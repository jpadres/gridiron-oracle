"""UNA INGESTA QUE NO TRAE NADA TIENE QUE FALLAR RUIDOSAMENTE.

    UN ARTEFACTO VACÍO CON LA FECHA DE HOY ES PEOR QUE UNO VIEJO.
    PARECE ACTUAL Y NO LO ES.

Este repositorio ya ha cometido las dos mitades del fallo. El barrido diario
salía VERDE sin barrer nada porque sin clave avisaba y devolvía 0 —correcto en
local, mentira en CI, donde barrer es su única tarea—. Y el barrido de feeds
publicó su primer artefacto porque `git diff --quiet` no ve un fichero nuevo.
En los dos casos el trabajo no se hizo y nada se puso rojo.

Las dos preguntas que contesta, y son DOS:

    ¿TRAJO FILAS?        -> `require_rows`
    ¿SON DE AHORA?       -> `require_fresh`

La segunda no inventa umbrales: los lee de `freshness.WINDOWS`, que ya los
declara por dominio porque una cuota caduca en minutos y una estadística de
carrera no caduca nunca. Y usa `USABLE_AS_CURRENT`, que es el conjunto que el
proyecto entero usa para decidir si algo se puede AFIRMAR como actual — no un
corte nuevo escrito aquí.

No hay respaldo silencioso: estas funciones LEVANTAN. Devolver lo viejo con
cara de nuevo es exactamente lo que la regla 5 prohíbe.
"""

from __future__ import annotations

from datetime import datetime

from .freshness import USABLE_AS_CURRENT, WINDOWS, Domain, Freshness, Provenance, classify


class IngestFailed(RuntimeError):
    """La ingesta no puede dar su resultado por bueno."""


class SourceEmpty(IngestFailed):
    """La fuente contestó, y no trajo nada."""


class SourceStale(IngestFailed):
    """La fuente trajo algo, y no es de ahora."""


def require_rows(name: str, rows, *, minimum: int = 1) -> int:
    """Cuántas filas trajo la fuente. Levanta `SourceEmpty` si no llega al mínimo.

    `minimum` existe porque «no vacío» no siempre es el umbral: un parte de
    lesiones con una fila no es el parte de la liga. Pero el valor por defecto
    es 1 a propósito — un mínimo alto escrito a ojo convierte un control en una
    convención, y este fichero no declara ninguna.
    """
    try:
        cuantas = len(rows)
    except TypeError:  # un iterador no se puede medir sin consumirlo
        rows = list(rows)
        cuantas = len(rows)
    if cuantas < minimum:
        raise SourceEmpty(
            f"{name}: la fuente devolvió {cuantas} fila(s) y hacen falta al menos "
            f"{minimum}. No se publica nada encima del artefacto anterior: un "
            f"fichero vacío con la fecha de hoy parece actual y no lo es."
        )
    return cuantas


def require_fresh(
    name: str,
    domain: Domain,
    published_at: datetime | None,
    *,
    now: datetime | None = None,
    allow: frozenset[Freshness] | set[Freshness] | None = None,
) -> Freshness:
    """Clasifica la fuente y levanta `SourceStale` si no se puede afirmar actual.

    `published_at` es la fecha del DATO y nunca la de descarga: `Provenance` se
    niega a mirar `retrieved_at` justamente para que la hora de bajar un fichero
    no se convierta en actualidad. `None` levanta — «no sé de cuándo es» no es
    «es de ahora».

    `allow` permite ampliar lo aceptable para un dominio donde RECENT sirva, y
    se pasa explícito en la llamada para que quede escrito EN la ingesta de
    quién es esa decisión. Sin `allow`, lo aceptable es `USABLE_AS_CURRENT`.
    """
    aceptable = set(allow) if allow else set(USABLE_AS_CURRENT)
    if published_at is None:
        raise SourceStale(
            f"{name}: no se puede situar en el tiempo (sin fecha del dato). "
            f"UNKNOWN no es actual."
        )
    estado = classify(
        Provenance(domain=domain, published_at=published_at, source=name), now=now
    )
    if estado not in aceptable:
        ventana = WINDOWS.get(domain)
        corte = (
            f" la ventana de {domain.value} para afirmarlo actual es "
            f"{round(ventana[1].total_seconds() / 3600, 1)} h."
            if ventana else ""
        )
        raise SourceStale(
            f"{name}: lo más nuevo que trae la fuente es de {published_at.isoformat()} "
            f"y eso la clasifica {estado.value}.{corte}"
        )
    return estado
