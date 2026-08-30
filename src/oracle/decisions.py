"""Traducir una separación de proyección en algo que se pueda decir en voz alta.

Bloque C del Decision Lab V2.

## De dónde salen estas cuatro etiquetas

De medir, no de elegirlas. E12, sobre 89.114 pares de 2024–2025:

    separación        acierto real          n
    < 1 punto         50,6% [49,5–51,7]   15.837   <- el 50% dentro del intervalo
    1 – 3 puntos      53,0–55,8%          26.517
    3 – 5 puntos      59,8% [59,1–60,5]   19.682
    > 5 puntos        66,7% [66,2–67,3]   27.078

**Por debajo de un punto el orden no contiene información.** Y como los puestos
consecutivos de un ranking semanal se separan por mucho menos de un punto, el
puesto 14 y el 15 son la misma cosa.

## Por qué esto NO devuelve una probabilidad

`historical_accuracy` es la frecuencia con la que **el sistema** ha acertado en
decisiones de esa dificultad. No es «A tiene un 60% de superar a B»: eso exige
calibración por par, que es un experimento distinto y que no se ha hecho.

La diferencia importa porque las dos cosas se leen igual en una pantalla y sólo
una está respaldada. Por eso el campo se llama así y no `probability`, y por eso
`Separation` no expone ningún método que devuelva algo llamado probabilidad.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Confidence(str, Enum):
    """Cuánto se puede afirmar sobre una comparación entre dos jugadores."""

    TOSS_UP = "TOSS_UP"
    """Moneda al aire. El acierto medido no se distingue del 50%."""

    LEAN = "LEAN"
    """Inclinación. Mejor que el azar, lejos de ser claro."""

    CLEAR = "CLEAR"
    """Claro."""

    VERY_CLEAR = "VERY_CLEAR"
    """Muy claro."""


@dataclass(frozen=True)
class Band:
    """Un tramo de separación con su evidencia medida detrás."""

    confidence: Confidence
    min_gap: float
    max_gap: float | None
    historical_accuracy: float
    accuracy_ci: tuple[float, float]
    sample_size: int
    wording: str
    """Cómo se puede redactar. Literal, para que no se improvise en cada pantalla."""

    @property
    def is_informative(self) -> bool:
        """¿Excluye el intervalo al 50%? Si no, no hay nada que recomendar."""
        return self.accuracy_ci[0] > 0.50


# Los tramos, con los números de E12. Cambiar un umbral aquí exige rehacer el
# experimento: son cortes medidos, no elegidos.
BANDS: tuple[Band, ...] = (
    Band(
        confidence=Confidence.TOSS_UP,
        min_gap=0.0, max_gap=1.0,
        historical_accuracy=0.506,
        accuracy_ci=(0.495, 0.517),
        sample_size=15837,
        wording="a coin flip: start whichever you prefer",
    ),
    Band(
        confidence=Confidence.LEAN,
        min_gap=1.0, max_gap=3.0,
        historical_accuracy=0.544,
        accuracy_ci=(0.521, 0.567),
        sample_size=26517,
        wording="a slight lean, and not much more",
    ),
    Band(
        confidence=Confidence.CLEAR,
        min_gap=3.0, max_gap=5.0,
        historical_accuracy=0.598,
        accuracy_ci=(0.591, 0.605),
        sample_size=19682,
        wording="the choice is clear",
    ),
    Band(
        confidence=Confidence.VERY_CLEAR,
        min_gap=5.0, max_gap=None,
        historical_accuracy=0.667,
        accuracy_ci=(0.662, 0.673),
        sample_size=27078,
        wording="the choice is very clear",
    ),
)


def band_for(gap: float) -> Band:
    """El tramo que corresponde a una diferencia de proyección, en valor absoluto."""
    value = abs(float(gap))
    for band in BANDS:
        if band.max_gap is None or value < band.max_gap:
            return band
    return BANDS[-1]


def as_payload() -> list[dict]:
    """Los tramos, para que la interfaz no reinvente los cortes."""
    return [
        {
            "confidence": band.confidence.value,
            "min_gap": band.min_gap,
            "max_gap": band.max_gap,
            "historical_accuracy": band.historical_accuracy,
            "accuracy_ci": list(band.accuracy_ci),
            "sample_size": band.sample_size,
            "wording": band.wording,
            "is_informative": band.is_informative,
        }
        for band in BANDS
    ]
