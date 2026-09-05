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


def _descargas(raw: Path, calendario, pbp, stats, rosters) -> None:
    """Los ficheros que `oracle refresh` baja, con su fecha de descarga."""
    _con_fecha(raw / "games.csv", calendario)
    _con_fecha(raw / "pbp_2025.parquet", pbp)
    _con_fecha(raw / "player_stats_2025.parquet", stats)
    _con_fecha(raw / "roster_2026.parquet", rosters)


def test_las_secciones_conservan_su_desacuerdo(tmp_path):
    """Tres orígenes con tres edades dan TRES fechas, no una aplanada."""
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _descargas(raw, dt.date(2026, 8, 29), dt.date(2026, 8, 20),
               dt.date(2026, 8, 17), dt.date(2026, 9, 4))

    fechas = _fechas_de_origen(_Paths(raw, proc))
    assert fechas == {
        "markets": "2026-08-29",   # el calendario
        "model": "2026-08-20",     # el más viejo de calendario y play-by-play
        "fantasy": "2026-08-17",   # el más viejo de estadística y rosters
    }
    # La propiedad, no los literales: si un día se aplanan en una sola, esto cae.
    assert len(set(fechas.values())) == 3


def test_un_ARTEFACTO_COMPILADO_no_puede_dar_frescura(tmp_path):
    """EL FALLO QUE ESTE CAMPO EXISTE PARA IMPEDIR, cometido en su arreglo.

    `features.parquet` y `player_weeks.parquet` los produce este repositorio: su
    mtime es cuándo corrí el pipeline, no cuándo se bajaron los datos. Fechando
    con ellos, `oracle features` sobre una descarga de hace tres semanas ponía
    HOY. Estaba pasando en producción: el sitio publicaba el board como del 5 de
    septiembre con estadística descargada el 17 de agosto.

    La propiedad es incondicional: recompilar no mueve ninguna fecha.
    """
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _descargas(raw, dt.date(2026, 8, 17), dt.date(2026, 8, 17),
               dt.date(2026, 8, 17), dt.date(2026, 8, 17))
    antes = _fechas_de_origen(_Paths(raw, proc))

    # Ahora se compila TODO hoy, sin bajar un solo byte nuevo.
    _con_fecha(proc / "features.parquet", dt.date.today())
    _con_fecha(proc / "player_weeks.parquet", dt.date.today())
    _con_fecha(proc / "team_games.parquet", dt.date.today())
    _con_fecha(proc / "games.parquet", dt.date.today())

    assert _fechas_de_origen(_Paths(raw, proc)) == antes, (
        "recompilar movió una fecha: eso es frescura fabricada"
    )
    assert set(antes.values()) == {"2026-08-17"}


def test_la_seccion_es_tan_actual_como_su_fuente_mas_vieja(tmp_path):
    """Con rosters de hoy y estadística de hace un mes, manda la estadística."""
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _descargas(raw, dt.date(2026, 9, 5), dt.date(2026, 9, 5),
               dt.date(2026, 8, 17), dt.date(2026, 9, 5))
    assert _fechas_de_origen(_Paths(raw, proc))["fantasy"] == "2026-08-17"


def test_de_una_serie_por_temporada_manda_la_MAS_NUEVA(tmp_path):
    """`pbp_1999.parquet` no se vuelve a bajar: no puede fechar al modelo."""
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _descargas(raw, dt.date(2026, 9, 5), dt.date(2026, 9, 5),
               dt.date(2026, 9, 5), dt.date(2026, 9, 5))
    _con_fecha(raw / "pbp_1999.parquet", dt.date(2019, 1, 1))
    assert _fechas_de_origen(_Paths(raw, proc))["model"] == "2026-09-05"


def test_sin_origen_la_seccion_es_UNKNOWN_y_no_hereda_de_otra(tmp_path):
    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _con_fecha(raw / "games.csv", dt.date(2026, 8, 29))
    fechas = _fechas_de_origen(_Paths(raw, proc))
    assert fechas["markets"] == "2026-08-29"
    # `fantasy` no tiene fichero: UNKNOWN, jamás la fecha del mercado.
    assert fechas["fantasy"] is None
    # Y `model` tampoco: tiene el calendario pero no el play-by-play, y media
    # medición presentada como entera es lo que este campo vino a evitar.
    assert fechas["model"] is None


def test_un_fichero_VACIO_es_una_descarga_que_no_termino(tmp_path):
    ruta = _con_fecha(tmp_path / "games.csv", dt.date(2026, 8, 29))
    ruta.write_text("", encoding="utf-8")
    assert _fecha_de(ruta) is None


def test_una_marca_en_el_FUTURO_no_da_frescura(tmp_path):
    """Un reloj mal puesto no puede fabricar una descarga que no ha ocurrido."""
    futuro = _con_fecha(tmp_path / "games.csv",
                        dt.date.today() + dt.timedelta(days=30))
    assert _fecha_de(futuro) is None


def test_un_DIRECTORIO_no_es_un_fichero_de_origen(tmp_path):
    carpeta = tmp_path / "raw"
    carpeta.mkdir()
    assert _fecha_de(carpeta) is None


def test_un_clon_SIN_datos_no_borra_las_fechas_que_el_payload_ya_traia():
    """UNKNOWN antes que INVENTADO; **no** UNKNOWN antes que MEDIDO.

    `data/` está en `.gitignore` y pesa 490 MB, así que en un clon recién hecho
    no hay un solo fichero de origen y el parche calcularía tres `None`.
    Escribirlos encima de fechas medidas parece prudente y es una pérdida de
    información — el mismo fallo que el research diario publicando fichas
    sueltas encima de las buenas porque su índice vivía en `out/`.
    """
    from data_dates_patch import fechas_que_se_perderian

    medidas = {"markets": "2026-09-05", "model": "2026-08-17", "fantasy": "2026-08-17"}
    sin_datos = {"markets": None, "model": None, "fantasy": None}
    assert fechas_que_se_perderian(medidas, sin_datos) == ["fantasy", "markets", "model"]

    # Refrescar de verdad SÍ puede mover una fecha: eso no es una pérdida.
    nuevas = {"markets": "2026-09-06", "model": "2026-09-06", "fantasy": "2026-09-06"}
    assert fechas_que_se_perderian(medidas, nuevas) == []

    # Y una sección que el payload tampoco fechaba puede quedarse en UNKNOWN.
    assert fechas_que_se_perderian({"markets": "2026-09-05"}, {"markets": "2026-09-05",
                                                              "fantasy": None}) == []
