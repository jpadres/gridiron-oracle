"""Frescura: qué se puede afirmar como ACTUAL y qué no.

## El fallo que esto impide

    FUENTE REAL + INFORMACIÓN REAL + FECHA VIEJA = RESPUESTA ACTUAL FALSA.

Es el modo de fallo más peligroso de una investigación automática, porque no
parece un error: la fuente es buena, la cita es exacta y el texto suena bien. Lo
único que está mal es el tiempo, y el tiempo no se ve.

## Las cuatro marcas, que NO son la misma

- `published_at` — cuándo se publicó el texto.
- `event_at` — cuándo ocurrió lo que cuenta.
- `effective_at` — desde cuándo rige (una suspensión de tres partidos).
- `retrieved_at` — cuándo lo leímos nosotros.

Un artículo actualizado hoy puede describir algo de marzo. Un artículo histórico
descubierto hoy sigue siendo histórico. **La hora de descarga no es la hora del
hecho**, y confundirlas es exactamente cómo se fabrica una respuesta falsamente
actual.

## Ventanas por dominio, no una ventana global

Una cuota se queda vieja en minutos; un parte de lesiones el domingo, en horas;
una estadística de carrera **no caduca nunca**. Una única ventana global sería o
absurdamente estricta para lo histórico o peligrosamente laxa para el mercado.
Por eso `WINDOWS` es un diccionario por dominio y los números están escritos,
no elegidos en el momento de usarlos.

## HISTORICAL no es STALE

Que Rice tenga 197 touchdowns es igual de cierto hoy que en 1999. Un dato
histórico correctamente etiquetado es **válido**, no caducado. Marcarlo como
STALE empujaría a descartar lo que sí se puede afirmar.

## Falla cerrado

`require_current` levanta una excepción en vez de devolver lo viejo. La regla del
proyecto es **UNKNOWN > STALE PRESENTADO COMO ACTUAL**: decir «no tengo el dato
de hoy» es un resultado correcto; decir el de ayer como si fuera el de hoy, no.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum


class Freshness(str, Enum):
    LIVE = "LIVE"
    """Dentro de la ventana en la que el dato se comporta como tiempo real."""

    CURRENT = "CURRENT"
    """Utilizable como estado actual sin advertencia."""

    RECENT = "RECENT"
    """Utilizable, pero hay que enseñar la antigüedad al lado."""

    STALE = "STALE"
    """No se puede presentar como actual. Sirve de contexto, no de estado."""

    HISTORICAL = "HISTORICAL"
    """Hecho del pasado, correcto por definición. NO es una versión de STALE."""

    UNKNOWN = "UNKNOWN"
    """No se pudo establecer la frescura. Nunca se degrada a CURRENT."""


class StaleData(RuntimeError):
    """Se pidió estado actual y sólo hay dato viejo. Falla cerrado a propósito."""


class Domain(str, Enum):
    """Los tipos de dato con vida útil distinta."""

    ODDS = "ODDS"
    DRAFT_STATE = "DRAFT_STATE"
    INJURY_GAMEDAY = "INJURY_GAMEDAY"
    INJURY_REPORT = "INJURY_REPORT"
    WEATHER = "WEATHER"
    ROSTER = "ROSTER"
    DEPTH_CHART = "DEPTH_CHART"
    TRANSACTION = "TRANSACTION"
    NEWS = "NEWS"
    ADP = "ADP"
    LEAGUE_STATE = "LEAGUE_STATE"
    SEASON_STATS = "SEASON_STATS"
    CAREER_STATS = "CAREER_STATS"


# Los tres cortes de cada dominio: (live, current, recent). Más allá de `recent`
# es STALE. Los números salen de cuánto tarda ESE dato en cambiar de verdad, no
# de un gusto: una cuota se mueve con cada apuesta grande; una plantilla, con
# cada transacción; una estadística de carrera, nunca.
WINDOWS: dict[Domain, tuple[timedelta, timedelta, timedelta]] = {
    # El mercado se mueve en segundos. Una cuota de hace una hora no es la cuota.
    Domain.ODDS: (timedelta(minutes=2), timedelta(minutes=15), timedelta(hours=2)),
    # Un draft en directo: entre dos picks pueden pasar 30 segundos.
    Domain.DRAFT_STATE: (timedelta(seconds=30), timedelta(minutes=2), timedelta(minutes=10)),
    # Domingo: los inactivos oficiales salen 90 minutos antes del kickoff.
    Domain.INJURY_GAMEDAY: (timedelta(minutes=5), timedelta(hours=1), timedelta(hours=6)),
    # Entre semana el parte se publica a diario. `live` a cero a propósito: un
    # documento publicado nunca es «en directo», por reciente que sea. LIVE se
    # reserva a lo que llega como flujo —cuotas, picks, inactivos— porque es la
    # etiqueta que autoriza a la interfaz a decir que algo está pasando ahora.
    Domain.INJURY_REPORT: (timedelta(0), timedelta(hours=24), timedelta(days=3)),
    Domain.WEATHER: (timedelta(minutes=15), timedelta(hours=1), timedelta(hours=6)),
    Domain.ROSTER: (timedelta(0), timedelta(hours=24), timedelta(days=7)),
    Domain.DEPTH_CHART: (timedelta(0), timedelta(days=1), timedelta(days=7)),
    Domain.TRANSACTION: (timedelta(minutes=15), timedelta(hours=12), timedelta(days=3)),
    Domain.NEWS: (timedelta(0), timedelta(hours=24), timedelta(days=7)),
    Domain.ADP: (timedelta(0), timedelta(days=2), timedelta(days=14)),
    Domain.LEAGUE_STATE: (timedelta(minutes=5), timedelta(hours=6), timedelta(days=2)),
    # Las estadísticas de la temporada en curso se cierran cada semana.
    Domain.SEASON_STATS: (timedelta(0), timedelta(days=2), timedelta(days=9)),
}

# Los dominios cuyo dato es un hecho del pasado: no caducan. Se listan en vez de
# derivarlo, para que añadir un dominio obligue a decidir a cuál de los dos
# grupos pertenece.
TIMELESS: frozenset[Domain] = frozenset({Domain.CAREER_STATS})

# Jerarquía de evidencia. Sólo se usa para DESEMPATAR, nunca para descartar: el
# desacuerdo se conserva (ver `resolve`).
EVIDENCE_RANK: dict[str, int] = {
    "OFFICIAL": 4,   # anuncio del equipo o de la liga, inactivos oficiales
    "REPORTED": 3,   # periodista con nombre, informando
    "OBSERVED": 2,   # reportero describiendo lo que vio
    "OPINION": 1,    # analista esperando algo
    "MODEL": 1,      # nosotros
}


@dataclass(frozen=True)
class Provenance:
    """De dónde sale un dato y cuándo, con las cuatro marcas separadas."""

    source: str
    domain: Domain
    retrieved_at: datetime | None = None
    published_at: datetime | None = None
    event_at: datetime | None = None
    effective_at: datetime | None = None
    author: str | None = None
    url: str | None = None
    evidence_type: str | None = None
    season: int | None = None
    week: int | None = None

    @property
    def as_of(self) -> datetime | None:
        """El instante que decide la frescura.

        Es `event_at` si se conoce, y sólo entonces `published_at`. **Nunca**
        `retrieved_at`: descargar hoy un artículo de marzo no lo hace de hoy, y
        usar la hora de descarga es precisamente cómo un dato viejo se disfraza
        de actual.
        """
        return self.event_at or self.published_at


def classify(
    provenance: Provenance,
    *,
    now: datetime | None = None,
    timeless: bool = False,
) -> Freshness:
    """Frescura de un dato. `UNKNOWN` cuando no se puede establecer."""
    if timeless or provenance.domain in TIMELESS:
        # Un hecho del pasado con fecha conocida es HISTORICAL, que es válido.
        # Sin fecha no se puede situar en el tiempo, y eso sigue siendo UNKNOWN.
        return Freshness.HISTORICAL if provenance.as_of else Freshness.UNKNOWN

    as_of = provenance.as_of
    if as_of is None or as_of.tzinfo is None:
        # Sin huso no se convierte: suponerlo desplaza el instante entre una y
        # ocho horas y el resultado se lee como real. Misma regla que
        # `narrative/timestamps.py`.
        return Freshness.UNKNOWN

    now = now or datetime.now(UTC)
    age = now - as_of
    if age < timedelta(0):
        # Fecha en el futuro: reloj mal puesto, huso mal aplicado o fuente rota.
        # No se trata como «fresquísimo», que es lo que haría una comparación
        # ingenua — se trata como lo que es, un dato que no se puede situar.
        return Freshness.UNKNOWN

    window = WINDOWS.get(provenance.domain)
    if window is None:
        return Freshness.UNKNOWN
    live, current, recent = window
    if age <= live:
        return Freshness.LIVE
    if age <= current:
        return Freshness.CURRENT
    if age <= recent:
        return Freshness.RECENT
    return Freshness.STALE


USABLE_AS_CURRENT = frozenset({Freshness.LIVE, Freshness.CURRENT})


def require_current(
    provenance: Provenance,
    *,
    now: datetime | None = None,
    allow_recent: bool = False,
) -> Freshness:
    """Exige estado actual. Levanta `StaleData` si no lo hay.

    Falla cerrado a propósito: devolver el dato viejo con una advertencia deja la
    decisión en manos de quien llama, y quien llama casi siempre la ignora.
    """
    level = classify(provenance, now=now)
    allowed = USABLE_AS_CURRENT | ({Freshness.RECENT} if allow_recent else frozenset())
    if level in allowed:
        return level
    raise StaleData(
        f"No hay dato actual de {provenance.domain.value} desde «{provenance.source}»: "
        f"frescura {level.value}"
        + (f", último verificado {provenance.as_of.isoformat()}" if provenance.as_of
           else ", sin fecha comprobable")
    )


def season_week_matches(provenance: Provenance, season: int, week: int) -> bool:
    """¿Habla de la jornada que se está publicando?

    Un depth chart de la temporada pasada es un documento real y correcto, y
    describe una plantilla que ya no existe. La frescura por sí sola no lo caza:
    un artículo de la pretemporada anterior puede estar dentro de la ventana de
    NEWS si se republica.
    """
    if provenance.season is None:
        return False
    if provenance.season != season:
        return False
    return provenance.week is None or provenance.week == week


@dataclass(frozen=True)
class Claim:
    """Una afirmación sobre el estado actual, con su procedencia."""

    value: object
    provenance: Provenance


@dataclass(frozen=True)
class Resolution:
    """El resultado de cruzar dos fuentes. El desacuerdo NO se borra."""

    winner: Claim
    others: tuple[Claim, ...]
    agreed: bool
    reason: str

    @property
    def disputed(self) -> bool:
        return not self.agreed


def resolve(claims: list[Claim], *, now: datetime | None = None) -> Resolution:
    """Cruza afirmaciones en conflicto sin ocultar el conflicto.

    Orden: primero la evidencia oficial, después la más reciente, después la
    mejor atribuida. Pero el desacuerdo se conserva: «el equipo lo da dudoso» y
    «el reportero espera que juegue» **no son la misma clase de evidencia**, y
    quedarse sólo con una de las dos borra información que quien decide necesita.
    """
    if not claims:
        raise ValueError("No hay ninguna afirmación que resolver.")

    def key(claim: Claim):
        rank = EVIDENCE_RANK.get((claim.provenance.evidence_type or "").upper(), 0)
        as_of = claim.provenance.as_of
        # Sin fecha va al fondo: no se puede afirmar que sea lo más nuevo.
        stamp = as_of.timestamp() if as_of else float("-inf")
        return (rank, stamp)

    ordered = sorted(claims, key=key, reverse=True)
    winner, others = ordered[0], tuple(ordered[1:])
    agreed = all(claim.value == winner.value for claim in others)
    if agreed:
        reason = "todas las fuentes coinciden"
    else:
        best = EVIDENCE_RANK.get((winner.provenance.evidence_type or "").upper(), 0)
        rival = max(
            (EVIDENCE_RANK.get((c.provenance.evidence_type or "").upper(), 0) for c in others),
            default=0,
        )
        reason = (
            "gana la evidencia de mayor rango"
            if best > rival
            else "mismo rango de evidencia: gana la más reciente"
        )
    return Resolution(winner=winner, others=others, agreed=agreed, reason=reason)
