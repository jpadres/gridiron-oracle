"""El catálogo de fuentes no puede inflar su propio recuento.

    250 SITIOS QUE REPITEN UN INFORME NO SON 250 FUENTES.

Y antes que eso: 32 subpáginas de un mismo medio no son 32 organizaciones. Por
eso el catálogo separa CUATRO tipos de entidad que no se suman entre sí, y este
test existe para que nadie los sume «para llegar a 250».
"""

from __future__ import annotations

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CATALOGO = RAIZ / "research" / "sources.json"

ESTADOS = {
    "PRODUCTION_INGEST",
    "PRODUCTION_CANDIDATE",
    "PRODUCTION_CANDIDATE_HISTORICAL_ONLY",
    "ON_DEMAND",
    "MANUAL_REFERENCE",
    "PAID_CANDIDATE",
    "REJECTED",
}
SECCIONES = ("providers", "organizations", "authors", "feeds", "rejected")


def catalogo() -> dict:
    return json.loads(CATALOGO.read_text(encoding="utf-8"))


def entradas(d: dict) -> list[dict]:
    return [e for s in SECCIONES for e in d.get(s, [])]


def test_el_catalogo_existe_y_declara_sus_secciones():
    d = catalogo()
    for seccion in SECCIONES:
        assert seccion in d, f"falta la sección {seccion}"


def test_ids_unicos_en_todo_el_catalogo():
    ids = [e["source_id"] for e in entradas(catalogo())]
    assert len(ids) == len(set(ids)), "hay source_id repetidos"


def test_todo_estado_es_conocido():
    """Ninguna entrada puede quedarse sin clasificar."""
    for e in entradas(catalogo()):
        assert e.get("state") in ESTADOS, f"{e.get('source_id')} tiene estado {e.get('state')!r}"


def test_las_cuatro_familias_NO_se_suman():
    """El recuento se publica por tipo, nunca agregado.

    Es la regla que impide el titular vacío «monitorizamos 250 fuentes». Un
    PROVIDER de datos, una ORGANIZACIÓN de prensa, un AUTOR y un FEED responden
    preguntas distintas y no son intercambiables.
    """
    d = catalogo()
    kinds = {e.get("kind") for e in entradas(d) if e.get("kind")}
    assert kinds <= {"PROVIDER", "ORGANIZATION", "AUTHOR", "FEED"}, kinds


def test_una_afirmacion_de_cadencia_lleva_su_verificacion():
    """Decir cada cuánto se actualiza algo es una afirmación sobre el mundo.

    La regla 5 del proyecto aplicada al catálogo: si se declara una cadencia,
    tiene que constar CUÁNDO se comprobó. Sin eso es una creencia con formato
    de dato, y la cadencia de una fuente cambia sin avisar.
    """
    for e in entradas(catalogo()):
        if e.get("freshness_expectation"):
            assert e.get("cadence_verified_at"), (
                f"{e['source_id']} declara cadencia sin fecha de verificación"
            )
            # Y CONTRA QUÉ se comprobó. Sólo la fecha deja «lo miré el día 5»,
            # que no se puede volver a comprobar ni contrastar: dos de las
            # cuatro entradas se subieron sin este campo y el test las dejó
            # pasar mientras el documento afirmaba que lo vigilaba.
            assert e.get("cadence_source"), (
                f"{e['source_id']} declara cadencia sin decir de dónde sale"
            )


def test_una_afirmacion_de_ALCANCE_dice_desde_donde_se_comprobo():
    """`reachable_from_ci: true` era una creencia con forma de dato.

    Lo que se comprobó fue un HTTP 200 desde ESTA sesión; CI tiene otra red y
    otra política de salida, y nadie lo probó allí. Una afirmación sobre un
    entorno en el que no se ha ejecutado nada es exactamente la clase de dato
    que este catálogo existe para no publicar: UNKNOWN antes que supuesto.
    """
    for e in entradas(catalogo()):
        alcance = e.get("reachability")
        if alcance is None:
            continue
        assert alcance.get("checked_from"), f"{e['source_id']}: alcance sin origen"
        assert alcance.get("checked_at"), f"{e['source_id']}: alcance sin fecha"
        assert "from_ci" in alcance, f"{e['source_id']}: falta declarar el caso de CI"
        assert alcance["from_ci"] is None or isinstance(alcance["from_ci"], bool)
    # Y que nadie reintroduzca el campo plano que lo afirmaba sin comprobarlo.
    for e in entradas(catalogo()):
        assert "reachable_from_ci" not in e, (
            f"{e['source_id']} vuelve a afirmar alcance desde CI sin haberlo comprobado"
        )


def test_lo_que_no_sirve_en_temporada_no_se_marca_como_produccion_semanal():
    """`participation` sólo se publica tras los playoffs. No puede quedar como
    fuente de producción semanal por descuido: ése sería exactamente el dato
    viejo presentado como actual."""
    d = catalogo()
    part = next(e for e in d["providers"] if e["source_id"] == "nflverse.participation")
    assert part["state"] == "PRODUCTION_CANDIDATE_HISTORICAL_ONLY"
    assert "NO actualiza en temporada" in part["freshness_expectation"]


# --- Lo derivado del archivo (scripts/source_registry_build.py) --------------

CLASIFICACIONES = {"VETTED", "DISCOVERED", "REDUNDANT", "REJECTED"}


def test_toda_organizacion_derivada_lleva_clasificacion_con_su_base():
    d = catalogo()
    for e in d["organizations"] + d["rejected"]:
        assert e.get("classification") in CLASIFICACIONES, e["source_id"]
        assert e.get("classification_basis"), f"{e['source_id']}: clasificación sin base escrita"
        # «ingestible» es una afirmación sobre un feed verificado: sin feed, null.
        assert "ingestible" in e and (e["ingestible"] is None or isinstance(e["ingestible"], bool))


def test_un_eco_no_cuenta_como_origen():
    d = catalogo()
    for e in d["organizations"]:
        if e["classification"] == "REDUNDANT":
            assert e["counts_as_origin"] is False, e["source_id"]
    for e in d["rejected"]:
        assert e["classification"] == "REJECTED" and e["state"] == "REJECTED"


def test_una_edicion_regional_no_es_otra_organizacion():
    d = catalogo()
    domains = [e["domain"] for e in d["organizations"] + d["rejected"]]
    assert len(domains) == len(set(domains))
    for a in domains:
        for b in domains:
            assert a == b or not a.endswith("." + b), f"{a} es un subdominio de {b}: se cuenta dos veces"


def test_los_recuentos_no_se_inflan_con_lo_rechazado_ni_con_lo_redundante():
    d = catalogo()
    origenes = [e for e in d["organizations"] if e["counts_as_origin"]]
    assert len(origenes) < len(d["organizations"]) + len(d["rejected"])
    assert all(e["citations"] >= 1 for e in d["organizations"])
