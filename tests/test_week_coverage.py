"""La OTRA mitad de la frescura: de qué jornada habla el dato.

    DATO RECIENTE + JORNADA VIEJA = RESPUESTA ACTUAL FALSA.

Es la regla 5 con el eje cambiado, y es el síntoma que se reportó el 7 de
octubre de 2026: el sitio servía la jornada 4 estando en la 5, con los ficheros
razonablemente frescos. La edad no lo podía ver porque la edad no es la
pregunta.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from oracle import health
from oracle.fantasy.weekly import history_before, stats_window
from oracle.freshness import Domain

AHORA = dt.datetime(2026, 10, 7, 12, 0, tzinfo=dt.timezone.utc)


def _assess(*, covers_week, current_week, published_at=None):
    return health.assess(
        name="x", feeds="y", domain=Domain.ODDS, origin="o",
        published_at=published_at or AHORA,
        covers_week=covers_week, current_week=current_week, now=AHORA,
    )


def test_una_jornada_atras_es_stale_aunque_el_fichero_sea_de_hace_un_minuto():
    r = _assess(covers_week=4, current_week=5, published_at=AHORA - dt.timedelta(minutes=1))
    assert r.coverage == health.BEHIND
    assert r.label == health.STALE
    # La edad se conserva tal cual: es un hecho distinto y no se pisa.
    assert r.freshness != "STALE"
    assert "week 4" in (r.reason or ""), "el motivo tiene que nombrar la jornada que cubre"
    assert "current week is 5" in (r.reason or ""), "y la de hoy, para poder discutirlo"


def test_la_jornada_de_hoy_no_se_degrada():
    r = _assess(covers_week=5, current_week=5)
    assert r.coverage == health.CURRENT_WEEK
    assert r.label == health.FRESH


def test_sin_jornada_que_comparar_no_se_afirma_nada():
    # Una estadística de carrera no cubre una jornada: NOT_WEEKLY es una
    # respuesta válida y no un «no sé» suave.
    assert _assess(covers_week=None, current_week=5).coverage == health.NOT_WEEKLY
    assert _assess(covers_week=4, current_week=None).coverage == health.NOT_WEEKLY


def test_el_motivo_de_la_edad_no_se_borra_al_añadir_el_de_cobertura():
    # Las dos cosas pueden estar mal a la vez, y quedarse con una sola borra
    # información: el lector necesita saber que además está viejo.
    r = _assess(covers_week=4, current_week=5, published_at=AHORA - dt.timedelta(days=9))
    assert "week 4" in (r.reason or "")
    assert "window" in (r.reason or "")


def test_la_cobertura_viaja_al_payload():
    assert _assess(covers_week=4, current_week=5).as_dict()["coverage"] == health.BEHIND


# --- la ventana de estadística, MEDIDA sobre las filas que entran -----------

COLUMNAS = ["season", "week", "season_type", "player_id", "position"]


def _filas(pares):
    """Un doble que se PARECE al original: con `season_type` incluso vacío.

    `regular_season` falla cerrado si falta la columna —a propósito, para que un
    cambio de esquema no cuele los playoffs— así que un frame vacío sin columnas
    probaría otra cosa.
    """
    filas = [
        {"season": s, "week": w, "season_type": "REG", "player_id": "p", "position": "WR"}
        for s, w in pares
    ]
    return pd.DataFrame(filas, columns=COLUMNAS)


def test_la_ventana_sale_de_las_filas_y_no_de_una_resta():
    # La jornada 4 NO se ha descargado. `week - 1` diría 4; la verdad es 3.
    v = stats_window(_filas([(2026, 1), (2026, 2), (2026, 3)]), 2026, 5)
    assert v == {"season": 2026, "week": 3, "basis": "PLAYER_WEEKS_ROWS"}


def test_la_ventana_incluye_la_jornada_mas_reciente_jugada():
    v = stats_window(_filas([(2026, w) for w in (1, 2, 3, 4)]), 2026, 5)
    assert v["week"] == 4


def test_sin_filas_la_ventana_es_unknown_y_no_la_jornada_cero():
    assert stats_window(_filas([]), 2026, 5) is None


def test_la_ventana_no_mira_el_futuro():
    v = stats_window(_filas([(2026, w) for w in (1, 2, 3, 4, 5, 6)]), 2026, 5)
    assert v["week"] == 4, "la jornada que se proyecta no puede entrar en su propia ventana"


def test_los_playoffs_no_entran_en_la_ventana():
    filas = _filas([(2025, 17), (2025, 18)])
    filas.loc[filas["week"] == 18, "season_type"] = "POST"
    assert stats_window(filas, 2026, 1)["week"] == 17


def test_weekly_rankings_usa_el_mismo_recorte_que_lo_publicado():
    """Un solo recorte, leído en el CÓDIGO.

    Si `weekly_rankings` vuelve a filtrar por su cuenta, la jornada publicada
    como «stats hasta» puede dejar de ser la que entra sin que falle nada: dos
    traductores del mismo hecho, el fallo que más veces ha costado una
    iteración aquí.
    """
    from pathlib import Path
    fuente = Path("src/oracle/fantasy/weekly.py").read_text(encoding="utf-8")
    cuerpo = fuente.split("def weekly_rankings(", 1)[1].split("\ndef ", 1)[0]
    assert "history_before(" in cuerpo, "weekly_rankings tiene que llamar al recorte compartido"
    assert 'player_weeks["season"] < season' not in cuerpo, (
        "weekly_rankings ha vuelto a escribir el recorte a mano"
    )


def test_el_recorte_de_player_weeks_esta_escrito_una_sola_vez():
    """Una definición del «historial anterior» SOBRE player_weeks.

    Los recortes de `team_points` y `team_games` son otros frames y quedan
    fuera a propósito: no llevan etapa y `regular_season` no aplica. Lo que no
    puede haber es dos lecturas distintas de las MISMAS filas, que es lo que
    haría que `stats_window` describiera a una y no a la otra.
    """
    from pathlib import Path
    fuente = Path("src/oracle/fantasy/weekly.py").read_text(encoding="utf-8")
    assert fuente.count('player_weeks["season"] < season') == 0, (
        "alguien ha vuelto a recortar player_weeks a mano en vez de usar history_before"
    )
    assert fuente.count("def history_before(") == 1


@pytest.mark.parametrize("temporada", [2025, 2026])
def test_la_ventana_respeta_el_cambio_de_temporada(temporada):
    filas = _filas([(2025, 17), (2026, 1), (2026, 2)])
    v = stats_window(filas, 2026, 2)
    assert (v["season"], v["week"]) == (2026, 1)
    assert history_before(filas, temporada, 1).empty is (temporada == 2025)
