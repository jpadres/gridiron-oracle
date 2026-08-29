#!/usr/bin/env python3
"""¿Bate el modelo de pateadores a sus dos baselines? Umbral en PREREGISTRO_kickers.md

    Calibración: 2018-2021    Evaluación: 2022-2025, sin volver a tocar nada

Baseline A: el pateador medio de la liga (una constante).
Baseline B: la media ponderada de los últimos seis partidos del pateador.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from oracle.config import paths as resolve_paths
from oracle.fantasy.kickers import (
    DISTANCE_BUCKETS,
    KickerScoring,
    distance_mix,
    fit_opportunity,
    project,
)

CALIBRATION = (2018, 2019, 2020, 2021)
EVALUATION = (2022, 2023, 2024, 2025)
FORM_WINDOW, FORM_DECAY = 6, 0.85


def score_kicker(rows: pd.DataFrame, scoring: KickerScoring = KickerScoring()) -> pd.Series:
    points = rows["pat_made"].fillna(0) * scoring.pat_made
    points += (rows["pat_att"].fillna(0) - rows["pat_made"].fillna(0)) * scoring.pat_missed
    for index, (made_col, _m) in enumerate(DISTANCE_BUCKETS):
        if made_col in rows:
            points += rows[made_col].fillna(0) * scoring.by_bucket[index]
    misses = rows["fg_att"].fillna(0) - rows["fg_made"].fillna(0)
    return points + misses * scoring.fg_missed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=None)
    args = parser.parse_args()
    paths = resolve_paths(args.root).ensure()

    pw = pd.read_parquet(paths.player_weeks)
    k = pw[(pw["position"] == "K") & (pw["season_type"] == "REG")].copy()
    k["fantasy_points"] = score_kicker(k)

    tg = pd.read_parquet(paths.team_games)
    team_points = tg[["season", "week", "team", "points_for"]].copy()

    # AJUSTE con puntos reales: se está estimando la relación estructural entre
    # los puntos de un equipo y los intentos de su pateador, y para eso el dato
    # correcto es el observado.
    cal = k[k["season"].isin(CALIBRATION)]
    model = fit_opportunity(cal, team_points)
    mix = distance_mix(cal)
    print(f"Ajustado sobre {CALIBRATION} — {len(cal):,} pateador-semanas")
    print(f"  intentos de PAT = {model.pat_intercept:.3f} + {model.pat_slope:.4f} x puntos")
    print(f"  intentos de FG  = {model.fg_intercept:.3f} + {model.fg_slope:.4f} x puntos")
    print(f"  acierto PAT liga: {model.pat_rate:.3f}")
    print("  acierto FG por tramo: " + ", ".join(
        f"{c.replace('fg_made_','')}={v:.3f}" for c, v in model.conversion.items()
        if np.isfinite(v)))

    # EVALUACIÓN con los puntos PROYECTADOS por el modelo de partidos, no con
    # los reales. La primera versión de este script usó los reales y sacó
    # Spearman 0,410 — por encima del umbral de alarma del preregistro. La
    # investigación que ese umbral obliga a hacer encontró la causa en un
    # minuto: le estaba dando la respuesta. Un pateador no se proyecta sabiendo
    # el marcador final.
    #
    # `backtest_preds.parquet` son predicciones walk-forward: cada temporada
    # pronosticada con un modelo que no la ha visto.
    preds = pd.read_parquet(paths.out / "backtest_preds.parquet")
    lados = []
    for row in preds.itertuples(index=False):
        for team, sign in ((row.home_team, 1.0), (row.away_team, -1.0)):
            lados.append({
                "season": int(row.season), "week": int(row.week), "team": team,
                "pred_points": (row.pred_total + sign * row.pred_margin) / 2.0,
            })
    proyectados = pd.DataFrame(lados)

    ev = k[k["season"].isin(EVALUATION)].merge(
        proyectados, on=["season", "week", "team"], how="inner"
    )
    ev = ev.sort_values(["season", "week"])
    ev["proyectado"] = [project(p, model, mix) for p in ev["pred_points"]]

    # Baseline B: media ponderada de sus últimos seis partidos, estrictamente
    # anteriores. Se calcula con un desplazamiento para no verse a sí misma.
    def recent(group: pd.DataFrame) -> pd.Series:
        values = group["fantasy_points"].to_numpy(dtype=float)
        out = np.full(len(values), np.nan)
        for i in range(len(values)):
            past = values[max(0, i - FORM_WINDOW):i]
            if len(past) == 0:
                continue
            w = FORM_DECAY ** np.arange(len(past) - 1, -1, -1)
            out[i] = float((past * w).sum() / w.sum())
        return pd.Series(out, index=group.index)

    ev["baseline_forma"] = (
        ev.groupby("player_id", group_keys=False)[["fantasy_points"]].apply(recent)
    )
    ev["baseline_medio"] = cal["fantasy_points"].mean()
    ev = ev.dropna(subset=["baseline_forma"])

    print(f"\nEvaluación sobre {EVALUATION} — {len(ev):,} pateador-semanas\n")
    print(f"{'':22}{'MAE':>8}{'Spearman':>11}")
    out = {}
    for name, col in (("modelo", "proyectado"),
                      ("baseline A: media liga", "baseline_medio"),
                      ("baseline B: su forma", "baseline_forma")):
        mae = float((ev[col] - ev["fantasy_points"]).abs().mean())
        rho = float(spearmanr(ev[col], ev["fantasy_points"]).statistic) if ev[col].nunique() > 1 else float("nan")
        out[name] = {"mae": mae, "rho": rho}
        print(f"{name:22}{mae:>8.3f}{rho:>11.3f}")

    gana = (out["modelo"]["mae"] < out["baseline A: media liga"]["mae"]
            and out["modelo"]["mae"] < out["baseline B: su forma"]["mae"]
            and out["modelo"]["rho"] > out["baseline B: su forma"]["rho"])
    print(f"\nBate a los dos baselines (MAE y Spearman): {'SÍ' if gana else 'NO'}")

    # La separación real entre K1 y K12, que es la cifra que el preregistro
    # obliga a publicar tanto si el modelo gana como si no.
    ev["rk"] = ev.groupby(["season","week"])["proyectado"].rank(ascending=False, method="first")
    k1 = ev[ev.rk <= 1]
    k12 = ev[(ev.rk > 11) & (ev.rk <= 12)]
    print(f"\nSeparación real K1 vs K12 (proyectado): "
          f"{k1.proyectado.mean():.2f} vs {k12.proyectado.mean():.2f} = "
          f"{k1.proyectado.mean()-k12.proyectado.mean():.2f} pts/partido")
    print(f"Separación REALIZADA K1 vs K12:          "
          f"{k1.fantasy_points.mean():.2f} vs {k12.fantasy_points.mean():.2f} = "
          f"{k1.fantasy_points.mean()-k12.fantasy_points.mean():.2f} pts/partido")
    print(f"Desviación típica de los puntos de un pateador en una jornada: "
          f"{ev.fantasy_points.std():.2f}")
    json.dump({"metricas": out, "gana": gana,
               "k1_k12_proyectado": float(k1.proyectado.mean()-k12.proyectado.mean()),
               "k1_k12_realizado": float(k1.fantasy_points.mean()-k12.fantasy_points.mean())},
              open("/tmp/kicker_validate.json","w"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
