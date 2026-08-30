"""E18 — el valor por liga responde a las reglas de la liga.

Preregistro en `docs/PREREGISTRO_valorliga.md`. Lo que se protege aquí son
PROPIEDADES, no números: que el reparto de los huecos compartidos cuadre, que
superflex profundice el reemplazo del quarterback y que nada caiga en un valor
por defecto sin decirlo.

El experimento completo, sobre las 861 proyecciones reales, está en
`scripts/league_value_validate.py`. Esto es la red que impide que una propiedad
validada se rompa sin que nadie se entere.
"""

from __future__ import annotations

import pytest

from oracle.fantasy.league import (
    UnsupportedRoster,
    greedy_replacement,
    roster_context,
)

BENCH = ["BN"] * 6
BASE = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"]
SUPERFLEX = [*BASE[:8], "SUPER_FLEX", *BASE[8:]]


def _pool(qb=60, rb=90, wr=110, te=50):
    """Una población con la separación de escala que tiene el fútbol de verdad.

    El quarterback suma bastante más que el receptor. Importa: el reparto voraz
    compara puntos brutos, así que un pool donde el QB24 valiera menos que el
    WR40 mandaría huecos de superflex a receptores — correcto para ese pool y
    absurdo para el fútbol.
    """
    return {
        "QB": [310.0 - i * 3.0 for i in range(qb)],
        "RB": [250.0 - i * 2.0 for i in range(rb)],
        "WR": [245.0 - i * 1.6 for i in range(wr)],
        "TE": [200.0 - i * 2.4 for i in range(te)],
    }


def test_e18_el_voraz_consume_exactamente_los_huecos():
    for roster, teams in [(BASE, 10), (BASE, 12), (BASE, 14), (SUPERFLEX, 12)]:
        context = roster_context(roster + BENCH, teams)
        _, _, consumed = greedy_replacement(_pool(), context)
        assert consumed == context.starter_slots, (roster, teams)


def test_e18_superflex_profundiza_el_reemplazo_del_quarterback():
    pool = _pool()
    una = roster_context(BASE + BENCH, 12)
    sf = roster_context(SUPERFLEX + BENCH, 12)
    rep_una, rank_una, _ = greedy_replacement(pool, una)
    rep_sf, rank_sf, _ = greedy_replacement(pool, sf)

    assert rank_sf["QB"] / rank_una["QB"] >= 1.8
    assert rep_sf["QB"] < rep_una["QB"]
    # Y no toca a las demás: el superflex sólo compite por quarterbacks mientras
    # el quarterback siga siendo el que más suma, que es el caso en el fútbol.
    assert rank_sf["RB"] == rank_una["RB"]
    assert rank_sf["WR"] == rank_una["WR"]


def test_e18_mas_equipos_reemplazo_mas_profundo_y_mas_barato():
    pool = _pool()
    ranks, points = {}, {}
    for teams in (10, 12, 14):
        replacement, rank, _ = greedy_replacement(pool, roster_context(BASE + BENCH, teams))
        ranks[teams], points[teams] = rank, replacement
    for position in ("QB", "RB", "WR", "TE"):
        assert ranks[10][position] <= ranks[12][position] <= ranks[14][position]
        assert points[10][position] >= points[12][position] >= points[14][position]


def test_e18_el_reemplazo_es_el_primero_que_no_es_titular():
    """La definición, y la ruptura deliberada con el board viejo.

    Con 12 equipos y un solo quarterback titular salen 12 titulares, así que el
    reemplazo es el QB13 — no el QB12, que es el último que SÍ juega. El modelo
    anterior tomaba el último titular, lo que sobreestima el reemplazo, y no lo
    hacía igual en todas las posiciones: por eso distorsionaba justo la
    comparación entre posiciones para la que existe el VOR.
    """
    pool = _pool()
    context = roster_context(["QB", "RB", "RB", "WR", "WR", "WR", "TE", *BENCH], 12)
    replacement, rank, _ = greedy_replacement(pool, context)
    assert rank["QB"] == 13
    assert replacement["QB"] == pytest.approx(pool["QB"][12])


def test_e18_cero_titulares_no_se_convierte_en_el_valor_por_defecto():
    context = roster_context(["QB", "RB", "RB", "WR", "WR", "WR", "FLEX", *BENCH], 12)
    assert context.dedicated["TE"] == 0
    # El ala cerrada sólo conserva su parte del flex, que es lo que la liga le da.
    assert context.starters["TE"] == pytest.approx(0.10)


def test_e18_hueco_desconocido_levanta_en_vez_de_ignorarse():
    with pytest.raises(UnsupportedRoster, match="LB"):
        roster_context([*BASE, "LB", *BENCH], 12)


def test_e18_una_posicion_agotada_no_produce_un_reemplazo_de_cero():
    """Si se acaban los jugadores se usa el último, nunca cero.

    Un cero daría un VOR igual a los puntos del jugador y pondría a la posición
    entera arriba del board.
    """
    context = roster_context(SUPERFLEX + BENCH, 14)
    replacement, _, _ = greedy_replacement({"QB": [300.0, 290.0, 280.0]}, context)
    assert replacement["QB"] == 280.0


def test_e18b_el_valor_no_se_afirma_en_ligas_muy_profundas():
    """La frontera está declarada y se respeta.

    E18 pasó sus 16 propiedades a 10-14 equipos. A 32 fallan las dos de magnitud
    del superflex, y el diagnóstico es que el ancla de reemplazo cae donde la
    proyección ya es casi el prior. El board se sigue calculando; lo que no se
    afirma es la magnitud, y eso tiene que ser comprobable.
    """
    from oracle.fantasy.league import VALIDATED_MAX_TEAMS, value_confidence

    reducido = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]
    for teams in (10, 12, 14):
        assert value_confidence(roster_context(reducido + BENCH, teams)) == "VALIDATED"
    for teams in (16, 20, 32):
        assert value_confidence(roster_context(reducido + BENCH, teams)) == "UNVALIDATED_DEPTH"
    assert VALIDATED_MAX_TEAMS == 14


def test_e18b_la_estructura_sigue_respondiendo_a_32_equipos():
    """Lo que SÍ aguanta en profundidad, para que no se pierda al documentar lo que no.

    El reparto cuadra y el rank del quarterback se dobla igual que a 12. Que la
    magnitud del valor no esté validada no significa que el reparto esté roto.
    """
    pool = _pool(qb=140, rb=260, wr=360, te=200)
    una = roster_context(BASE + BENCH, 32)
    sf = roster_context(SUPERFLEX + BENCH, 32)

    _, rank_una, used_una = greedy_replacement(pool, una)
    _, rank_sf, used_sf = greedy_replacement(pool, sf)
    assert used_una == una.starter_slots
    assert used_sf == sf.starter_slots
    assert rank_sf["QB"] / rank_una["QB"] >= 1.8
