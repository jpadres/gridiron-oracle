"""La capa de red del ADP, probada con un doble que se PARECE al original.

Un doble que miente en un campo prueba otra cosa: ya costó una iteración con
los fixtures de Sleeper sin `metadata.position`. La respuesta de aquí abajo es
la forma real de la API pública, recortada.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from oracle.fantasy.adp_fetch import AdpUnavailable, fetch

RESPUESTA = {
    "status": "Success",
    "meta": {"type": "PPR", "teams": 12, "rounds": 15, "total_drafts": 1837,
             "start_date": "2026-08-30", "end_date": "2026-09-06"},
    "players": [
        {"player_id": 1, "name": "Bijan Robinson", "position": "RB", "team": "ATL",
         "adp": 1.4, "times_drafted": 1800},
        {"player_id": 2, "name": "Ja'Marr Chase", "position": "WR", "team": "CIN",
         "adp": 2.1, "times_drafted": 1790},
        {"player_id": 3, "name": "Sin ADP", "position": "TE", "team": "KC",
         "times_drafted": 3},
    ],
}


class _Respuesta:
    def __init__(self, payload, status=200):
        self._cuerpo = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self):
        return self._cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _opener(payload):
    def abrir(request, timeout=None):  # noqa: ARG001
        return _Respuesta(payload)
    return abrir


AHORA = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)


def test_la_instantanea_lleva_su_contexto_entero():
    """Un ADP sin formato, tamaño de liga y muestra es un número que parece un dato."""
    snap = fetch("ppr", 12, 2026, opener=_opener(RESPUESTA), now=AHORA)
    assert snap.source == "fantasyfootballcalculator"
    assert snap.scoring == "ppr"
    assert snap.league_size == 12
    assert snap.sample_size == 1837
    assert snap.window == "2026-08-30"
    # LA FECHA DE DESCARGA SE LLAMA DESCARGA. La fuente no publica cuándo
    # calculó el agregado, así que esto no puede leerse como «el ADP es de hoy».
    assert snap.fetched_at == "2026-09-06T12:00:00Z"


def test_una_fila_sin_adp_no_se_inventa():
    snap = fetch("ppr", 12, 2026, opener=_opener(RESPUESTA), now=AHORA)
    assert [e.name for e in snap.entries] == ["Bijan Robinson", "Ja'Marr Chase"]


def test_sin_jugadores_LEVANTA_en_vez_de_devolver_media_instantanea():
    vacia = {"meta": RESPUESTA["meta"], "players": []}
    with pytest.raises(AdpUnavailable):
        fetch("ppr", 12, 2026, opener=_opener(vacia), now=AHORA)


def test_un_fallo_de_red_no_devuelve_una_instantanea_vacia():
    def revienta(request, timeout=None):  # noqa: ARG001
        raise OSError("connect_rejected")
    with pytest.raises(AdpUnavailable):
        fetch("ppr", 12, 2026, opener=revienta, now=AHORA)


def test_un_formato_que_la_fuente_no_publica_no_se_pide():
    with pytest.raises(AdpUnavailable):
        fetch("superflex-inventado", 12, 2026, opener=_opener(RESPUESTA), now=AHORA)
