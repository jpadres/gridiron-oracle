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

import pytest

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

from export_web_data import _fecha_de, _fechas_de_origen  # noqa: E402


class _Paths:
    def __init__(self, raw: Path, processed: Path, out: Path | None = None):
        self.raw = raw
        self.processed = processed
        # `out/` es donde vive el board compilado, y su `season` es lo que dice
        # QUÉ estadística puede haber leído. Sin él no se filtra nada.
        self.out = out if out is not None else raw.parent / "out"


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
        # Las plantillas, APARTE: `fantasy` arrastra la estadística más vieja y
        # taparía que el registro de quién está cortado o en reserva es de
        # dieciocho días después. Es justo el desacuerdo que decide un pick.
        "rosters": "2026-09-04",
    }
    # La propiedad, no los literales: si un día se aplanan en una sola, esto cae.
    assert len(set(fechas.values())) == 4
    # Y la que más importa la víspera de un draft: las plantillas NO pueden
    # heredar la fecha de la estadística.
    assert fechas["rosters"] != fechas["fantasy"]


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


def test_el_parche_CONSERVA_las_claves_que_no_calcula():
    """El fallo real no estaba en la comprobación: estaba en la ASIGNACIÓN.

    `_fechas_de_origen` fecha las secciones que salen de un fichero descargado
    y `research` no es una de ellas —la calcula `fecha_del_research` sobre las
    fichas—, así que no aparece en el resultado. Escribirlo entero encima
    (`payload["data_dates"] = fechas`) BORRABA la fecha de la prensa y la
    pantalla pasaba a UNKNOWN teniéndola medida. Se funde.

    Se comprueba la propiedad y no la implementación: lo que importa es que
    una clave que el cálculo no toca siga valiendo lo mismo después.
    """
    antes = {"markets": "2026-09-05", "rosters": "2026-09-05", "research": "2026-09-04"}
    calculadas = {"markets": "2026-09-06", "rosters": "2026-09-06"}
    despues = {**antes, **calculadas}

    assert despues["research"] == "2026-09-04", "la fecha de la prensa se ha perdido"
    assert despues["markets"] == "2026-09-06", "un refresco real sí mueve la fecha"

    # Y que el script haga eso de verdad, no sólo el diccionario del test: la
    # propiedad de arriba se cumple sola. Se lee el CÓDIGO, como en el test que
    # comprueba que `Briefs.jsx` pinta la etiqueta que su función devuelve.
    fuente = (RAIZ / "scripts" / "data_dates_patch.py").read_text(encoding="utf-8")
    assert 'payload["data_dates"] = {**antes, **fechas}' in fuente, (
        "el parche sustituye data_dates en vez de fundirlo: borra las claves "
        "que no calcula, y `research` es una de ellas"
    )


# --------------------------------------------------------------------------
# LA ESTADÍSTICA QUE EL BOARD *PUEDE* HABER LEÍDO
# --------------------------------------------------------------------------


def _board_de(out: Path, season: int) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "fantasy_draft.json").write_text(
        f'{{"season": {season}, "board": []}}', encoding="utf-8"
    )


def test_la_estadistica_de_la_temporada_PROYECTADA_no_fecha_el_board(tmp_path):
    """El board de 2026 no contiene ni una fila de 2026: es walk-forward.

    Medido el 13 de septiembre de 2026 en este repositorio. Al refrescar llegó
    `player_stats_2026.parquet` con fecha del 12 y la sección pasó a decir
    `fantasy: 2026-09-12`, mientras el board recompilado salía **byte a byte
    idéntico** al anterior porque sus entradas son 2024 y 2025. Veintiséis días
    fabricados sobre la sección que alimenta el board entero.
    """
    raw, proc, out = tmp_path / "raw", tmp_path / "processed", tmp_path / "out"
    _con_fecha(raw / "games.csv", dt.date(2026, 9, 13))
    _con_fecha(raw / "pbp_2026.parquet", dt.date(2026, 9, 12))
    _con_fecha(raw / "roster_2026.parquet", dt.date(2026, 9, 12))
    _con_fecha(raw / "player_stats_2024.parquet", dt.date(2026, 8, 17))
    _con_fecha(raw / "player_stats_2025.parquet", dt.date(2026, 8, 17))
    # La de la temporada en curso, recién publicada — y que el board NO lee.
    _con_fecha(raw / "player_stats_2026.parquet", dt.date(2026, 9, 12))
    _board_de(out, 2026)

    fechas = _fechas_de_origen(_Paths(raw, proc, out))
    assert fechas["fantasy"] == "2026-08-17", (
        "la sección se fecha con un fichero que el board no puede haber leído"
    )
    # Y las plantillas SÍ son del 12: el board las lee de verdad, y aplanar las
    # dos borraría el desacuerdo que decide un pick.
    assert fechas["rosters"] == "2026-09-12"


