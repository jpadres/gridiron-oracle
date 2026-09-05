"""La fecha de un dato sale de su fichero de origen, NUNCA del reloj.

Este campo existe porque la página de apuestas decía que las cuotas eran «as of
this build» — la hora de compilación prestada al dato. La primera versión del
arreglo escribía `Timestamp.now()`, que es el MISMO fallo con otro nombre: en
este repositorio `games.csv` llevaba siete días sin refrescarse cuando el
exportador habría dicho «hoy».

Se comprueba la propiedad, no la implementación: la fecha tiene que MOVERSE con
el fichero y no con el calendario.
"""

from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

from export_web_data import _fecha_de, _fechas_de_origen  # noqa: E402


class _Paths:
    def __init__(self, raw: Path, processed: Path):
        self.raw = raw
        self.processed = processed


def _con_fecha(ruta: Path, cuando: dt.date) -> Path:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text("x", encoding="utf-8")
    ts = dt.datetime.combine(cuando, dt.time(12, 0), tzinfo=dt.timezone.utc).timestamp()
    os.utime(ruta, (ts, ts))
    return ruta


def test_la_fecha_sale_del_fichero_y_no_del_reloj(tmp_path):
    viejo = _con_fecha(tmp_path / "games.csv", dt.date(2020, 1, 15))
    assert _fecha_de(viejo) == "2020-01-15"
    # Y no la de hoy, que es justo lo que haría una afirmación falsamente actual.
    assert _fecha_de(viejo) != dt.datetime.now(dt.timezone.utc).date().isoformat()


def test_un_fichero_que_no_esta_da_UNKNOWN_y_no_una_fecha_prestada(tmp_path):
    assert _fecha_de(tmp_path / "no-existe.csv") is None


def test_las_secciones_conservan_su_desacuerdo(tmp_path):
    """Tres orígenes con tres edades dan TRES fechas, no una aplanada."""
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _con_fecha(raw / "games.csv", dt.date(2026, 8, 29))
    _con_fecha(proc / "features.parquet", dt.date(2026, 9, 3))
    _con_fecha(proc / "player_weeks.parquet", dt.date(2026, 8, 17))

    fechas = _fechas_de_origen(_Paths(raw, proc))
    assert fechas == {
        "markets": "2026-08-29",
        "model": "2026-09-03",
        "fantasy": "2026-08-17",
    }
    # La propiedad, no los literales: si un día se aplanan en una sola, esto cae.
    assert len(set(fechas.values())) == 3


def test_sin_origen_la_seccion_es_UNKNOWN_y_no_hereda_de_otra(tmp_path):
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _con_fecha(raw / "games.csv", dt.date(2026, 8, 29))
    fechas = _fechas_de_origen(_Paths(raw, proc))
    assert fechas["markets"] == "2026-08-29"
    # `fantasy` no tiene fichero: UNKNOWN, jamás la fecha del mercado.
    assert fechas["fantasy"] is None
