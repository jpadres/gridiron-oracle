"""Pateadores.

El hallazgo que gobierna este módulo está medido, no supuesto: la conversión de
un pateador no predice la del año siguiente (r = 0,024) y su dispersión apenas
supera la del azar binomial. Estos tests fijan las consecuencias de diseño.
"""

from __future__ import annotations

import pandas as pd
import pytest

from oracle.fantasy.kickers import (
    KickerScoring,
    OpportunityModel,
    distance_mix,
    fit_opportunity,
    project,
)


@pytest.fixture
def semanas() -> pd.DataFrame:
    """Pateador-semanas sintéticas con una relación puntos -> intentos clara."""
    filas = []
    for i in range(400):
        puntos = 10 + (i % 25)
        filas.append({
            "season": 2020, "week": 1 + i % 17, "team": f"T{i % 8}",
            "pat_att": puntos // 7, "pat_made": puntos // 7,
            "fg_att": 2.0, "fg_made": 1.0,
            "fg_made_30_39": 1.0, "fg_missed_30_39": 1.0,
        })
    return pd.DataFrame(filas)


@pytest.fixture
def puntos() -> pd.DataFrame:
    """Puntos del equipo, en su propia tabla como en producción."""
    filas = []
    for i in range(400):
        filas.append({"season": 2020, "week": 1 + i % 17, "team": f"T{i % 8}",
                      "points_for": 10 + (i % 25)})
    return pd.DataFrame(filas).drop_duplicates(subset=["season", "week", "team"])


def test_mas_puntos_del_equipo_es_mas_oportunidad(semanas, puntos):
    """Todo el modelo es esto: el pateador cobra lo que anota su ataque."""
    modelo = fit_opportunity(semanas, puntos)
    pocos = modelo.expected(10.0)
    muchos = modelo.expected(35.0)
    assert muchos.pat_attempts > pocos.pat_attempts
    assert muchos.fg_attempts >= pocos.fg_attempts


def test_el_pateador_no_aporta_ni_un_parametro(semanas, puntos):
    """No es una simplificación: es el hallazgo.

    Con r = 0,024 año contra año en porcentaje de acierto, una tasa por pateador
    sería ruido con tres decimales. Si alguien añade un parámetro individual
    aquí, tiene que revalidar el preregistro entero.
    """
    modelo = fit_opportunity(semanas, puntos)
    campos = set(OpportunityModel.__dataclass_fields__)
    assert not {c for c in campos if "player" in c or "kicker" in c}
    # Y `project` sólo recibe puntos de equipo, modelo de liga y reparto de liga.
    assert project(24.0, modelo, distance_mix(semanas)) > 0


def test_tramo_sin_muestra_no_se_inventa(semanas, puntos):
    """Una tasa de acierto sin intentos detrás se deja fuera, no se estima.

    Salir algo bajo es honesto; inventar un 0,80 desde 60 yardas no lo es.
    """
    modelo = fit_opportunity(semanas, puntos)
    assert not pd.notna(modelo.conversion["fg_made_60_"])
    # Y el proyectado sigue siendo finito y positivo pese al tramo ausente.
    assert 0 < project(24.0, modelo, distance_mix(semanas)) < 30


def test_la_puntuacion_premia_la_distancia():
    """Los tramos largos valen más, que es la única parte no volumétrica."""
    reglas = KickerScoring()
    assert reglas.by_bucket[4] > reglas.by_bucket[0]  # 50-59 vale más que 0-19
    assert reglas.fg_missed < 0
