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
    # `unknown_origin == 0` no es decoración: sin esto el test pasa igual con un
    # código que marque TODOS los ecos como desconocidos, que es una respuesta
    # distinta con el mismo número. Lo destapó una revisión por mutación.
    assert c.unknown_origin == 0
    assert c.origins == ("source:insider",)
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
    assert c.unknown_origin == 0, "el podcast se resuelve al reportero, no queda sin resolver"
    assert c.origins == ("source:reportero_x",)
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
    assert c.independent_origins == 0, "un ciclo no aporta NINGÚN origen"
    assert c.unknown_origin == 2
    assert c.can_claim_multiple_sources is False


def test_una_sola_afirmacion_nunca_es_corroboracion():
    c = corroboration([Attributed("solo", "quien_sea", originates=True)])
    assert c.independent_origins == 1
    assert c.can_claim_multiple_sources is False


# ── Los cinco casos con los que una revisión adversaria rompió el módulo ─────
# Se conservan como tests porque cada uno fabricaba corroboración a partir de un
# solo informe, que es exactamente lo que este fichero existe para impedir.


def test_segun_X_cuando_X_es_a_su_vez_un_repetidor():
    """Un podcast dice «según ESPN» y el artículo de ESPN cita al insider.

    Contar `source:espn` como raíz creaba un SEGUNDO origen para una sola
    noticia. Si X aparece en el índice repitiendo a otro, se sigue su cadena.
    """
    claims = [
        Attributed("c0", "insider", originates=True),
        Attributed("c1", "espn", origin_claim_id="c0"),
        Attributed("c2", "podcast", origin_source_id="espn"),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1
    assert c.origins == ("source:insider",)
    assert c.can_claim_multiple_sources is False


def test_el_articulo_citado_no_esta_pero_la_fuente_SI_y_es_repetidora():
    claims = [
        Attributed("c0", "insider", originates=True),
        Attributed("c1", "espn", origin_claim_id="c0"),
        Attributed("c2", "podcast", origin_claim_id="ya_no_existe", origin_source_id="espn"),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1
    # El conteo NO basta: con esta rama desactivada, c2 cae a desconocido y el
    # número sigue siendo 1 porque c0 ya aportaba ese origen. Hay que afirmar
    # que c2 QUEDÓ RESUELTO, no sólo que la cuenta cuadra.
    assert c.unknown_origin == 0, "c2 tiene que resolverse al insider, no quedar sin resolver"


def test_una_fuente_citada_que_NO_esta_en_el_indice_si_es_raiz():
    """La otra mitad: si «según X» y X no aparece, X es la raíz utilizable.
    Sin esto el arreglo anterior habría convertido todo en desconocido."""
    claims = [
        Attributed("a", "medio_a", origin_source_id="agencia"),
        Attributed("b", "medio_b", originates=True),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 2
    assert set(c.origins) == {"source:agencia", "source:medio_b"}


def test_un_nodo_incoherente_no_aporta_origen():
    """Dice originar Y citar a otro. De las dos lecturas posibles, la que suma
    un origen es justo la que infla: un dato roto no corrobora nada."""
    claims = [
        Attributed("c0", "insider", originates=True),
        Attributed("c1", "sitio", originates=True, origin_claim_id="c0"),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1
    assert c.unknown_origin == 1
    assert c.can_claim_multiple_sources is False


def test_ids_repetidos_no_producen_una_respuesta_segura():
    """El índice es un dict y se quedaba con el ÚLTIMO: un eco con el id de un
    originador se resolvía COMO él y desaparecía sin ruido."""
    claims = [
        Attributed("c0", "insider", originates=True),
        Attributed("c1", "sitio", origin_claim_id="c0"),
        Attributed("c1", "otro", originates=True),
    ]
    c = corroboration(claims)
    assert c.total_claims == 3
    assert c.unknown_origin == 2, "las dos afirmaciones del id ambiguo son desconocidas"
    assert c.can_claim_multiple_sources is False


def test_un_originador_sin_fuente_identificable_no_es_un_origen():
    claims = [
        Attributed("a", "", originates=True),
        Attributed("b", "insider", originates=True),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1
    assert c.unknown_origin == 1
    assert c.can_claim_multiple_sources is False


def test_el_mismo_medio_escrito_de_tres_formas_es_uno():
    claims = [
        Attributed("a", "ESPN", originates=True),
        Attributed("b", "x", origin_source_id="espn"),
        Attributed("c", "y", origin_source_id="espn "),
    ]
    c = corroboration(claims)
    assert c.independent_origins == 1
    assert c.can_claim_multiple_sources is False
