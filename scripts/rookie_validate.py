#!/usr/bin/env python3
"""¿Bate la previa de rookie a sus baselines? Umbral en PREREGISTRO_rookies.md

    Walk-forward estricto: la previa de la temporada S sólo ve rookies de < S.
    Evaluación sobre 2016-2025.

Baseline A: cero (lo que hay hoy — el rookie no existe en el board).
Baseline B: la media de todos los rookies de esa posición, sin capital de draft.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd
from scipy.stats import spearmanr

from oracle.config import paths as resolve_paths
from oracle.fantasy.rookies import FANTASY_POSITIONS, fit, predict, season_table
from oracle.fantasy.scoring import PPR

FIRST_TRAINING_SEASON = 2006
EVALUATION = range(2016, 2026)


def rookie_table(paths) -> pd.DataFrame:
    """Rookies con su capital de draft y los puntos que hicieron ese año.

    La construye `oracle.fantasy.rookies.season_table`, que es la MISMA que usa
    el board. Antes vivía aquí duplicada, y una tabla de validación que no es la
    de producción valida otra cosa.
    """
    table = season_table(paths.raw, pd.read_parquet(paths.player_weeks), PPR)
    return table[table["season"] >= FIRST_TRAINING_SEASON]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=None)
    args = parser.parse_args()
    paths = resolve_paths(args.root).ensure()
    table = rookie_table(paths)
    print(f"{len(table):,} temporadas de rookie desde {FIRST_TRAINING_SEASON}\n")

    filas = []
    for season in EVALUATION:
        priors = fit(table, season)
        cohort = table[table["season"] == season]
        past = table[table["season"] < season]
        if cohort.empty or not priors:
            continue
        position_mean = past.groupby("position")["points"].mean()
        for row in cohort.itertuples(index=False):
            prior = predict(priors, row.position, row.draft_number)
            if prior is None:
                continue
            filas.append({
                "season": season, "position": row.position, "real": row.points,
                "modelo": prior.shrunk_mean,
                "baseline_cero": 0.0,
                "baseline_posicion": float(position_mean.get(row.position, 0.0)),
            })
    ev = pd.DataFrame(filas)
    print(f"{len(ev):,} rookies evaluados sobre {EVALUATION.start}-{EVALUATION.stop-1}\n")

    print(f"{'':26}{'MAE':>9}{'Spearman':>11}")
    out = {}
    for name, col in (("previa por capital", "modelo"),
                      ("baseline A: cero", "baseline_cero"),
                      ("baseline B: media pos.", "baseline_posicion")):
        mae = float((ev[col] - ev["real"]).abs().mean())
        rho = (float(spearmanr(ev[col], ev["real"]).statistic)
               if ev[col].nunique() > 1 else float("nan"))
        out[name] = {"mae": mae, "rho": rho}
        print(f"{name:26}{mae:>9.2f}{rho:>11.3f}")

    gana = (out["previa por capital"]["mae"] < out["baseline A: cero"]["mae"]
            and out["previa por capital"]["mae"] < out["baseline B: media pos."]["mae"]
            and out["previa por capital"]["rho"] > 0)
    print(f"\nBate a los dos baselines: {'SÍ' if gana else 'NO'}")
    rho = out["previa por capital"]["rho"]
    print(f"Umbral de alarma (Spearman > 0,75): {'SALTA — investigar' if rho > 0.75 else 'no salta'}")

    print("\nPor posición:")
    print(f"{'pos':5}{'n':>6}{'MAE':>9}{'Spearman':>11}")
    for position in FANTASY_POSITIONS:
        g = ev[ev.position == position]
        if len(g) < 30:
            continue
        print(f"{position:5}{len(g):>6}{(g.modelo-g.real).abs().mean():>9.2f}"
              f"{spearmanr(g.modelo, g.real).statistic:>11.3f}")

    json.dump({"metricas": out, "gana": gana}, open("/tmp/rookie_validate.json", "w"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
