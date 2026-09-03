#!/usr/bin/env python3
"""Experimento del clima: ¿viento y temperatura añaden algo al modelo?

Preregistro en `docs/PREREGISTRO_clima.md`, escrito ANTES de correr esto. El
umbral de aceptación está fijado allí y no se toca al ver el resultado.

No modifica el modelo de producción: construye las columnas nuevas, parchea
`FEATURE_COLUMNS` durante la corrida de la variante y compara los dos
walk-forward con las MISMAS temporadas. Si el experimento no pasa el umbral, no
queda ni rastro en `src/`.

    python scripts/weather_experiment.py --from 2012
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.backtest.walkforward import walk_forward  # noqa: E402
from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.data import features as features_mod  # noqa: E402
from oracle.models import predictor as predictor_mod  # noqa: E402

EXTRA = ["wind_mph", "temp_f", "wind_outdoor", "weather_known"]

# Bajo techo no hay viento y la temperatura es de sala. No es una imputación:
# es el hecho del estadio cerrado.
INDOOR_TEMP_F = 70.0


def build(paths) -> pd.DataFrame:
    """Las features de siempre más las tres columnas del clima."""
    feats = pd.read_parquet(paths.processed / "features.parquet")
    games = pd.read_parquet(paths.processed / "games.parquet")
    cols = ["game_id", "temp", "wind", "roof", "stadium_id"]
    frame = feats.merge(games[cols], on="game_id", how="left")

    indoors = frame["indoors"].astype(float).fillna(0.0)
    wind = pd.to_numeric(frame["wind"], errors="coerce")
    temp = pd.to_numeric(frame["temp"], errors="coerce")

    # Bajo techo, el dato se CONOCE aunque venga vacío.
    known = (indoors > 0.5) | (wind.notna() & temp.notna())

    wind = wind.where(indoors < 0.5, 0.0)
    temp = temp.where(indoors < 0.5, INDOOR_TEMP_F)

    # Lo que falte, la mediana de esa sede en el HISTORIAL PREVIO. Nada de la
    # mediana global de todo el fichero: incluiría partidos futuros, que es la
    # fuga que este proyecto persigue.
    frame = frame.sort_values(["season", "week"]).reset_index(drop=True)
    for col, serie in (("wind_mph", wind), ("temp_f", temp)):
        valores = serie.to_numpy(dtype=float)
        por_sede: dict[str, list[float]] = {}
        salida = np.empty(len(valores))
        for i, (sede, v) in enumerate(zip(frame["stadium_id"].fillna("?"), valores, strict=True)):
            if np.isfinite(v):
                salida[i] = v
                por_sede.setdefault(sede, []).append(v)
            else:
                previos = por_sede.get(sede) or [x for xs in por_sede.values() for x in xs]
                salida[i] = float(np.median(previos)) if previos else (
                    0.0 if col == "wind_mph" else INDOOR_TEMP_F
                )
        frame[col] = salida

    frame["wind_outdoor"] = frame["wind_mph"] * (1.0 - indoors)
    frame["weather_known"] = known.astype(float)
    return frame


def corre(frame: pd.DataFrame, columnas: list[str], first: int):
    """Un walk-forward con la lista de features dada."""
    original = list(features_mod.FEATURE_COLUMNS)
    features_mod.FEATURE_COLUMNS[:] = columnas
    predictor_mod.FEATURE_COLUMNS = features_mod.FEATURE_COLUMNS
    try:
        preds, metrics = walk_forward(frame, first_season=first)
    finally:
        features_mod.FEATURE_COLUMNS[:] = original
        predictor_mod.FEATURE_COLUMNS = features_mod.FEATURE_COLUMNS
    return preds, metrics


def totales(preds: pd.DataFrame) -> pd.DataFrame:
    hay = preds["total"].notna() & preds["pred_total"].notna()
    out = preds.loc[hay, ["season", "total", "pred_total", "total_line"]].copy()
    out["err"] = (out["total"] - out["pred_total"]).abs()
    out["err_line"] = (out["total"] - out["total_line"]).abs()
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="¿Añade algo el clima?")
    parser.add_argument("--root", default=None)
    parser.add_argument("--from", dest="first", type=int, default=2012)
    args = parser.parse_args(argv)
    paths = resolve_paths(args.root)

    frame = build(paths)
    base_cols = [c for c in features_mod.FEATURE_COLUMNS]
    print(f"Partidos: {len(frame)} · features base: {len(base_cols)} · +{len(EXTRA)}")
    print(f"Con clima conocido: {frame['weather_known'].mean():.1%}")

    print("\n=== BASE ===", flush=True)
    base_preds, base_metrics = corre(frame, base_cols, args.first)
    print("\n=== CON CLIMA ===", flush=True)
    var_preds, var_metrics = corre(frame, base_cols + EXTRA, args.first)

    bt = totales(base_preds)
    vt = totales(var_preds)
    assert len(bt) == len(vt), "los dos walk-forward tienen que cubrir los mismos partidos"

    mae_base = float(bt["err"].mean())
    mae_var = float(vt["err"].mean())
    mae_line = float(bt["err_line"].mean())

    por_temporada = []
    for season in sorted(bt["season"].unique()):
        b = float(bt.loc[bt["season"] == season, "err"].mean())
        v = float(vt.loc[vt["season"] == season, "err"].mean())
        por_temporada.append({"season": int(season), "base": b, "clima": v, "delta": b - v})

    margen_base = float(np.mean([m.margin_mae for m in base_metrics.values()]))
    margen_var = float(np.mean([m.margin_mae for m in var_metrics.values()]))
    brier_base = float(np.mean([m.brier for m in base_metrics.values()]))
    brier_var = float(np.mean([m.brier for m in var_metrics.values()]))

    ultimas = por_temporada[-4:]
    gana = sum(1 for t in ultimas if t["delta"] > 0)
    mejora = mae_base - mae_var

    print("\n=== RESULTADO ===")
    print(f"MAE de totales   base {mae_base:.3f}  clima {mae_var:.3f}  "
          f"mejora {mejora:+.3f}   (la línea sola: {mae_line:.3f})")
    print(f"MAE de margen    base {margen_base:.3f}  clima {margen_var:.3f}  "
          f"delta {margen_var - margen_base:+.3f}")
    print(f"Brier            base {brier_base:.4f}  clima {brier_var:.4f}  "
          f"delta {brier_var - brier_base:+.4f}")
    print("\nPor temporada (MAE de totales):")
    for t in por_temporada:
        print(f"  {t['season']}  base {t['base']:.3f}  clima {t['clima']:.3f}  {t['delta']:+.3f}")
    print(f"\nÚltimas cuatro: gana {gana} de 4")

    # El umbral del preregistro, aplicado tal cual está escrito.
    ok_mae = mejora >= 0.15
    ok_temporadas = gana >= 3
    ok_resto = (margen_var - margen_base) <= 0.01 and (brier_var - brier_base) <= 0.0005
    if ok_mae and ok_temporadas and ok_resto:
        veredicto = "ACEPTADO"
    elif ok_mae and not ok_temporadas:
        veredicto = "INCONCLUSO (mejora la media, no las temporadas)"
    else:
        veredicto = "RECHAZADO"
    print(f"\nVEREDICTO: {veredicto}")
    print(f"  umbral MAE >= 0.15: {ok_mae} ({mejora:+.3f})")
    print(f"  3 de las ultimas 4: {ok_temporadas} ({gana})")
    print(f"  no empeora el resto: {ok_resto}")

    salida = paths.out / "weather_experiment.json"
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps({
        "veredicto": veredicto,
        "mae_totales": {"base": mae_base, "clima": mae_var, "linea": mae_line},
        "mae_margen": {"base": margen_base, "clima": margen_var},
        "brier": {"base": brier_base, "clima": brier_var},
        "por_temporada": por_temporada,
        "gana_ultimas_4": gana,
    }, indent=2), encoding="utf-8")
    print(f"\nEscrito {salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