def test_sin_board_compilado_no_se_recorta_a_ojo(tmp_path):
    """Sin `season` declarada no se sabe cuáles entran, y no se inventa.

    Quitar ficheros por intuición sería fabricar el recorte. Se usa lo que hay y
    la sección queda con la fecha de la serie, que es lo que se puede sostener.
    """
    raw, proc, out = tmp_path / "raw", tmp_path / "processed", tmp_path / "out"
    _con_fecha(raw / "games.csv", dt.date(2026, 9, 13))
    _con_fecha(raw / "roster_2026.parquet", dt.date(2026, 9, 12))
    _con_fecha(raw / "player_stats_2025.parquet", dt.date(2026, 8, 17))
    _con_fecha(raw / "player_stats_2026.parquet", dt.date(2026, 9, 12))
    fechas = _fechas_de_origen(_Paths(raw, proc, out))
    assert fechas["fantasy"] == "2026-08-17", (
        "con dos temporadas dentro, manda la más VIEJA"
    )


# --------------------------------------------------------------------------
# LO PUBLICADO TIENE QUE SER LO QUE HAY EN EL FICHERO QUE LO FECHA
# --------------------------------------------------------------------------


def _calendario_csv(raw: Path, filas) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    cabecera = "season,week,home_team,away_team,spread_line,total_line,gameday,gametime,home_score,away_score"
    cuerpo = "\n".join(",".join(str(c) for c in f) for f in filas)
    (raw / "games.csv").write_text(f"{cabecera}\n{cuerpo}\n", encoding="utf-8")


def test_una_linea_MOVIDA_no_se_puede_publicar(tmp_path):
    """Fail-closed: el handicap publicado tiene que ser el del calendario.

    Medido el 13 de septiembre de 2026: **8 de los 16 partidos** de la jornada 1
    se publicaban con una línea que `games.csv` ya no tenía —ARI@LAC 10.5 contra
    9.5, DEN@KC 3.0 contra 2.5— mientras `data_dates.markets` se fechaba con el
    fichero NUEVO. La página de apuestas calculaba EV y Kelly contra un número
    que el mercado había dejado atrás.
    """
    from export_web_data import LineasDesfasadas, _comprobar_lineas_publicadas

    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _calendario_csv(raw, [(2026, 1, "LAC", "ARI", 9.5, 47.5, "2026-09-13", "16:25", "", "")])
    paths = _Paths(raw, proc)

    # Lo que el fichero dice: pasa.
    _comprobar_lineas_publicadas(
        [{"away_team": "ARI", "home_team": "LAC", "spread_line": 9.5, "total_line": 47.5}],
        paths,
    )
    # Un punto de más: levanta, y dice cuál.
    with pytest.raises(LineasDesfasadas, match="10.5"):
        _comprobar_lineas_publicadas(
            [{"away_team": "ARI", "home_team": "LAC", "spread_line": 10.5, "total_line": 47.5}],
            paths,
        )
    # El total también se apuesta.
    with pytest.raises(LineasDesfasadas, match="total_line"):
        _comprobar_lineas_publicadas(
            [{"away_team": "ARI", "home_team": "LAC", "spread_line": 9.5, "total_line": 46.5}],
            paths,
        )


