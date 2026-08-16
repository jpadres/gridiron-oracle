"""Eliminación del margen de la casa (de-vig) por el método de Shin.

Una casa que ofrece -110/-110 está vendiendo probabilidades que suman ~1,048. Ese
4,8% es su comisión, y hay que quitarlo antes de comparar nada con el modelo.

## Por qué Shin y no normalización proporcional

Repartir el exceso en proporción a cada precio asume que la casa carga la
comisión por igual sobre los dos lados. **No lo hace.** Los precios de los no
favoritos incorporan el sesgo favorito-longshot: el público paga de más por el
premio grande, y la casa cobra ese entusiasmo cargando más margen en ese lado.

Shin (1993) modela el exceso como el coste de operar frente a apostantes
informados, y de ahí sale la corrección con la dirección correcta:

    **Shin asigna MENOS probabilidad al no favorito que la normalización
    proporcional, no más.**

Esa frase está aquí porque el signo se invirtió una vez durante el desarrollo y
no salta a la vista: las dos versiones dan números plausibles. En moneylines
desequilibradas la diferencia entre ambos métodos es de 1-2 puntos porcentuales
— exactamente el tamaño del edge que se intenta detectar. Con el signo al revés
el modelo encuentra "valor" sistemático en los no favoritos, que es justo el lado
por el que se pierde dinero.

Hay un test que fija la dirección: `tests/test_betting.py::test_shin_shrinks_longshot`.
"""

from __future__ import annotations

import numpy as np

from .odds import decimal_to_implied

# Cota superior de la proporción de dinero informado. Por encima de ~0,3 el
# modelo de Shin deja de tener sentido económico y la bisección sólo estaría
# absorbiendo un error en las cuotas de entrada.
Z_MAX = 0.35
TOLERANCE = 1e-10


def implied_probabilities(decimal_odds: np.ndarray) -> np.ndarray:
    """Probabilidades implícitas brutas (suman > 1)."""
    return np.asarray(decimal_to_implied(np.asarray(decimal_odds, dtype=float)))


def devig_proportional(decimal_odds: np.ndarray) -> np.ndarray:
    """Normalización proporcional. Está aquí para poder compararla, no para usarla."""
    raw = implied_probabilities(decimal_odds)
    return raw / raw.sum()


def devig_shin(decimal_odds: np.ndarray) -> np.ndarray:
    """De-vig por el método de Shin.

    Resuelve por bisección la proporción de dinero informado `z` que hace que
    las probabilidades corregidas sumen 1:

        p_i = [sqrt(z² + 4(1−z)·π_i²/Σπ) − z] / (2(1−z))

    La bisección es de sobra: la suma es monótona decreciente en z, converge en
    ~50 iteraciones a precisión de máquina, y no depende de una derivada que
    habría que mantener a mano.
    """
    raw = implied_probabilities(decimal_odds)
    booksum = raw.sum()
    if not np.isfinite(booksum) or booksum <= 0:
        raise ValueError("Cuotas no válidas para de-vig.")
    # Un mercado sin margen (o con margen negativo, que pasa al comparar libros
    # distintos) no tiene nada que corregir.
    if booksum <= 1.0:
        return raw / booksum

    def corrected(z: float) -> np.ndarray:
        return (np.sqrt(z**2 + 4 * (1 - z) * raw**2 / booksum) - z) / (2 * (1 - z))

    low, high = 0.0, Z_MAX
    if corrected(high).sum() > 1.0:
        # El margen es tan alto que Shin no lo explica con z ≤ Z_MAX. Se cae a
        # proporcional en vez de devolver algo que no suma 1.
        return raw / booksum

    for _ in range(200):
        mid = (low + high) / 2
        if corrected(mid).sum() > 1.0:
            low = mid
        else:
            high = mid
        if high - low < TOLERANCE:
            break

    probabilities = corrected((low + high) / 2)
    return probabilities / probabilities.sum()


def shin_z(decimal_odds: np.ndarray) -> float:
    """Proporción de dinero informado estimada. Útil para diagnóstico.

    Un `z` alto en un mercado concreto significa que la casa se está protegiendo
    mucho: normalmente es una noticia que aún no es pública (una lesión) y es
    una señal para no apostar ese partido, no para apostarlo más fuerte.
    """
    raw = implied_probabilities(decimal_odds)
    booksum = raw.sum()
    if booksum <= 1.0:
        return 0.0
    low, high = 0.0, Z_MAX
    for _ in range(200):
        mid = (low + high) / 2
        value = (np.sqrt(mid**2 + 4 * (1 - mid) * raw**2 / booksum) - mid) / (2 * (1 - mid))
        if value.sum() > 1.0:
            low = mid
        else:
            high = mid
    return (low + high) / 2
