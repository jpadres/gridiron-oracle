"""Instantes canónicos en UTC. Una sola forma de escribirlos y de compararlos.

## Por qué esto es un módulo y no dos líneas

Un feed RSS trae `Sat, 29 Aug 2026 10:42:00 -0500`. Un Atom trae
`2026-08-29T15:42:00Z`. Un tercero trae `2026-08-29 10:42:00` sin huso ninguno.
Comparar esas tres como cadenas —que es lo que se hace sin pensar— da un orden
que no es el orden real: `"2026-08-29T10:42:00-05:00"` es *menor* que
`"2026-08-29T15:42:00Z"` alfabéticamente, y son el mismo instante.

Toda la medición de latencia se apoya en esa comparación. Un orden mal calculado
no falla: produce «este reportero se adelanta 34 minutos» con el signo cambiado.

## La regla, que es la misma de todo el proyecto

**UNKNOWN > INVENTED.** Una fecha y hora sin huso horario **no se convierte**.
Suponerle UTC, o el huso del servidor, o el de la costa este porque «casi toda la
NFL es de allí», produce un instante que se lee como real y está desplazado entre
una y ocho horas. Se devuelve `None`, y el campo se queda vacío.

Una fecha sin hora tampoco se convierte a mediodía ni a medianoche: es una fecha,
y para latencia no sirve.
"""

from __future__ import annotations

from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

# La forma canónica: ISO 8601 en UTC terminando en Z. Sin microsegundos, que no
# aportan nada aquí y ensucian la comparación visual.
CANONICAL = "%Y-%m-%dT%H:%M:%SZ"


def now() -> str:
    """El instante actual en forma canónica."""
    return datetime.now(UTC).strftime(CANONICAL)


def canonical(value: object) -> str | None:
    """Cualquier instante con huso conocido, en UTC canónico. `None` si no se puede.

    Acepta lo que traen los feeds de verdad:

    - RFC 822 / RFC 2822, que es lo que usa `pubDate` de RSS.
    - ISO 8601 con huso, que es lo que usa Atom.
    - Un `datetime` ya construido, si viene con huso.

    Devuelve `None` —y esto es lo importante— cuando el instante **no lleva
    huso**. No se le supone ninguno.
    """
    if value is None:
        return None

    if isinstance(value, datetime):
        return _from_datetime(value)

    text = str(value).strip()
    if not text:
        return None

    # ISO 8601 primero: es lo que escribimos nosotros, así que es el caso común.
    parsed = _try_iso(text)
    if parsed is None:
        parsed = _try_rfc822(text)
    if parsed is None:
        return None
    return _from_datetime(parsed)


def _from_datetime(value: datetime) -> str | None:
    # `tzinfo is None` es una fecha-hora flotante: no designa un instante, sólo
    # una lectura de reloj. Convertirla exige elegir un huso, y elegirlo es
    # inventarlo.
    if value.tzinfo is None or value.utcoffset() is None:
        return None
    return value.astimezone(UTC).strftime(CANONICAL)


def _try_iso(text: str) -> datetime | None:
    candidate = text
    # `fromisoformat` de Python 3.11 acepta la Z, pero no cuesta nada ser
    # explícito y funciona igual en versiones anteriores.
    if candidate.endswith(("Z", "z")):
        candidate = candidate[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def _try_rfc822(text: str) -> datetime | None:
    try:
        return parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None


def earliest(*values: str | None) -> str | None:
    """El más antiguo de varios instantes canónicos, ignorando los ausentes.

    Sólo tiene sentido sobre valores ya canonizados: sobre cadenas con husos
    distintos, comparar es exactamente el error que este módulo existe para
    evitar. Por eso no acepta nada que no termine en Z.
    """
    known = [value for value in values if value and value.endswith("Z")]
    return min(known) if known else None


def minutes_between(earlier: str | None, later: str | None) -> float | None:
    """Minutos entre dos instantes canónicos. `None` si falta alguno.

    Es la operación que sostiene la métrica de latencia, y por eso devuelve
    `None` en vez de cero cuando falta un extremo: un cero se promedia, un
    `None` se excluye.
    """
    if not earlier or not later:
        return None
    try:
        start = datetime.strptime(earlier, CANONICAL).replace(tzinfo=UTC)
        end = datetime.strptime(later, CANONICAL).replace(tzinfo=UTC)
    except ValueError:
        return None
    return (end - start).total_seconds() / 60.0
