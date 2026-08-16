"""Dimensionamiento de apuestas: Kelly fraccionado con encogimiento del edge.

Kelly completo maximiza el crecimiento logarítmico del bankroll **si conoces las
probabilidades verdaderas**. No las conoces: tienes una estimación con error. Y
Kelly es asimétricamente cruel con ese error — sobreestimar el edge un 20%
apuesta un 20% de más, pero el coste en drawdown crece mucho más rápido.

Kelly completo con probabilidades estimadas produce drawdowns del 60-80%. No es
una opción defendible para nadie, y desde luego no para un proyecto personal.

Por eso hay **cuatro** frenos apilados, y cada uno protege de algo distinto:

1. `edge_shrink = 0.50` — el edge estimado se parte por la mitad *antes* de
   entrar en la fórmula. Cubre el error de estimación del modelo.
2. `fraction = 0.25` — Kelly a un cuarto. Cubre la varianza del propio Kelly.
3. `max_fraction = 0.02` — tope duro del 2% del bankroll. Cubre el caso en que
   el modelo se equivoque catastróficamente en un partido concreto.
4. `min_edge = 0.015` — por debajo del 1,5% de ventaja no se apuesta. Cubre el
   caso en que el "edge" sea sólo error de medición.

Los cuatro juntos son deliberadamente conservadores. Un modelo que iguala al
mercado (que es lo que este hace) **no tiene edge demostrado**, y el
dimensionamiento tiene que reflejar eso.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KellyConfig:
    """Parámetros de gestión de riesgo. Los valores por defecto son los del proyecto."""

    fraction: float = 0.25
    edge_shrink: float = 0.50
    max_fraction: float = 0.02
    min_edge: float = 0.015

    def __post_init__(self) -> None:
        if not 0 < self.fraction <= 1:
            raise ValueError("fraction debe estar en (0, 1].")
        if not 0 <= self.edge_shrink <= 1:
            raise ValueError("edge_shrink debe estar en [0, 1].")
        if not 0 < self.max_fraction <= 1:
            raise ValueError("max_fraction debe estar en (0, 1].")


def full_kelly(probability: float, decimal_odds: float) -> float:
    """Fracción de Kelly completa. Interna: nunca se apuesta este número.

        f* = (p·b − q) / b,  con b = cuota_decimal − 1

    Se devuelve 0 en vez de negativo cuando no hay valor: una fracción negativa
    significa "apuesta al otro lado", y ese otro lado se evalúa por separado con
    sus propias cuotas, que no son el inverso de estas.
    """
    b = decimal_odds - 1.0
    if b <= 0:
        return 0.0
    edge = probability * decimal_odds - 1.0
    return max(edge / b, 0.0)


def stake_fraction(
    probability: float,
    decimal_odds: float,
    market_probability: float | None = None,
    config: KellyConfig | None = None,
) -> float:
    """Fracción del bankroll a apostar, con los cuatro frenos aplicados.

    `market_probability` es la probabilidad de la casa ya sin margen. Cuando se
    pasa, el edge se mide contra ella (que es la comparación correcta) y no
    contra la cuota bruta.
    """
    config = config or KellyConfig()

    reference = (
        market_probability if market_probability is not None else 1.0 / decimal_odds
    )
    edge = probability - reference
    if edge < config.min_edge:
        return 0.0

    # El encogimiento se aplica sobre la probabilidad, no sobre la fracción
    # final. Es lo mismo sólo si Kelly fuese lineal en p, y no lo es.
    shrunk = reference + (1 - config.edge_shrink) * edge
    kelly = full_kelly(shrunk, decimal_odds)

    return min(config.fraction * kelly, config.max_fraction)


def stake(
    bankroll: float,
    probability: float,
    decimal_odds: float,
    market_probability: float | None = None,
    config: KellyConfig | None = None,
) -> float:
    """Importe a apostar, redondeado a la unidad."""
    fraction = stake_fraction(probability, decimal_odds, market_probability, config)
    return round(bankroll * fraction, 2)


def expected_value(probability: float, decimal_odds: float) -> float:
    """EV por unidad apostada. 0.03 = +3% de retorno esperado."""
    return probability * decimal_odds - 1.0
