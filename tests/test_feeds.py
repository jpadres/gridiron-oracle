"""Ingesta RSS, husos horarios y clima. Los casos que rompen en producción."""

from __future__ import annotations

from oracle.narrative import intelligence, timestamps
from oracle.narrative.feeds import Feed, canonical_url, merge_duplicates, parse
from oracle.narrative.weather import Conditions, describe, relevant

RSS = """<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
 <channel>
  <item>
   <title>Nacua sigue sin entrenar</title>
   <link>https://espn.com/nfl/story/nacua?utm_source=rss&amp;utm_medium=feed</link>
   <pubDate>Sat, 29 Aug 2026 10:42:00 -0500</pubDate>
   <dc:creator>Sarah Barshop</dc:creator>
   <description>El receptor no participo del entrenamiento.</description>
  </item>
  <item>
   <title>Sin firma y sin huso</title>
   <link>https://espn.com/nfl/story/otra</link>
   <pubDate>2026-08-29 10:42:00</pubDate>
  </item>
 </channel>
</rss>"""

ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <title>Nacua sigue sin entrenar</title>
  <link href="https://espn.com/nfl/story/nacua"/>
  <published>2026-08-29T15:42:00Z</published>
  <author><name>Sarah Barshop</name></author>
  <summary>Cobertura del equipo.</summary>
 </entry>
