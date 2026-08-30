"""La plantilla NORMAL del dueño, como fixture de regresión permanente.

    NORMAL_1QB_2RB_2WR_1TE_1FLEX_1DEF_1K

Confirmada explícitamente, no deducida de una captura. Convive con la liga
especial de 32 equipos y **nunca se mezclan**: son dos configuraciones distintas
y ninguna es el respaldo de la otra.

Lo que este fichero protege no es que los números salgan: es que una estructura
no se cuele en otra, y que un preset no se convierta en lo que tiene una liga
desconocida.
"""

from __future__ import annotations

import pytest

from oracle.fantasy.league import (
    DEEP_32_ROSTER,
    NORMAL_ROSTER,
    UnsupportedRoster,
    assign_slots,
    greedy_replacement,
    roster_context,
)

BENCH = ["BN"] * 6


def _pool(**kw):
    base = {"QB": 60, "RB": 90, "WR": 110, "TE": 50}
    base.update(kw)
    escala = {"QB": (310.0, 3.0), "RB": (250.0, 2.0), "WR": (245.0, 1.6), "TE": (200.0, 2.4)}
    return {p: [escala[p][0] - i * escala[p][1] for i in range(n)] for p, n in base.items()}


def _normal(teams: int = 12):
    return roster_context([*NORMAL_ROSTER, *BENCH], teams)


# --- la estructura, hueco a hueco -------------------------------------------

def test_normal_declara_nueve_huecos_titulares():
    assert len(NORMAL_ROSTER) == 9
    assert list(NORMAL_ROSTER) == ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"]


def test_normal_reparte_siete_huecos_de_vor_y_no_nueve():
    """Nueve huecos de plantilla, SIETE de reparto. No es lo mismo.

    El pateador y la defensa existen en la liga y hay que poder draftearlos,
    pero no entran en el board de VOR —el modelo no los proyecta— así que no
    consumen hueco de asignación. Confundir las dos cantidades daría un nivel de
    reemplazo calculado contra una demanda que no existe.
    """
    c = _normal()
    assert c.starter_slots == 12 * 7
    assert sum(c.dedicated.values()) + c.flex + c.superflex == 7


def test_normal_cuenta_bien_cada_hueco_dedicado():
    c = _normal()
    assert c.dedicated == {"QB": 1, "RB": 2, "WR": 2, "TE": 1}
    assert c.flex == 1
    assert c.superflex == 0, "la plantilla normal NO lleva superflex"
    assert c.is_superflex is False


def test_normal_reconoce_pateador_y_defensa():
    c = _normal()
    assert c.has_kicker is True
    assert c.has_defense is True


def test_normal_reparte_el_flex_sin_atarlo_a_una_posicion():
    c = _normal()
    # El flex se reparte; ninguna posición se lo lleva entero.
    assert c.starters["RB"] == pytest.approx(2.45)
    assert c.starters["WR"] == pytest.approx(2.45)
    assert c.starters["TE"] == pytest.approx(1.10)
    assert sum(c.starters.values()) == pytest.approx(7.0)


def test_normal_el_reparto_consume_exactamente_sus_huecos():
    c = _normal()
    _, _, consumidos = greedy_replacement(_pool(), c)
    assert consumidos == c.starter_slots


@pytest.mark.parametrize("teams", [8, 10, 12, 14])
def test_normal_escala_con_el_tamano_de_liga(teams):
    c = _normal(teams)
    assert c.starter_slots == teams * 7
    _, _, consumidos = greedy_replacement(_pool(QB=200, RB=300, WR=400, TE=200), c)
    assert consumidos == c.starter_slots


# --- que NO se contamine con la liga especial -------------------------------

def test_la_liga_de_32_es_OTRA_estructura_y_no_se_parece():
    normal = _normal(12)
    especial = roster_context([*DEEP_32_ROSTER, *BENCH], 32)

    assert normal.dedicated != especial.dedicated
    assert normal.superflex == 0 and especial.superflex == 1
    assert normal.flex == 1 and especial.flex == 3
    assert normal.has_kicker and not especial.has_kicker
    assert normal.dedicated["QB"] == 1 and especial.dedicated["QB"] == 0
    assert normal.dedicated["TE"] == 1 and especial.dedicated["TE"] == 0


def test_compilar_una_no_altera_la_otra():
    """Ida y vuelta: la especial en medio no puede dejar rastro en la normal."""
    antes = _normal(12)
    roster_context([*DEEP_32_ROSTER, *BENCH], 32)
    despues = _normal(12)
    assert antes.dedicated == despues.dedicated
    assert antes.starters == despues.starters
    assert antes.starter_slots == despues.starter_slots


def test_un_preset_NO_es_lo_que_tiene_una_liga_desconocida():
    """La regla que impide que la comodidad se convierta en un respaldo.

    `NORMAL_ROSTER` es una plantilla conocida del dueño. Una liga externa sin
    estructura leída sigue siendo UNKNOWN: el compilador levanta en vez de
    rellenar. Si algún día esto pasa a devolver el preset, esta prueba cae.
    """
    with pytest.raises(UnsupportedRoster):
        roster_context(None, 12)
    with pytest.raises(UnsupportedRoster):
        roster_context([], 12)
    with pytest.raises(UnsupportedRoster, match="LB"):
        roster_context([*NORMAL_ROSTER, "LB", *BENCH], 12)


