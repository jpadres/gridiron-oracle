#!/usr/bin/env python3
"""Calcula el plan de survivor de la temporada y escribe `out/survivor.json`.

    python scripts/survivor_build.py
    python scripts/survivor_build.py --used KC,BUF,PHI      # ya gastados
    python scripts/survivor_build.py --from-week 5 --through 18

Un survivor es elegir un ganador por jornada sin repetir equipo. Lo difícil no
es acertar esta semana: es no gastarte hoy al equipo que te salvaba la jornada
once. Eso es un problema de asignación con solución exacta — ver
`oracle/survivor/__init__.py`.

**Esto sí es un sitio donde el modelo aporta**, al revés que las apuestas contra
la línea de cierre. No compites contra un mercado eficiente, compites contra el
calendario, y lo que hace falta es una probabilidad bien calibrada mirando
dieciocho jornadas a la vez.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.config import MAX_REGULAR_SEASON_WEEK
from oracle.config import paths as resolve_paths
from oracle.pipeline import Oracle
from oracle.survivor import best_plan, probability_matrix, week_board, win_probabilities

# Candidatos que viajan a la web. Más allá del top 12 de una jornada, la
# supervivencia del plan ya cae tanto que la fila sólo sirve para hacer scroll.
BOARD_LIMIT = 12

# Horizonte corto para el segundo tablero. A dieciocho jornadas el producto de
# probabilidades se aplana —todo sale «menos del uno por ciento»— y las opciones
# dejan de distinguirse. Seis semanas es el plazo en el que un survivor se
# decide de verdad y en el que el coste de quemar a alguien todavía se nota.
SHORT_HORIZON = 6


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plan de survivor")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--from-week", type=int, default=None, help="Primera jornada a decidir.")
    parser.add_argument("--through", type=int, default=MAX_REGULAR_SEASON_WEEK)
    parser.add_argument("--used", default="", help="Equipos ya gastados, separados por comas.")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    print("Entrenando el modelo...")
    oracle = Oracle.train(args.root)

    season, first = _resolve_start(oracle, args.season, args.from_week)
    weeks = list(range(first, args.through + 1))
    used = {team.strip().upper() for team in args.used.split(",") if team.strip()}
    print(f"Survivor {season}: jornadas {first}-{args.through}"
          + (f", ya gastados {', '.join(sorted(used))}" if used else ""))

    predictions = _predict_weeks(oracle, season, weeks)
    frame = win_probabilities(predictions)
    matrix, weeks, teams = probability_matrix(frame, weeks=weeks)

    plan = best_plan(matrix, weeks, teams, used=used)
    if not plan.picks:
        print("No hay plan posible con esos equipos gastados.")
        return 1

    board = week_board(matrix, weeks, teams, first, used=used)

    # Mismo cálculo sobre las seis primeras jornadas. No es una vista
    # alternativa por gusto: a horizonte largo el producto aplasta las
    # diferencias, y la decisión de esta semana se toma mirando el mes que
    # viene, no diciembre.
    short_weeks = weeks[:SHORT_HORIZON]
    short_matrix = matrix[: len(short_weeks)]
    short_board = week_board(short_matrix, short_weeks, teams, first, used=used)
    short_plan = best_plan(short_matrix, short_weeks, teams, used=used)

    context = _opponents(frame)

    payload = {
        "season": season,
        "from_week": first,
        "through": args.through,
        "used": sorted(used),
        "plan_survival": plan.survival,
        "plan": [_enrich(pick, context) for pick in plan.picks],
        "board": [_enrich_board(entry, first, context) for entry in board[:BOARD_LIMIT]],
        "short_horizon": len(short_weeks),
        "short_survival": short_plan.survival,
        "short_plan": [_enrich(pick, context) for pick in short_plan.picks],
        "short_board": [_enrich_board(e, first, context) for e in short_board[:BOARD_LIMIT]],
    }
    (paths.out / "survivor.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nSupervivencia del plan completo: {plan.survival:.2%}")
    print("\nMejores elecciones de la jornada (por supervivencia del plan que empieza ahí):")
    for entry in board[:6]:
        rival = context.get((first, entry["team"]), {})
        print(f"  {entry['team']:>3} vs {rival.get('opponent','?'):<3} "
              f"gana {entry['win_prob']:.1%} | plan {entry['survival_if_used']:.2%} "
              f"| quemarlo cuesta {entry['cost']:.2%}")
    print(f"\nA {len(short_weeks)} jornadas vista (que es como se decide):"
          f" supervivencia {short_plan.survival:.1%}")
    for entry in short_board[:6]:
        rival = context.get((first, entry["team"]), {})
        print(f"  {entry['team']:>3} vs {rival.get('opponent','?'):<3} "
              f"gana {entry['win_prob']:.1%} | plan {entry['survival_if_used']:.1%} "
              f"| quemarlo cuesta {entry['cost']:.1%}")
    print("\nPlan completo:", " ".join(pick["team"] for pick in plan.picks))
    print("Plan corto:   ", " ".join(pick["team"] for pick in short_plan.picks))
    print(f"\nEscrito {(paths.out / 'survivor.json').relative_to(paths.root)}")
    return 0


def _resolve_start(oracle: Oracle, season: int | None, week: int | None) -> tuple[int, int]:
    """Primera jornada sin jugar, salvo que se pida otra."""
    pending = oracle.features[oracle.features["played"] == 0].sort_values(["season", "week"])
    if pending.empty:
        raise SystemExit("No hay jornadas pendientes en el calendario.")
    row = pending.iloc[0]
    return (season or int(row["season"]), week or int(row["week"]))


def _predict_weeks(oracle: Oracle, season: int, weeks: list[int]) -> pd.DataFrame:
    """Pronósticos de todas las jornadas del horizonte, en una tabla.

    Para las jornadas futuras no hay línea de mercado publicada, así que el
    modelo cae a su variante autónoma. Es peor que la anclada al mercado (Brier
    0.2187 frente a 0.2117 en el backtest) y hay que decirlo: la jornada 15
    calculada hoy es un prior de fuerza de equipos, no un pronóstico.
    """
    frames = []
    for week in weeks:
        try:
            features = oracle.week_features(season, week)
        except ValueError:
            continue
        frames.append(oracle.predict(features))
    if not frames:
        raise SystemExit(f"Sin partidos para {season} en las jornadas pedidas.")
    return pd.concat(frames, ignore_index=True)


def _opponents(frame: pd.DataFrame) -> dict[tuple[int, str], dict]:
    return {
        (int(row.week), row.team): {"opponent": row.opponent, "home": bool(row.home)}
        for row in frame.itertuples()
    }


def _enrich(pick: dict, context: dict) -> dict:
    return {**pick, **context.get((pick["week"], pick["team"]), {})}


def _enrich_board(entry: dict, week: int, context: dict) -> dict:
    return {**entry, **context.get((week, entry["team"]), {})}


if __name__ == "__main__":
    raise SystemExit(main())
