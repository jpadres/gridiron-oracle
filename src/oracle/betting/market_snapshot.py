"""OBSERVACIONES DE MERCADO INDEXADAS EN EL TIEMPO: el contrato que hoy no existe.

El backtest de este proyecto mide contra la LÍNEA DE CIERRE (`spread_line` de
nflverse), que es la última cuota antes del kickoff — la que nadie puede
apostar. Lo que se puede apostar es la línea que había CUANDO SE DECIDIÓ. Sin
esa distinción, un «edge» contra el cierre no es un edge accionable, y el
proyecto no lo llama así: el registro tiene `BETTING_EDGE = REJECTED`.

Este módulo define el contrato de datos que hace posible la versión honesta:

    OPEN      la primera línea publicada por un libro
    DECISION  la línea vigente en el instante en que se recomendó (snapshot)
    CLOSE     la última antes del kickoff — comparador y objetivo de CLV, NUNCA
              entrada de la recomendación

Cada observación lleva su `observed_at`. Sin marca de tiempo no hay
observación: `MarketObservation` se niega a existir sin ella. Y la selección
«la línea vigente a las 14:03» se hace SÓLO con observaciones anteriores a ese
instante —la línea de las 14:05 no existía para quien decidió a las 14:03—.

Lo que NO hay todavía: datos. nflverse no publica aperturas ni instantáneas
(`docs/PROVEEDORES_LINEAS.md` audita quién sí). Hasta que exista una fuente, el
cierre sigue siendo lo único que hay, y así se dice en la web.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class MarketType(str, Enum):
    SPREAD = "SPREAD"
    TOTAL = "TOTAL"
    MONEYLINE = "MONEYLINE"


class Phase(str, Enum):
    OPEN = "OPEN"
    DECISION = "DECISION"
    CLOSE = "CLOSE"


def _aware(stamp: datetime, name: str) -> datetime:
    if not isinstance(stamp, datetime):
        raise TypeError(f"{name} tiene que ser datetime, no {type(stamp).__name__}")
    if stamp.tzinfo is None:
        raise ValueError(f"{name} tiene que llevar zona horaria: un instante sin zona no es un instante")
    return stamp.astimezone(timezone.utc)


@dataclass(frozen=True)
class MarketObservation:
    """Una línea de un libro para un mercado de un partido en UN instante."""

    game_id: str
    market_type: MarketType
    book: str                 # «pinnacle», «draftkings», «consensus»… nunca «unknown» implícito
    line: float | None        # handicap o total; None en moneyline
    odds_decimal: float       # cuota decimal del lado
    side: str                 # equipo, «OVER»/«UNDER»
    observed_at: datetime     # cuándo se VIO esta línea (obligatorio)
    source: str               # de dónde salió la observación
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    phase_hint: Phase | None = None   # lo que el proveedor DIGA que es; no se deduce

    def __post_init__(self) -> None:
        object.__setattr__(self, "observed_at", _aware(self.observed_at, "observed_at"))
        for name in ("opened_at", "closed_at"):
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, _aware(value, name))
        if not self.book or not self.source:
            raise ValueError("una observación sin libro o sin fuente no es una observación")
        if not (self.odds_decimal > 1.0):
            raise ValueError(f"cuota decimal inválida: {self.odds_decimal}")
        if self.market_type is MarketType.MONEYLINE and self.line is not None:
            raise ValueError("un moneyline no lleva handicap")
        if self.market_type is not MarketType.MONEYLINE and self.line is None:
            raise ValueError(f"un {self.market_type.value} lleva línea")


@dataclass(frozen=True)
class DecisionSnapshot:
    """Lo que se congela cuando se recomienda: modelo + mercado + instante.

    La evaluación histórica usa ESTO, nunca un recálculo de hoy: el modelo de
    hoy sabe cosas que el de aquel día no sabía, y la línea de hoy no es la
    que se apostó.
    """

    game_id: str
    market_type: MarketType
    side: str
    model_version: str
    model_probability: float
    model_projection: float | None
    market: MarketObservation
    decided_at: datetime
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "decided_at", _aware(self.decided_at, "decided_at"))
        if self.market.observed_at > self.decided_at:
            raise ValueError("la observación de mercado es POSTERIOR a la decisión: no estaba disponible")
        if not (0.0 <= self.model_probability <= 1.0):
            raise ValueError("model_probability fuera de [0, 1]")


def at_decision_time(observations: list[MarketObservation], when: datetime,
                     book: str | None = None) -> MarketObservation | None:
    """La última observación ANTERIOR O IGUAL a `when` (y del libro pedido, si se pide).

    Nada posterior cuenta, aunque sea «mejor»: no existía. Sin observaciones
    anteriores, None — y quien llama dice UNKNOWN, no cae al cierre.
    """
    when = _aware(when, "when")
    usable = [o for o in observations if o.observed_at <= when and (book is None or o.book == book)]
    if not usable:
        return None
    return max(usable, key=lambda o: o.observed_at)


def opening(observations: list[MarketObservation], book: str | None = None) -> MarketObservation | None:
    usable = [o for o in observations if book is None or o.book == book]
    return min(usable, key=lambda o: o.observed_at) if usable else None


def closing(observations: list[MarketObservation], kickoff: datetime,
            book: str | None = None) -> MarketObservation | None:
    """La última observación antes del kickoff. Es el COMPARADOR (CLV), no la entrada."""
    return at_decision_time(observations, kickoff, book)


def closing_line_value(decision: DecisionSnapshot, close: MarketObservation) -> float | None:
    """CLV en puntos de línea, con el signo del lado apostado. None entre mercados distintos."""
    if decision.market.market_type is not close.market_type or decision.market.line is None or close.line is None:
        return None
    # Para un spread/total tomado por el lado «menos puntos», que la línea de
    # cierre se mueva a favor es que suba el handicap recibido. Se devuelve la
    # diferencia bruta; el signo por lado lo interpreta quien evalúa, con el
    # lado en la mano. Lo que aquí NO se hace es convertirlo en «ganancia».
    return float(close.line - decision.market.line)