def test_un_hueco_en_los_dos_lados_es_el_MISMO_hecho(tmp_path):
    """`NaN` en el fichero y `null` en el payload son «no hay línea», no un
    desacuerdo. `NaN == NaN` es False, así que hay que decirlo a mano — y si no
    se dijera, un partido sin mercado bloquearía el export entero."""
    from export_web_data import _comprobar_lineas_publicadas

    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _calendario_csv(raw, [(2026, 1, "LAC", "ARI", "", "", "2026-09-13", "16:25", "", "")])
    _comprobar_lineas_publicadas(
        [{"away_team": "ARI", "home_team": "LAC", "spread_line": None, "total_line": None}],
        _Paths(raw, proc),
    )


def test_los_codigos_de_equipo_pasan_por_normalize_team(tmp_path):
    """nflverse escribe «LA» donde el board escribe «LAR». Sin normalizar, los
    Rams saldrían como «publicado pero no está en games.csv» — el `AZ`/`ARI` de
    siempre, ahora bloqueando una publicación correcta."""
    from export_web_data import _comprobar_lineas_publicadas

    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _calendario_csv(raw, [(2026, 1, "LA", "SF", 3.5, 47.5, "2026-09-10", "20:35", 7, 27)])
    _comprobar_lineas_publicadas(
        [{"away_team": "SF", "home_team": "LAR", "spread_line": 3.5, "total_line": 47.5}],
        _Paths(raw, proc),
    )


def test_el_estado_del_partido_sale_del_calendario(tmp_path):
    """Saque y marcador final, y `final` sólo cuando hay marcador de verdad."""
    from export_web_data import _anotar_estado

    raw, proc = tmp_path / "raw", tmp_path / "processed"
    _calendario_csv(raw, [
        (2026, 1, "SEA", "NE", 3.0, 44.5, "2026-09-09", "20:20", 13, 10),
        (2026, 1, "LAC", "ARI", 9.5, 47.5, "2026-09-13", "16:25", "", ""),
    ])
    filas = [
        {"away_team": "NE", "home_team": "SEA"},
        {"away_team": "ARI", "home_team": "LAC"},
    ]
    _anotar_estado(filas, _Paths(raw, proc), 2026, 1)
    assert filas[0]["final"] is True
    assert (filas[0]["away_score"], filas[0]["home_score"]) == (10, 13)
    assert filas[0]["kickoff"] == "2026-09-09 20:20"
    # Y un partido que todavía no se ha jugado NO se afirma acabado.
    assert filas[1]["final"] is False
    assert filas[1]["home_score"] is None
    assert filas[1]["kickoff"] == "2026-09-13 16:25"


def test_el_estado_se_acota_a_LA_JORNADA_que_se_publica(tmp_path):
    """Un emparejamiento se repite temporada tras temporada.

    `games.csv` trae 7.548 partidos desde 1999 y (visitante, local) no es una
    clave única: sin acotar, el último NE@SEA del fichero gana. Al primer
    intento las 320 filas del semanal salieron «FINAL» y un quarterback llevaba
    de saque el 28 de septiembre de **2025**.
    """
    from export_web_data import _anotar_estado

    raw, proc = tmp_path / "raw", tmp_path / "processed"
    # EL QUE SE BUSCA VA PRIMERO, A PROPÓSITO. Sin el filtro gana el ÚLTIMO que
    # coincide, así que ponerlo al final haría pasar el test con el fallo puesto
    # — es el «8 y 9 son los dos míos» del test del turno, que ya costó una
    # iteración en este repositorio. Con el orden invertido, las dos respuestas
    # caen en filas distintas.
    _calendario_csv(raw, [
        (2026, 7, "SEA", "NE", 1.0, 45.5, "2026-10-25", "13:00", "", ""),
        (2025, 4, "SEA", "NE", 2.5, 43.5, "2025-09-28", "16:05", 21, 17),
        (2026, 1, "SEA", "NE", 3.0, 44.5, "2026-09-09", "20:20", 13, 10),
    ])
    filas = [{"away_team": "NE", "home_team": "SEA"}]
    _anotar_estado(filas, _Paths(raw, proc), 2026, 7)
    assert filas[0]["kickoff"] == "2026-10-25 13:00", "se cogió el partido de otra jornada"
    assert filas[0]["final"] is False
