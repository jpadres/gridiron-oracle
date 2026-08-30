"""Ausencia y bust: que el denominador sea el correcto y que no mire al futuro."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.fantasy import bust
from oracle.fantasy.availability import history, season_availability


def _weeks(rows: list[tuple[int, str, str, int, str]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "season": season,
                "season_type": "REG",
                "player_id": player,
                "team": team,
                "week": week,
                "game_id": f"{season}_{week:02d}_{team}",
                "position": position,
            }
            for season, player, team, week, position in rows
        ]
    )


def _schedule(season: int, team: str, games: int) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "season": season,
                "team": team,
                "week": week,
                "game_id": f"{season}_{week:02d}_{team}",
                "game_type": "REG",
                "played": 1,
            }
            for week in range(1, games + 1)
        ]
    )


def test_denominator_is_the_team_schedule_not_seventeen():
    """En 2019 se jugaban 16, no 17.

    Con un 17 fijo, cualquier jugador de una temporada corta arrastraría una
    ausencia inventada de un partido. Es el mismo error de denominador que ya
    costó una iteración en `fantasy/weekly.py`.
    """
    weeks = _weeks([(2019, "p1", "KC", w, "WR") for w in range(1, 17)])
    schedule = _schedule(2019, "KC", 16)

    result = season_availability(weeks, schedule)
    assert result["team_games"].iloc[0] == 16
    assert result["missed_share"].iloc[0] == pytest.approx(0.0)


def test_missed_share_counts_the_games_absent():
    weeks = _weeks([(2023, "p1", "KC", w, "RB") for w in range(1, 13)])
    schedule = _schedule(2023, "KC", 17)

    result = season_availability(weeks, schedule)
    # 12 de 17 -> se perdió 5.
    assert result["missed_share"].iloc[0] == pytest.approx(5 / 17)


def test_history_ignores_the_season_being_predicted():
    """Regla dura nº1: para predecir la temporada S sólo valen las anteriores.

    El jugador está sano en 2022 y 2023 y se pierde 2024 casi entera.
    Preguntando por 2024, el historial no puede haberse enterado.
    """
    rows = [(2022, "p1", "KC", w, "WR") for w in range(1, 18)]
    rows += [(2023, "p1", "KC", w, "WR") for w in range(1, 18)]
    rows += [(2024, "p1", "KC", 1, "WR")]
    weeks = _weeks(rows)
    schedule = pd.concat(
        [_schedule(season, "KC", 17) for season in (2022, 2023, 2024)], ignore_index=True
    )
    positions = pd.Series({"p1": "WR"})

    availability = season_availability(weeks, schedule)
    before = history(availability, positions, 2024)
    after = history(availability, positions, 2025)

    assert before["missed_rate_raw"].iloc[0] == pytest.approx(0.0, abs=1e-9)
    # Preguntando por 2025 sí entra el desastre de 2024.
    assert after["missed_rate_raw"].iloc[0] > 0.3


def test_short_sample_is_pulled_towards_the_positional_mean():
    """Un jugador con una temporada no tiene derecho a una tasa extrema."""
    rows = [(2023, "veteran", "KC", w, "WR") for w in range(1, 18)]
    rows += [(2022, "veteran", "KC", w, "WR") for w in range(1, 18)]
    rows += [(2021, "veteran", "KC", w, "WR") for w in range(1, 18)]
    # El novato juega 2 de 17 en su única temporada: tasa bruta 0.88.
    rows += [(2023, "rookie", "SF", w, "WR") for w in (1, 2)]
    weeks = _weeks(rows)
    schedule = pd.concat(
        [
            _schedule(season, team, 17)
            for season in (2021, 2022, 2023)
            for team in ("KC", "SF")
        ],
        ignore_index=True,
    )
    positions = pd.Series({"veteran": "WR", "rookie": "WR"})

    result = history(season_availability(weeks, schedule), positions, 2024)
    rookie = result.set_index("player_id").loc["rookie"]
    assert rookie["missed_rate_raw"] > 0.85
    assert rookie["missed_rate"] < rookie["missed_rate_raw"]


def test_bust_labels_respect_their_cuts():
    low, high = bust.BUST_CUTS
    assert bust.label(low - 0.01) == "Solid"
    assert bust.label((low + high) / 2) == "Normal"
    assert bust.label(high + 0.01) == "Fragile"
    # El borde exacto pertenece al lado malo: ante la duda, avisar.
    assert bust.label(high) == "Fragile"


def test_bust_model_learns_the_obvious_direction():
    """Más riesgo de entrada, más probabilidad de salida."""
    size = 400
    generator = np.random.default_rng(0)
    risky = generator.random(size)
    frame = pd.DataFrame(
        {
            "risk_sample": risky,
            "risk_shrink": risky,
            "risk_touchdown": risky,
            "missed_rate": risky,
            "bust": (generator.random(size) < risky).astype(int),
        }
    )
    model = bust.fit(frame)
    probabilities = bust.predict(model, frame)
    assert probabilities.min() >= 0.0 and probabilities.max() <= 1.0
    assert np.corrcoef(risky, probabilities)[0, 1] > 0.9


def test_perfect_calibration_scores_zero_error():
    outcome = np.array([0, 0, 0, 0, 1, 1, 1, 1] * 20)
    probability = outcome.astype(float)
    assert bust.expected_calibration_error(probability, outcome, bins=2) == pytest.approx(0.0)
