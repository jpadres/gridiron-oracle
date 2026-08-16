"""Tests del modelo de fantasy.

Cuatro de estos tests existen porque el error correspondiente llegó a producir
rankings visiblemente absurdos. Están señalados.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.fantasy.draft import (
    AGE_CURVES,
    LeagueSettings,
    _age_factor,
    draft_board,
    project_season,
)
from oracle.fantasy.scoring import HALF_PPR, PPR, STANDARD, rules_from_name, score_player_weeks
from oracle.fantasy.weekly import (
    DEF_STRENGTH,
    SACK_RATE,
    SCRAMBLE_RATE,
    STARTERS_PER_TEAM,
    team_volume,
    weekly_rankings,
)

# ---------------------------------------------------------------------------
# Puntuación
# ---------------------------------------------------------------------------

def test_scoring_rules_change_the_ranking():
    """La puntuación no es presentación: cambia quién es mejor.

    Un receptor de volumen con recepciones cortas gana en PPR y pierde en
    estándar. Un board calculado con las reglas equivocadas no es aproximado,
    es de otra liga.
    """
    stats = pd.DataFrame(
        [
            {"receptions": 9.0, "receiving_yards": 70.0, "receiving_tds": 0.0},   # volumen
            {"receptions": 3.0, "receiving_yards": 95.0, "receiving_tds": 0.0},   # explosivo
        ]
    )
    ppr = score_player_weeks(stats, PPR)
    standard = score_player_weeks(stats, STANDARD)

    assert ppr.iloc[0] > ppr.iloc[1]
    assert standard.iloc[0] < standard.iloc[1]
    assert score_player_weeks(stats, HALF_PPR).iloc[0] == pytest.approx(
        (ppr.iloc[0] + standard.iloc[0]) / 2
    )


def test_scoring_matches_hand_calculation():
    stats = pd.DataFrame(
        [{"passing_yards": 300.0, "passing_tds": 2.0, "interceptions": 1.0,
          "rushing_yards": 20.0}]
    )
    # 300·0.04 + 2·4 − 2 + 20·0.1 = 12 + 8 − 2 + 2 = 20
    assert score_player_weeks(stats, PPR).iloc[0] == pytest.approx(20.0)


def test_missing_columns_are_treated_as_zero():
    """nflverse cambia de esquema entre temporadas: no se puede fallar por eso."""
    stats = pd.DataFrame([{"rushing_yards": 100.0}])
    assert score_player_weeks(stats, PPR).iloc[0] == pytest.approx(10.0)


def test_unknown_scoring_name_is_rejected():
    with pytest.raises(ValueError):
        rules_from_name("superflex-ppr-1.5te")


# ---------------------------------------------------------------------------
# Proyecciones de draft y VOR
# ---------------------------------------------------------------------------

def test_projection_only_uses_earlier_seasons(player_weeks):
    """La misma regla walk-forward que el modelo de partidos."""
    projections = project_season(player_weeks, season=2024)
    assert (projections["season"] == 2024).all()
    assert not projections.empty

    with pytest.raises(ValueError):
        project_season(player_weeks, season=2023 - 50)


def test_touchdowns_regress_harder_than_volume(player_weeks):
    """Los TD son la estadística más ruidosa y la que más engaña.

    Dos jugadores con el mismo volumen y distinto número de TD deben acercarse
    en la proyección mucho más de lo que se diferenciaron en el resultado.
    """
    history = player_weeks[player_weeks["position"] == "RB"].copy()
    lucky = history[history["player_id"] == history["player_id"].iloc[0]].copy()
    lucky["player_id"] = "LUCKY_RB"
    lucky["rushing_tds"] = lucky["rushing_tds"] + 1.2
    unlucky = history[history["player_id"] == history["player_id"].iloc[0]].copy()
    unlucky["player_id"] = "UNLUCKY_RB"
    unlucky["rushing_tds"] = 0.0

    combined = pd.concat([player_weeks, lucky, unlucky], ignore_index=True)
    projections = project_season(combined, season=2025).set_index("player_id")

    observed_gap = (lucky["rushing_tds"].mean() - unlucky["rushing_tds"].mean()) * 6.0
    projected_gap = (
        projections.loc["LUCKY_RB", "ppg_shrunk"] - projections.loc["UNLUCKY_RB", "ppg_shrunk"]
    )
    assert 0 < projected_gap < observed_gap


def test_age_curve_has_the_running_back_cliff():
    """El acantilado del RB a partir de los 28 está documentado y es brutal."""
    rb_peak = AGE_CURVES["RB"][0]
    assert _age_factor("RB", rb_peak) == pytest.approx(1.0)
    # A los 30 el corredor pierde mucho más que el receptor a la misma edad.
    assert _age_factor("RB", 30.0) < _age_factor("WR", 30.0)
    assert _age_factor("RB", 30.0) < _age_factor("QB", 30.0)
    # Y nunca baja a cero: el suelo existe para que la extrapolación no delire.
    assert _age_factor("RB", 40.0) >= 0.55
    assert _age_factor("RB", float("nan")) == 1.0


def test_vor_not_total_points_drives_the_board(player_weeks):
    """El orden final es por valor sobre reemplazo, no por puntos totales.

    Es la única comparación honesta entre un QB y un RB: lo que importa no es
    cuántos puntos hace, sino cuántos más que el que consigues gratis.
    """
    projections = project_season(player_weeks, season=2025)
    board = draft_board(projections)

    assert board["overall_rank"].is_monotonic_increasing
    assert board["vor"].is_monotonic_decreasing
    # El mejor por puntos brutos es casi siempre un QB; el primero del board no
    # tiene por qué serlo, y ese es justo el objetivo del VOR.
    assert board["vor"].iloc[0] == board["vor"].max()

    # El nivel de reemplazo es una constante por posición: si variase entre
    # jugadores de la misma posición, el VOR no sería comparable ni dentro de
    # ella, que es lo único que el VOR garantiza gratis.
    for _, group in board.groupby("position"):
        replacement = group["replacement_points"].iloc[0]
        assert (group["replacement_points"] == replacement).all()


def test_replacement_level_depends_on_league_size(player_weeks):
    projections = project_season(player_weeks, season=2025)
    small = draft_board(projections, LeagueSettings(teams=8))
    large = draft_board(projections, LeagueSettings(teams=14))

    small_qb = small[small["position"] == "QB"]["replacement_points"].iloc[0]
    large_qb = large[large["position"] == "QB"]["replacement_points"].iloc[0]
    # Con más equipos, el reemplazo es peor: el nivel de referencia baja.
    assert large_qb <= small_qb


def test_tiers_come_from_real_gaps(player_weeks):
    board = draft_board(project_season(player_weeks, season=2025))
    assert board["tier"].min() == 1
    assert board["tier"].is_monotonic_increasing
    assert board["tier"].nunique() > 1


# ---------------------------------------------------------------------------
# Ranking semanal — los cuatro errores caros
# ---------------------------------------------------------------------------

def test_qb_attempts_are_not_team_dropbacks():
    """**El error del 28%.** Los dropbacks del equipo NO son intentos del QB.

    Hay que descontar capturas y escapadas. Sin ese descuento, la posición QB
    salía un 28% alta — el mayor error individual de todo el desarrollo.
    """
    volume = team_volume(pred_margin_for=0.0, pred_total=44.0)

    assert volume.pass_attempts < volume.dropbacks
    assert volume.pass_attempts == pytest.approx(
        volume.dropbacks * (1 - SACK_RATE - SCRAMBLE_RATE)
    )
    # El descuento combinado ronda el 13%: no es un detalle de redondeo.
    assert 0.10 < 1 - volume.pass_attempts / volume.dropbacks < 0.16


def test_scrambles_are_not_double_counted():
    """Las escapadas son acarreos del QB: no pueden sumarse también al corredor."""
    volume = team_volume(pred_margin_for=0.0, pred_total=44.0)
    plays_without_pass = volume.plays - volume.dropbacks
    assert volume.rush_attempts == pytest.approx(plays_without_pass - volume.scrambles)


def test_game_script_moves_volume():
    """El equipo al que se proyecta perder pasa más. Ese es todo el puente."""
    trailing = team_volume(pred_margin_for=-10.0, pred_total=44.0)
    leading = team_volume(pred_margin_for=10.0, pred_total=44.0)

    assert trailing.pass_attempts > leading.pass_attempts
    assert trailing.rush_attempts < leading.rush_attempts
    # Y un partido con más puntos proyectados tiene más jugadas.
    assert team_volume(0.0, 54.0).plays > team_volume(0.0, 38.0).plays


def test_only_starters_are_ranked(player_weeks, weekly_predictions):
    """**Un equipo tiene UN titular.**

    Sin esta restricción, cualquier suplente que arrancó dos partidos hereda el
    volumen completo del equipo y aparece entre los mejores de la jornada — que
    es exactamente lo que hace inútil a un ranking semanal.
    """
    rankings = weekly_rankings(player_weeks, weekly_predictions, season=2024, week=14)
    assert not rankings.empty

    per_team = rankings.groupby(["team", "position"]).size()
    for (_, position), count in per_team.items():
        assert count <= STARTERS_PER_TEAM[position]

    # En concreto: un solo QB por equipo, y es el de más intentos.
    qbs = rankings[rankings["position"] == "QB"]
    assert qbs.groupby("team").size().max() == 1
    assert not qbs["player_id"].str.endswith("QB2").any()


def test_usage_shares_use_the_current_roster(player_weeks, weekly_predictions):
    """**El roster se aplica ANTES de calcular las cuotas.**

    Si se calcula el target share con el equipo del año pasado y sólo después se
    cambia de equipo, el jugador se lleva su cuota antigua a una plantilla donde
    no la tiene, y aparece con el volumen de dos equipos distintos.
    """
    from oracle.fantasy.scoring import score_player_weeks
    from oracle.fantasy.weekly import _player_usage

    history = player_weeks.copy()
    history["fantasy_points"] = score_player_weeks(history, PPR)
    usage = _player_usage(history)

    shares = usage.groupby("team")["target_share"].sum()
    np.testing.assert_allclose(shares.to_numpy(), 1.0, atol=1e-9)
    assert (usage["target_share"] <= 1.0).all()


def test_matchup_adjustment_is_damped(player_weeks, weekly_predictions):
    """La defensa contra la posición es señal real, pero pequeña y ruidosa.

    Aplicarla entera empeora las proyecciones fuera de muestra. Este test fija
    que el ajuste sigue amortiguado.
    """
    assert 0.0 < DEF_STRENGTH < 1.0

    rankings = weekly_rankings(player_weeks, weekly_predictions, season=2024, week=14)
    multipliers = rankings["matchup_multiplier"]
    # Amortiguado al 45%, ningún emparejamiento puede mover la proyección más
    # de un ~35%: si lo hace, alguien ha subido DEF_STRENGTH sin revalidar.
    assert multipliers.between(0.65, 1.35).all()


def test_weekly_projection_is_in_a_plausible_range(player_weeks, weekly_predictions):
    """Cordura básica: nadie proyecta 80 puntos ni −5."""
    rankings = weekly_rankings(player_weeks, weekly_predictions, season=2024, week=14)
    assert rankings["projected_points"].between(0, 45).all()
    for position in ("QB", "RB", "WR", "TE"):
        group = rankings[rankings["position"] == position]
        assert group["projected_points"].mean() > 1.0, position


def test_weekly_uses_no_future_information(player_weeks, weekly_predictions):
    """Cambiar el futuro no puede cambiar el ranking de la semana 14."""
    baseline = weekly_rankings(player_weeks, weekly_predictions, season=2024, week=10)

    tampered = player_weeks.copy()
    future = (tampered["season"] == 2024) & (tampered["week"] >= 10)
    tampered.loc[future, "receiving_yards"] *= 5.0
    tampered.loc[future, "passing_yards"] *= 5.0

    after = weekly_rankings(tampered, weekly_predictions, season=2024, week=10)
    pd.testing.assert_frame_equal(
        baseline.sort_values("player_id").reset_index(drop=True),
        after.sort_values("player_id").reset_index(drop=True),
    )


@pytest.fixture(scope="module")
def weekly_predictions() -> pd.DataFrame:
    """Predicciones de partido sintéticas para los ocho equipos con roster."""
    from oracle.data.ingest import VALID_TEAMS

    teams = sorted(VALID_TEAMS)[:8]
    rows = []
    for i in range(0, len(teams), 2):
        rows.append(
            {
                "home_team": teams[i],
                "away_team": teams[i + 1],
                "pred_margin": 3.0 - i,
                "pred_total": 44.0 + i,
            }
        )
    return pd.DataFrame(rows)
