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


# ===========================================================================
# ESTRUCTURA 32 equipos · 3 FLEX · SUPER_FLEX · sin QB ni TE dedicados
# ===========================================================================
#
#     LO QUE SE AFIRMA AQUÍ ES LA ESTRUCTURA. LA PUNTUACIÓN ES UNKNOWN.
#
# Estos huecos se observaron en una liga real y se conservan porque destaparon
# casos que ningún escenario sintético cubría. Lo que NO se afirma es qué board
# tiene esa liga: su puntuación no se ha leído de ninguna parte, y sin ella el
# board sería una conjetura con aspecto de dato.
#
# Por eso el pool de estos tests es sintético y declarado: prueban que el
# REPARTO aguanta esta forma de plantilla, no qué jugadores salen.

STRUCT_32_3FLEX_SF = ["RB", "WR", "FLEX", "FLEX", "FLEX", "SUPER_FLEX"]


def _struct_context(teams: int = 32):
    return roster_context(STRUCT_32_3FLEX_SF + BENCH, teams)


def test_estructura_sin_quarterback_dedicado_no_revienta_ni_inventa():
    context = _struct_context()
    assert context.dedicated["QB"] == 0, "no hay hueco de QB, y se dice"
    # El quarterback sólo entra por el superflex: un titular por equipo.
    assert context.starters["QB"] == pytest.approx(1.0)


def test_estructura_sin_ala_cerrada_dedicada_deja_el_te_en_su_parte_del_flex():
    context = _struct_context()
    assert context.dedicated["TE"] == 0
    # Sólo lo que le da el flex, nada inventado: 3 flex × 0,10.
    assert context.starters["TE"] == pytest.approx(0.30)


def test_estructura_tres_flex_y_un_superflex_se_cuentan_como_tales():
    context = _struct_context()
    assert context.flex == 3
    assert context.superflex == 1


def test_estructura_los_192_huecos_se_reparten_enteros():
    context = _struct_context()
    assert context.starter_slots == 192, "6 titulares × 32 equipos"
    _, _, consumed = greedy_replacement(_pool(qb=140, rb=260, wr=360, te=200), context)
    assert consumed == 192


def test_estructura_el_pool_no_se_queda_vacio():
    """Con cuatro de seis huecos compartidos es donde más fácil sería agotar uno."""
    replacement, rank, _ = greedy_replacement(
        _pool(qb=140, rb=260, wr=360, te=200), _struct_context()
    )
    for position in ("QB", "RB", "WR", "TE"):
        assert position in replacement, position
        assert rank[position] >= 1


def test_estructura_el_reparto_es_determinista():
    pool = _pool(qb=140, rb=260, wr=360, te=200)
    context = _struct_context()
    primero = greedy_replacement(pool, context)
    segundo = greedy_replacement(pool, context)
    assert primero == segundo


def test_estructura_el_flex_hace_sustitutos_a_corredor_receptor_y_ala_cerrada():
    """La consecuencia de tener tres huecos compartidos, y es comprobable.

    Con el flex, RB, WR y TE compiten por los mismos huecos, así que su precio de
    reemplazo converge. No es una observación sobre una liga concreta: sale del
    reparto y se puede exigir sobre un pool declarado.
    """
    replacement, _, _ = greedy_replacement(
        _pool(qb=140, rb=260, wr=360, te=200), _struct_context()
    )
    compartidas = [replacement[p] for p in ("RB", "WR", "TE")]
    spread = max(compartidas) - min(compartidas)
    # El quarterback NO converge: no comparte huecos con ellos salvo el superflex.
    assert spread < 0.15 * max(compartidas), f"precios {compartidas}"


# ===========================================================================
# PUNTUACIÓN NO ES VALOR — la distinción, como test permanente
# ===========================================================================

def _board(pool_points, context):
    """VOR de un pool ya puntuado. Devuelve {posición: [vor...]} en orden."""
    replacement, _, _ = greedy_replacement(pool_points, context)
    return {
        position: [p - replacement[position] for p in sorted(points, reverse=True)]
        for position, points in pool_points.items()
    }


def test_un_cambio_de_puntuacion_que_sube_a_TODOS_no_cambia_el_valor():
    """El pase de TD de 6 puntos, convertido en propiedad.

    Medido en E18 sobre datos reales: pasar de 4 a 6 puntos por TD de pase sube
    el reemplazo del quarterback de 241 a 284 —exactamente lo que sube cada
    quarterback— así que el VOR queda intacto y el top-50 coincide entero.

    Aquí se exige la versión general: **un desplazamiento uniforme de una
    posición no puede mover su VOR**. Es la forma más limpia de decir que
    compilar la puntuación no termina el trabajo.
    """
    context = roster_context(BASE + BENCH, 12)
    base = _pool()
    subido = {**base, "QB": [p + 40.0 for p in base["QB"]]}

    vor_base = _board(base, context)
    vor_subido = _board(subido, context)
    for position in ("QB", "RB", "WR", "TE"):
        for a, b in zip(vor_base[position], vor_subido[position], strict=True):
            assert a == pytest.approx(b), position


