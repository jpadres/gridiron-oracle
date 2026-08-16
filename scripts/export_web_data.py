#!/usr/bin/env python3
"""Genera el payload de la web y lo comprime.

## El flujo de datos de la web, y por qué es así

    scripts/*.py  ->  web/data/model.json      (JSON legible, NO se versiona)
                  ->  web/data/model.b64.js    (gzip + base64, ~24 KB, SÍ se versiona)
                  ->  web/data/model.js        (lo descomprime EN BUILD TIME)

El sitio no hace **ni una** petición de red en runtime: las seis páginas salen
estáticas con los datos ya dentro. Eso es lo que permite que la superficie de
ataque sea literalmente cero (sin endpoints, sin fetch, sin variables de
entorno) y que todo corra en el plan gratuito.

**Si regeneras los datos hay que recomprimir**, o la web seguirá mostrando los
anteriores sin dar ningún error. El paso está automatizado en
`.github/workflows/weekly-predictions.yml`.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.backtest.metrics import calibration_table, evaluate, summarize_ats
from oracle.backtest.walkforward import season_table, walk_forward
from oracle.config import DEFAULT_BACKTEST_START
from oracle.config import paths as resolve_paths
from oracle.pipeline import Oracle

# Límite de aviso del payload comprimido. No es un límite técnico: es la señal
# de que alguien ha metido en la web una tabla que debería ser un fichero
# descargable. A partir de ~200 KB el primer render se nota.
SIZE_WARNING_KB = 200


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera web/data/model.b64.js")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None, help="Temporada a publicar.")
    parser.add_argument("--week", type=int, default=None, help="Jornada a publicar.")
    parser.add_argument("--from", dest="first_season", type=int, default=DEFAULT_BACKTEST_START)
    parser.add_argument("--skip-backtest", action="store_true",
                        help="Reutiliza el backtest anterior (útil al iterar el diseño).")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    print("Entrenando el modelo de producción...")
    oracle = Oracle.train(args.root)

    payload: dict = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "placeholder": False,
    }

    # --- validación fuera de muestra ---------------------------------------
    backtest_cache = paths.out / "backtest.json"
    if args.skip_backtest and backtest_cache.exists():
        print("Reutilizando el backtest en caché.")
        payload["validation"] = json.loads(backtest_cache.read_text(encoding="utf-8"))
    else:
        print(f"Walk-forward desde {args.first_season} (esto tarda unos minutos)...")
        predictions, metrics = walk_forward(oracle.features, args.first_season)
        overall = evaluate(predictions)
        ats = summarize_ats(predictions)
        validation = {
            "overall": overall.to_dict(),
            "ats": ats.to_dict(),
            "seasons": season_table(metrics).to_dict(orient="records"),
            "calibration": calibration_table(predictions).astype(
                {"bin": str}
            ).to_dict(orient="records"),
        }
        backtest_cache.write_text(json.dumps(validation, default=str), encoding="utf-8")
        payload["validation"] = validation

    # --- jornada publicada --------------------------------------------------
    season, week = _resolve_week(oracle, args.season, args.week)
    payload["week"] = {"season": season, "week": week}
    print(f"Publicando {season} semana {week}.")

    week_predictions = oracle.predict(oracle.week_features(season, week))
    payload["predictions"] = _round_frame(
        week_predictions[
            [
                "game_id", "home_team", "away_team", "spread_line", "total_line",
                "pred_margin", "pred_margin_free", "pred_total", "home_win_prob",
                "edge_vs_line",
            ]
        ]
    ).to_dict(orient="records")

    bets = oracle.value_bets(week_predictions)
    payload["bets"] = _round_frame(bets).to_dict(orient="records") if not bets.empty else []

    payload["ratings"] = _round_frame(oracle.team_ratings()).to_dict(orient="records")

    # --- fantasy ------------------------------------------------------------
    payload["fantasy"] = _load_optional(paths.out / "fantasy_draft.json")
    payload["fantasy_weekly"] = _load_optional(paths.out / "fantasy_weekly.json")

    write_payload(paths.web_data, payload)
    return 0


def _resolve_week(oracle: Oracle, season: int | None, week: int | None) -> tuple[int, int]:
    """Si no se especifica, se publica la primera jornada sin jugar.

    Es lo que quiere el workflow semanal: la jornada que viene, no la que acaba
    de terminar.
    """
    if season is not None and week is not None:
        return season, week
    pending = oracle.features[~oracle.features["played"].astype(bool)]
    if pending.empty:
        last = oracle.features.iloc[-1]
        return int(last["season"]), int(last["week"])
    first = pending.sort_values(["season", "week"]).iloc[0]
    return int(first["season"]), int(first["week"])


def _round_frame(frame: pd.DataFrame, decimals: int = 4) -> pd.DataFrame:
    """Redondea los flotantes.

    No es cosmética: 15 decimales de un float multiplican por tres el tamaño del
    JSON antes de comprimir, y el payload viaja en el bundle de la página.
    """
    out = frame.copy()
    for column in out.select_dtypes(include=["float64", "float32"]).columns:
        out[column] = out[column].round(decimals)
    return out


def _load_optional(path: Path) -> object:
    if not path.exists():
        print(f"  (aviso) falta {path.name}: la sección saldrá vacía en la web.")
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _finite(value):
    """Convierte NaN e infinitos a null, recursivamente.

    **Esto no es opcional.** `json.dumps` de Python emite `NaN` e `Infinity` tal
    cual, y son extensiones que JavaScript **no** acepta: `JSON.parse` revienta
    con el payload entero, no sólo con el campo afectado.

    El fallo es especialmente traicionero porque no se ve en Python (que relee
    su propio NaN sin quejarse) y en la web se manifiesta como «todavía no hay
    datos generados» en *todas* las secciones — que parece un problema de
    generación, no de serialización. Un solo jugador sin fecha de nacimiento
    (`age`) basta para tumbar la página entera.
    """
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_finite(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def write_payload(web_data: Path, payload: dict) -> Path:
    """Escribe el JSON y su versión comprimida en base64."""
    web_data.mkdir(parents=True, exist_ok=True)

    # allow_nan=False convierte en excepción ruidosa cualquier no-finito que se
    # escape a `_finite`. Preferimos que falle el script a publicar una web que
    # se queda muda.
    raw = json.dumps(
        _finite(payload), ensure_ascii=False, default=str, separators=(",", ":"),
        allow_nan=False,
    )
    (web_data / "model.json").write_text(raw, encoding="utf-8")

    # mtime=0 para que el gzip sea reproducible: si no, cada ejecución produce
    # bytes distintos aunque los datos sean idénticos y el diff de git es ruido.
    compressed = gzip.compress(raw.encode("utf-8"), compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode("ascii")

    (web_data / "model.b64.js").write_text(
        "// GENERADO POR scripts/export_web_data.py — NO EDITAR A MANO.\n"
        "// gzip + base64 del payload del modelo. Lo descomprime model.js\n"
        "// en build time, para que las páginas salgan estáticas y el sitio\n"
        "// no haga ni una petición de red en runtime.\n"
        f"export const MODEL_B64 = \"{encoded}\";\n",
        encoding="utf-8",
    )

    size_kb = len(encoded) / 1024
    print(f"Escrito web/data/model.b64.js ({size_kb:.1f} KB en base64).")
    if size_kb > SIZE_WARNING_KB:
        print(f"  AVISO: por encima de {SIZE_WARNING_KB} KB. ¿Hay una tabla que sobra?")
    return web_data / "model.b64.js"


if __name__ == "__main__":
    raise SystemExit(main())
