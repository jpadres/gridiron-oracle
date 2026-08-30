"""Tests adversarios de frescura.

Cada uno reproduce una forma concreta de fabricar una respuesta falsamente
actual. No se comprueba que el módulo «funcione»: se comprueba que **no se deja
engañar** por el caso que lo rompería.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from oracle.freshness import (
    Claim,
    Domain,
    Freshness,
    Provenance,
    StaleData,
    classify,
    require_current,
    resolve,
    season_week_matches,
)

NOW = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


def _p(domain, **kwargs):
    return Provenance(source="test", domain=domain, **kwargs)


# --- la hora de descarga no es la hora del hecho ----------------------------

def test_articulo_actualizado_hoy_sobre_un_hecho_viejo_no_es_actual():
    """El caso central: publicado hoy, ocurrido en marzo.

    Una comparación ingenua miraría `published_at` y lo daría por actual. La
    noticia es real y la fuente es buena; lo único viejo es el hecho, que es
    justo lo que importa.
    """
    provenance = _p(
        Domain.TRANSACTION,
        published_at=NOW - timedelta(hours=1),
        event_at=datetime(2026, 3, 14, tzinfo=UTC),
        retrieved_at=NOW,
    )
    assert classify(provenance, now=NOW) is Freshness.STALE


def test_la_hora_de_descarga_nunca_da_frescura():
    """Descargar hoy un artículo sin fecha no lo convierte en de hoy."""
    provenance = _p(Domain.NEWS, retrieved_at=NOW)
    assert classify(provenance, now=NOW) is Freshness.UNKNOWN


def test_articulo_historico_descubierto_hoy_sigue_siendo_historico():
    provenance = _p(
        Domain.DEPTH_CHART,
        published_at=datetime(2025, 9, 1, tzinfo=UTC),
        retrieved_at=NOW,
    )
    assert classify(provenance, now=NOW) is Freshness.STALE


# --- ventanas por dominio ---------------------------------------------------

def test_la_misma_antiguedad_significa_cosas_distintas_segun_el_dominio():
    """Treinta minutos: la cuota ya no vale, el parte de lesiones sí.

    Es la razón entera de que las ventanas sean por dominio. Con una ventana
    global, uno de los dos casos saldría mal necesariamente.
    """
    hace_30 = NOW - timedelta(minutes=30)
    assert classify(_p(Domain.ODDS, event_at=hace_30), now=NOW) is Freshness.RECENT
    assert classify(_p(Domain.INJURY_REPORT, event_at=hace_30), now=NOW) is Freshness.CURRENT


def test_estadistica_de_carrera_no_caduca():
    """197 touchdowns de Rice son igual de ciertos hoy que en 1999.

    HISTORICAL es válido, no una versión suave de STALE: etiquetarlo como
    caducado empujaría a descartar lo único que sí se puede afirmar sin
    verificación.
    """
    provenance = _p(Domain.CAREER_STATS, event_at=datetime(1999, 1, 1, tzinfo=UTC))
    assert classify(provenance, now=NOW) is Freshness.HISTORICAL


def test_dato_atemporal_sin_fecha_sigue_siendo_desconocido():
    """Atemporal no es lo mismo que sin fecha: sin fecha no se puede situar."""
    assert classify(_p(Domain.CAREER_STATS), now=NOW) is Freshness.UNKNOWN


# --- fechas mal formadas ----------------------------------------------------

def test_fecha_sin_huso_no_se_convierte():
    """Suponerle un huso desplaza el instante entre una y ocho horas."""
    provenance = _p(Domain.ODDS, event_at=datetime(2026, 8, 30, 11, 59))  # naive
    assert classify(provenance, now=NOW) is Freshness.UNKNOWN


def test_fecha_en_el_futuro_no_es_fresquisima():
    """Una comparación ingenua daría edad negativa y por tanto LIVE.

    Un timestamp futuro significa reloj mal puesto, huso mal aplicado o fuente
    rota. Ninguna de las tres cosas es «muy reciente».
    """
    provenance = _p(Domain.ODDS, event_at=NOW + timedelta(hours=3))
    assert classify(provenance, now=NOW) is Freshness.UNKNOWN


def test_sin_fecha_de_publicacion_es_desconocido_no_actual():
    assert classify(_p(Domain.INJURY_GAMEDAY), now=NOW) is Freshness.UNKNOWN


# --- falla cerrado ----------------------------------------------------------

def test_require_current_levanta_en_vez_de_devolver_lo_viejo():
    provenance = _p(Domain.ODDS, event_at=NOW - timedelta(hours=4))
    with pytest.raises(StaleData, match="ODDS"):
        require_current(provenance, now=NOW)


def test_require_current_lo_dice_cuando_no_hay_fecha():
    with pytest.raises(StaleData, match="sin fecha comprobable"):
        require_current(_p(Domain.WEATHER), now=NOW)


def test_require_current_acepta_reciente_solo_si_se_pide():
    provenance = _p(Domain.ODDS, event_at=NOW - timedelta(minutes=45))
    assert classify(provenance, now=NOW) is Freshness.RECENT
    with pytest.raises(StaleData):
        require_current(provenance, now=NOW)
    assert require_current(provenance, now=NOW, allow_recent=True) is Freshness.RECENT


# --- temporada y jornada ----------------------------------------------------

def test_depth_chart_de_la_temporada_pasada_no_vale_para_esta():
    """La frescura sola no lo caza: un artículo viejo republicado entra en ventana."""
    provenance = _p(
        Domain.DEPTH_CHART, event_at=NOW - timedelta(hours=2), season=2025, week=1
    )
    assert classify(provenance, now=NOW) is Freshness.CURRENT
    assert season_week_matches(provenance, 2026, 1) is False


def test_jornada_equivocada_de_la_temporada_correcta():
    provenance = _p(Domain.INJURY_REPORT, event_at=NOW, season=2026, week=12)
    assert season_week_matches(provenance, 2026, 1) is False


def test_sin_temporada_declarada_no_se_da_por_buena():
    provenance = _p(Domain.DEPTH_CHART, event_at=NOW)
    assert season_week_matches(provenance, 2026, 1) is False


# --- fuentes en conflicto ---------------------------------------------------

def test_el_inactivo_oficial_del_domingo_gana_al_reporte_del_martes():
    """El caso literal de la regla: un informe de martes no anula un oficial."""
    martes = Claim(
        value="plays",
        provenance=_p(
            Domain.INJURY_GAMEDAY,
            event_at=NOW - timedelta(days=5),
            evidence_type="REPORTED",
        ),
    )
    domingo = Claim(
        value="inactive",
        provenance=_p(
            Domain.INJURY_GAMEDAY,
            event_at=NOW - timedelta(minutes=20),
            evidence_type="OFFICIAL",
        ),
    )
    resolution = resolve([martes, domingo])
    assert resolution.winner is domingo
    assert resolution.disputed is True


def test_el_desacuerdo_se_conserva_no_se_borra():
    """«El equipo lo da dudoso» y «el reportero espera que juegue» no son lo
    mismo, y quedarse sólo con uno borra información que decide una alineación."""
    equipo = Claim(
        value="questionable",
        provenance=_p(Domain.INJURY_REPORT, event_at=NOW, evidence_type="OFFICIAL"),
    )
    reportero = Claim(
        value="expected to play",
        provenance=_p(Domain.INJURY_REPORT, event_at=NOW, evidence_type="REPORTED"),
    )
    resolution = resolve([equipo, reportero])
    assert resolution.winner is equipo
    assert resolution.others == (reportero,)
    assert resolution.disputed is True


def test_a_igual_evidencia_gana_la_mas_reciente():
    viejo = Claim(
        value="starter",
        provenance=_p(
            Domain.DEPTH_CHART, event_at=NOW - timedelta(days=2), evidence_type="REPORTED"
        ),
    )
    nuevo = Claim(
        value="backup",
        provenance=_p(Domain.DEPTH_CHART, event_at=NOW, evidence_type="REPORTED"),
    )
    assert resolve([viejo, nuevo]).winner is nuevo


def test_una_fuente_sin_fecha_no_puede_ganar_por_reciente():
    """Sin fecha no se puede afirmar que sea lo más nuevo, así que va al fondo."""
    sin_fecha = Claim(
        value="out",
        provenance=_p(Domain.INJURY_REPORT, evidence_type="REPORTED"),
    )
    fechado = Claim(
        value="active",
        provenance=_p(
            Domain.INJURY_REPORT, event_at=NOW - timedelta(days=1), evidence_type="REPORTED"
        ),
    )
    assert resolve([sin_fecha, fechado]).winner is fechado


def test_el_articulo_viejo_no_gana_por_llegar_primero_en_la_lista():
    """Devuelto arriba por el buscador, pero más viejo: no manda."""
    primero = Claim(
        value="signed",
        provenance=_p(
            Domain.TRANSACTION, event_at=NOW - timedelta(days=30), evidence_type="OFFICIAL"
        ),
    )
    segundo = Claim(
        value="released",
        provenance=_p(Domain.TRANSACTION, event_at=NOW, evidence_type="OFFICIAL"),
    )
    assert resolve([primero, segundo]).winner is segundo


def test_cuando_coinciden_no_hay_disputa():
    a = Claim(value="out", provenance=_p(Domain.INJURY_REPORT, event_at=NOW,
                                         evidence_type="OFFICIAL"))
    b = Claim(value="out", provenance=_p(Domain.INJURY_REPORT, event_at=NOW,
                                         evidence_type="REPORTED"))
    resolution = resolve([a, b])
    assert resolution.agreed is True
    assert resolution.disputed is False


# --- cobertura del propio diccionario ---------------------------------------

def test_todo_dominio_tiene_ventana_o_es_atemporal():
    """Un dominio nuevo sin ventana devolvería UNKNOWN en silencio.

    Es el fallo que este test impide: añadir `Domain.PROPS` y que todo lo que lo
    use quede clasificado como desconocido sin que nadie se entere.
    """
    from oracle.freshness import TIMELESS, WINDOWS

    for domain in Domain:
        assert domain in WINDOWS or domain in TIMELESS, f"{domain} sin ventana"


def test_las_ventanas_estan_ordenadas():
    """live <= current <= recent. Desordenadas, la clasificación es incoherente."""
    from oracle.freshness import WINDOWS

    for domain, (live, current, recent) in WINDOWS.items():
        assert live <= current <= recent, f"{domain} tiene ventanas desordenadas"
