"""Registro de capacidades y autoridad de decisión.

Bloques D y E del Decision Lab V2. Estos tests son lo que convierte la regla
arquitectónica en algo que se cumple, en vez de en algo que se recuerda.
"""

from __future__ import annotations

import pytest

from oracle.capabilities import (
    REGISTRY,
    Authority,
    Status,
    as_payload,
    get,
    may_recommend,
)
from oracle.decisions import BANDS, Confidence, band_for

# --- la regla arquitectónica -----------------------------------------------

def test_la_autoridad_se_deriva_del_estado_y_no_se_puede_subir():
    """No hay excepciones «porque este caso es distinto».

    En cuanto una capacidad pudiera saltarse su estado, el registro deja de
    valer para nada.
    """
    esperado = {
        Status.VALIDATED: Authority.RECOMMEND,
        Status.NOT_READY: Authority.INFORM,
        Status.REJECTED: Authority.DATA_ONLY,
        Status.BLOCKED: Authority.HIDE,
        Status.DESIGN_ONLY: Authority.HIDE,
    }
    for capability in REGISTRY:
        assert capability.authority is esperado[capability.status], capability.id
    # Y `authority` es una propiedad derivada, no un campo que se pueda asignar.
    assert "authority" not in {f for f in REGISTRY[0].__dataclass_fields__}


def test_un_estado_validado_o_rechazado_exige_un_experimento_detras():
    """Un estado sin medición es una opinión con formato de dato.

    Sólo BLOCKED y DESIGN_ONLY pueden no tener experimento: sin medición no hay
    nada que validar ni que rechazar.
    """
    for capability in REGISTRY:
        if capability.status in (Status.VALIDATED, Status.REJECTED, Status.NOT_READY):
            assert capability.experiment_id, capability.id
            assert capability.metric, capability.id
            assert capability.sample_size, capability.id
            assert capability.last_validated, capability.id


def test_una_capacidad_desconocida_revienta_en_vez_de_permitir():
    """Ante lo no evaluado, el comportamiento seguro no es «adelante»."""
    with pytest.raises(KeyError, match="desconocida"):
        get("START_SIT_PUNTER")
    with pytest.raises(KeyError):
        may_recommend("LO_QUE_SEA")


# --- los casos concretos que motivaron todo esto ---------------------------

def test_el_quarterback_informa_pero_no_recomienda():
    """El caso que motivó el bloque entero.

    El modelo de QB proyecta números utilizables —T.Lawrence 22,6— y la
    capacidad de recomendar entre dos quarterbacks NO está validada: pierde
    contra la media de sus seis últimos partidos por tres vías independientes.

    Las dos cosas a la vez. La interfaz puede enseñar el número; no puede decir
    «alinea a Lawrence».
    """
    qb = get("START_SIT_QB")
    assert qb.status is Status.NOT_READY
    assert qb.authority is Authority.INFORM
    assert not may_recommend("START_SIT_QB")
    # Y las otras tres posiciones sí.
    for position in ("RB", "WR", "TE"):
        assert may_recommend(f"START_SIT_{position}"), position


def test_el_pateador_no_puede_presentarse_ordenado():
    """Rechazado el ORDEN, no el modelo. La distinción está en el registro."""
    assert get("KICKER_ORDINAL_RANKING").authority is Authority.DATA_ONLY
    assert get("KICKER_SKILL_ESTIMATE").authority is Authority.DATA_ONLY


def test_el_clima_separa_lo_descriptivo_de_lo_predictivo():
    """Dos capacidades distintas para el mismo fenómeno, y tiene que ser así.

    El efecto es real hacia atrás y no se puede usar hacia adelante, porque el
    dato sólo existe después del partido.
    """
    assert get("WEATHER_HISTORICAL").status is Status.VALIDATED
    assert get("WEATHER_PREDICTION").status is Status.BLOCKED
    assert get("WEATHER_PREDICTION").authority is Authority.HIDE


def test_las_apuestas_estan_rechazadas_con_su_numero():
    apuestas = get("BETTING_EDGE")
    assert apuestas.status is Status.REJECTED
    assert "52,4" in apuestas.evidence  # el equilibrio, para que no se olvide


def test_el_payload_lleva_estado_y_autoridad_de_cada_capacidad():
    payload = as_payload()
    assert payload["model_version"]
    assert len(payload["capabilities"]) == len(REGISTRY)
    for entry in payload["capabilities"]:
        assert entry["status"] in {s.value for s in Status}
        assert entry["authority"] in {a.value for a in Authority}
        assert isinstance(entry["limitations"], list)


def test_toda_capacidad_validada_declara_sus_limitaciones():
    """Una capacidad validada sin limitaciones escritas es sospechosa.

    Todo lo que se ha medido en este proyecto tiene un borde donde deja de
    valer, y ese borde es lo primero que se pierde al pasar a producto.
    """
    for capability in REGISTRY:
        if capability.status is Status.VALIDATED:
            assert capability.limitations, capability.id


# --- la escala de separación (bloque C) ------------------------------------

def test_por_debajo_de_un_punto_no_es_informativo():
    """El hallazgo de E12, convertido en contrato.

    Los puestos consecutivos de un ranking se separan por mucho menos de un
    punto: el 14 y el 15 son la misma cosa.
    """
    for gap in (0.0, 0.3, 0.99):
        banda = band_for(gap)
        assert banda.confidence is Confidence.TOSS_UP
        assert not banda.is_informative
        assert banda.accuracy_ci[0] <= 0.50 <= banda.accuracy_ci[1]


def test_los_tramos_son_monotonos_y_cubren_todo():
    anterior = 0.0
    for banda in BANDS:
        assert banda.min_gap == anterior
        anterior = banda.max_gap if banda.max_gap is not None else anterior
    assert BANDS[-1].max_gap is None  # el último no tiene techo
    # Y el acierto crece con la separación.
    aciertos = [b.historical_accuracy for b in BANDS]
    assert aciertos == sorted(aciertos)


def test_la_escala_no_expone_nada_llamado_probabilidad():
    """Son frecuencias históricas del sistema, no probabilidades por par.

    Las dos cosas se leen igual en una pantalla y sólo una está respaldada. El
    nombre del campo es la única defensa que hay.
    """
    campos = set(BANDS[0].__dataclass_fields__)
    assert not {c for c in campos if "prob" in c.lower()}
    assert "historical_accuracy" in campos
    for entrada in band_for(4.0).__dataclass_fields__:
        assert "prob" not in entrada.lower()