def test_un_cambio_de_estructura_SIN_tocar_la_puntuacion_si_cambia_el_valor():
    """El recíproco, que es la otra mitad de la afirmación.

    Superflex no toca ni una regla de puntuación y sí mueve el valor. Sin este
    test el anterior se podría satisfacer con un modelo que no reacciona a nada.
    """
    pool = _pool()
    una = roster_context(BASE + BENCH, 12)
    sf = roster_context(SUPERFLEX + BENCH, 12)

    rep_una, _, _ = greedy_replacement(pool, una)
    rep_sf, _, _ = greedy_replacement(pool, sf)
    assert rep_sf["QB"] < rep_una["QB"], "el reemplazo del QB baja"
    # Y el VOR de cada quarterback sube en esa misma diferencia.
    assert (pool["QB"][0] - rep_sf["QB"]) > (pool["QB"][0] - rep_una["QB"])


def test_el_flex_se_reparte_por_pool_compartido_y_no_por_pesos_fijos():
    """La diferencia entre asignar y repartir, hecha comprobable.

    Con pesos fijos, cambiar QUIÉN está disponible no cambia el reparto: los
    pesos son constantes. Con asignación sí, porque cada hueco va a quien más
    vale en ese momento. Aquí se hunde el pool de corredores y se exige que el
    reparto reaccione — un modelo de pesos no podría pasar este test.
    """
    context = roster_context(BASE + BENCH, 12)
    normal = _pool()
    sin_rb = {**normal, "RB": [p - 80.0 for p in normal["RB"]]}

    _, rank_normal, _ = greedy_replacement(normal, context)
    _, rank_sin_rb, _ = greedy_replacement(sin_rb, context)

    assert rank_sin_rb["RB"] < rank_normal["RB"], "se draftean menos corredores"
    assert rank_sin_rb["WR"] > rank_normal["WR"], "y más receptores ocupan el flex"

    # Y la comparación que da sentido al test: el modelo de PESOS no se entera.
    # `replacement_rank` no mira el pool —es equipos × una constante— así que
    # devuelve lo mismo con corredores hundidos y sin hundir. Ahí está la
    # diferencia entre repartir por convención y asignar por lo que hay.
    por_pesos = {p: context.replacement_rank(p) for p in ("RB", "WR")}
    assert por_pesos["RB"] == 29 and por_pesos["WR"] == 41, por_pesos
    assert rank_normal["RB"] != rank_sin_rb["RB"], (
        "el voraz sí reacciona; si esto empatara, se habría vuelto un modelo de pesos"
    )


def test_la_demanda_asignada_es_igual_a_los_huecos_que_la_liga_define():
    """Nada de 95 de 96. Un jugador por hueco, ni uno más ni uno menos."""
    pool = _pool(qb=140, rb=260, wr=360, te=200)
    for roster, teams in [(BASE, 10), (BASE, 12), (BASE, 14), (SUPERFLEX, 12),
                          (STRUCT_32_3FLEX_SF, 32)]:
        context = roster_context(roster + BENCH, teams)
        _, _, consumed = greedy_replacement(pool, context)
        assert consumed == context.starter_slots, (roster, teams)


# ===========================================================================
# CERO ES UN VALOR REAL
# ===========================================================================

def test_cero_titulares_sobrevive_al_adaptador_de_sleeper_entero():
    """El camino completo, que es donde estaba el fallo.

    Era `counts[position] or DEFAULT_STARTERS[position]`: cero es falso en
    Python, así que una liga sin ala cerrada titular recibía un TE inventado. No
    fallaba nada — el board simplemente era el de otra liga.

    Se comprueba de punta a punta —desde el JSON de Sleeper hasta el nivel de
    reemplazo— porque el bug vivía en la traducción, no en el compilador.
    """
    from oracle.leagues.sleeper import league_settings_from, roster_context_from

    liga = {
        "total_rosters": 12,
        "roster_positions": ["QB", "RB", "RB", "WR", "WR", "WR", "FLEX", *BENCH],
    }
    context = roster_context_from(liga)
    assert context.dedicated["TE"] == 0
    assert context.starters["TE"] == pytest.approx(0.10)

    starters = dict(league_settings_from(liga).starters)
    assert starters["TE"] == pytest.approx(0.10), "no aparece un TE titular de la nada"

    # Y sin ala cerrada dedicada, su reemplazo es mucho más superficial.
    con_te = roster_context_from({**liga, "roster_positions": [
        "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", *BENCH]})
    assert con_te.starters["TE"] > context.starters["TE"]
