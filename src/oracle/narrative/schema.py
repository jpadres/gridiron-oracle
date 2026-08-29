"""Versión del esquema de las fichas, y la migración de lo antiguo.

## La regla que gobierna todo este módulo

**UNKNOWN > INVENTED.** Si un campo de una ficha antigua no se puede reconstruir
con evidencia real, se queda en `None`. Nunca se rellena con una suposición para
evitar un hueco.

No es purismo. El archivo existe para poder medir, más adelante, en qué fuentes
fiarse y cuánto se adelantan. Una fecha inventada a mediodía no se distingue de
una real cuando la lees en noviembre, y contamina exactamente la métrica que el
archivo existía para hacer posible.

## Por qué la migración ocurre al LEER y no al guardar

Los ficheros de `research/` no se reescriben nunca. Lo que se publicó el 17 de
agosto se queda en disco tal como se publicó, y la conversión al esquema nuevo
pasa en memoria cada vez que se cargan. Dos motivos:

1. Es el mismo principio por el que `research/` se versiona al revés que `data/`:
   son unos kilobytes que **no se pueden reconstruir**, y reescribirlos es
   perder el original a cambio de comodidad.
2. Una migración que reescribe es irreversible si está mal. Una que convierte al
   leer se corrige cambiando una función.

## La mina que había que desactivar

`research._clean` degradaba a "rumor" cualquier `confidence` que no reconociera,
en silencio y sin fallar. Pasar las 61 fichas históricas por ahí con el enum
nuevo habría convertido los "confirmado" y los "informado" en rumores sin que
nada avisara. Por eso la ruta de migración es **distinta** de la de validación:
`migrate_item` no llama a `_clean` ni al revés.
"""

from __future__ import annotations

from typing import Any

# v1: el esquema original (confidence de 3 niveles, sin autor ni timestamps).
# v2: evidence_type de 5 niveles, autor, timestamps de latencia y resolución.
SCHEMA_VERSION = 2

# Los cinco niveles miden **procedencia**: quién lo dice y cómo lo sabe. No miden
# certeza, que es otro eje. Un REPORTADO puede ser más fiable que un HECHO viejo.
EVIDENCE_TYPES: tuple[str, ...] = (
    "HECHO",       # anuncio oficial del equipo o de la liga, o parte oficial
    "REPORTADO",   # un periodista con nombre lo reporta como información suya
    "OBSERVADO",   # un reportero describe lo que vio: repeticiones, entrenamiento
    "OPINION",     # un analista con nombre espera algo. Es su juicio, no un hecho
    "MODELO",      # lo decimos nosotros, a partir de nuestros propios números
)

# Lo que se le enseña al lector cuando una ficha es anterior al esquema nuevo.
# No es un error de datos ni un hueco a rellenar: es un registro de antes.
LEGACY_LABEL = "LEGACY"

# De dónde vino el insight. Vive en `feeds.SOURCE_TYPES` y se repite aquí en la
# migración porque las fichas viejas también necesitan un valor: el suyo es
# WEB_SEARCH, y ése SÍ se puede afirmar — el único camino que existía cuando se
# escribieron era el barrido con búsqueda.
LEGACY_SOURCE_TYPE = "WEB_SEARCH"


def migrate_item(item: dict[str, Any]) -> dict[str, Any]:
    """Una ficha de cualquier versión, leída con la forma de la actual.

    Lo que no se puede saber se queda a `None`. En concreto, el `confidence` de
    v1 **no se traduce** a `evidence_type`: el esquema viejo no distinguía entre
    reportado, observado y opinión, así que convertir "rumor" en OPINION sería
    inventar una clasificación que nadie hizo.
    """
    if item.get("schema_version") == SCHEMA_VERSION:
        return item

    migrated = dict(item)
    migrated["schema_version"] = SCHEMA_VERSION

    # Procedencia: desconocida en v1, y así se queda.
    migrated.setdefault("evidence_type", None)

    # Timestamps de latencia. v1 sólo tenía `published` con precisión de día, y
    # un día no sirve para medir quién se adelantó treinta minutos.
    for field in ("published_at", "first_seen_at", "confirmed_at", "ingested_at"):
        migrated.setdefault(field, None)

    migrated.setdefault("resolution", None)
    # Excepción a UNKNOWN > INVENTED, y por eso lleva explicación: esto no se
    # está adivinando. Cuando se escribieron esas fichas el único camino de
    # ingesta que existía era el barrido con búsqueda, así que su procedencia
    # técnica se conoce con certeza aunque no estuviera escrita.
    migrated.setdefault("source_type", LEGACY_SOURCE_TYPE)

    # El autor va dentro de cada fuente, no en la ficha: una ficha puede tener
    # dos fuentes de dos periodistas distintos, y el reliability score necesita
    # atribuir a cada uno lo suyo.
    migrated["sources"] = [
        {**source, "author": source.get("author")} for source in item.get("sources", [])
    ]
    return migrated


def is_classified(item: dict[str, Any]) -> bool:
    """¿Tiene procedencia conocida? Sólo entonces cuenta para métricas.

    Las fichas legacy **siguen siendo visibles y útiles como contexto**. Lo que
    no hacen es entrar en el reliability score ni en la latencia, donde
    contarlas sería medir sobre datos que no existen.
    """
    return item.get("evidence_type") in EVIDENCE_TYPES


def has_latency_data(item: dict[str, Any]) -> bool:
    """¿Se puede medir cuánto tardó en llegar?

    Hace falta cuándo lo publicó la fuente y cuándo lo vimos por primera vez.
    Sin las dos, la resta no significa nada.
    """
    return bool(item.get("published_at")) and bool(item.get("first_seen_at"))
