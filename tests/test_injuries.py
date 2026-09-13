"""El parte de lesiones oficial: MARCA, y no convierte una progresión en una
probabilidad de jugar.

Cada test lleva el fallo que existe para cazar.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from oracle.fantasy import injuries


def _parte(tmp_path: Path, filas) -> Path:
    ruta = tmp_path / "injuries_2026.parquet"
    pd.DataFrame(filas).to_parquet(ruta)
    return ruta


def _fila(**kw):
    base = {
        "season": 2026, "week": 1, "team": "LV", "gsis_id": "00-0000001",
        "position": "TE", "full_name": "Un Jugador",
        "report_primary_injury": "Knee", "report_status": None,
        "practice_status": None,
    }
    base.update(kw)
    return base


def test_una_designacion_NUEVA_levanta_en_vez_de_colarse_como_juega(tmp_path):
    """La puerta que cazó `INA` en las plantillas, aquí también.

    Conocer tres designaciones no es conocerlas todas: la liga puede añadir
    otra, y traducirla a «sin designación» por defecto convertiría un cambio de
    vocabulario en un board que afirma que alguien apartado juega.
    """
    ruta = _parte(tmp_path, [_fila(report_status="Probable")])
    with pytest.raises(injuries.InjuryReportUnknown, match="Probable"):
        injuries.load(ruta, season=2026, week=1)


def test_un_estado_de_ENTRENAMIENTO_nuevo_tambien_levanta(tmp_path):
    ruta = _parte(tmp_path, [_fila(practice_status="Rested")])
    with pytest.raises(injuries.InjuryReportUnknown, match="Rested"):
        injuries.load(ruta, season=2026, week=1)


def test_DOUBTFUL_no_es_OUT(tmp_path):
    """Un dudoso PUEDE jugar. Excluirlo de la alineación sería convertir una
    designación en una predicción, que es justo lo que este módulo no hace.
    """
    ruta = _parte(tmp_path, [
        _fila(gsis_id="a", report_status="Out"),
        _fila(gsis_id="b", report_status="Doubtful"),
        _fila(gsis_id="c", report_status="Questionable"),
    ])
    e = injuries.load(ruta, season=2026, week=1)
    assert e["a"].excludes_from_lineup is True
    assert e["b"].excludes_from_lineup is False, "un DOUBTFUL no está descartado"
    assert e["c"].excludes_from_lineup is False
    # Pero los tres son un aviso: DOUBTFUL y QUESTIONABLE comparten severidad.
    assert e["a"].severity == "OUT"
    assert e["b"].severity == "RISK"
    assert e["c"].severity == "RISK"


def test_la_designacion_y_el_ENTRENAMIENTO_son_dos_hechos_distintos(tmp_path):
    """Se puede entrenar COMPLETO y estar OUT — Michael Penix Jr. figura así en
    la jornada 1 de 2026. Colapsar las dos en «lesionado» borra lo que decide
    una alineación, y deducir «entrena completo, luego juega» es inventar.
    """
    ruta = _parte(tmp_path, [
        _fila(gsis_id="a", report_status="Out",
              practice_status="Full Participation in Practice"),
        _fila(gsis_id="b", report_status=None,
              practice_status="Did Not Participate In Practice"),
    ])
    e = injuries.load(ruta, season=2026, week=1)
    assert e["a"].designation == "OUT" and e["a"].practice == "FULL"
    assert e["a"].excludes_from_lineup is True, "entrenar completo no anula un OUT"
    # Y al revés: sin designación no hay designación, por mucho DNP que haya.
    assert e["b"].designation is None and e["b"].practice == "DNP"
    assert e["b"].severity is None
    assert e["b"].excludes_from_lineup is False


def test_el_parte_se_acota_a_SU_jornada(tmp_path):
    """El fichero acumula la temporada: el parte de la 3 no dice nada de la 7."""
    ruta = _parte(tmp_path, [
        _fila(gsis_id="a", week=1, report_status="Out"),
        _fila(gsis_id="b", week=2, report_status="Out"),
    ])
    e = injuries.load(ruta, season=2026, week=1)
    assert set(e) == {"a"}, "se coló una jornada que no es"


def test_los_codigos_de_equipo_pasan_por_normalize_team(tmp_path):
    """El parte escribe «LA» y el board «LAR». Es el `AZ`/`ARI` de siempre."""
    ruta = _parte(tmp_path, [_fila(gsis_id="a", team="LA")])
    assert injuries.load(ruta, season=2026, week=1)["a"].team == "LAR"


def test_attach_escribe_SOLO_campos_con_prefijo_injury(tmp_path):
    """La regla 8 tiene que poder comprobarse leyendo la lista de campos: el
    número de la fila es el mismo con marca y sin ella."""
    ruta = _parte(tmp_path, [_fila(gsis_id="p1", report_status="Questionable")])
    e = injuries.load(ruta, season=2026, week=1)
    fila = {"player_id": "p1", "projected_points": 123.4, "vor": 45.6}
    antes = dict(fila)
    assert injuries.attach([fila], e) == 1
    nuevos = set(fila) - set(antes)
    assert nuevos and all(k.startswith("injury_") for k in nuevos), sorted(nuevos)
    assert fila["projected_points"] == antes["projected_points"]
    assert fila["vor"] == antes["vor"]
    assert fila["injury_designation"] == "QUESTIONABLE"


def test_sin_parte_no_se_marca_a_nadie(tmp_path):
    """«Ninguno está lesionado» es una afirmación que este módulo no puede
    hacer: sin fichero se devuelve vacío y no se toca ninguna fila."""
    assert injuries.load(tmp_path / "no-existe.parquet", season=2026, week=1) == {}
    fila = {"player_id": "p1"}
    assert injuries.attach([fila], {}) == 0
    assert fila == {"player_id": "p1"}


def test_el_parte_se_REFRESCA_con_el_resto():
    """Un parte descargado una vez y nunca más es peor que no tenerlo.

    Caduca en horas —un jugador pasa de dudoso a inactivo el mismo domingo— y
    un fichero congelado se leería como actual, que es la regla 5 exacta. Tiene
    que estar en la lista que `oracle refresh` recorre, no bajarse a mano.
    """
    import inspect

    from oracle.data import ingest

    fuente = inspect.getsource(ingest.download_season)
    assert '"injuries"' in fuente, (
        "el parte no entra en `oracle refresh`: se quedaría congelado"
    )
    assert "injuries" in ingest.FIRST_SEASON_BY_DATASET, (
        "sin temporada de arranque, una ausencia esperable abortaría la descarga"
    )
