#!/usr/bin/env python3
"""Recalibra el ranking semanal y lo valida contra el listón que importa.

## La separación que hace que esto signifique algo

    Calibración: 2022-2023   (se ajustan los multiplicadores por posición)
    Evaluación:  2024-2025   (NO se toca nada, sólo se mide)

Ajustar y evaluar sobre el mismo periodo produce siempre una mejora aparente. La
separación temporal es lo único que convierte "mi modelo mejora" en una
afirmación comprobable.

## El listón

No se compara contra cero ni contra una media global: se compara contra **la
media ponderada de los últimos seis partidos del jugador**, que cualquiera
calcula en dos minutos. Un modelo semanal de fantasy que no bata a eso no
justifica su existencia.

El resultado esperado es una mejora **pequeña**: dos décimas de punto de error y
un punto de acierto cara a cara. El fantasy semanal es, en su mayor parte, ruido;
quien prometa más que esto no lo ha medido.
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
from oracle.fantasy.scoring import rules_from_name, score_player_weeks
from oracle.fantasy.weekly import FORM_DECAY, FORM_WINDOW, WeeklyCalibration, weekly_rankings
from oracle.pipeline import Oracle

CALIBRATION_SEASONS = (2022, 2023)
EVALUATION_SEASONS = (2024, 2025)
POSITIONS = ("QB", "RB", "WR", "TE")

# Umbral de aceptación, FIJADO ANTES DE VER EL RESULTADO. Si el modelo no supera
# esto en las cuatro posiciones, el cambio se revierte y se publica igualmente
# que no funcionó.
ACCEPTANCE = {"spearman_gain": 0.0, "mae_gain": 0.0}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recalibra y valida el ranking semanal.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--scoring", default="ppr")
    parser.add_argument("--write", action="store_true",
                        help="Guarda los multiplicadores nuevos si superan el umbral.")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    rules = rules_from_name(args.scoring)
    players = pd.read_parquet(paths.player_weeks)

    print("Entrenando el modelo de partidos...")
    oracle = Oracle.train(args.root)

    print(f"\nAjustando multiplicadores con {CALIBRATION_SEASONS}...")
    fitted = _fit_multipliers(players, oracle, rules, CALIBRATION_SEASONS)
    for position, value in fitted.multipliers.items():
        print(f"  {position}: {value:.3f}")

    print(f"\nEvaluando sobre {EVALUATION_SEASONS} SIN volver a tocar nada...")
    report = _evaluate(players, oracle, rules, fitted, EVALUATION_SEASONS)
    print(report.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))

    beats_baseline = bool(
        (report["spearman_model"] > report["spearman_baseline"] + ACCEPTANCE["spearman_gain"]).all()
        and (report["mae_model"] < report["mae_baseline"] - ACCEPTANCE["mae_gain"]).all()
    )
    print(
        "\nBate al baseline en las cuatro posiciones: "
        + ("SÍ" if beats_baseline else "NO — y se publica igual, esa es la regla")
    )

    if args.write:
        if not beats_baseline:
            print("No se escribe la calibración: no supera el umbral fijado de antemano.")
            return 1
        destination = paths.out / "fantasy_weekly_calibration.json"
        destination.write_text(
            json.dumps({"multipliers": fitted.multipliers,
                        "evaluated_on": list(EVALUATION_SEASONS),
                        "report": report.round(4).to_dict(orient="records")},
                       ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"Escrito {destination}")
    return 0


def _weeks_of(players: pd.DataFrame, seasons: tuple[int, ...]) -> list[tuple[int, int]]:
    subset = players[players["season"].isin(seasons)]
    # A partir de la semana 4: antes no hay forma reciente que medir, y la
    # comparación contra el baseline de seis partidos no sería justa.
    return [
        (int(season), int(week))
        for season, week in subset[["season", "week"]].drop_duplicates().itertuples(index=False)
        if week >= 4
    ]


def _project_weeks(
    players: pd.DataFrame, oracle: Oracle, rules, calibration, seasons: tuple[int, ...]
) -> pd.DataFrame:
    """Proyecta todas las jornadas del periodo y las une con el resultado real."""
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)

    frames = []
    for season, week in _weeks_of(players, seasons):
        try:
            predictions = oracle.predict(oracle.week_features(season, week))
            ranking = weekly_rankings(scored, predictions, season, week, rules, calibration)
        except ValueError:
            continue
        if ranking.empty:
            continue
        frames.append(ranking)

    if not frames:
        return pd.DataFrame()

    projected = pd.concat(frames, ignore_index=True)
    truth = scored[["player_id", "season", "week", "fantasy_points"]]
    return projected.merge(truth, on=["player_id", "season", "week"], how="inner")


def _fit_multipliers(players, oracle, rules, seasons) -> WeeklyCalibration:
    """Un multiplicador por posición: el cociente entre lo real y lo proyectado.

    Es deliberadamente el ajuste más simple posible. Cualquier cosa más rica
    (por equipo, por rango de proyección) ajustaría ruido: hay unas 2.000
    observaciones útiles por posición y periodo, no 200.000.
    """
    neutral = WeeklyCalibration(multipliers=dict.fromkeys(POSITIONS, 1.0))
    joined = _project_weeks(players, oracle, rules, neutral, seasons)
    if joined.empty:
        return WeeklyCalibration()

    multipliers = {}
    for position in POSITIONS:
        group = joined[joined["position"] == position]
        if len(group) < 200:
            multipliers[position] = 1.0
            continue
        multipliers[position] = float(
            group["fantasy_points"].mean() / max(group["projected_points"].mean(), 1e-9)
        )
    return WeeklyCalibration(multipliers=multipliers)


def _evaluate(players, oracle, rules, calibration, seasons) -> pd.DataFrame:
    """Modelo frente al baseline de seis partidos, por posición."""
    joined = _project_weeks(players, oracle, rules, calibration, seasons)
    if joined.empty:
        return pd.DataFrame()

    rows = []
    for position in POSITIONS:
        group = joined[joined["position"] == position].dropna(
            subset=["projected_points", "baseline_points", "fantasy_points"]
        )
        if len(group) < 100:
            continue
        truth = group["fantasy_points"].to_numpy(dtype=float)
        model = group["projected_points"].to_numpy(dtype=float)
        baseline = group["baseline_points"].to_numpy(dtype=float)
        rows.append(
            {
                "position": position,
                "observations": len(group),
                "spearman_model": float(spearmanr(model, truth)[0]),
                "spearman_baseline": float(spearmanr(baseline, truth)[0]),
                "mae_model": float(np.mean(np.abs(model - truth))),
                "mae_baseline": float(np.mean(np.abs(baseline - truth))),
                "head_to_head": _head_to_head(group),
            }
        )
    return pd.DataFrame(rows)


def _head_to_head(group: pd.DataFrame) -> float:
    """Dos jugadores de la misma posición y semana: ¿acierta el orden?

    Es la métrica que de verdad se corresponde con la decisión que toma un
    usuario ("¿a cuál de estos dos alineo?"), y es mucho más exigente que una
    correlación global.
    """
    correct = total = 0
    for _, week_group in group.groupby(["season", "week"], observed=True):
        values = week_group[["projected_points", "fantasy_points"]].to_numpy(dtype=float)
        n = len(values)
        if n < 2:
            continue
        for i in range(n):
            for j in range(i + 1, n):
                if values[i, 1] == values[j, 1]:
                    continue
                total += 1
                predicted_order = values[i, 0] > values[j, 0]
                actual_order = values[i, 1] > values[j, 1]
                correct += predicted_order == actual_order
    return correct / total if total else float("nan")


if __name__ == "__main__":
    print(f"(La forma reciente usa {FORM_WINDOW} partidos con decaimiento {FORM_DECAY}.)")
    raise SystemExit(main())
