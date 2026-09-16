"""El puesto de registro: cada test lleva el fallo que existe para cazar."""
from __future__ import annotations

import pandas as pd
import pytest

from oracle.fantasy.jobs import (
    HAS_JOB,
    NOT_THE_JOB,
    UNKNOWN_JOB,
    DepthChartUnavailable,
    attach,
    jobs_of_record,
    latest_snapshot,
)

VIEJO = "2026-03-22T06:38:42Z"
NUEVO = "2026-09-15T12:39:14Z"


def _fila(dt, team, name, gsis, rank, pos="PK"):
    return {"dt": dt, "team": team, "player_name": name, "gsis_id": gsis,
            "pos_abb": pos, "pos_rank": rank}


def _chart():
    """Dos instantáneas con titulares DISTINTOS, a propósito.

    Si las dos dijeran lo mismo, leer la vieja pasaría el test — el «8 y 9 son
    los dos míos» del test del turno. Aquí ATL cambia de pateador entre marzo y
    septiembre, así que la respuesta correcta y la incorrecta son distintas.
    """
    return pd.DataFrame([
        _fila(VIEJO, "ATL", "Zane Gonzalez", "00-0033553", 1),
        _fila(VIEJO, "LA", "Joshua Karty", "00-0039697", 1),
        _fila(NUEVO, "ATL", "Nick Folk", "00-0025565", 1),
        _fila(NUEVO, "LA", "Harrison Mevis", "00-0039498", 1),
        _fila(NUEVO, "NYJ", "Jason Sanders", "00-0034794", 1),
        _fila(NUEVO, "NYJ", "Blake Grupe", "00-0038443", 2),
    ])


def test_se_lee_la_instantanea_MAS_RECIENTE_entera():
    ult, instante = latest_snapshot(_chart())
    assert instante == NUEVO
    # Entera: no se mezcla el ATL de septiembre con el LA de marzo, porque ese
    # orden no existió nunca a la vez.
    assert set(ult["dt"]) == {NUEVO}


def test_el_titular_de_septiembre_gana_al_de_marzo():
    jobs = jobs_of_record(_chart())
    assert jobs["ATL"].player_name == "Nick Folk"
    assert jobs["ATL"].effective_at == NUEVO


def test_el_codigo_de_equipo_pasa_por_normalize_team():
    """«LA» en el depth chart es «LAR» en el board.

    Comparar en crudo fabricó cinco traspasos falsos la noche antes de un draft.
    """
    jobs = jobs_of_record(_chart())
    assert "LAR" in jobs, "el depth chart escribe LA y el board LAR"
    assert "LA" not in jobs
    assert jobs["LAR"].player_name == "Harrison Mevis"


def test_dos_en_el_mismo_puesto_es_COMPETENCIA_y_no_se_elige():
    jobs = jobs_of_record(_chart())
    nyj = jobs["NYJ"]
    assert nyj.player_name == "Jason Sanders"   # el rank 1, no el último leído
    assert nyj.contested is True
    assert nyj.competition == ("Blake Grupe",)


def test_sin_depth_chart_LEVANTA_en_vez_de_borrar_a_los_32():
    """«No sé quién tiene el trabajo» no es «nadie lo tiene».

    Devolver un diccionario vacío dejaría a los 32 pateadores marcados como que
    no tienen el puesto, sin decir que la fuente faltaba.
    """
    with pytest.raises(DepthChartUnavailable):
        jobs_of_record(pd.DataFrame())
    with pytest.raises(DepthChartUnavailable):
        jobs_of_record(pd.DataFrame([{"team": "ATL", "pos_abb": "PK", "pos_rank": 1}]))


def test_attach_marca_los_tres_veredictos():
    jobs = jobs_of_record(_chart())
    filas = [
        {"player_id": "00-0025565", "team": "ATL", "projected_points": 8.0},   # sí
        {"player_id": "00-0033553", "team": "ATL", "projected_points": 7.5},   # no
        {"player_id": "00-0099999", "team": "SEA", "projected_points": 9.0},   # sin equipo en la instantánea
    ]
    attach(filas, jobs)
    assert [f["job_status"] for f in filas] == [HAS_JOB, NOT_THE_JOB, UNKNOWN_JOB]
    # El de ATL que NO tiene el puesto sabe quién lo tiene: eso es lo que la
    # pantalla necesita para no publicarlo como el pateador de Atlanta.
    assert filas[1]["job_holder"] == "Nick Folk"


def test_attach_NO_toca_un_solo_numero():
    """Marcar no es calcular. Si un día esto moviera una proyección, la garantía
    anti-fuga del proyecto dejaría de valer — es la regla 8 aplicada al puesto."""
    jobs = jobs_of_record(_chart())
    filas = [{"player_id": "00-0033553", "team": "ATL", "projected_points": 7.5}]
    antes = dict(filas[0])
    attach(filas, jobs)
    nuevos = set(filas[0]) - set(antes)
    assert all(k.startswith("job_") for k in nuevos), f"escribió fuera de job_: {nuevos}"
    assert filas[0]["projected_points"] == antes["projected_points"]


def test_la_competencia_solo_se_atribuye_a_quien_TIENE_el_puesto():
    jobs = jobs_of_record(_chart())
    filas = [{"player_id": "00-0038443", "team": "NYJ"}]    # Grupe, el segundo
    attach(filas, jobs)
    assert filas[0]["job_status"] == NOT_THE_JOB
    assert filas[0]["job_contested"] is False, "no tiene el puesto: decir «disputado» mezcla dos hechos"
