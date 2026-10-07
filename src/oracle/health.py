"""SALUD DE LAS FUENTES: qué se refrescó, cuándo, y qué jornada cubre.

    UNA PANTALLA QUE NO DICE LA EDAD DE SUS DATOS NO SE PUEDE AUDITAR.

Este módulo contesta, fuente por fuente, tres preguntas que hasta ahora había
que ir a buscar a mano a `data/raw` y a los logs de Actions:

    ¿CUÁNDO SE REFRESCÓ CON ÉXITO?  ¿QUÉ JORNADA CUBRE?  ¿SE PUEDE AFIRMAR HOY?

## Por qué hace falta

El 7 de octubre de 2026 producción servía la jornada 4 estando en la 5, con el
modelo y las líneas del 29 de septiembre. La causa no era que la ingesta se
hubiera parado: `weekly-predictions.yml` había fallado sus cuatro ejecuciones
programadas, **todas en el push y ninguna calculando**, y nadie lo vio porque
ninguna pantalla decía la edad de lo que enseñaba. Ocho días.

## Los umbrales NO se escriben aquí

Salen de `freshness.WINDOWS`, que ya los declara por dominio y con su razón —
una cuota caduca en minutos, un parte de lesiones en 24 h, una estadística de
carrera nunca—. Escribir aquí un segundo juego de números sería el fallo de los
dos traductores del mismo formato, que este repositorio lleva quince veces
cometiendo, aplicado justo a la pantalla que existe para detectarlo.

## Las tres etiquetas, y por qué hay un caso que no es ninguna

`FRESH` / `STALE` / `BROKEN` es la lectura de un vistazo; la frescura PRECISA
(`LIVE`, `CURRENT`, `RECENT`, `STALE`, `HISTORICAL`, `UNKNOWN`) viaja al lado y
es la autoridad. La distinción que importa:

  · `STALE`  — se pudo leer y está fuera de su ventana.
  · `BROKEN` — no se pudo leer: fichero ausente, fuente inalcanzable, o la
               fecha no se puede establecer. «No pude comprobar» NO es «está
               bien», y por eso `UNKNOWN` cae aquí y nunca en FRESH.
  · `HISTORICAL` se publica como FRESH **con su motivo a la vista**: el board
    de 2026 no lee ni una fila de 2026 por la garantía walk-forward, así que su
    estadística es vieja POR DISEÑO. Meterla en STALE sería contradecir la regla
    que dice que HISTORICAL no es una versión suave de STALE; meterla en FRESH a
    secas sería esconder por qué. Se dice.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from oracle.freshness import (
    USABLE_AS_CURRENT,
    WINDOWS,
    Domain,
    Freshness,
    Provenance,
    classify,
)

#: Lectura de un vistazo. La frescura precisa viaja al lado y manda.
FRESH = "FRESH"
STALE = "STALE"
BROKEN = "BROKEN"

CURRENT_WEEK = "CURRENT_WEEK"
BEHIND = "BEHIND"
NOT_WEEKLY = "NOT_WEEKLY"

#: Qué etiqueta corta le toca a cada frescura. NO se escribe a ojo: sale de
#: `USABLE_AS_CURRENT`, que `freshness.py` ya declara como `{LIVE, CURRENT}`.
#:
#: Que `RECENT` caiga en STALE es la parte que importa y no es un endurecimiento
#: arbitrario: `RECENT` significa «utilizable, pero hay que enseñar la
#: antigüedad al lado», o sea que NO se puede afirmar como actual — y la ventana
#: `current` del parte de lesiones son exactamente 24 h. Un parte de hace treinta
#: horas pintado FRESH es la frase que esta pantalla existe para no decir.
#:
#: `UNKNOWN` es BROKEN a propósito: no haber podido comprobar no es haber
#: comprobado que está bien.
#:
#: `HISTORICAL` es FRESH **con su motivo a la vista**: el board no lee la
#: temporada que proyecta, así que su estadística es vieja POR DISEÑO. Meterla
#: en STALE contradiría la regla que dice que HISTORICAL no es una versión suave
#: de STALE; meterla en FRESH a secas esconderían por qué.
ETIQUETA: dict[Freshness, str] = {
    **{f: FRESH for f in USABLE_AS_CURRENT},
    Freshness.RECENT: STALE,
    Freshness.STALE: STALE,
    Freshness.HISTORICAL: FRESH,
    Freshness.UNKNOWN: BROKEN,
}


@dataclass(frozen=True)
class SourceHealth:
    """El estado de UNA fuente, con todo lo que hace falta para discutirlo."""

    name: str
    """Cómo se llama en la pantalla."""

    feeds: str
    """Qué alimenta. Sin esto el lector no sabe qué se le cae si está roja."""

    domain: Domain
    """De qué dominio es, que es lo que decide su ventana."""

    origin: str
    """De dónde sale: fichero, release o endpoint. Comprobable."""

    as_of: str | None
    """El instante que decide la frescura, en ISO con huso. `None` si no se sabe.

    Es `published_at` —la fecha del DATO— y nunca la hora de descarga: bajar hoy
    un fichero de marzo no lo hace de hoy, y `freshness.Provenance.as_of` se
    niega por eso a mirar `retrieved_at`. Para los ficheros de nflverse las dos
    coinciden a propósito: `download_if_changed` conserva el mtime cuando el
    contenido no cambió y `source_date_repair.py` lo sustituye por la fecha del
    commit de origen cuando el servidor no manda `Last-Modified`.
    """

    covers_week: int | None
    """La jornada NFL que cubre el dato, no la de hoy."""

    covers_season: int | None = None

    basis: str = "published_at"
    """EN QUÉ marca se apoya la etiqueta. Sin esto, «hace 2 h» no se puede discutir."""

    freshness: str = Freshness.UNKNOWN.value
    label: str = BROKEN
    reason: str | None = None
    """Por qué está en ese estado, en una frase. Obligatorio si no es FRESH."""

    window_hours: float | None = None
    """El corte que decidió la etiqueta, para que el umbral sea auditable."""

    coverage: str = NOT_WEEKLY
    """`CURRENT_WEEK`, `BEHIND` o `NOT_WEEKLY`: el otro eje de la frescura.

    La edad contesta «¿de cuándo es el fichero?» y esto «¿de qué jornada
    habla?». No son lo mismo y el caso que importa es justo el que las separa:
    un fichero de hace diez minutos cubriendo la jornada pasada.
    """

    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "feeds": self.feeds,
            "domain": self.domain.value,
            "origin": self.origin,
            "as_of": self.as_of,
            "basis": self.basis,
            "covers_season": self.covers_season,
            "covers_week": self.covers_week,
            "freshness": self.freshness,
            "label": self.label,
            "reason": self.reason,
            "window_hours": self.window_hours,
            "coverage": self.coverage,
            **({"extra": self.extra} if self.extra else {}),
        }


def _edad(delta) -> str:
    """«3d 4h», «2h 15m», «18m». Sin minutos, una cuota de hace veinte minutos
    salía como «hace 0d 0h», que se lee como un fallo y no informa de nada."""
    total = int(delta.total_seconds())
    d, resto = divmod(total, 86400)
    h, resto = divmod(resto, 3600)
    m = resto // 60
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def _iso(ts: datetime | None) -> str | None:
    return None if ts is None else ts.astimezone(UTC).isoformat(timespec="seconds")


def file_published_at(path: Path) -> datetime | None:
    """La fecha del DATO de un fichero descargado, o `None`.

    Es el mtime, y `ingest.py` lo mantiene a propósito: contenido idéntico no se
    reescribe, y si el servidor manda `Last-Modified` el fichero lleva esa fecha.
    Por eso NO sirve para un artefacto que compila este repositorio —ahí el
    mtime es «cuándo corrí el pipeline»— y esa distinción ya costó tres
    iteraciones. Quien llame a esto con un artefacto propio se miente.
    """
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, UTC)
    except OSError:
        return None


def _cobertura(covers_week: int | None, current_week: int | None) -> str:
    """¿La jornada que cubre esta fuente es la de hoy?

    `NOT_WEEKLY` cuando la pregunta no aplica —una estadística de carrera no
    cubre una jornada— y es una respuesta VÁLIDA, no un «no sé» suave. Sin
    jornada actual con la que comparar tampoco se afirma nada.
    """
    if covers_week is None or current_week is None:
        return NOT_WEEKLY
    return CURRENT_WEEK if int(covers_week) >= int(current_week) else BEHIND


def assess(
    *,
    name: str,
    feeds: str,
    domain: Domain,
    origin: str,
    published_at: datetime | None,
    covers_week: int | None = None,
    covers_season: int | None = None,
    current_week: int | None = None,
    now: datetime | None = None,
    timeless: bool = False,
    missing_reason: str | None = None,
    extra: dict | None = None,
) -> SourceHealth:
    """Clasifica UNA fuente con la ventana que su dominio ya declara."""
    now = now or datetime.now(UTC)
    if published_at is None:
        return SourceHealth(
            name=name, feeds=feeds, domain=domain, origin=origin,
            as_of=None, covers_week=covers_week, covers_season=covers_season,
            freshness=Freshness.UNKNOWN.value, label=BROKEN,
            reason=missing_reason or "could not establish when this was last published",
            coverage=_cobertura(covers_week, current_week),
            extra=extra or {},
        )
    estado = classify(
        # `published_at` y no `retrieved_at`: la propiedad `as_of` de
        # `Provenance` se niega a mirar la hora de descarga, que es la regla 5.
        Provenance(domain=domain, published_at=published_at, source=origin),
        now=now, timeless=timeless,
    )
    ventana = WINDOWS.get(domain)
    # El corte que separa «se puede afirmar» de «no»: el tercero de la terna.
    horas = round(ventana[2].total_seconds() / 3600, 1) if ventana else None
    edad = now - published_at
    motivo = None
    if estado is Freshness.STALE:
        motivo = (f"last published {_edad(edad)} ago; the {domain.value} window "
                  f"is {horas} h")
    elif estado is Freshness.HISTORICAL:
        motivo = ("old BY DESIGN: the walk-forward guarantee forbids reading the season "
                  "it projects, so this is as current as it can be")
    elif estado is Freshness.UNKNOWN:
        motivo = "the date cannot be placed in time (no timezone, or in the future)"
    elif estado is Freshness.RECENT:
        motivo = (f"last published {_edad(edad)} ago: usable as context, but past the "
                  f"{round(ventana[1].total_seconds() / 3600, 1)} h in which {domain.value} "
                  f"can be asserted as CURRENT")
    etiqueta = ETIQUETA[estado]
    cobertura = _cobertura(covers_week, current_week)
    if cobertura == BEHIND:
        # LA SEGUNDA MITAD DE LA REGLA 5: el fichero puede ser de hace diez
        # minutos y lo que cubre ser de la jornada pasada. «Dato real + jornada
        # vieja» es la misma falsa actualidad que «dato real + fecha vieja», y
        # es literalmente el síntoma que se reportó el 7 de octubre: el sitio
        # servía la jornada 4 estando en la 5. La EDAD se conserva tal cual
        # —es un hecho distinto— y lo que cambia es el veredicto.
        etiqueta = STALE
        detalle = (f"covers week {covers_week} while the current week is "
                   f"{current_week}: this section has not advanced")
        motivo = f"{detalle}; {motivo}" if motivo else detalle
    return SourceHealth(
        name=name, feeds=feeds, domain=domain, origin=origin,
        as_of=_iso(published_at), covers_week=covers_week, covers_season=covers_season,
        freshness=estado.value, label=etiqueta, reason=motivo,
        window_hours=horas, coverage=cobertura, extra=extra or {},
    )


def week_agreement(derived: tuple[int, int] | None, sleeper: dict | None) -> dict:
    """¿Coinciden la jornada del CALENDARIO y la que dice Sleeper?

        NO SE ELIGE EN SILENCIO. SE DICE QUE DISCREPAN.

    La jornada del producto sale de `schedule.py::current_point` —el primer
    partido sin jugar— y ésa es la autoridad única desde que tres reglas
    distintas contestaban la misma pregunta y una estaba mal. Sleeper no la
    sustituye: la CONTRASTA, que es lo que detecta el caso que importa (el sitio
    dice 4 y el mundo va por la 5).

    Y si Sleeper no se pudo leer, eso es `UNREACHABLE`, no un acuerdo.
    """
    salida: dict = {"derived_season": None, "derived_week": None,
                    "sleeper_season": None, "sleeper_week": None}
    if derived:
        salida["derived_season"], salida["derived_week"] = derived
    if not sleeper or sleeper.get("status") != "OK":
        salida["status"] = "UNREACHABLE"
        salida["note"] = ((sleeper or {}).get("note")
                      or "api.sleeper.app/v1/state/nfl could not be read")
        salida["retrieved_at"] = (sleeper or {}).get("retrieved_at")
        return salida
    salida["retrieved_at"] = sleeper.get("retrieved_at")
    salida["sleeper_season"] = sleeper.get("season")
    salida["sleeper_week"] = sleeper.get("week")
    mismo = (str(salida["derived_season"]) == str(salida["sleeper_season"])
             and salida["derived_week"] == salida["sleeper_week"])
    salida["status"] = "AGREE" if mismo else "DISAGREE"
    if not mismo:
        salida["note"] = (
            f"the schedule says week {salida['derived_week']} and Sleeper says "
            f"{salida['sleeper_week']}: the schedule is what gets published, and the "
            f"disagreement is stated rather than resolved silently"
        )
    return salida


def load_sleeper_state(path: Path) -> dict | None:
    """El estado de Sleeper tal como lo dejó quien pudo leerlo.

    Se lee de un artefacto versionado y no de la red: este contenedor tiene
    `api.sleeper.app` bloqueado (CONNECT 403, medido), así que el adaptador lo
    escribe donde SÍ hay salida y aquí sólo se consume. Lo que no se hace es
    afirmar que una fuente es alcanzable sin haberlo ejecutado en ese entorno —
    eso ya fue un error de este repositorio.
    """
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
