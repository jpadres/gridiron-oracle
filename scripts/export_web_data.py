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

# Columnas que la web pinta de cada tabla de fantasy. Cualquier otra cosa que
# lleve el artefacto de `out/` es intermedio del modelo y no viaja al bundle.
DRAFT_COLUMNS = (
    "player_id", "overall_rank", "player_name", "position", "team", "position_rank",
    "tier", "projected_points", "vor",
)
WEEKLY_COLUMNS = (
    "player_id", "position_rank", "player_name", "position", "team", "opponent",
    "projected_points", "baseline_points", "matchup_multiplier",
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera web/data/model.b64.js")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None, help="Temporada a publicar.")
    parser.add_argument("--week", type=int, default=None, help="Jornada a publicar.")
    parser.add_argument("--from", dest="first_season", type=int, default=DEFAULT_BACKTEST_START)
    parser.add_argument("--skip-backtest", action="store_true",
                        help="Reutiliza el backtest anterior (útil al iterar el diseño).")
    parser.add_argument("--with-narrative", action="store_true",
                        help="Genera resumen y explicaciones con Claude (necesita ANTHROPIC_API_KEY).")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    print("Entrenando el modelo de producción...")
    oracle = Oracle.train(args.root)

    payload: dict = {
        "generated_at": pd.Timestamp.now("UTC").isoformat(),
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
    # Se recortan a las columnas que la web pinta. Los artefactos de `out/`
    # llevan además los intermedios del modelo (ppg_shrunk, weighted_games,
    # age_factor...), que son imprescindibles para depurar y no pintan nada en
    # la página. Dejarlos dentro triplica el payload, y el payload viaja en el
    # bundle de cada página.
    payload["fantasy"] = _trim_records(
        _load_optional(paths.out / "fantasy_draft.json"), "board", DRAFT_COLUMNS
    )
    payload["fantasy_weekly"] = _trim_records(
        _load_optional(paths.out / "fantasy_weekly.json"), "rankings", WEEKLY_COLUMNS
    )

    # --- research (prensa e insiders) ---------------------------------------
    # Viaja aparte de todo lo anterior a propósito: son afirmaciones de terceros
    # con su fuente al lado, no salidas del modelo, y no entran en ningún cálculo.
    payload["research"] = _research(paths, payload)

    # --- dossier curado (parte médico, campamento, reporteros) ---------------
    # Atribuido y fechado, pero SIN enlace: por eso viaja aparte del research y
    # la web lo dice donde se enseña. Ver `narrative/dossier.py`.
    payload["dossier"] = _dossier(paths, payload)

    # --- survivor -----------------------------------------------------------
    # Lo genera `scripts/survivor_build.py`. Es el único sitio del proyecto
    # donde el modelo tiene ventaja real: no compite contra un mercado, compite
    # contra el calendario.
    payload["survivor"] = _load_optional(paths.out / "survivor.json")

    # --- textos generados ---------------------------------------------------
    if args.with_narrative:
        payload["narrative"] = _narrative(payload)

    write_payload(paths.web_data, payload)
    return 0


def _research(paths, payload: dict) -> dict | None:
    """La sección de prensa: del artefacto del día si está, y si no, del archivo.

    La segunda vía no es un lujo. `out/` no se versiona, así que la
    regeneración semanal corre sobre un checkout limpio donde `research.json` no
    existe — y sin reconstruirla desde `research/`, la sección de prensa
    desaparecería de la web cada miércoles.
    """
    cached = paths.out / "research.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))

    from oracle.narrative import archive

    weekly = payload.get("fantasy_weekly") or {}
    section = archive.consolidate(paths.root, days=10, players=weekly.get("rankings", []))
    if section is None:
        print("  (aviso) sin research: la sección saldrá vacía en la web.")
    return section


def _dossier(paths, payload: dict) -> dict | None:
    """El dossier curado, con cada entrada colgada de su jugador del ranking."""
    path = paths.root / "research" / "dossier.json"
    if not path.exists():
        return None

    from oracle.narrative import dossier as dossier_module

    data = json.loads(path.read_text(encoding="utf-8"))
    players = (payload.get("fantasy_weekly") or {}).get("rankings", [])
    board = (payload.get("fantasy") or {}).get("board", [])
    # Se busca en las dos listas: el board de draft tiene 250 jugadores y el
    # ranking semanal sólo a los titulares, así que un suplente lesionado sólo
    # aparece en el primero — y es justo el que interesa marcar.
    dossier_module.attach_players(data.get("medical", []), players + board)
    dossier_module.attach_players(data.get("camp", []), players + board)
    # El parte médico viaja entero porque la etiqueta de disponibilidad de cada
    # fila del board se saca de él. Los reportes de campamento, no: sólo se
    # pintan los de sustancia alta, y los otros 71 son 18 KB de bundle que nadie
    # ve. Siguen en `research/dossier.json`, que es el archivo.
    data["camp"] = [entry for entry in data.get("camp", []) if entry["substance"] == "alta"]
    linked = sum(1 for entry in data.get("medical", []) if entry.get("player_id"))
    print(f"  dossier: {len(data.get('medical', []))} avisos médicos, {linked} sobre un jugador del board.")
    return data


def _narrative(payload: dict) -> dict | None:
    """Resumen de la jornada y explicaciones, verificados contra los propios datos.

    Se hace aquí y no en un script aparte porque el contexto que necesita el
    texto —predicciones, validación y ranking de la semana— ya está montado en
    memoria en este punto. Un script independiente tendría que reentrenar el
    modelo para reconstruirlo.
    """
    from oracle.narrative import weekly as narrative_weekly
    from oracle.narrative.client import NarrativeUnavailable, available

    if not available():
        print("  (aviso) sin ANTHROPIC_API_KEY: la web sale sin resumen ni explicaciones.")
        return None

    context = _narrative_context(payload)
    try:
        print("Redactando el resumen de la jornada...")
        summary = narrative_weekly.week_summary(context)
        players = _players_to_explain(payload)
        print(f"Explicando {len(players)} jugadores...")
        notes = narrative_weekly.player_notes(players, context["semana"]) if players else []
    except NarrativeUnavailable as error:
        print(f"  (aviso) la API no respondió: {error}. La web sale sin textos.")
        return None

    if not summary and not notes:
        return None
    return {
        "generated_at": pd.Timestamp.now("UTC").isoformat(),
        "summary": summary,
        "player_notes": {note["player_id"]: note["text"] for note in notes},
    }


def _narrative_context(payload: dict) -> dict:
    """El material que ve el redactor: sólo números del modelo, y pocos.

    Recortado a conciencia. Cada número que entra aquí es un número que el texto
    puede citar —el verificador de `factcheck` lo autoriza— así que meter la
    tabla entera no es generosidad, es ampliar la superficie de error.
    """
    predictions = sorted(
        payload.get("predictions", []),
        key=lambda row: -abs(row.get("edge_vs_line") or 0),
    )[:6]
    weekly = payload.get("fantasy_weekly") or {}
    rankings = weekly.get("rankings", [])
    return {
        "jornada": payload.get("week"),
        "validacion": (payload.get("validation") or {}).get("overall"),
        "partidos_donde_mas_se_separa_del_mercado": predictions,
        "semana": {
            "jornada": payload.get("week"),
            "jugadores": _with_delta(rankings)[:40],
        },
    }


def _players_to_explain(payload: dict) -> list[dict]:
    """Los que valen una explicación: los mejores de cada puesto y los que más se mueven.

    No todo el ranking. Explicar al número 34 de receptores cuesta lo mismo que
    explicar al primero y no lo lee nadie.
    """
    weekly = payload.get("fantasy_weekly") or {}
    rows = _with_delta(weekly.get("rankings", []))
    chosen: dict[str, dict] = {}
    for position in ("QB", "RB", "WR", "TE"):
        group = [row for row in rows if row.get("position") == position]
        top = sorted(group, key=lambda row: -(row.get("projected_points") or 0))[:3]
        movers = sorted(group, key=lambda row: -abs(row.get("delta") or 0))[:2]
        for row in top + movers:
            chosen[str(row.get("player_id"))] = row
    return list(chosen.values())[:20]


def _with_delta(rows: list[dict]) -> list[dict]:
    """Añade la diferencia con el listón.

    El texto la va a mencionar seguro, y `factcheck` sólo deja citar números que
    estén en los datos. Calcularla aquí es lo que evita que el modelo tenga que
    restar de cabeza — y que el validador lo rechace por hacerlo bien.
    """
    out = []
    for row in rows:
        projected = row.get("projected_points")
        baseline = row.get("baseline_points")
        enriched = dict(row)
        if projected is not None and baseline is not None:
            enriched["delta"] = round(projected - baseline, 2)
        out.append(enriched)
    return out


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


def _trim_records(section: object, key: str, columns: tuple[str, ...]) -> object:
    """Deja en `section[key]` sólo las columnas indicadas.

    Tolera que la sección no exista (los artefactos de fantasy son opcionales) y
    que a una fila le falte alguna columna: se omite en vez de fallar, porque un
    board generado con una versión anterior del script sigue siendo publicable.
    """
    if not isinstance(section, dict) or key not in section:
        return section
    section[key] = [
        {c: row[c] for c in columns if c in row} for row in section[key]
    ]
    return section


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
