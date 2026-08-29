"""Tests de propiedad e invariantes.

Bloque 65 del espec adversarial.

## Qué añaden sobre los tests de ejemplo

Un test de ejemplo comprueba que `devig_shin([1.91, 1.91])` da lo que esperas.
Un test de propiedad comprueba que **para cualquier par de cuotas válidas** las
probabilidades suman uno y ninguna se sale del intervalo. La diferencia importa
cuando el fallo vive en un caso que a nadie se le ocurrió escribir a mano: una
cuota de 1,01, un favorito extremo, una probabilidad de exactamente 0,5.

Este proyecto ya se comió dos errores que un invariante habría cazado sin que
nadie tuviera que imaginar el caso: **Shin al revés** (daba MÁS probabilidad al
no favorito) y el **signo invertido del rating defensivo**. Los dos son
violaciones de una propiedad, no de un ejemplo.
"""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from oracle.betting.devig import devig_proportional, devig_shin
from oracle.betting.kelly import KellyConfig, expected_value, full_kelly, stake_fraction
from oracle.betting.odds import american_to_decimal, decimal_to_american, decimal_to_implied
from oracle.fantasy.rookies import UDFA_ROUND, draft_round
from oracle.fantasy.scoring import PPR, STANDARD, ScoringRules, score_player_weeks

# Cuotas decimales plausibles: desde un favorito casi seguro hasta un longshot.
cuota = st.floats(min_value=1.01, max_value=51.0, allow_nan=False, allow_infinity=False)
probabilidad = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)


# --- de-vig ----------------------------------------------------------------

@given(a=cuota, b=cuota)
@settings(max_examples=300, deadline=None)
def test_devig_devuelve_una_distribucion(a, b):
    """Sumen lo que sumen las implícitas, la salida es una distribución."""
    for funcion in (devig_proportional, devig_shin):
        p = funcion(np.array([a, b]))
        assert np.all(p >= 0.0) and np.all(p <= 1.0), (funcion.__name__, a, b)
        assert p.sum() == pytest.approx(1.0, abs=1e-6), (funcion.__name__, a, b)


@given(a=cuota, b=cuota)
@settings(max_examples=300, deadline=None)
def test_devig_conserva_el_orden(a, b):
    """La cuota más baja tiene que salir con más probabilidad. Siempre.

    Es la propiedad que el fallo de «Shin al revés» violaba.
    """
    assume(abs(a - b) > 0.02)
    for funcion in (devig_proportional, devig_shin):
        p = funcion(np.array([a, b]))
        assert (p[0] > p[1]) == (a < b), (funcion.__name__, a, b, p)


@given(a=cuota, b=cuota)
@settings(max_examples=300, deadline=None)
def test_shin_castiga_al_longshot_frente_al_proporcional(a, b):
    """Shin da MENOS probabilidad al no favorito, no más.

    Ése es todo el sesgo favorito-longshot que Shin existe para corregir, y es
    exactamente el signo que este proyecto tuvo mal en su día.
    """
    assume(abs(a - b) > 0.5)
    odds = np.array([a, b])
    proporcional, shin = devig_proportional(odds), devig_shin(odds)
    longshot = 0 if a > b else 1
    assert shin[longshot] <= proporcional[longshot] + 1e-9, (a, b, proporcional, shin)


# --- cuotas ----------------------------------------------------------------

@given(d=cuota)
@settings(max_examples=200, deadline=None)
def test_americano_y_decimal_son_inversos(d):
    assert american_to_decimal(decimal_to_american(d)) == pytest.approx(d, rel=1e-6)


@given(d=cuota)
@settings(max_examples=200, deadline=None)
def test_la_implicita_esta_en_el_intervalo_y_decrece(d):
    p = decimal_to_implied(d)
    assert 0.0 < p <= 1.0
    # Una cuota mayor no puede tener más probabilidad implícita.
    assert decimal_to_implied(d + 1.0) < p


# --- Kelly -----------------------------------------------------------------

@given(p=probabilidad, d=cuota)
@settings(max_examples=300, deadline=None)
def test_kelly_nunca_apuesta_sin_ventaja(p, d):
    """Sin valor esperado positivo, la fracción tiene que ser cero.

    Apostar con EV negativo no es agresivo: es aritméticamente perdedor, y un
    Kelly que devolviera algo positivo ahí estaría roto.
    """
    fraccion = stake_fraction(p, d, config=KellyConfig())
    if expected_value(p, d) <= 0:
        assert fraccion == pytest.approx(0.0), (p, d, fraccion)
    assert 0.0 <= fraccion <= 1.0


@given(p=probabilidad, d=cuota)
@settings(max_examples=300, deadline=None)
def test_kelly_fraccionado_nunca_supera_al_completo(p, d):
    completo = max(full_kelly(p, d), 0.0)
    fraccionado = stake_fraction(p, d, config=KellyConfig())
    assert fraccionado <= completo + 1e-9, (p, d, completo, fraccionado)


# --- puntuación ------------------------------------------------------------

@given(
    receptions=st.integers(min_value=0, max_value=20),
    yards=st.integers(min_value=0, max_value=250),
    tds=st.integers(min_value=0, max_value=4),
)
@settings(max_examples=200, deadline=None)
def test_metamorfico_mas_por_recepcion_nunca_puntua_menos(receptions, yards, tds):
    """Bloque 67: si sólo sube el valor de la recepción, el total no baja.

    Con las mismas estadísticas, pasar de estándar a PPR sólo puede sumar. Si
    alguna vez restara, habría un signo invertido en la puntuación.
    """
    import pandas as pd
    fila = pd.DataFrame([{
        "position": "WR", "receptions": receptions,
        "receiving_yards": yards, "receiving_tds": tds,
    }])
    assert (score_player_weeks(fila, PPR).iloc[0]
            >= score_player_weeks(fila, STANDARD).iloc[0] - 1e-9)


@given(
    receptions=st.integers(min_value=1, max_value=20),
    premium=st.floats(min_value=1.0, max_value=2.0),
)
@settings(max_examples=200, deadline=None)
def test_metamorfico_el_premium_solo_afecta_a_su_posicion(receptions, premium):
    import pandas as pd
    reglas = ScoringRules(reception_by_position={"TE": premium})
    te = pd.DataFrame([{"position": "TE", "receptions": receptions, "receiving_yards": 0}])
    wr = pd.DataFrame([{"position": "WR", "receptions": receptions, "receiving_yards": 0}])
    assert score_player_weeks(te, reglas).iloc[0] == pytest.approx(receptions * premium)
    assert score_player_weeks(wr, reglas).iloc[0] == pytest.approx(receptions * 1.0)


# --- identidad de rookie ---------------------------------------------------

@given(pick=st.integers(min_value=1, max_value=300))
@settings(max_examples=200, deadline=None)
def test_la_ronda_es_monotona_y_esta_acotada(pick):
    ronda = draft_round(pick)
    assert 1 <= ronda <= 7
    assert draft_round(pick + 32) >= ronda
    # Y no drafteado nunca cae dentro del rango de rondas.
    assert draft_round(None) == UDFA_ROUND > 7
