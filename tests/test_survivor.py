"""Tests del planificador de survivor.

Lo que se prueba aquí es la propiedad que justifica el módulo entero: **elegir
cada semana al favorito más claro no es la estrategia óptima**. Si un test
tuviera que sobrevivir a una reescritura, es ese.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.survivor import best_plan, probability_matrix, week_board, win_probabilities

WEEKS = [1, 2, 3]
TEAMS = ["A", "B", "C", "D"]


def _matrix(rows: list[list[float]]) -> np.ndarray:
    return np.array(rows, dtype=float)


def test_greedy_is_not_optimal():
    """El caso que da sentido al módulo.

    A gana el 90% esta semana y es la elección obvia. Pero A es también la única
    salida decente de la jornada 2, donde lo mejor que queda es un 55%. Gastarlo
    hoy cuesta: 0,90 × 0,55 = 0,495 frente a 0,60 × 0,85 = 0,510.

    Un survivor se pierde así, no fallando el favorito de la semana.
    """
    matrix = _matrix([[0.90, 0.60, np.nan, np.nan],
                      [0.85, np.nan, 0.55, np.nan],
                      [0.70, np.nan, np.nan, 0.60]])
    plan = best_plan(matrix, WEEKS, TEAMS)
    assert plan.picks[0]["team"] != "A", "el óptimo no quema al mejor equipo en la jornada 1"
    assert plan.survival > 0.90 * 0.55 * 0.60


def test_no_team_is_used_twice():
    """La regla del juego. Sin esto no hay problema que resolver."""
    matrix = _matrix([[0.9, 0.8, 0.7, 0.6],
                      [0.9, 0.8, 0.7, 0.6],
                      [0.9, 0.8, 0.7, 0.6]])
    plan = best_plan(matrix, WEEKS, TEAMS)
    assert len(set(plan.teams())) == len(plan.picks) == 3


def test_survival_is_the_product_of_the_picks():
    """La supervivencia declarada tiene que ser la de verdad.

    Se calcula sumando logaritmos por estabilidad numérica, y ese cambio es
    justo donde se cuela un error de escala que nadie nota.
    """
    matrix = _matrix([[0.9, 0.8, 0.7, 0.6],
                      [0.5, 0.8, 0.7, 0.6],
                      [0.9, 0.4, 0.7, 0.6]])
    plan = best_plan(matrix, WEEKS, TEAMS)
    expected = np.prod([pick["win_prob"] for pick in plan.picks])
    assert plan.survival == pytest.approx(expected, rel=1e-9)


def test_byes_are_never_picked():
    """NaN es «no juega», no «pierde seguro».

    Si se tratara como un cero, el solucionador vería una derrota casi segura
    donde en realidad hay una casilla prohibida — y podría preferirla a una
    derrota probable de verdad.
    """
    matrix = _matrix([[np.nan, 0.55, np.nan, np.nan],
                      [0.90, np.nan, 0.60, np.nan],
                      [np.nan, np.nan, np.nan, 0.50]])
    plan = best_plan(matrix, WEEKS, TEAMS)
    assert plan.picks[0]["team"] == "B"
    assert all(not np.isnan(pick["win_prob"]) for pick in plan.picks)


def test_used_teams_are_out():
    matrix = _matrix([[0.95, 0.60, 0.55, 0.50],
                      [0.90, 0.70, 0.65, 0.40],
                      [0.85, 0.75, 0.45, 0.35]])
    plan = best_plan(matrix, WEEKS, TEAMS, used={"A"})
    assert "A" not in plan.teams()


def test_forcing_a_team_puts_it_in_that_week():
    matrix = _matrix([[0.95, 0.60, 0.55, 0.50],
                      [0.90, 0.70, 0.65, 0.40],
                      [0.85, 0.75, 0.45, 0.35]])
    plan = best_plan(matrix, WEEKS, TEAMS, forced=(1, "C"))
    assert plan.picks[0]["team"] == "C"


def test_board_ranks_by_the_plan_not_by_this_week():
    """El tablero ordena por supervivencia del plan, no por el favorito de hoy.

    Es la diferencia entre «quién gana el domingo» y «qué me conviene gastar»,
    que es la pregunta del survivor.
    """
    matrix = _matrix([[0.90, 0.60, np.nan, np.nan],
                      [0.85, np.nan, 0.55, np.nan],
                      [0.70, np.nan, np.nan, 0.60]])
    board = week_board(matrix, WEEKS, TEAMS, 1)
    assert board[0]["team"] == "B"
    assert board[0]["cost"] == pytest.approx(0.0, abs=1e-12)
    # Quemar a A hoy cuesta supervivencia, y el número lo dice.
    burning_a = next(entry for entry in board if entry["team"] == "A")
    assert burning_a["cost"] > 0
    assert burning_a["win_prob"] > board[0]["win_prob"], "y aun así gana más esta semana"


def test_win_probabilities_are_complementary():
    """Un partido son dos filas y sus probabilidades suman uno."""
    predictions = pd.DataFrame({
        "season": [2026, 2026], "week": [1, 1],
        "home_team": ["KC", "SF"], "away_team": ["DEN", "LAR"],
        "home_win_prob": [0.70, 0.55],
    })
    frame = win_probabilities(predictions)
    assert len(frame) == 4
    for game in (("KC", "DEN"), ("SF", "LAR")):
        pair = frame[frame["team"].isin(game)]
        assert pair["win_prob"].sum() == pytest.approx(1.0)


def test_matrix_marks_teams_on_bye_as_nan():
    predictions = pd.DataFrame({
        "season": [2026], "week": [1],
        "home_team": ["KC"], "away_team": ["DEN"], "home_win_prob": [0.70],
    })
    matrix, weeks, teams = probability_matrix(
        win_probabilities(predictions), weeks=[1], teams=["KC", "DEN", "SF"]
    )
    assert np.isnan(matrix[0, teams.index("SF")])
    assert matrix[0, teams.index("KC")] == pytest.approx(0.70)
