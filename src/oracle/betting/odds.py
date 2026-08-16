"""Conversión entre formatos de cuota.

Aburrido y crítico. Un signo mal puesto aquí no lanza ninguna excepción: produce
un modelo que cree tener ventaja justo donde no la tiene.
"""

from __future__ import annotations

import numpy as np


def american_to_decimal(odds: float | np.ndarray) -> float | np.ndarray:
    """Cuota americana a decimal.

    +150 -> 2.50 (gano 150 por cada 100 apostados)
    -110 -> 1.909... (apuesto 110 para ganar 100)
    """
    odds = np.asarray(odds, dtype=float)
    result = np.where(odds > 0, 1.0 + odds / 100.0, 1.0 + 100.0 / np.abs(odds))
    return float(result) if result.ndim == 0 else result


def decimal_to_american(decimal: float | np.ndarray) -> float | np.ndarray:
    decimal = np.asarray(decimal, dtype=float)
    result = np.where(decimal >= 2.0, (decimal - 1.0) * 100.0, -100.0 / (decimal - 1.0))
    return float(result) if result.ndim == 0 else result


def decimal_to_implied(decimal: float | np.ndarray) -> float | np.ndarray:
    """Probabilidad implícita **bruta**: incluye la comisión de la casa.

    Nunca se compara con la probabilidad del modelo sin quitar antes el margen
    (`devig`). Comparar contra la implícita bruta es la forma más rápida de
    convencerse de que no hay ninguna apuesta con valor en el mundo.
    """
    decimal = np.asarray(decimal, dtype=float)
    result = 1.0 / decimal
    return float(result) if result.ndim == 0 else result


def american_to_implied(odds: float | np.ndarray) -> float | np.ndarray:
    return decimal_to_implied(american_to_decimal(odds))
