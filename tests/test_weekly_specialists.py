"""Pateadores y defensas del ranking semanal: la autoridad de cada uno.

El pateador tiene proyección validada (E8) y orden rechazado (E8b): estos tests
protegen las dos cosas a la vez — que la proyección salga del volumen del
EQUIPO y que la salida no lleve rank ordinal. La defensa sólo tiene hechos:
aquí se comprueba que la tabla no fabrica una proyección que no existe.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.fantasy.weekly import weekly_defenses, weekly_kickers

TEAMS = ["AAA", "BBB", "CCC", "DDD"]


def _kicker_row(player_id, team, season, week, fg_att=2.0, pat_att=3.0):
    made = max(fg_att - 0.4, 0.0)
    return {
        "player_id": player_id,
        "player_name": player_id.replace("_", " "),
        "position": "K",
        "team": team,
        "season": season,
        "week": week,
        "fg_att": fg_att,
        "pat_att": pat_att,
        "pat_made": pat_att * 0.95,
        # Todos los intentos en el tramo 30-39 para que la tasa tenga muestra.
        "fg_made_30_39": made,
        "fg_missed_30_39": fg_att - made,
        "fg_made_0_19": 0.0, "fg_missed_0_19": 0.0,
        "fg_made_20_29": 0.0, "fg_missed_20_29": 0.0,
        "fg_made_40_49": 0.0, "fg_missed_40_49": 0.0,
        "fg_made_50_59": 0.0, "fg_missed_50_59": 0.0,
        "fg_made_60_": 0.0, "fg_missed_60_": 0.0,
    }


@pytest.fixture(scope="module")
def kicker_weeks() -> pd.DataFrame:
    rows = []
    for team in TEAMS:
        for season in (2024, 2025):
            for week in range(1, 11):
                rows.append(_kicker_row(f"{team}_K1", team, season, week))
    # El suplente de última hora: UNA semana, la más reciente de AAA. Si el
    # titular se eligiera por recencia pura, este ruido lo destronaría.
    rows.append(_kicker_row("AAA_K2", "AAA", 2025, 10, fg_att=1.0, pat_att=1.0))
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def team_points() -> pd.DataFrame:
    rows = []
    for team in TEAMS:
        for season in (2024, 2025):
            for week in range(1, 11):
                rows.append({
                    "season": season, "week": week, "team": team,
                    "points_for": 17.0 + 6.0 * TEAMS.index(team),
                })
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def predictions() -> pd.DataFrame:
    # AAA (local) favorito por 10 en un partido de 50: implícito 30 frente a 20.
    # CCC-DDD igualado a 40: 20 y 20.
    return pd.DataFrame([
        {"home_team": "AAA", "away_team": "BBB", "pred_margin": 10.0, "pred_total": 50.0},
        {"home_team": "CCC", "away_team": "DDD", "pred_margin": 0.0, "pred_total": 40.0},
    ])


def test_kicker_output_has_no_ordinal_rank(kicker_weeks, team_points, predictions):
    """E8b rechaza K1…K12: la columna de rank NO puede existir en la salida."""
    board = weekly_kickers(kicker_weeks, team_points, predictions, 2026, 1)
    assert not any("rank" in c for c in board.columns)
    assert len(board) == 4


def test_kicker_starter_is_the_volume_kicker(kicker_weeks, team_points, predictions):
    """El titular de AAA es K1 (180 intentos en la ventana), no el suplente de
    la última semana. La recencia pura elegiría al ruido."""
    board = weekly_kickers(kicker_weeks, team_points, predictions, 2026, 1)
    assert board.loc[board["team"] == "AAA", "player_id"].iloc[0] == "AAA_K1"


def test_kicker_projection_follows_team_points(kicker_weeks, team_points, predictions):
    """Más puntos proyectados del equipo -> más proyección del pateador. Es TODO
    el modelo (la identidad del pateador no aporta parámetros), así que si esto
    falla no hay nada más que pueda estar bien."""
    board = weekly_kickers(kicker_weeks, team_points, predictions, 2026, 1).set_index("team")
    assert board.loc["AAA", "team_points"] == pytest.approx(30.0)
    assert board.loc["BBB", "team_points"] == pytest.approx(20.0)
    assert board.loc["AAA", "projected_points"] > board.loc["BBB", "projected_points"]
    assert 2.0 < board.loc["AAA", "projected_points"] < 20.0


def test_kicker_uses_no_future_information(kicker_weeks, team_points, predictions):
    """Truncar el historial en el corte no cambia nada: lo de después no entra."""
    future = pd.concat([kicker_weeks, pd.DataFrame([
        _kicker_row("AAA_K1", "AAA", 2026, 1, fg_att=9.0, pat_att=9.0),
        _kicker_row("AAA_K1", "AAA", 2026, 3, fg_att=9.0, pat_att=9.0),
    ])], ignore_index=True)
    clean = weekly_kickers(kicker_weeks, team_points, predictions, 2026, 1)
    dirty = weekly_kickers(future, team_points, predictions, 2026, 1)
    pd.testing.assert_frame_equal(clean, dirty)


def _team_games() -> pd.DataFrame:
    rows = []
    for team in TEAMS:
        for week in range(1, 11):
            rows.append({
                "season": 2025, "week": week, "team": team, "played": True,
                "points_against": 30.0 - 2.0 * TEAMS.index(team) + (week % 3),
                "def_sacks_taken": 2.0 + 0.2 * TEAMS.index(team),
                "def_interceptions": 1.0,
                "def_fumbles_lost": 0.5,
            })
    return pd.DataFrame(rows)


def test_defense_table_is_facts_only(predictions):
    """Sin proyección y sin rank: no hay modelo de DST y la tabla no lo finge."""
    board = weekly_defenses(_team_games(), predictions, 2026, 1)
    assert "projected_points" not in board.columns
    assert not any("rank" in c for c in board.columns)
    assert len(board) == 4


def test_defense_implied_totals_split_the_game(predictions):
    """Los implícitos de un partido suman su total: 30-20 en el 50, 20-20 en el 40."""
    board = weekly_defenses(_team_games(), predictions, 2026, 1).set_index("team")
    assert board.loc["AAA", "opponent_implied"] == pytest.approx(20.0)  # BBB anota 20
    assert board.loc["BBB", "opponent_implied"] == pytest.approx(30.0)
    assert board.loc["CCC", "opponent_implied"] == pytest.approx(20.0)
    # El orden es ascendente por el implícito del rival: el hecho, no un rank.
    ordered = weekly_defenses(_team_games(), predictions, 2026, 1)
    assert ordered["opponent_implied"].is_monotonic_increasing


def test_defense_recent_means_use_the_window(predictions):
    """La media es de las últimas 6, no de la temporada entera."""
    games = _team_games()
    board = weekly_defenses(games, predictions, 2026, 1, window=6).set_index("team")
    recent = games[games["team"] == "AAA"].tail(6)
    assert board.loc["AAA", "points_allowed_recent"] == pytest.approx(
        recent["points_against"].mean()
    )
    assert board.loc["AAA", "recent_games"] == 6
    assert board.loc["AAA", "takeaways_recent"] == pytest.approx(1.5)


def test_stat_lines_travel_with_the_ranking(kicker_weeks, team_points, predictions):
    """Las medias por stat existen donde su posición las define, y no donde no.

    No valida su magnitud — E7 valida el AGREGADO en puntos — pero sí el
    contrato: un QB lleva intentos y yardas de pase; un receptor lleva targets
    y ninguna columna de pase con valor.
    """
    from oracle.fantasy.weekly import TeamVolume, _project_stats
    volume = TeamVolume(63.0, 36.0, 32.0, 27.0, 2.4, 2.2)
    qb = pd.Series({"passing_yards": 4200.0, "attempts": 550.0, "passing_tds": 30.0,
                    "interceptions": 10.0, "rushing_yards": 300.0, "carries": 60.0,
                    "rushing_tds": 3.0, "rush_share": 0.08})
    stats = _project_stats(qb, "QB", volume)
    assert stats["proj_pass_att"] == pytest.approx(32.0)
    assert 180 < stats["proj_pass_yds"] < 300
    assert "proj_targets" not in stats

    wr = pd.Series({"rushing_yards": 20.0, "carries": 4.0, "rushing_tds": 0.0,
                    "receiving_yards": 1100.0, "targets": 140.0, "receptions": 95.0,
                    "receiving_tds": 8.0, "rush_share": 0.01, "target_share": 0.24})
    stats = _project_stats(wr, "WR", volume)
    assert stats["proj_targets"] == pytest.approx(32.0 * 0.24)  # intentos de pase × cuota
    assert stats["proj_receptions"] < stats["proj_targets"]
    assert "proj_pass_att" not in stats


def test_defense_without_history_says_so(predictions):
    """Equipo sin partidos: NaN y cero partidos, nunca un número inventado."""
    empty = _team_games().iloc[0:0]
    board = weekly_defenses(empty, predictions, 2026, 1).set_index("team")
    assert np.isnan(board.loc["AAA", "points_allowed_recent"])
    assert board.loc["AAA", "recent_games"] == 0
