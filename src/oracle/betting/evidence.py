"""Qué le pasó históricamente a las apuestas que se parecían a ésta.

## Por qué esto sustituye a «confianza»

El dueño pidió categorías tipo «Best Bets» y un indicador de confianza, con una
condición: que no fueran números inventados. Se midió, con el umbral fijado antes
en `docs/PREREGISTRO_confianza.md`, y el resultado es que **no se puede**:

    discrepancia    n      acierto    IC 95%
    0–1 pts       2189      49,3%     [47,2%, 51,4%]
    1–2 pts       1173      50,9%     [48,0%, 53,8%]
    2–3,5 pts      346      48,8%     [43,6%, 54,1%]
                                       equilibrio: 52,4%

Ningún tramo supera el equilibrio, y —lo que más informa— **el acierto no sube
con la discrepancia**. Que el modelo se separe más de la línea no predice acertar
más. Eso refuta directamente la idea de construir confianza a partir del edge,
que era el camino evidente.

Así que la sección no publica confianza. Publica **la ficha histórica de la clase
a la que pertenece cada apuesta**, que es la única afirmación que los datos
sostienen. Y esa ficha casi siempre dice que no apuestes, porque es lo que dicen
los datos.

## Por qué en puntos y no en probabilidad

Los tramos se definen sobre `|pred_margin − spread_line|`, en puntos, que es la
misma cantidad con la que `summarize_ats` produce el 49,81% publicado. Convertir
a probabilidad antes de trocear añade un paso —la distribución de márgenes— que
mete su propio error en la definición del tramo, y encima hace el número menos
legible: «el modelo discrepa 1,8 puntos de la línea» se entiende sin explicación.
"""

from __future__ import annotations

from dataclasses import dataclass

# Equilibrio a cuota −110: 11 aciertos de 21 para no perder dinero.
BREAKEVEN = 110 / 210

# Medido por `scripts/betting_confidence_validate.py` sobre el walk-forward
# 2012-2025, con los tramos fijados antes de mirar. Si se reejecuta y cambian,
# **hay que actualizar esta tabla**: es lo que la web cita como evidencia, y una
# cita que no corresponde a la medición es peor que no citar nada.
#
# El tramo de 3,5+ puntos existe pero tiene 28 casos en catorce temporadas. No se
# publica su tasa: con esa n, el intervalo es tan ancho que decir «59%» sería
# afirmar algo que la muestra no sostiene. Se dice que no hay evidencia.
BUCKETS = (
    {"low": 0.0, "high": 1.0, "bets": 2189, "win_rate": 0.493,
     "ci_low": 0.472, "ci_high": 0.514},
    {"low": 1.0, "high": 2.0, "bets": 1173, "win_rate": 0.509,
     "ci_low": 0.480, "ci_high": 0.538},
    {"low": 2.0, "high": 3.5, "bets": 346, "win_rate": 0.488,
     "ci_low": 0.436, "ci_high": 0.541},
)

# Por debajo de esto no se publica una tasa. Veintiocho casos repartidos en
# catorce temporadas no son una base para nada.
MIN_SAMPLE = 100


@dataclass(frozen=True)
class Evidence:
    """La ficha histórica de una clase de apuesta."""

    disagreement: float
    label: str
    bets: int | None
    win_rate: float | None
    ci_low: float | None
    ci_high: float | None
    beats_breakeven: bool
    verdict: str


def lookup(disagreement: float) -> Evidence:
    """La clase histórica a la que pertenece una discrepancia dada, en puntos."""
    magnitude = abs(float(disagreement))
    for bucket in BUCKETS:
        if bucket["low"] <= magnitude < bucket["high"]:
            beats = bucket["ci_low"] > BREAKEVEN
            return Evidence(
                disagreement=magnitude,
                label=f"{bucket['low']:.0f}–{bucket['high']:.1f} pts".replace(".0 pts", " pts"),
                bets=bucket["bets"],
                win_rate=bucket["win_rate"],
                ci_low=bucket["ci_low"],
                ci_high=bucket["ci_high"],
                beats_breakeven=beats,
                verdict="rentable" if beats else "por debajo del equilibrio",
            )
    # Fuera de los tramos medidos: discrepancias grandes, que casi no existen.
    # El percentil 99 de catorce temporadas es 3,27 puntos.
    return Evidence(
        disagreement=magnitude,
        label=f"más de {BUCKETS[-1]['high']:.1f} pts",
        bets=None,
        win_rate=None,
        ci_low=None,
        ci_high=None,
        beats_breakeven=False,
        verdict="sin evidencia suficiente",
    )
