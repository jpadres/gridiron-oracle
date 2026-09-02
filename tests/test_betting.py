"""Tests del módulo de apuestas.

El primero fija la dirección de Shin. Es el que evita repetir un error que ya se
cometió y que no da ningún síntoma: las dos versiones producen números
plausibles y sólo una gana dinero.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.betting.devig import devig_proportional, devig_shin, shin_z
from oracle.betting.kelly import (
    KellyConfig,
    expected_value,
    full_kelly,
    stake,
    stake_fraction,
)
from oracle.betting.odds import (
    american_to_decimal,
    american_to_implied,
    decimal_to_american,
    decimal_to_implied,
)
from oracle.betting.value import enumerate_markets, value_bets
from oracle.models.distribution import MarginDistribution

# ---------------------------------------------------------------------------
# Cuotas
# ---------------------------------------------------------------------------

def test_american_decimal_roundtrip():
    for odds in (-250.0, -110.0, -101.0, 100.0, 150.0, 400.0):
        decimal = american_to_decimal(odds)
        assert decimal_to_american(decimal) == pytest.approx(odds, rel=1e-9)


def test_known_odds_conversions():
    assert american_to_decimal(150.0) == pytest.approx(2.5)
    assert american_to_decimal(-110.0) == pytest.approx(1.9090909, rel=1e-6)
    assert decimal_to_implied(2.0) == pytest.approx(0.5)
    # Los dos lados a -110 suman 1,0476: ese 4,76% es la comisión de la casa.
    assert american_to_implied(-110.0) * 2 == pytest.approx(1.047619, rel=1e-6)


# ---------------------------------------------------------------------------
# De-vig por Shin — LA DIRECCIÓN
# ---------------------------------------------------------------------------

def test_shin_shrinks_longshot():
    """**Shin da MENOS probabilidad al no favorito que la proporcional.**

    Este es el test que fija el signo. Con la corrección al revés, el modelo
    encuentra "valor" sistemático en los no favoritos — que es exactamente el
    lado por el que se pierde dinero, porque es donde la casa carga más margen
    aprovechando el sesgo favorito-longshot.
    """
    # Moneyline desequilibrada: favorito claro contra no favorito.
    odds = american_to_decimal(np.array([-400.0, 320.0]))
    shin = devig_shin(odds)
    proportional = devig_proportional(odds)

    assert shin.sum() == pytest.approx(1.0)
    assert shin[0] > proportional[0], "El favorito debe recibir MÁS probabilidad con Shin."
    assert shin[1] < proportional[1], "El no favorito debe recibir MENOS probabilidad con Shin."


def test_shin_difference_is_the_size_of_the_edge_we_hunt():
    """La diferencia entre métodos es de 1-2 puntos porcentuales.

    Ese es justo el tamaño del edge que se intenta detectar: usar el método
    equivocado no es un detalle, se come la señal entera.
    """
    odds = american_to_decimal(np.array([-350.0, 280.0]))
    difference = abs(devig_shin(odds)[1] - devig_proportional(odds)[1])
    assert 0.002 < difference < 0.05


def test_shin_matches_proportional_on_a_balanced_book():
    """Con los dos lados al mismo precio no hay sesgo que corregir."""
    odds = american_to_decimal(np.array([-110.0, -110.0]))
    np.testing.assert_allclose(devig_shin(odds), devig_proportional(odds), atol=1e-9)
    np.testing.assert_allclose(devig_shin(odds), [0.5, 0.5], atol=1e-9)


def test_devig_output_is_a_probability_distribution():
    for pair in ([-2000.0, 1100.0], [-110.0, -110.0], [-140.0, 120.0], [200.0, -250.0]):
        probabilities = devig_shin(american_to_decimal(np.array(pair)))
        assert probabilities.sum() == pytest.approx(1.0)
        assert (probabilities > 0).all()
        assert (probabilities < 1).all()


def test_shin_z_is_zero_without_overround():
    """Sin margen no hay dinero informado que estimar."""
    fair = np.array([2.0, 2.0])
    assert shin_z(fair) == pytest.approx(0.0)
    assert shin_z(american_to_decimal(np.array([-110.0, -110.0]))) > 0.0


# ---------------------------------------------------------------------------
# Kelly y gestión de riesgo
# ---------------------------------------------------------------------------

def test_full_kelly_formula():
    # p=0.6 a cuota decimal 2.0 -> f* = (0.6·2 − 1)/1 = 0.20
    assert full_kelly(0.6, 2.0) == pytest.approx(0.20)
    assert full_kelly(0.5, 2.0) == pytest.approx(0.0)
    # Sin valor no se apuesta al otro lado por la puerta de atrás.
    assert full_kelly(0.4, 2.0) == 0.0


def test_stake_is_far_below_full_kelly():
    """Los cuatro frenos apilados, medidos.

    Kelly completo con probabilidades estimadas produce drawdowns del 60-80%.
    Lo que se apuesta debe ser una fracción pequeña de eso.
    """
    probability, odds = 0.60, 2.0
    full = full_kelly(probability, odds)
    applied = stake_fraction(probability, odds, market_probability=0.50)

    assert applied < full / 3
    assert applied <= KellyConfig().max_fraction


def test_hard_cap_binds_on_a_huge_edge():
    """Aunque el modelo crea tener una ventaja enorme, el tope del 2% manda."""
    assert stake_fraction(0.95, 3.0, market_probability=0.33) == pytest.approx(0.02)


def test_no_bet_below_the_minimum_edge():
    config = KellyConfig(min_edge=0.015)
    # 1 punto porcentual de ventaja: por debajo del umbral.
    assert stake_fraction(0.51, 2.0, market_probability=0.50, config=config) == 0.0
    # 3 puntos: pasa el filtro.
    assert stake_fraction(0.53, 2.0, market_probability=0.50, config=config) > 0.0


def test_edge_shrink_reduces_the_stake():
    aggressive = KellyConfig(edge_shrink=0.0, max_fraction=1.0)
    conservative = KellyConfig(edge_shrink=0.5, max_fraction=1.0)
    assert stake_fraction(0.60, 2.0, 0.50, conservative) < stake_fraction(
        0.60, 2.0, 0.50, aggressive
    )


def test_stake_scales_with_bankroll():
    assert stake(2000.0, 0.60, 2.0, 0.50) == pytest.approx(2 * stake(1000.0, 0.60, 2.0, 0.50))


def test_invalid_kelly_config_is_rejected():
    with pytest.raises(ValueError):
        KellyConfig(fraction=0.0)
    with pytest.raises(ValueError):
        KellyConfig(max_fraction=1.5)


def test_expected_value_sign():
    assert expected_value(0.6, 2.0) == pytest.approx(0.2)
    assert expected_value(0.45, 2.0) < 0


# ---------------------------------------------------------------------------
# Detección de valor
# ---------------------------------------------------------------------------

def _fake_week(home_prob: float, spread_line: float = 2.5) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "game_id": "2026_01_BUF_KC",
                "season": 2026,
                "week": 1,
                "home_team": "KC",
                "away_team": "BUF",
                "home_win_prob": home_prob,
                "pred_margin": 3.0,
                "pred_total": 47.0,
                "spread_line": spread_line,
                "home_moneyline": -140.0,
                "away_moneyline": 120.0,
            }
        ]
    )


def _fair_home_probability() -> float:
    """Probabilidad de la casa sin margen para la moneyline de `_fake_week`."""
    return float(devig_shin(american_to_decimal(np.array([-140.0, 120.0])))[0])


def test_no_value_against_an_efficient_market():
    """El resultado normal es "ninguna apuesta", y eso no es un fallo.

    Con la probabilidad del modelo igual a la de la casa sin margen, no hay nada
    que apostar. Si esto devolviera apuestas, el módulo estaría midiendo el
    margen de la casa como si fuera ventaja propia.
    """
    assert value_bets(_fake_week(_fair_home_probability())).empty


def test_value_appears_only_with_a_real_edge():
    bets = value_bets(_fake_week(0.72), bankroll=1000.0)
    assert not bets.empty
    assert (bets["stake"] <= 20.0).all(), "El tope del 2% sobre 1000 son 20 unidades."
    assert (bets["edge"] >= KellyConfig().min_edge).all()
    assert bets["ev"].is_monotonic_decreasing


def test_spreads_need_a_fitted_distribution():
    """Sin distribución ajustada no se cotizan spreads.

    Calcular la probabilidad de push con una normal produce precios mal en -3 y
    -7, que son la mitad del mercado. Antes de eso, no cotizar.
    """
    # El modelo dice que el local gana de 3 y la línea lo pone de 4 en contra:
    # 7 puntos de discrepancia, de sobra para superar el -110.
    week = _fake_week(0.72, spread_line=-4.0)
    without = value_bets(week)
    assert not without["market"].str.startswith("spread").any()

    rng = np.random.default_rng(5)
    distribution = MarginDistribution().fit(np.round(rng.normal(0, 13, 20000)))
    with_spreads = value_bets(week, distribution=distribution)
    assert with_spreads["market"].str.startswith("spread").any()


def test_spread_needs_more_than_half_a_point_to_beat_the_juice():
    """A -110 hace falta acertar el 52,4%: una ventaja mínima no es una apuesta.

    Es el filtro que impide confundir "el modelo difiere de la línea" con "hay
    valor". Casi toda la diferencia entre modelo y cierre cae en esta zona.
    """
    rng = np.random.default_rng(5)
    distribution = MarginDistribution().fit(np.round(rng.normal(0, 13, 20000)))
    # Medio punto de discrepancia: el modelo difiere del mercado, pero no lo
    # bastante como para pagar la comisión.
    marginal = value_bets(_fake_week(0.55, spread_line=2.5), distribution=distribution)
    assert not marginal["market"].str.startswith("spread").any()


def test_empty_result_still_has_the_right_columns():
    """Un resultado vacío conserva las columnas: el `if empty` se olvida siempre."""
    empty = value_bets(_fake_week(_fair_home_probability()))
    assert empty.empty
    for column in ("matchup", "market", "selection", "edge", "ev", "stake"):
        assert column in empty.columns


def test_enumerate_markets_lists_both_sides_of_every_spread_with_stake_zero_allowed():
    """Lo que `value_bets` filtra, aquí se ve: cada lado con su probabilidad."""
    distribution = MarginDistribution()
    distribution.fit(pd.DataFrame({"margin": np.random.default_rng(0).normal(2, 13, 2000).round()}))
    predictions = pd.DataFrame([
        {"game_id": "g1", "season": 2026, "week": 1, "home_team": "KC", "away_team": "BUF",
         "pred_margin": 0.5, "pred_total": 47.0, "home_win_prob": 0.52, "spread_line": 3.5},
        {"game_id": "g2", "season": 2026, "week": 1, "home_team": "SF", "away_team": "LAR",
         "pred_margin": -6.0, "pred_total": 44.0, "home_win_prob": 0.33, "spread_line": -6.0},
    ])
    markets = enumerate_markets(predictions, distribution=distribution)
    # Dos partidos, dos lados cada uno; sin moneyline no hay candidatos de moneyline.
    assert len(markets) == 4
    assert set(markets["selection"]) == {"KC", "BUF", "SF", "LAR"}
    # Los dos lados de un spread se reparten la probabilidad decidida.
    g1 = markets[markets["game_id"] == "g1"]
    assert abs(g1["model_prob"].sum() - 1.0) < 1e-9
    # El lado con menos probabilidad que la casa no tiene stake, pero SÍ aparece.
    assert (markets["stake_fraction"] == 0).any()
    assert set(markets.columns) >= {"edge", "ev", "stake_fraction", "push_prob", "market_prob"}
    # Y lo apostable de `value_bets` es un subconjunto de esto.
    bets = value_bets(predictions, distribution=distribution)
    for _, bet in bets.iterrows():
        match = markets[(markets["game_id"] == bet["game_id"]) & (markets["selection"] == bet["selection"])]
        assert len(match) == 1
        assert abs(float(match["model_prob"].iloc[0]) - float(bet["model_prob"])) < 1e-12


def test_spread_labels_follow_betting_convention_not_margin_sign():
    """Local favorito por 3,5: el local se apuesta a -3.5 y el visitante a +3.5.

    `spread_line` de nflverse es el margen del local; el handicap de la casa
    lleva el signo contrario. Publicarlo con el signo del margen daba «MIA -3.5»
    para un MIA que RECIBÍA 3,5 puntos, con la probabilidad correcta al lado.
    """
    distribution = MarginDistribution()
    distribution.fit(pd.DataFrame({"margin": np.random.default_rng(1).normal(2, 13, 2000).round()}))
    predictions = pd.DataFrame([
        {"game_id": "g", "season": 2026, "week": 1, "home_team": "LV", "away_team": "MIA",
         "pred_margin": 1.8, "pred_total": 44.0, "home_win_prob": 0.56, "spread_line": 3.5},
    ])
    markets = enumerate_markets(predictions, distribution=distribution)
    by = dict(zip(markets["selection"], markets["market"], strict=True))
    assert by["LV"] == "spread -3.5"
    assert by["MIA"] == "spread +3.5"
    # Y el que cubre más a menudo con un margen esperado por debajo de la línea es el que recibe.
    probs = dict(zip(markets["selection"], markets["model_prob"], strict=True))
    assert probs["MIA"] > probs["LV"]
