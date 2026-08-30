#!/usr/bin/env python3
"""Ranking semanal de fantasy por posición.

Necesita el modelo de partidos entrenado: el puente entre los dos modelos es el
guion de juego (`pred_margin` y `pred_total`), que decide cuántas jugadas tendrá
cada equipo y de qué tipo.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.fantasy.scoring import rules_from_name
from oracle.fantasy.weekly import (
    WeeklyCalibration,
    weekly_defenses,
    weekly_kickers,
    weekly_rankings,
)
from oracle.pipeline import Oracle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ranking semanal de fantasy.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--scoring", default="ppr")
    parser.add_argument("--top", type=int, default=30, help="Jugadores por posición a imprimir.")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    rules = rules_from_name(args.scoring)
    players = pd.read_parquet(paths.player_weeks)

    print("Entrenando el modelo de partidos...")
    oracle = Oracle.train(args.root)
    predictions = oracle.predict(oracle.week_features(args.season, args.week))

    calibration = _load_calibration(paths.out / "fantasy_weekly_calibration.json")

    print(f"Proyectando {args.season} semana {args.week}...")
    rankings = weekly_rankings(
        players, predictions, args.season, args.week, rules, calibration
    )

    for position in ("QB", "RB", "WR", "TE"):
        group = rankings[rankings["position"] == position].head(args.top)
        if group.empty:
            continue
        print(f"\n--- {position} ---")
        view = group[
            ["position_rank", "player_name", "team", "opponent", "projected_points",
             "matchup_multiplier"]
        ]
        print(view.to_string(index=False, float_format=lambda x: f"{x:7.2f}"))

    # Pateadores y defensas viajan en claves APARTE del ranking, porque su
    # autoridad es otra: el K tiene proyección validada (E8) pero orden
    # rechazado (E8b), y la defensa sólo tiene hechos (DST_STREAMING es
    # DESIGN_ONLY). Mezclarlos en `rankings` les prestaría una autoridad que no
    # tienen.
    team_games = pd.read_parquet(paths.team_games)
    kickers = weekly_kickers(players, team_games, predictions, args.season, args.week)
    defenses = weekly_defenses(team_games, predictions, args.season, args.week)
    print(f"\nPateadores proyectados: {len(kickers)} (sin rank ordinal, a propósito)")
    print(f"Defensas con contexto: {len(defenses)}")

    destination = paths.out / "fantasy_weekly.json"
    destination.write_text(
        json.dumps(
            {
                "season": args.season,
                "week": args.week,
                "scoring": args.scoring,
                "rankings": rankings.round(3).to_dict(orient="records"),
                "kickers": kickers.round(3).to_dict(orient="records"),
                "defenses": defenses.round(3).to_dict(orient="records"),
            },
            ensure_ascii=False,
            default=str,
        ),
        encoding="utf-8",
    )
    print(f"\nEscrito {destination}")
    print(
        "\nSólo aparece el titular de cada equipo. Sin esa restricción, cualquier\n"
        "suplente que arrancó dos partidos hereda el volumen completo del equipo."
    )
    return 0


def _load_calibration(path: Path) -> WeeklyCalibration:
    """Carga la calibración ajustada, o usa la del código si no hay fichero.

    Los multiplicadores por defecto no son a ojo: salen de
    `fantasy_weekly_calibrate.py` y están validados fuera de muestra. El fichero
    sólo existe cuando se ha recalibrado después de un cambio.
    """
    if not path.exists():
        return WeeklyCalibration()
    data = json.loads(path.read_text(encoding="utf-8"))
    return WeeklyCalibration(multipliers=data["multipliers"])


if __name__ == "__main__":
    raise SystemExit(main())