# --- asignación de huecos, que es PRESENTACIÓN ------------------------------

def _j(pid, pos, vor):
    return {"player_id": pid, "position": pos, "vor": vor}


def test_asignacion_llena_los_dedicados_antes_que_el_flex():
    huecos, sobra = assign_slots(
        [_j("rb1", "RB", 100), _j("rb2", "RB", 90), _j("rb3", "RB", 80)],
        list(NORMAL_ROSTER),
    )
    # Por ÍNDICE, no por nombre de hueco: hay dos «RB» y un diccionario los
    # colapsaría, que es como este test se equivocó la primera vez.
    ocupacion = [(h["slot"], (h["player"] or {}).get("player_id")) for h in huecos]
    assert ocupacion == [
        ("QB", None), ("RB", "rb1"), ("RB", "rb2"), ("WR", None), ("WR", None),
        ("TE", None), ("FLEX", "rb3"), ("DEF", None), ("K", None),
    ], ocupacion
    assert sobra == []


def test_asignacion_no_ata_el_flex_a_una_posicion():
    """El mismo hueco lo ocupa un corredor, un receptor o un ala cerrada."""
    for pos in ("RB", "WR", "TE"):
        huecos, _ = assign_slots([_j("x", pos, 50)] * 0 + [_j("x", pos, 50)],
                                 ["FLEX"])
        assert huecos[0]["player"]["position"] == pos


def test_asignacion_deja_huecos_ABIERTOS_sin_opinar():
    huecos, _ = assign_slots([_j("qb", "QB", 60)], list(NORMAL_ROSTER))
    abiertos = [h["slot"] for h in huecos if h["player"] is None]
    assert "RB" in abiertos and "DEF" in abiertos and "K" in abiertos
    # Un hueco abierto es un hecho de la plantilla. No lleva nada más.
    assert all(set(h) == {"index", "slot", "player"} for h in huecos)


def test_asignacion_el_orden_restrictivo_primero_evita_dejar_a_alguien_fuera():
    """El caso que justifica el orden, y que al revés falla.

    Con un solo quarterback y un SUPER_FLEX, empezar por el hueco permisivo
    metería al QB en el superflex y dejaría su hueco dedicado abierto. Aquí el
    dedicado se llena primero y el superflex recoge a otro.
    """
    huecos, sobra = assign_slots(
        [_j("qb", "QB", 200), _j("rb", "RB", 100)],
        ["QB", "SUPER_FLEX"],
    )
    puestos = {h["slot"]: h["player"]["player_id"] for h in huecos if h["player"]}
    assert puestos["QB"] == "qb"
    assert puestos["SUPER_FLEX"] == "rb"
    assert sobra == []


def test_asignacion_pateador_y_defensa_tienen_sitio_aunque_no_se_ordenen():
    """Seleccionable no es lo mismo que rankeable.

    El modelo no ordena pateadores (E8b los REJECTED) ni defensas
    (DST_STREAMING es DESIGN_ONLY). Eso no quita que la liga los exija y que la
    plantilla tenga que poder representarlos.
    """
    huecos, sobra = assign_slots(
        [_j("k", "K", 0), _j("d", "DST", 0)], list(NORMAL_ROSTER))
    puestos = {h["slot"]: h["player"]["player_id"] for h in huecos if h["player"]}
    assert puestos["K"] == "k"
    assert puestos["DEF"] == "d"
    assert sobra == []


def test_asignacion_la_liga_de_32_se_pinta_con_SU_estructura():
    huecos, _ = assign_slots(
        [_j("a", "RB", 100), _j("b", "WR", 90), _j("c", "QB", 300)],
        list(DEEP_32_ROSTER),
    )
    slots = [h["slot"] for h in huecos]
    assert slots == ["RB", "WR", "FLEX", "FLEX", "FLEX", "SUPER_FLEX"]
    assert "QB" not in slots and "K" not in slots
    # El quarterback sólo cabe en el superflex, porque esa liga no tiene hueco de QB.
    puestos = {h["slot"]: h["player"]["player_id"] for h in huecos if h["player"]}
    assert puestos["SUPER_FLEX"] == "c"


def test_asignacion_ignora_el_banquillo():
    huecos, _ = assign_slots([_j("a", "RB", 10)], [*NORMAL_ROSTER, "BN", "BN", "IR"])
    assert len(huecos) == 9
    assert all(h["slot"] not in {"BN", "IR"} for h in huecos)


def test_asignacion_es_determinista():
    jugadores = [_j(f"p{i}", ["RB", "WR", "TE"][i % 3], 100 - i) for i in range(9)]
    a, sa = assign_slots(list(jugadores), list(NORMAL_ROSTER))
    b, sb = assign_slots(list(reversed(jugadores)), list(NORMAL_ROSTER))
    assert [(h["slot"], (h["player"] or {}).get("player_id")) for h in a] == \
           [(h["slot"], (h["player"] or {}).get("player_id")) for h in b]
    assert [p["player_id"] for p in sa] == [p["player_id"] for p in sb]
