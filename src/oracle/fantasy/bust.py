"""Probabilidad de que una proyección de draft se quede corta de verdad.

## Qué es un bust aquí

Terminar la temporada **por debajo del 70% de su proyección**. El corte está
fijado en `docs/PREREGISTRO_riesgo.md` antes de medir nada, y no se mueve: un
umbral elegido después de ver los resultados convierte la validación en teatro.

Un bust no es lo mismo que un error de proyección grande. La proyección puede
fallar hacia arriba —y eso es una alegría, no un riesgo—, así que esto mide sólo
la cola de abajo. Es la pregunta que se hace de verdad en un draft: «¿cuánto me
puede salir mal esta elección?», no «¿cuánto puede variar?».

## Por qué una regresión logística y no una fórmula a mano

El índice de volatilidad de `risk.py` reparte sus tres componentes con pesos
puestos a mano, porque no había con qué ajustarlos sin sobreajustar. Aquí sí lo
hay: el bust es un suceso binario observado miles de veces, y ajustar cuatro
coeficientes sobre unos 2.000 casos por temporada no es sobreajuste, es
estimación. Lo que sale es además una **probabilidad**, que se puede calibrar y
por tanto desmentir — un índice de 0 a 100 no.

El ajuste es walk-forward: los coeficientes que se aplican a una temporada salen
sólo de las anteriores. Es la misma disciplina que el resto del proyecto, y aquí
importa igual: el bust de un jugador depende de qué le pasó a los demás ese año.

## Las cuatro entradas

Las tres de `risk.py` —muestra, cuánto encogió el modelo la tasa bruta,
dependencia del touchdown— más la **tasa de ausencia** de `availability.py`. La
cuarta es la que aporta información que las otras tres no tienen: un jugador
puede tener muestra larga, tasa creíble y pocos TD, y aun así perderse ocho
partidos.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

# Corte de bust, preregistrado. Terminar por debajo del 70% de la proyección.
BUST_FRACTION = 0.70

FEATURES = ("risk_sample", "risk_shrink", "risk_touchdown", "missed_rate")

# Etiquetas por probabilidad. Los cortes son absolutos y no percentiles: una
# probabilidad ya está en una escala interpretable, y trocearla por percentiles
# garantizaría que un tercio del board salga marcado como frágil aunque el año
# sea tranquilo — que es justo el defecto que tenía la primera versión del aviso
# de «muestra corta».
BUST_CUTS = (0.30, 0.50)
BUST_LABELS = ("Sólido", "Normal", "Frágil")


def label(probability: float) -> str:
    low, high = BUST_CUTS
    if probability < low:
        return BUST_LABELS[0]
    if probability >= high:
        return BUST_LABELS[2]
    return BUST_LABELS[1]


def fit(train: pd.DataFrame) -> LogisticRegression:
    """Ajusta sobre jugador-temporadas con columna `bust` ya observada."""
    matrix = train[list(FEATURES)].to_numpy(dtype=float)
    target = train["bust"].to_numpy(dtype=int)
    # `liblinear` con regularización suave: cuatro coeficientes sobre miles de
    # casos no necesita más, y una L2 floja evita que una temporada rara mande.
    model = LogisticRegression(C=1.0, solver="liblinear", max_iter=1000)
    model.fit(matrix, target)
    return model


def predict(model: LogisticRegression, frame: pd.DataFrame) -> np.ndarray:
    matrix = frame[list(FEATURES)].to_numpy(dtype=float)
    return model.predict_proba(matrix)[:, 1]


def expected_calibration_error(
    probability: np.ndarray, outcome: np.ndarray, bins: int = 10
) -> float:
    """ECE sobre deciles de probabilidad predicha.

    Es la misma métrica que el modelo de partidos publica para su probabilidad
    de victoria, y por el mismo motivo: para decidir, importa más que el número
    signifique lo que dice que el orden sea perfecto.
    """
    frame = pd.DataFrame({"p": probability, "y": outcome})
    frame["bin"] = pd.qcut(frame["p"], bins, labels=False, duplicates="drop")
    total = 0.0
    for _, group in frame.groupby("bin", observed=True):
        weight = len(group) / len(frame)
        total += weight * abs(group["p"].mean() - group["y"].mean())
    return float(total)
