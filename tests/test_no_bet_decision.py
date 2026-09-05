"""NO BET tiene UNA autoridad: `kelly.decide`, con precisión completa y al borde.

El navegador repetía la aritmética sobre valores redondeados a cuatro
decimales y en el borde exacto podía decir otra cosa. Ahora la decisión y su
motivo viajan en el payload; aquí se prueba el borde por los dos lados y se
fuzzea que `stake_fraction` y `decision` nunca se contradigan.
"""
from __future__ import annotations

import random

import pytest

from oracle.betting.kelly import (
    NO_BET_BELOW_PRICE,
    NO_BET_UNDER_MINIMUM,
    KellyConfig,
    decide,
    stake_fraction,
)

CFG = KellyConfig()
EPS = 1e-9


@pytest.mark.parametrize("delta, expected", [
    (-EPS, NO_BET_UNDER_MINIMUM),   # justo por debajo del mínimo
    (0.0, None),                    # exactamente el mínimo: entra (edge < min_edge es falso)
    (+EPS, None),
])
def test_boundary_at_the_minimum_edge(delta, expected):
    market = 0.40
    decimal = 3.0                   # a +200 un edge de 1,5% encogido sí bate el precio
    d = decide(market + CFG.min_edge + delta, decimal, market, CFG)
    assert d.no_bet_reason == expected
    assert (d.decision == "BET") == (expected is None)
    assert (d.stake_fraction > 0) == (expected is None)


def _probability_where_shrunk_meets_price(market: float, decimal: float) -> float:
    # shrunk = market + (1 − shrink)·edge  y  shrunk·decimal = 1  ⇒  edge = (1/d − market)/(1 − shrink)
    return market + (1.0 / decimal - market) / (1 - CFG.edge_shrink)


@pytest.mark.parametrize("delta, expected", [
    (-1e-7, NO_BET_BELOW_PRICE),   # el edge encogido se queda justo por debajo del precio
    (0.0, NO_BET_BELOW_PRICE),     # exactamente en el precio: Kelly = 0, no se apuesta
    (+1e-7, None),
])
def test_boundary_at_the_price(delta, expected):
    market, decimal = 0.5, 1.9091   # −110 sin margen
    p = _probability_where_shrunk_meets_price(market, decimal) + delta
    assert p - market > CFG.min_edge, "el caso tiene que estar por encima del mínimo para probar el segundo freno"
    d = decide(p, decimal, market, CFG)
    assert d.no_bet_reason == expected
    assert (d.stake_fraction > 0) == (expected is None)


def test_the_published_examples():
    assert decide(0.543, 1.9091, 0.5).no_bet_reason == NO_BET_BELOW_PRICE   # ARI @ LAC
    assert decide(0.5722, 1.9091, 0.5).decision == "BET"                     # MIA @ LV
    assert decide(0.51, 1.9091, 0.5).no_bet_reason == NO_BET_UNDER_MINIMUM


def test_fuzz_decision_and_fraction_never_disagree():
    rng = random.Random(20260905)
    for _ in range(20000):
        market = rng.uniform(0.05, 0.95)
        decimal = rng.uniform(1.05, 12.0)
        p = min(max(market + rng.uniform(-0.2, 0.2), 0.001), 0.999)
        d = decide(p, decimal, market, CFG)
        assert d.stake_fraction == stake_fraction(p, decimal, market, CFG)
        assert (d.decision == "BET") == (d.stake_fraction > 0)
        assert (d.no_bet_reason is None) == (d.decision == "BET")
        if d.no_bet_reason == NO_BET_UNDER_MINIMUM:
            assert p - market < CFG.min_edge
        if d.no_bet_reason == NO_BET_BELOW_PRICE:
            assert p - market >= CFG.min_edge
        assert d.stake_fraction <= CFG.max_fraction


def test_exact_equality_at_the_minimum_is_a_bet_with_exactly_representable_numbers():
    # 0,125 y 0,25 son exactos en binario: edge == min_edge sin ruido de coma
    # flotante. `edge < min_edge` deja pasar la igualdad; un `<=` la pararía.
    cfg = KellyConfig(min_edge=0.125)
    d = decide(0.375, 5.0, 0.25, cfg)  # a +400 el edge encogido bate el precio de sobra
    assert d.decision == "BET" and d.no_bet_reason is None
    assert decide(0.375 - 1e-12, 5.0, 0.25, cfg).no_bet_reason == NO_BET_UNDER_MINIMUM
