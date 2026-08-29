"""Ingesta de feeds RSS y Atom, antes de que intervenga ningún modelo.

## Por qué el feed va primero

Un feed ya trae estructurado lo que un modelo tendría que adivinar: el titular,
el enlace, el medio, la firma y la hora de publicación. Pedirle al modelo que
busque eso es pagar por deducir algo que venía escrito, y además introducir la
posibilidad de que lo deduzca mal.

El reparto queda así: **el feed aporta los hechos, el modelo aporta el juicio.**
Qué se publicó y cuándo lo sabe el feed. Si eso cambia una alineación, y de qué
jugador habla exactamente, lo decide el modelo — y sólo sobre las entradas que
han pasado el filtro, que son muchas menos.

## Lo que este módulo NO hace

No decide relevancia ni clasifica procedencia. Un feed no sabe si su nota es un
hecho oficial o la opinión de un columnista, y adivinarlo por el nombre del medio
sería inventar el campo que más importa del esquema nuevo. `evidence_type` sale
`None` de aquí y lo rellena el paso del modelo.

## Condiciones de uso

Los feeds se consumen como feeds: se guarda lo que viene en el feed, se enlaza
siempre al original y se atribuye el medio. ESPN lo exige explícitamente en sus
condiciones y coincide con lo que este proyecto ya hacía — sin URL comprobable,
la ficha no existe.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .timestamps import canonical, earliest, now

# De dónde vino de verdad un insight. Se guarda para poder responder, dentro de
# unos meses, si lo que aporta valor son los feeds, la búsqueda o los datos
# estructurados — y así saber qué merece la pena mantener o pagar.
SOURCE_TYPES: tuple[str, ...] = (
    "OFFICIAL",        # club o liga: parte oficial, nota de prensa
    "RSS",             # feed de un medio
    "WEB_SEARCH",      # barrido con búsqueda
    "STRUCTURED_API",  # Sleeper, nflverse: campos, no prosa
    "MODEL",           # lo derivamos nosotros
)

# Parámetros de seguimiento que hay que quitar de la URL antes de compararla.
#
# Sin esto, la misma nota llega dos veces desde dos feeds con `?utm_source=`
# distinto y el deduplicado por URL no la ve. Es el caso más común de duplicado
# en RSS con diferencia.
TRACKING_PARAMS = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "ref", "src", "smid", "partner",
})

# Espacios de nombres que usan los feeds reales para la firma.
NAMESPACES = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
}


@dataclass(frozen=True)
class Feed:
    """Un feed configurado. `team` sólo cuando el feed es de un solo equipo."""

    url: str
    outlet: str
    source_type: str = "RSS"
    team: str | None = None


@dataclass
class Entry:
    """Una entrada de feed, ya normalizada. Todavía no es una ficha."""

    title: str
    url: str
    outlet: str
    source_type: str
    author: str | None = None
    published_at: str | None = None
    first_seen_at: str | None = None
    summary: str = ""
    team: str | None = None
    sources: list[dict] = field(default_factory=list)

    def as_source(self) -> dict:
        return {
            "outlet": self.outlet,
            "title": self.title[:160],
            "url": self.url,
            "author": self.author,
        }


def canonical_url(url: str) -> str:
    """La URL sin lo que no identifica al documento.

    Quita parámetros de seguimiento, el fragmento y la barra final. Lo que queda
    es lo que sirve para decidir si dos entradas son la misma nota.
    """
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMS
    ]
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((
        parsed.scheme.lower(), parsed.netloc.lower(), path,
        "", urlencode(query), "",
    ))


def parse(xml_text: str, feed: Feed, *, ingested_at: str | None = None) -> list[Entry]:
    """Las entradas de un feed RSS o Atom.

    Acepta los dos formatos porque los medios usan los dos y no avisan de cuál:
    ESPN publica RSS 2.0 y algunos sitios de club publican Atom.
    """
    stamp = ingested_at or now()
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        # Un feed roto no puede tumbar la ingesta de los otros veinte.
        return []

    items = root.findall(".//item")
    if items:
        return [
            entry for entry in (_from_rss(item, feed, stamp) for item in items) if entry
        ]
    atom = root.findall("{http://www.w3.org/2005/Atom}entry")
    return [entry for entry in (_from_atom(item, feed, stamp) for item in atom) if entry]


def _from_rss(item: ET.Element, feed: Feed, stamp: str) -> Entry | None:
    url = canonical_url(_text(item, "link"))
    title = _text(item, "title")
    if not url or not title:
        return None
    return _build(
        title=title,
        url=url,
        feed=feed,
        # `pubDate` es RFC 822 y trae huso. Si el feed lo omite o lo escribe sin
        # huso, `canonical` devuelve None y el campo se queda vacío: no se le
        # supone uno.
        published_at=canonical(_text(item, "pubDate")),
        author=_text(item, "author") or _text(item, "dc:creator"),
        summary=_text(item, "description"),
        stamp=stamp,
    )


def _from_atom(item: ET.Element, feed: Feed, stamp: str) -> Entry | None:
    link = item.find("{http://www.w3.org/2005/Atom}link")
    url = canonical_url(link.get("href", "") if link is not None else "")
    title = _text(item, "atom:title")
    if not url or not title:
        return None
    name = item.find("{http://www.w3.org/2005/Atom}author/"
                     "{http://www.w3.org/2005/Atom}name")
    return _build(
        title=title,
        url=url,
        feed=feed,
        published_at=canonical(_text(item, "atom:published") or _text(item, "atom:updated")),
        author=name.text.strip() if name is not None and name.text else None,
        summary=_text(item, "atom:summary"),
        stamp=stamp,
    )


def _build(*, title, url, feed, published_at, author, summary, stamp) -> Entry:
    return Entry(
        title=" ".join(title.split())[:200],
        url=url,
        outlet=feed.outlet,
        source_type=feed.source_type,
        # None y no "": distingue «este feed no firma» de un autor vacío, y sin
        # esa distinción el reliability score se inventa un autor fantasma.
        author=(" ".join(author.split())[:80] if author and author.strip() else None),
        published_at=published_at,
        # Cuándo lo vimos NOSOTROS. Lo pone la ingesta porque el feed no puede
        # saberlo, y es la mitad de la resta que mide la latencia.
        first_seen_at=stamp,
        summary=" ".join((summary or "").split())[:600],
        # El equipo sólo cuando el feed es de un equipo. Deducirlo del titular
        # es adivinar, y ya costó una iteración situar a un jugador en el equipo
        # equivocado.
        team=feed.team,
    )


def _text(element: ET.Element, tag: str) -> str:
    found = element.find(tag, NAMESPACES) if ":" in tag else element.find(tag)
    return (found.text or "").strip() if found is not None else ""


def merge_duplicates(entries: list[Entry]) -> list[Entry]:
    """Una entrada por URL canónica, conservando lo mejor de cada copia.

    La misma nota aparece en el feed de la liga y en el del equipo. Descartarla
    sin más pierde dos cosas que importan: el instante en que la vimos **por
    primera vez**, que es la mitad de la métrica de latencia, y la segunda
    fuente, que es precisamente la confirmación independiente que sube la
    confianza de una ficha.
    """
    merged: dict[str, Entry] = {}
    for entry in entries:
        existing = merged.get(entry.url)
        if existing is None:
            entry.sources = [entry.as_source()]
            merged[entry.url] = entry
            continue

        existing.first_seen_at = earliest(existing.first_seen_at, entry.first_seen_at)
        existing.published_at = earliest(existing.published_at, entry.published_at)
        # Una firma vale más que ninguna: si la primera copia venía sin autor y
        # la segunda lo trae, nos quedamos con el nombre.
        existing.author = existing.author or entry.author
        existing.team = existing.team or entry.team
        if all(source["url"] != entry.url or source["outlet"] != entry.outlet
               for source in existing.sources):
            existing.sources.append(entry.as_source())
    return list(merged.values())
