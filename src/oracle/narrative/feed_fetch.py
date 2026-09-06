"""La capa de RED que le faltaba a `feeds.py`, y su parte de salud.

    EL BARRIDO DE PRENSA NO PUEDE DEPENDER DE UNA CLAVE DE MODELO.

`feeds.py` sabe parsear un RSS o un Atom desde hace meses, y `sources.py` tiene
los feeds configurados. Lo que no existía en ningún sitio es **bajarlos**: el
único camino a la prensa pasaba por `research.py`, que necesita
`ANTHROPIC_API_KEY`. Sin clave no corría nada, y por eso el registro de fuentes
lleva 101 organizaciones clasificadas a mano y **cero feeds leídos**.

Aquí se separan las dos etapas que nunca debieron ir juntas:

    FETCH DETERMINISTA   urllib + el parser que ya existe. Sin clave.
    ENRIQUECIMIENTO      resumen y juicio del modelo. Con clave.

Si falta la clave, la segunda no corre y la primera sí. Eso es lo que hace que
haya prensa la víspera de un draft aunque el secret esté sin restaurar.

## No se parsea dos veces

Este módulo **no** vuelve a interpretar XML: llama a `feeds.parse`. Escribir un
segundo parser habría sido el fallo de los dos traductores del mismo formato,
que en este repositorio ya ha costado siete iteraciones — y el que diverge aquí
es de qué fecha lleva una noticia.

## Falla cerrado

Un artefacto sin ninguna fuente viva NO se publica encima del anterior. Es la
forma de romper que parece que funcionó: fichero nuevo, fecha de generación de
hoy, nada dentro, y lo bueno de ayer machacado.
"""
from __future__ import annotations

import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from . import feeds
from .feeds import Entry, Feed

#: Quién soy y para qué. Un feed público servido a un lector que se identifica
#: es una relación normal; disfrazarse de navegador para saltarse un bloqueo no.
USER_AGENT = (
    "gridiron-oracle/1.0 (personal fantasy football research; "
    "contact via github.com/jpadres/gridiron-oracle)"
)
TIMEOUT = 20

OK = "OK"
EMPTY = "EMPTY"
ERROR = "ERROR"


@dataclass
class FeedHealth:
    """Qué contestó una fuente. La salud del feed es parte del dato.

    Sin esto, «no hay noticias de este equipo» y «este feed lleva tres días
    caído» se leen igual, y sólo uno de los dos es información sobre el fútbol.
    """

    outlet: str
    url: str
    status: str
    items: int = 0
    dated_items: int = 0
    latest_published_at: str | None = None
    http_status: int | None = None
    error: str | None = None
    fetched_at: str | None = None
    team: str | None = None


@dataclass
class Harvest:
    """Lo recogido y el estado de quien lo dio."""

    generated_at: str
    entries: list[Entry] = field(default_factory=list)
    health: list[FeedHealth] = field(default_factory=list)

    @property
    def sources_ok(self) -> int:
        return sum(1 for h in self.health if h.status == OK)

    @property
    def dated(self) -> int:
        return sum(1 for e in self.entries if e.published_at)

    def summary(self) -> dict:
        fechas = [e.published_at for e in self.entries if e.published_at]
        return {
            # CUÁNDO SE GENERÓ no es CUÁNDO SON LAS NOTICIAS. Las dos, separadas.
            "generated_at": self.generated_at,
            "sources_total": len(self.health),
            "sources_ok": self.sources_ok,
            "sources_empty": sum(1 for h in self.health if h.status == EMPTY),
            "sources_error": sum(1 for h in self.health if h.status == ERROR),
            "entries": len(self.entries),
            "entries_dated": self.dated,
            "entries_undated": len(self.entries) - self.dated,
            "newest_published_at": max(fechas) if fechas else None,
            "oldest_published_at": min(fechas) if fechas else None,
            "teams_covered": sorted({e.team for e in self.entries if e.team}),
        }

    def to_dict(self) -> dict:
        return {
            "summary": self.summary(),
            "health": [asdict(h) for h in self.health],
            "entries": [asdict(e) for e in self.entries],
        }


def fetch_one(feed: Feed, opener=None, now: datetime | None = None) -> tuple[list[Entry], FeedHealth]:
    """Baja y parsea un feed. **Nunca levanta**: el fallo es parte del resultado.

    Un feed caído no puede tumbar la ingesta de los otros treinta, y tampoco
    puede pasar por «no había noticias».
    """
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    request = urllib.request.Request(feed.url, headers={"User-Agent": USER_AGENT})
    try:
        with (opener or urllib.request.urlopen)(request, timeout=TIMEOUT) as response:
            body = response.read()
            code = getattr(response, "status", None)
    except urllib.error.HTTPError as error:
        return [], FeedHealth(feed.outlet, feed.url, ERROR, error=f"HTTP {error.code}",
                              http_status=error.code, fetched_at=stamp, team=feed.team)
    except Exception as error:  # noqa: BLE001 — en red, cualquier fallo es ERROR
        return [], FeedHealth(feed.outlet, feed.url, ERROR, error=type(error).__name__,
                              fetched_at=stamp, team=feed.team)

    text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)
    entries = feeds.parse(text, feed, ingested_at=stamp)
    if not entries:
        return [], FeedHealth(feed.outlet, feed.url, EMPTY, http_status=code,
                              error="respondió pero sin entradas legibles",
                              fetched_at=stamp, team=feed.team)
    fechas = [e.published_at for e in entries if e.published_at]
    return entries, FeedHealth(
        feed.outlet, feed.url, OK, items=len(entries), dated_items=len(fechas),
        latest_published_at=max(fechas) if fechas else None,
        http_status=code, fetched_at=stamp, team=feed.team,
    )


def harvest(feed_list: list[Feed], opener=None, now: datetime | None = None) -> Harvest:
    """Lee todas las fuentes y funde duplicados con el criterio que ya existía.

    El deduplicado es `feeds.merge_duplicates`: una entrada por URL canónica,
    conservando la primera vez que se vio y **las dos fuentes**. Quedarse con
    una sola borraría la confirmación independiente, que es lo que distingue un
    hecho de un rumor repetido.
    """
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    todas: list[Entry] = []
    salud: list[FeedHealth] = []
    for feed in feed_list:
        entries, health = fetch_one(feed, opener=opener, now=now)
        todas.extend(entries)
        salud.append(health)
    return Harvest(generated_at=stamp, entries=feeds.merge_duplicates(todas), health=salud)


def publishable(collected: Harvest) -> bool:
    """¿Se puede escribir esto encima de lo que ya había?

    Que el script terminara no basta. Sin ninguna fuente viva o sin una sola
    entrada, publicar deja el sitio peor que antes y con aspecto de estar al día.
    """
    return collected.sources_ok > 0 and len(collected.entries) > 0
