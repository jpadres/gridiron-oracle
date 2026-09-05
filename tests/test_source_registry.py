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


def test_lo_que_no_sirve_en_temporada_no_se_marca_como_produccion_semanal():
    """`participation` sólo se publica tras los playoffs. No puede quedar como
    fuente de producción semanal por descuido: ése sería exactamente el dato
    viejo presentado como actual."""
    d = catalogo()
    part = next(e for e in d["providers"] if e["source_id"] == "nflverse.participation")
    assert part["state"] == "PRODUCTION_CANDIDATE_HISTORICAL_ONLY"
    assert "NO actualiza en temporada" in part["freshness_expectation"]