</feed>"""


# --- husos horarios --------------------------------------------------------


def test_the_same_instant_in_two_offsets_canonicalises_identically():
    """El fallo que este módulo existe para evitar.

    Como cadenas, "2026-08-29T10:42:00-05:00" es MENOR que
    "2026-08-29T15:42:00Z" y son el mismo instante. Comparar así da un orden que
    no es el real, y toda la latencia se apoya en ese orden.
    """
    with_offset = timestamps.canonical("2026-08-29T10:42:00-05:00")
    in_utc = timestamps.canonical("2026-08-29T15:42:00Z")
    rfc822 = timestamps.canonical("Sat, 29 Aug 2026 10:42:00 -0500")

    assert with_offset == in_utc == rfc822 == "2026-08-29T15:42:00Z"
    # Y como cadenas crudas NO son iguales: por eso hay que canonizar.
    assert "2026-08-29T10:42:00-05:00" != "2026-08-29T15:42:00Z"


def test_a_timestamp_without_timezone_is_not_guessed():
    """UNKNOWN > INVENTED.

    Suponerle UTC, o el huso del servidor, o el del este «porque casi toda la
    NFL está allí», produce un instante desplazado hasta ocho horas que se lee
    como real.
    """
    assert timestamps.canonical("2026-08-29 10:42:00") is None
    assert timestamps.canonical("2026-08-29") is None
    assert timestamps.canonical("") is None
    assert timestamps.canonical(None) is None


def test_latency_is_none_when_an_endpoint_is_missing():
    """`None` y no cero: un cero se promedia, un `None` se excluye."""
    assert timestamps.minutes_between(None, "2026-08-29T15:42:00Z") is None
    assert timestamps.minutes_between("2026-08-29T15:08:00Z", "2026-08-29T15:42:00Z") == 34.0


# --- ingesta ---------------------------------------------------------------


def test_rss_entry_is_normalised_with_author_and_utc():
    feed = Feed("https://espn.com/rss", "ESPN", team="LAR")
    entries = parse(RSS, feed, ingested_at="2026-08-29T16:00:00Z")

    first = entries[0]
    assert first.author == "Sarah Barshop"
    assert first.published_at == "2026-08-29T15:42:00Z"
    assert first.first_seen_at == "2026-08-29T16:00:00Z"
    assert first.team == "LAR"
    assert first.source_type == "RSS"
    # Los parámetros de seguimiento no identifican al documento.
    assert first.url == "https://espn.com/nfl/story/nacua"


def test_a_feed_without_author_or_timezone_yields_none_not_empty_string():
    """Distinguir «este feed no firma» de un autor vacío.

    Sin esa distinción el reliability score acaba con un autor fantasma que
    acumula aciertos de todo el mundo.
    """
    entries = parse(RSS, Feed("u", "ESPN"), ingested_at="2026-08-29T16:00:00Z")
    second = entries[1]
    assert second.author is None
    assert second.published_at is None
    # Pero la entrada NO se descarta: sigue siendo una nota publicada.
    assert second.title == "Sin firma y sin huso"


def test_the_same_story_in_two_feeds_merges_keeping_the_earliest_sighting():
    """El duplicado no se tira: se funde.

    Si la copia descartada es la que vimos ANTES, el instante que sobrevive es el
    de la segunda vez y la latencia medida no significa nada. Y la segunda fuente
    es la confirmación independiente, que es señal, no ruido.
    """
    national = parse(RSS, Feed("u1", "ESPN"), ingested_at="2026-08-29T16:00:00Z")[:1]
    team = parse(ATOM, Feed("u2", "ESPN Rams", team="LAR"),
                 ingested_at="2026-08-29T16:35:00Z")

    merged = merge_duplicates(national + team)

    assert len(merged) == 1
    assert merged[0].first_seen_at == "2026-08-29T16:00:00Z"
    assert merged[0].team == "LAR"       # lo aporta la copia de equipo
    assert len(merged[0].sources) == 2   # las dos fuentes se conservan


def test_canonical_url_strips_tracking_but_keeps_real_query():
    assert canonical_url("https://a.com/x/?utm_source=rss&id=7") == "https://a.com/x?id=7"
    assert canonical_url("https://A.com/x#seccion") == "https://a.com/x"
    assert canonical_url("javascript:alert(1)") == ""


def test_a_broken_feed_returns_nothing_instead_of_exploding():
    """Un feed roto no puede tumbar la ingesta de los otros veinte."""
    assert parse("<rss><channel><item>", Feed("u", "X")) == []


# --- clima -----------------------------------------------------------------


def test_a_dome_never_reports_weather():
    """Sale gratis del dato que ya teníamos y quita un tercio de los partidos."""
    dome = Conditions("DET", "Ford Field", "dome", wind_mph=30.0, snow=True)
    assert not relevant(dome)
    assert describe(dome) is None


def test_light_rain_is_not_news():
    """Avisar de cada chubasco es el ruido que esta sección existe para no crear."""
    mild = Conditions("GB", "Lambeau", "outdoor", wind_mph=8.0, precip_probability=0.30)
    assert describe(mild) is None


def test_weather_separates_the_fact_from_our_reading():
    strong = Conditions("CHI", "Soldier Field", "outdoor", wind_mph=24.0, gust_mph=31.0)
    result = describe(strong)

    assert result["evidence_type"] == "HECHO"
    assert "24 mph" in result["fact"]
    # La lectura va aparte, etiquetada como nuestra y con el aviso.
    assert result["interpretation_evidence_type"] == "MODELO"
    assert "no validada" in result["interpretation_caveat"]


def test_a_retractable_roof_is_still_checked():
    """Un retráctil puede estar abierto. Un domo fijo, no."""
    retractable = Conditions("ARI", "State Farm", "retractable", wind_mph=26.0)
    assert relevant(retractable)


# --- today's intelligence --------------------------------------------------


def test_ordering_puts_the_most_actionable_first():
    """La primera versión negaba las claves Y ordenaba al revés: relevancia 4
    salía por encima de relevancia 5."""
    items = [
        {"kind": "lesion", "impact": "baja", "fantasy_relevance": 4,
         "date": "2026-08-29", "evidence_type": "HECHO", "team": "KC"},
        {"kind": "lesion", "impact": "baja", "fantasy_relevance": 5,
         "date": "2026-08-29", "evidence_type": "REPORTADO", "team": "SF"},
    ]
    assert intelligence.todays(items)[0]["team"] == "SF"


def test_low_relevance_never_reaches_the_screen():
    items = [{"kind": "lesion", "impact": "baja", "fantasy_relevance": 2,
              "date": "2026-08-29", "team": "KC"}]
    assert intelligence.todays(items) == []


def test_a_trade_is_not_filed_as_context():
    """`roster` y `transaccion` son el mismo suceso con dos nombres.

    Aceptar sólo el del esquema mandaba los siete traspasos de agosto a
    «Contexto», que es donde no se miran.
    """
    for kind in ("roster", "transaccion"):
        item = {"kind": kind, "impact": "neutro", "fantasy_relevance": 5,
                "date": "2026-08-29", "team": "NE"}
        assert intelligence.todays([item])[0]["label"] == "Waiver"


def test_el_parser_deshace_las_entidades_html():
    """`Vikings&#39;` se pintaba TAL CUAL en cuanto algo mostró texto de feed."""
    import xml.etree.ElementTree as ET

    from oracle.narrative.feeds import _text

    item = ET.fromstring("<item><title>Vikings&amp;#39; QB &amp;amp; more</title></item>")
    assert _text(item, "title") == "Vikings' QB & more"


def test_el_marcado_de_un_description_no_se_pinta():
    """Un `<description>` de RSS trae HTML, y el orden de limpieza importa."""
    from oracle.narrative.feeds import clean_text

    crudo = '&lt;p&gt;&lt;img src="https://statico.example.com/a/very/long/name.jpg"&gt;Real news&lt;/p&gt;'
    assert clean_text(crudo) == "Real news", (
        "el marcado se está pintando: además de feo, la URL no parte y desborda"
    )
    # Al revés no funciona, y por eso el orden está escrito: si se quitaran las
    # etiquetas ANTES de desescapar, no habría ninguna que quitar.
    assert "<" not in clean_text(crudo)


def test_una_etiqueta_partida_por_el_recorte_tampoco_se_pinta():
    """`_build` recorta a 600 caracteres y parte el `<img>` por la mitad.

    Sin su `>` no es una etiqueta para ningún patrón, así que se pintaba entera
    como texto — con una URL de imagen que no tiene por dónde partirse. Es lo
    que desbordaba `/research` 13 px a 390.
    """
    from oracle.narrative.feeds import clean_text

    assert clean_text('<p><img src="https://statico.example.com/a/very/long/na') == ""
    # Pero un «menor que» de verdad se queda: el patrón exige que parezca
    # etiqueta, no cualquier `<` al final.
    assert clean_text("Scores of 3 < 5 happen") == "Scores of 3 < 5 happen"


def test_el_cargador_normaliza_los_archivos_viejos(tmp_path):
    """UN sitio para deshacerlas, no uno por lector.

    El fichero se guardó con el parser anterior y lo leen tres consumidores: el
    barrido determinista, el parche de prensa y quien venga. Arreglarlo en cada
    uno es el fallo de los dos traductores; se normaliza al leer.
    """
    import json

    from oracle.narrative.feeds import load_archive

    fichero = tmp_path / "feeds.json"
    fichero.write_text(json.dumps({"entries": [
        {"title": "Vikings&#39; QB", "summary": "AT&amp;T Stadium", "url": "u"},
        {"title": "Ya limpio", "summary": None, "url": "v"},
    ]}), encoding="utf-8")
    datos = load_archive(fichero)
    assert datos["entries"][0]["title"] == "Vikings' QB"
    assert datos["entries"][0]["summary"] == "AT&T Stadium"
    # Idempotente y tolerante: un texto ya limpio no cambia y un None no rompe.
    assert datos["entries"][1]["title"] == "Ya limpio"
    assert datos["entries"][1]["summary"] is None
