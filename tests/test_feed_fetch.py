"""La ingesta determinista: sin clave, sin inventar fechas y sin publicar en vacío."""
from __future__ import annotations

import io
from datetime import datetime, timezone

from oracle.narrative import feed_fetch
from oracle.narrative.feeds import Feed

NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)

RSS = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Named the starter</title><link>https://x.test/a</link>
<pubDate>Fri, 05 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Sin fecha</title><link>https://x.test/b</link></item>
</channel></rss>"""

MISMA_NOTA = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Named the starter</title><link>https://x.test/a?utm_source=otro</link>
<pubDate>Fri, 05 Sep 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""


class _Resp(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _serve(mapping):
    def opener(request, timeout=0):
        url = getattr(request, "full_url", request)
        body = mapping.get(url)
        if body is None:
            raise OSError("sin ruta")
        if isinstance(body, Exception):
            raise body
        return _Resp(body.encode("utf-8"))
    return opener


def test_a_dead_feed_is_ERROR_and_not_silence():
    feed = Feed("https://x.test/feed", "X")
    entries, health = feed_fetch.fetch_one(
        feed, opener=_serve({"https://x.test/feed": TimeoutError("lento")}), now=NOW)
    assert entries == [] and health.status == feed_fetch.ERROR
    assert health.error == "TimeoutError"
    # «No hay noticias» y «el feed está caído» no se pueden leer igual.
    assert health.items == 0


def test_a_broken_xml_is_EMPTY_and_says_why():
    feed = Feed("https://x.test/feed", "X")
    _, health = feed_fetch.fetch_one(feed, opener=_serve({"https://x.test/feed": "<no"}), now=NOW)
    assert health.status == feed_fetch.EMPTY and health.error


def test_an_unreadable_date_never_becomes_the_sweep_date():
    feed = Feed("https://x.test/feed", "X")
    entries, health = feed_fetch.fetch_one(feed, opener=_serve({"https://x.test/feed": RSS}), now=NOW)
    by = {e.title: e for e in entries}
    assert by["Named the starter"].published_at.startswith("2026-09-05")
    # La entrada sin pubDate se queda SIN fecha de publicación...
    assert by["Sin fecha"].published_at is None
    # ...y la hora del barrido vive en otro campo, que es lo que impide
    # convertir una descarga en actualidad.
    assert by["Sin fecha"].first_seen_at.startswith("2026-09-06")
    assert health.dated_items == 1 and health.items == 2


def test_the_same_note_from_two_feeds_keeps_both_sources():
    mapping = {"https://a.test/f": RSS, "https://b.test/f": MISMA_NOTA}
    out = feed_fetch.harvest([Feed("https://a.test/f", "A"), Feed("https://b.test/f", "B")],
                             opener=_serve(mapping), now=NOW)
    titulos = [e.title for e in out.entries]
    assert titulos.count("Named the starter") == 1, "el utm_source no hace dos notas"
    nota = next(e for e in out.entries if e.title == "Named the starter")
    # Quedarse con una sola fuente borraría la confirmación independiente.
    assert len(nota.sources) == 2
    assert {s["outlet"] for s in nota.sources} == {"A", "B"}


def test_nothing_alive_is_not_publishable():
    out = feed_fetch.harvest([Feed("https://x.test/f", "X")],
                             opener=_serve({"https://x.test/f": OSError("caído")}), now=NOW)
    assert out.sources_ok == 0
    assert feed_fetch.publishable(out) is False, (
        "publicar un artefacto vacío encima del bueno es la rotura que parece que funcionó")
    resumen = out.summary()
    assert resumen["sources_error"] == 1 and resumen["entries"] == 0


def test_one_live_source_is_publishable_and_dates_are_publication_not_generation():
    out = feed_fetch.harvest([Feed("https://x.test/f", "X")],
                             opener=_serve({"https://x.test/f": RSS}), now=NOW)
    assert feed_fetch.publishable(out) is True
    resumen = out.summary()
    assert resumen["newest_published_at"].startswith("2026-09-05")
    assert resumen["generated_at"].startswith("2026-09-06")
    assert resumen["entries_undated"] == 1


def test_this_module_does_not_parse_xml_itself():
    """Un segundo parser del mismo formato es el fallo de los dos traductores."""
    from pathlib import Path
    texto = Path("src/oracle/narrative/feed_fetch.py").read_text(encoding="utf-8")
    assert "ElementTree" not in texto and "fromstring" not in texto
    assert "feeds.parse(" in texto
