"""Distribución discreta del margen, con números clave.

El margen en la NFL **no es una variable continua**. Se acumula brutalmente en 3
y en 7, porque así es como se puntúa: gol de campo y touchdown con transformación.
Convertir "margen esperado 2.8" en probabilidad con una normal comete errores
grandes y, lo que es peor, *sistemáticos* justo en las líneas donde se juega el
dinero: -3 y -7 son la mitad del mercado de spread.

La densidad se factoriza:

    P(margen = k | pred) ∝ w(k) · N(k ; pred, σ(pred, total))

`w(k)` es un multiplicador empírico: el cociente entre la frecuencia observada de
cada margen y su versión suavizada por kernel. No se le dice al modelo que 3 y 7
son especiales — sale solo, con ~1.9 en k=3, ~1.5 en k=7 y ~0.55 en k=2 y k=5.
Que aparezca sin pedirlo es la comprobación de que el método mide algo real.

De ahí salen dos cosas que una normal no puede dar: probabilidades de *push*
correctas (con línea entera, empatar contra el número no es un caso raro: en
-3 es el 8-9% de las veces) y precios correctos en líneas de -3 y -7.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Rango de márgenes considerado. ±70 cubre todo lo que ha pasado en la historia
# de la NFL con holgura; fuera de ahí la normal ya aporta densidad ~0.
MARGIN_MIN, MARGIN_MAX = -70, 70

# Ancho del kernel que define la "frecuencia esperada si no hubiera números
# clave". 2.5 puntos es lo bastante ancho para no seguir los propios picos de 3 y
# 7 (que es lo que se quiere medir) y lo bastante estrecho para seguir la forma
# general de la distribución.
KERNEL_BANDWIDTH = 2.5

# Topes del multiplicador. Sin ellos, un margen exótico con dos observaciones en
# la cola puede salir con w=6 y contaminar precios reales.
WEIGHT_FLOOR, WEIGHT_CEILING = 0.35, 2.60

# Cuenta de "prior" para encoger w(k) hacia 1 donde hay pocos datos. Un margen
# de 48 puntos se ha dado tres veces: su frecuencia cruda no significa nada.
WEIGHT_PRIOR_COUNT = 60.0


@dataclass
class MarginDistribution:
    """Distribución del margen ajustada a un histórico.

    Se reajusta en cada paso del walk-forward: los pesos de números clave y la
    escala σ también son parámetros aprendidos, y usarlos ajustados sobre el
    futuro sería tan fuga como usar un modelo ajustado sobre el futuro.
    """

    # σ = intercepto + pendiente · (total_esperado − 44) / 10.
    # La varianza del margen crece con el total: en un partido que se proyecta
    # 55 puntos hay más posesiones y más varianza que en uno de 35. 44 es la
    # media histórica de la liga, así que el intercepto es σ "en un partido
    # normal" y es directamente interpretable.
    sigma_intercept: float = 13.5
    sigma_total_slope: float = 0.9
    sigma_floor: float = 9.0

    grid: np.ndarray = field(default_factory=lambda: np.arange(MARGIN_MIN, MARGIN_MAX + 1))
    weights: np.ndarray | None = None

    def fit(
        self,
        margins: np.ndarray,
        predictions: np.ndarray | None = None,
        totals: np.ndarray | None = None,
    ) -> MarginDistribution:
        """Estima los pesos de números clave y la escala σ.

        `predictions` y `totals` son opcionales: sin ellas se estima σ a partir
        de la dispersión bruta de los márgenes, que es peor pero permite usar la
        distribución antes de tener un modelo.
        """
        margins = np.asarray(margins, dtype=float)
        margins = margins[np.isfinite(margins)]
        if margins.size == 0:
            raise ValueError("No hay márgenes para ajustar la distribución.")

        self.weights = _key_number_weights(margins, self.grid)

        if predictions is not None:
            residuals = margins - np.asarray(predictions, dtype=float)[: margins.size]
        else:
            residuals = margins - margins.mean()
        residuals = residuals[np.isfinite(residuals)]

        if totals is not None and np.isfinite(totals).sum() > 100:
            totals = np.asarray(totals, dtype=float)[: residuals.size]
            mask = np.isfinite(totals) & np.isfinite(residuals)
            # Regresión de |residuo| sobre el total centrado. Se usa el valor
            # absoluto y no el cuadrado porque el cuadrado da todo el peso a
            # cuatro palizas y la pendiente sale inestable de un año a otro.
            centered = (totals[mask] - 44.0) / 10.0
            design = np.column_stack([np.ones(centered.size), centered])
            # |residuo| de una normal tiene media σ·sqrt(2/π): se corrige para
            # que el intercepto siga siendo σ y no otra escala.
            coefficients, *_ = np.linalg.lstsq(design, np.abs(residuals[mask]), rcond=None)
            scale = np.sqrt(np.pi / 2.0)
            self.sigma_intercept = float(coefficients[0] * scale)
            self.sigma_total_slope = float(coefficients[1] * scale)
        else:
            self.sigma_intercept = float(residuals.std(ddof=1))

        return self

    def sigma(self, total: float | None = None) -> float:
        if total is None or not np.isfinite(total):
            total = 44.0
        value = self.sigma_intercept + self.sigma_total_slope * (float(total) - 44.0) / 10.0
        return max(value, self.sigma_floor)

    def pmf(self, pred_margin: float, total: float | None = None) -> np.ndarray:
        """Distribución de probabilidad sobre `self.grid`."""
        sigma = self.sigma(total)
        density = np.exp(-0.5 * ((self.grid - pred_margin) / sigma) ** 2)
        if self.weights is not None:
            density = density * self.weights
        total_mass = density.sum()
        if total_mass <= 0:
            # Predicción absurdamente fuera del grid. Mejor una uniforme que un
            # NaN que se propague silenciosamente hasta un precio.
            return np.full(self.grid.size, 1.0 / self.grid.size)
        return density / total_mass

    def win_probability(self, pred_margin: float, total: float | None = None) -> float:
        """Probabilidad de que gane el local.

        El empate se reparte a medias. En la NFL es raro (~0.2%) pero existe, y
        tirarlo a la basura desplaza la probabilidad una décima justo en los
        partidos más igualados, que son los que más importan.
        """
        pmf = self.pmf(pred_margin, total)
        return float(pmf[self.grid > 0].sum() + 0.5 * pmf[self.grid == 0].sum())

    def cover_probability(
        self, pred_margin: float, line: float, total: float | None = None
    ) -> tuple[float, float, float]:
        """(cubre el local, push, cubre el visitante) para un spread dado.

        Convención de `line`: la misma de nfldata, positiva si el local es
        favorito, y el local cubre cuando `margen > line`.
        """
        pmf = self.pmf(pred_margin, total)
        push = float(pmf[np.isclose(self.grid, line)].sum())
        home = float(pmf[self.grid > line].sum())
        away = float(pmf[self.grid < line].sum())
        return home, push, away

    def to_dict(self) -> dict:
        return {
            "sigma_intercept": self.sigma_intercept,
            "sigma_total_slope": self.sigma_total_slope,
            "weights": None if self.weights is None else self.weights.tolist(),
        }


def _key_number_weights(margins: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Cociente entre frecuencia observada y frecuencia suavizada por kernel.

    El resultado, sin decirle nada al modelo sobre el reglamento: picos claros
    en |margen| = 3 y 7, valles en 2, 4 y 5.
    """
    edges = np.append(grid - 0.5, grid[-1] + 0.5)
    counts, _ = np.histogram(margins, bins=edges)
    observed = counts / max(counts.sum(), 1)

    # Suavizado gaussiano sobre la rejilla discreta: "cómo sería la distribución
    # si los puntos se repartieran de forma continua".
    offsets = grid[:, None] - grid[None, :]
    kernel = np.exp(-0.5 * (offsets / KERNEL_BANDWIDTH) ** 2)
    kernel /= kernel.sum(axis=1, keepdims=True)
    smoothed = kernel @ observed

    with np.errstate(divide="ignore", invalid="ignore"):
        weights = np.where(smoothed > 0, observed / smoothed, 1.0)

    # Encogimiento hacia 1 por número de observaciones: donde hay tres partidos
    # el cociente no es señal, es ruido.
    reliability = counts / (counts + WEIGHT_PRIOR_COUNT)
    weights = 1.0 + reliability * (weights - 1.0)

    return np.clip(np.nan_to_num(weights, nan=1.0), WEIGHT_FLOOR, WEIGHT_CEILING)
