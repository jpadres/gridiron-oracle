"""UN TEST POR INGESTA: que falle si la fuente vuelve VACÍA o VIEJA.

    SALIR CON 0 SIN HABER INGERIDO ES UNA MENTIRA VERDE.

Ya ha pasado dos veces en este repositorio. El barrido diario salía VERDE sin
barrer nada (sin clave avisaba y devolvía 0 — correcto en local, mentira en CI,
donde barrer es su única tarea) y el barrido de feeds dio su primera ejecución
por buena sin publicar nada porque `git diff --quiet` no ve un fichero nuevo.

Las dos mitades se prueban por separado porque son dos fallos distintos: una
fuente que no trae filas y una que trae filas viejas. La segunda es la peligrosa
— la fuente es buena, la cita es exacta, y lo único que está mal es el tiempo.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pandas as pd
import pytest

from oracle.freshness import Domain, Freshness
from oracle.ingest_guard import (
    IngestFailed,
    SourceEmpty,
    SourceStale,
    require_fresh,
    require_rows,
)

AHORA = dt.datetime(2026, 10, 7, 12, 0, tzinfo=dt.timezone.utc)
RAIZ = Path(__file__).resolve().parent.parent

# Las ingestas, y el fichero donde cada una tiene que defenderse. Es una LISTA
# BLANCA a propósito: una ingesta nueva sin guarda sale roja por no estar aquí,
# y una guarda que se borre sale roja por no estar allí. Un control que se
# relaja hasta no comprobar nada es peor que no tenerlo.
INGESTAS = {
    "nflverse (oracle refresh)": "src/oracle/data/ingest.py",
    "ADP": "scripts/adp_fetch.py",
    "feeds de prensa": "scripts/feed_harvest.py",
    "barrido de la jornada": "scripts/weekly_research.py",
}


# --- la guarda, con el fallo inyectado en los datos -------------------------

def test_cero_filas_levanta():
    with pytest.raises(SourceEmpty):
        require_rows("x", [])
    with pytest.raises(SourceEmpty):
        require_rows("x", pd.DataFrame())


def test_un_frame_con_columnas_y_sin_filas_tambien_levanta():
    # El caso de verdad: nflverse cambia un nombre de columna, el merge sale
    # vacío y el parquet se escribe igual, válido y con la fecha de hoy.
    vacio = pd.DataFrame(columns=["season", "week", "player_id"])
    with pytest.raises(SourceEmpty):
        require_rows("player_weeks", vacio)


def test_lo_que_trae_filas_pasa_y_devuelve_cuantas():
    assert require_rows("x", [1, 2, 3]) == 3


def test_el_minimo_no_es_una_convencion_escondida():
    # Si hiciera falta un mínimo mayor, se pasa EN LA LLAMADA para que quede
    # escrito de quién es la decisión. El de por defecto es 1.
    assert require_rows("x", [1]) == 1
    with pytest.raises(SourceEmpty):
        require_rows("x", [1], minimum=2)


def test_un_iterador_no_se_pierde_al_medirlo():
    with pytest.raises(SourceEmpty):
        require_rows("x", iter([]))
    assert require_rows("x", iter([1, 2])) == 2


# --- la otra mitad: filas VIEJAS -------------------------------------------

def test_un_parte_de_lesiones_de_hace_nueve_dias_levanta():
    with pytest.raises(SourceStale):
        require_fresh("injuries", Domain.INJURY_REPORT,
                      AHORA - dt.timedelta(days=9), now=AHORA)


def test_un_parte_de_hace_una_hora_pasa():
    estado = require_fresh("injuries", Domain.INJURY_REPORT,
                           AHORA - dt.timedelta(hours=1), now=AHORA)
    assert estado in {Freshness.LIVE, Freshness.CURRENT}


def test_sin_fecha_del_dato_levanta_en_vez_de_dar_por_bueno():
    # UNKNOWN > STALE PRESENTADO COMO ACTUAL, y «no sé de cuándo es» no es «es
    # de ahora»: la regla 5 entera depende de que esto levante.
    with pytest.raises(SourceStale):
        require_fresh("injuries", Domain.INJURY_REPORT, None, now=AHORA)


def test_la_hora_de_descarga_no_se_puede_colar_como_frescura():
    """El fallo más peligroso del proyecto, en la guarda que lo impide.

    `require_fresh` recibe `published_at` y lo pasa por `Provenance`, que se
    NIEGA a mirar `retrieved_at`. Si alguien le pasara la hora de descarga de un
    fichero de marzo, la guarda lo daría por actual — así que lo que se prueba
    aquí es que la firma no ofrece ese parámetro.
    """
    import inspect
    firma = inspect.signature(require_fresh)
    assert "retrieved_at" not in firma.parameters, (
        "require_fresh no puede aceptar la hora de descarga: convertirla en "
        "actualidad es exactamente cómo se fabrica una respuesta falsamente actual"
    )


def test_la_ventana_la_declara_el_dominio_y_no_esta_guarda():
    """Ninguna hora escrita a mano en el fichero de la guarda.

    Las ventanas son por dominio porque la vida útil no es la misma: una cuota
    caduca en minutos y una estadística de carrera no caduca nunca. Un umbral
    escrito aquí sería un cuarto sitio donde vive la misma decisión.
    """
    fuente = (RAIZ / "src/oracle/ingest_guard.py").read_text(encoding="utf-8")
    assert "timedelta(" not in fuente, "la guarda ha vuelto a declarar su propio umbral"
    assert "WINDOWS" in fuente and "USABLE_AS_CURRENT" in fuente


def test_una_cuota_vieja_de_una_hora_ya_no_es_actual():
    # El mismo instante, dos dominios: una hora es nada para una estadística y
    # es viejo para una cuota. Es lo que prueba que la ventana la pone el
    # dominio y no la guarda.
    with pytest.raises(SourceStale):
        require_fresh("odds", Domain.ODDS, AHORA - dt.timedelta(hours=1), now=AHORA)


# --- y que CADA ingesta la llame -------------------------------------------

@pytest.mark.parametrize("nombre,ruta", sorted(INGESTAS.items()))
def test_cada_ingesta_se_defiende_de_una_fuente_vacia(nombre, ruta):
    fuente = (RAIZ / ruta).read_text(encoding="utf-8")
    assert "require_rows(" in fuente, (
        f"{nombre} ({ruta}) no comprueba que su fuente haya traído filas: "
        f"publicaría un artefacto vacío con la fecha de hoy"
    )


def test_la_lista_de_ingestas_no_esta_vacia():
    # El `conAjuste.length > 0` de siempre: una lista vacía habría hecho pasar
    # el parametrizado de arriba sin comprobar una sola ingesta.
    assert len(INGESTAS) >= 4


def test_el_lector_de_fuentes_no_se_escribe_su_propia_comprobacion_de_vacio():
    """Una definición de «¿trajo filas?», y ACOTADA al lector.

    La primera versión de esto buscaba `.empty:` en todo el fichero y sacaba
    `de_jornada.empty` —que es «ningún club ha entregado el parte todavía»,
    una distinción del dominio y no una comprobación de ingesta—. Un validador
    con falsos positivos acaba desactivado: se mira el CUERPO de `_leer`, que
    es la función que carga una fuente, y ahí un `.empty` sí sería una segunda
    definición del mismo control.
    """
    fuente = (RAIZ / "scripts/weekly_research.py").read_text(encoding="utf-8")
    cuerpo = fuente.split("def _leer(", 1)[1].split("\ndef ", 1)[0]
    sin_comentarios = "\n".join(linea.split("#")[0] for linea in cuerpo.splitlines())
    assert "require_rows(" in sin_comentarios
    assert ".empty" not in sin_comentarios, (
        "_leer comprueba el vacío por su cuenta en vez de llamar a require_rows"
    )


def test_refresh_comprueba_TODAS_las_tablas_que_escribe():
    """Tantas comprobaciones como escrituras, no «alguna».

    La primera versión de este guardián sólo pedía que `require_rows(`
    apareciera en el fichero. Al quitar la comprobación de `player_weeks`
    —justo la tabla que alimenta el board y el semanal— siguió VERDE, porque
    las otras dos seguían ahí. Es el «el nombre sigue apareciendo» por quinta
    vez en este repositorio: la propiedad es que CADA `to_parquet` de `refresh`
    vaya detrás de una comprobación.
    """
    fuente = (RAIZ / "src/oracle/data/ingest.py").read_text(encoding="utf-8")
    cuerpo = fuente.split("def refresh(", 1)[1].split("\ndef ", 1)[0]
    escrituras = cuerpo.count(".to_parquet(")
    comprobaciones = cuerpo.count("require_rows(")
    assert escrituras > 0, "refresh ya no escribe ninguna tabla: este test mide otra cosa"
    assert comprobaciones >= escrituras, (
        f"refresh escribe {escrituras} tablas y sólo comprueba {comprobaciones}: "
        f"la que falta se publicaría vacía con la fecha de hoy"
    )


def test_el_barrido_de_la_jornada_puede_exigir_la_jornada_actual():
    """`--require-current`, por lo mismo que `--require-key`.

    En CI este barrido es la ÚNICA tarea de su job, así que un artefacto
    publicado con las secciones vacías —o colgando el ranking de la jornada
    pasada de la cabecera de la actual— sale verde sin haber barrido.
    """
    fuente = (RAIZ / "scripts/weekly_research.py").read_text(encoding="utf-8")
    assert "--require-current" in fuente
    # LAS DOS RAMAS, no «alguna». Inyectando el fallo en una sola el guardián
    # seguía verde porque la otra mantenía el texto vivo: se cuentan los usos y
    # se exige que CADA uno acabe en un fallo.
    usos = fuente.count("if args.require_current:")
    assert usos >= 2, (
        f"se esperaban dos ramas de --require-current (fuentes obligatorias y "
        f"jornada del ranking) y hay {usos}"
    )
    for trozo in fuente.split("if args.require_current:")[1:]:
        assert "return 1" in trozo[:600], (
            "una rama de --require-current no falla: otro aviso no es un control"
        )


def test_las_ingestas_fallan_CERRADAS():
    """Ninguna captura `IngestFailed` para seguir como si nada.

    Un `except IngestFailed: pass` convierte la guarda en decoración con nombre
    técnico. Lo que sí vale es capturarla para imprimir y SALIR con código
    distinto de cero, que es lo que hacen los scripts.
    """
    for ruta in sorted(set(INGESTAS.values())):
        fuente = (RAIZ / ruta).read_text(encoding="utf-8")
        if "except IngestFailed" not in fuente:
            continue
        for trozo in fuente.split("except IngestFailed")[1:]:
            cuerpo = trozo[:400]
            assert "return 1" in cuerpo or "return None" in cuerpo or "raise" in cuerpo, (
                f"{ruta} captura IngestFailed y sigue adelante"
            )


def test_IngestFailed_es_el_padre_de_las_dos():
    # Un script puede capturar una sola cosa y cubrir las dos mitades.
    assert issubclass(SourceEmpty, IngestFailed)
    assert issubclass(SourceStale, IngestFailed)
