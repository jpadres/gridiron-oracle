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


def test_no_tier_has_a_single_player(player_weeks):
    """Un tier de uno no es un tier: es ruido con nombre de información.

    El umbral anterior (media + 0.6·σ del hueco) producía 41 tiers en los
    primeros 123 jugadores del board real, varios de un solo nombre. No se veía
    porque la tabla marcaba el corte con un borde algo más grueso; apareció al
    dibujar cada tier con su banda y su número.
    """
    board = draft_board(project_season(player_weeks, season=2025))
    sizes = board.groupby("tier").size()
    assert sizes.min() >= 2, f"tiers de un solo jugador: {list(sizes[sizes < 2].index)}"


def test_tier_count_stays_usable(player_weeks):
    """Entre 6 y 16 tiers. Ni uno solo para todo, ni uno por ronda de nada."""
    board = draft_board(project_season(player_weeks, season=2025))
    assert 6 <= board["tier"].nunique() <= 16


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


def test_usage_share_counts_games_missed(player_weeks):
    """**La cuota se mide sobre los partidos del EQUIPO, no los del jugador.**

    Una media por partido jugado es condicional a que jugara. Al sumarlas para
    normalizar, quien se perdió media temporada entra con su tasa completa: el
    denominador se infla y TODAS las cuotas del equipo salen bajas.

    Con datos reales el denominador se inflaba entre un 5% y un 34% según el
    equipo, y las proyecciones salían al 73-80% de la forma reciente del
    jugador. Lo grave era que el sesgo variaba por equipo, así que corrompía
    justo la comparación que un ranking semanal tiene que acertar.

    Aquí: dos receptores con el mismo volumen POR PARTIDO JUGADO, uno presente
    en los seis partidos y otro en uno solo. El primero tiene que llevarse
    mucha más cuota; con el cálculo viejo se la repartían a partes iguales.
    """
    from oracle.fantasy.scoring import score_player_weeks
    from oracle.fantasy.weekly import _player_usage

    team = player_weeks["team"].iloc[0]
    plantilla = player_weeks[player_weeks["team"] == team]
    semanas = sorted(plantilla["week"].unique())[-6:]
    plantilla = plantilla[plantilla["week"].isin(semanas)]

    def receptor(player_id, weeks):
        filas = plantilla[plantilla["position"] == "WR"].head(len(weeks)).copy()
        filas["player_id"] = player_id
        filas["player_name"] = player_id
        filas["position"] = "WR"
        filas["week"] = list(weeks)
        filas["season"] = plantilla["season"].max()
        filas["targets"] = 10.0
        return filas

    historial = pd.concat(
        [player_weeks, receptor("SIEMPRE", semanas), receptor("UNA_VEZ", semanas[-1:])],
        ignore_index=True,
    )
    historial["fantasy_points"] = score_player_weeks(historial, PPR)
    usage = _player_usage(historial).set_index("player_id")

    constante = usage.loc["SIEMPRE", "target_share"]
    esporadico = usage.loc["UNA_VEZ", "target_share"]
    assert constante > 3 * esporadico, (
        f"El que jugó los 6 partidos tiene cuota {constante:.3f} y el que jugó uno "
        f"{esporadico:.3f}. Se están sumando medias por partido jugado en vez de "
        "medir sobre la ventana del equipo."
    )


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


# Rango en el que tiene que caer el MEJOR de cada posición en una jornada, en
# PPR. No son cifras de adorno: si el titular de una posición se proyecta fuera
# de esta banda, el ranking no sirve para decidir una alineación.
TOP_PROJECTION_BANDS = {"QB": (12.0, 32.0), "RB": (10.0, 30.0),
                        "WR": (10.0, 30.0), "TE": (6.0, 22.0)}


def test_weekly_projection_is_in_a_plausible_range(player_weeks, weekly_predictions):
    """El mejor de cada posición tiene que caer en una banda realista.

    La versión laxa de este test (sólo «entre 0 y 45») **no detectó** que las
    proyecciones salían aplastadas contra el suelo con datos reales: el mejor
    receptor de la jornada se proyectaba a 7,8 puntos en vez de ~18, porque las
    cuotas de uso se normalizaban sobre 25 años de plantillas. Comprobar sólo
    que un número «no es absurdo» deja pasar justo el fallo que importa.
    """
    rankings = weekly_rankings(player_weeks, weekly_predictions, season=2024, week=14)
    assert rankings["projected_points"].between(0, 45).all()

    for position, (low, high) in TOP_PROJECTION_BANDS.items():
        group = rankings[rankings["position"] == position]
        assert not group.empty, position
        best = group["projected_points"].max()
        assert low <= best <= high, (
            f"El mejor {position} se proyecta a {best:.1f}, fuera de [{low}, {high}]. "
            "Suele significar que las cuotas de uso se están normalizando sobre el "
            "conjunto de jugadores equivocado."
        )


def test_only_recent_players_are_ranked(player_weeks, weekly_predictions):
    """Un jugador que no juega desde hace temporadas no puede aparecer.

    Su último equipo y sus últimos seis partidos siguen en el historial; lo que
    no siguen es siendo relevantes. Con datos reales esto sacaba a Gronkowski
    entre los mejores tight ends de 2026.
    """
    retired = player_weeks[player_weeks["player_id"].str.endswith("WR1")].head(20).copy()
    retired["player_id"] = "RETIRADO_WR"
    retired["player_name"] = "Retirado"
    retired["season"] = 2015  # hace nueve temporadas
    # Volumen enorme, para que sólo la ventana de plantilla pueda excluirlo.
    retired["targets"] = 20.0
    retired["receptions"] = 15.0
    retired["receiving_yards"] = 220.0

    combined = pd.concat([player_weeks, retired], ignore_index=True)
    rankings = weekly_rankings(combined, weekly_predictions, season=2024, week=14)
    assert "RETIRADO_WR" not in set(rankings["player_id"])


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
