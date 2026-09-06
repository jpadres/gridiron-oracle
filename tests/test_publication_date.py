"""La fecha de publicación se lee en los formatos de la prensa, y nunca se inventa."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from oracle.narrative.research import parse_publication_date

NOW = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("stamp, day", [
    ("2026-09-04", "2026-09-04"),
    ("2026-09-04T10:15:00Z", "2026-09-04"),
    ("2026-09-04T10:15:00+00:00", "2026-09-04"),
    ("2026-09-04T22:15:00-04:00", "2026-09-04"),  # la zona se conserva, no se convierte
    ("Sep 4, 2026", "2026-09-04"),
    ("Sept 4, 2026", "2026-09-04"),
    ("Sept. 4, 2026", "2026-09-04"),
    ("September 4, 2026", "2026-09-04"),
    ("4 Sep 2026", "2026-09-04"),
    ("4 September 2026", "2026-09-04"),
    ("Thu, 04 Sep 2026 10:15:00 GMT", "2026-09-04"),  # RFC 2822 de un feed
    ("Thursday, September 4, 2026", "2026-09-04"),
    ("2026-03-14", "2026-03-14"),  # una fecha vieja sigue siendo una fecha
])
def test_common_press_formats_are_read(stamp, day):
    out = parse_publication_date(stamp, now=NOW)
    assert out is not None and out.startswith(day), (stamp, out)


@pytest.mark.parametrize("stamp", [
    "2026-09-07", "Sep 9, 2026", "2027-01-01T00:00:00Z", "Mon, 14 Sep 2026 10:00:00 GMT",
])
def test_a_future_date_is_unknown(stamp):
    assert parse_publication_date(stamp, now=NOW) is None


def test_one_day_of_tolerance_for_clocks_and_zones():
    assert parse_publication_date("2026-09-06", now=NOW) is not None


@pytest.mark.parametrize("stamp", [
    None, "", "   ", "garbage", "Sunday", "14", "2026", "0.5", "week 1", "4/9/2026", "09/04/2026",
    "1899-12-31", "not a date 2026", "20260904", True, [],
])
def test_unparseable_is_unknown_and_never_today(stamp):
    out = parse_publication_date(stamp, now=NOW)
    assert out is None, (stamp, out)


def test_never_returns_the_reference_clock_for_garbage():
    for stamp in ("garbage", "", None):
        assert parse_publication_date(stamp, now=NOW) != NOW.isoformat()


@pytest.mark.parametrize("stamp", [
    "September 2026", "Sep 2026", "2026-09", "1/2026", "10:00 2026",  # sin día: dateutil ponía el de HOY
    "4-9-2026", "04-09-2026", "4.9.2026", "04.09.2026",               # guiones y puntos, igual de ambiguos
])
def test_an_incomplete_or_ambiguous_date_is_unknown_not_today(stamp):
    out = parse_publication_date(stamp, now=NOW)
    assert out is None, (stamp, out)


@pytest.mark.parametrize("stamp, expected", [
    ("Sep 4, 2026 11:00 pm PDT", "2026-09-04T23:00:00-07:00"),
    ("Sep 4, 2026 11:00 pm ET", "2026-09-04T23:00:00-04:00"),
    ("Dec 4, 2026 11:00 pm ET", "2026-12-04T23:00:00-05:00"),  # horario de invierno
    ("Sep 4, 2026 11:00 pm EST", "2026-09-04T23:00:00-04:00"),  # «EST» en septiembre es la zona, no el offset
])
def test_press_time_zones_are_kept_not_dropped_to_utc(stamp, expected):
    out = parse_publication_date(stamp, now=datetime(2026, 12, 10, tzinfo=timezone.utc))
    assert out == expected, (stamp, out)


def test_iso_dates_are_not_mistaken_for_ambiguous_ones():
    assert parse_publication_date("2026-09-04", now=NOW) == "2026-09-04T00:00:00+00:00"
    assert parse_publication_date("2026-09-04T10:15:00-05:00", now=NOW) == "2026-09-04T10:15:00-05:00"


# --- El futuro tampoco entra por el parser de FEEDS ------------------------
#
# `parse_publication_date` rechazaba el futuro desde hace semanas. El parser de
# feeds, que lee instantes de máquina en vez de prosa, NO: la primera ejecución
# real de `research-feeds.yml` (6 de septiembre de 2026) publicó como entrada
# más reciente una fechada `2026-09-14T02:00:00Z` — ocho días por delante del
# reloj. Dos traductores del mismo concepto con distinta cobertura, otra vez.


def test_publication_rechaza_el_futuro_y_conserva_el_pasado():
    from datetime import datetime, timezone

    from oracle.narrative.timestamps import publication

    ahora = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
    assert publication("2026-09-14T02:00:00Z", now=ahora) is None
    assert publication("2026-09-05T10:00:00Z", now=ahora) == "2026-09-05T10:00:00Z"
    # Un día de tolerancia: un reloj adelantado o un huso mal declarado caben.
    assert publication("2026-09-06T23:00:00Z", now=ahora) == "2026-09-06T23:00:00Z"
    # Y lo de siempre: sin huso NO se convierte.
    assert publication("2026-09-05 10:00:00", now=ahora) is None


def test_una_entrada_de_feed_fechada_en_el_futuro_sale_SIN_fecha():
    """La propiedad del PRODUCTO, no la de la función.

    Un guardián sobre una función que ninguna ruta llama vigila una función. Se
    comprueba con `feeds.parse`, que es por donde pasa lo que se publica.
    """
    from oracle.narrative import feeds

    lejano = "Mon, 14 Sep 2093 02:00:00 +0000"
    xml = f"""<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Preview</title><link>https://ejemplo.com/a</link>
      <pubDate>{lejano}</pubDate></item>
      <item><title>Ayer</title><link>https://ejemplo.com/b</link>
      <pubDate>Fri, 05 Sep 2025 10:00:00 +0000</pubDate></item>
    </channel></rss>"""
    entradas = {e.title: e for e in feeds.parse(xml, feeds.Feed("https://ejemplo.com/f", "X"))}
    assert entradas["Preview"].published_at is None, (
        "una nota fechada en el futuro no puede viajar como fecha de publicación: "
        "se propaga como «lo más nuevo que sabemos»"
    )
    assert entradas["Ayer"].published_at == "2025-09-05T10:00:00Z"


def test_el_workflow_de_feeds_no_pregunta_por_un_fichero_QUE_NO_RASTREA():
    """`git diff --quiet` no ve un fichero nuevo, y por eso el barrido salió
    verde sin publicar nada la primera vez que funcionó de verdad.

    Estrecho a propósito: se exige que el `git add` del artefacto ocurra ANTES
    de la comparación, que es el orden que hace la pregunta contestable.
    """
    from pathlib import Path

    texto = Path(".github/workflows/research-feeds.yml").read_text(encoding="utf-8")
    add = texto.find("git add -- research/feeds_latest.json")
    diff = texto.find("git diff --cached --quiet -- research/feeds_latest.json")
    assert add != -1, "el artefacto tiene que añadirse al índice"
    assert diff != -1, "y compararse contra el ÍNDICE, que sí ve lo nuevo"
    assert add < diff, "añadir va ANTES de comparar, o la primera publicación no ocurre"
    assert "git diff --quiet -- research/feeds_latest.json" not in texto, (
        "la comparación ciega a los ficheros nuevos no puede volver"
    )
