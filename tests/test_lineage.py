"""Un informe repetido catorce veces sigue siendo UN informe.

Es la propiedad que hace que una red de 250 fuentes valga algo en vez de
multiplicar por 250 el mismo eco. `freshness.resolve` cruza afirmaciones y
conserva el desacuerdo, pero no sabe de dónde vienen: cuenta artículos.
"""

from __future__ import annotations

from oracle.sources.lineage import Attributed, corroboration, resolve_origin


def test_un_informe_repetido_catorce_veces_es_un_origen():
    claims = [Attributed("c0", "insider", originates=True)]
    claims += [Attributed(f"c{i}", f"sitio{i}", origin_claim_id="c0") for i in range(1, 15)]
    c = corroboration(claims)
    assert c.total_claims == 15
    assert c.independent_origins == 1
    assert c.can_claim_multiple_sources is False


def test_dos_reporteros_independientes_SI_son_dos():
    # La otra mitad: si el módulo dijera siempre 1, sería inútil.
    claims = [
        Attributed("a", "reportero_a", originates=True),
        Attributed("b", "reportero_b", originates=True),
        Attributed("eco", "agregador", origin_claim_id="a"),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 2
    assert c.can_claim_multiple_sources is True


def test_el_mismo_reportero_en_dos_medios_no_son_dos_fuentes():
    # Publica en su medio y en un podcast: dos artículos, un originador.
    claims = [
        Attributed("art", "reportero_x", originates=True),
        Attributed("pod", "podcast", origin_source_id="reportero_x"),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1
    assert c.can_claim_multiple_sources is False


def test_linaje_desconocido_NO_cuenta_como_independiente():
    """«No sé de dónde viene» no puede convertirse en «viene de otro sitio»."""
    claims = [
        Attributed("c0", "insider", originates=True),
        Attributed("c1", "sitio", origin_claim_id=None, origin_source_id=None),
        Attributed("c2", "otro", origin_claim_id=None, origin_source_id=None),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1, "sólo el originador conocido cuenta"
    assert c.unknown_origin == 2, "y los otros dos se declaran desconocidos"
    assert c.can_claim_multiple_sources is False


def test_una_cadena_larga_llega_a_la_raiz():
    claims = [
        Attributed("raiz", "insider", originates=True),
        Attributed("m1", "medio1", origin_claim_id="raiz"),
        Attributed("m2", "medio2", origin_claim_id="m1"),
        Attributed("m3", "medio3", origin_claim_id="m2"),
    ]
    index = {c.claim_id: c for c in claims}
    # La raíz es QUIÉN origina, no qué artículo.
    assert resolve_origin("m3", index) == "source:insider"
    assert corroboration(claims).independent_origins == 1


def test_dos_medios_que_se_citan_MUTUAMENTE_no_cuelgan_ni_inventan_raiz():
    """Ocurre de verdad. Sin guarda, esto es recursión infinita."""
    claims = [
        Attributed("a", "medio_a", origin_claim_id="b"),
        Attributed("b", "medio_b", origin_claim_id="a"),
    ]
    index = {c.claim_id: c for c in claims}
    # Un ciclo no tiene raíz demostrable: se cae al originador atribuido, y como
    # tampoco lo hay, es desconocido. Lo que NO puede es colgarse ni inventar.
    assert resolve_origin("a", index) is None, "un ciclo no demuestra ninguna raíz"
    assert resolve_origin("b", index) is None
    c = corroboration(claims)
    assert c.can_claim_multiple_sources is False


def test_una_sola_afirmacion_nunca_es_corroboracion():
    c = corroboration([Attributed("solo", "quien_sea", originates=True)])
    assert c.independent_origins == 1
    assert c.can_claim_multiple_sources is False
