"""Componentes canónicos: la proyección antes de convertirse en puntos.

## El problema que resuelve

Hasta ahora la proyección fundamental era **un número de puntos**, calculado con
unas reglas concretas en el momento de construir el board. Un número así no se
puede reinterpretar: si tu liga paga media recepción, no hay forma de recuperar
cuántas recepciones había dentro de esos puntos.

Aquí la unidad fundamental pasa a ser el **componente de fútbol** —yardas, TD,
recepciones— y los puntos son una función de (componentes × reglas). Lo que se
publica son los componentes; la puntuación se compila después, por liga.

## Por qué esto es exacto y no una aproximación

La puntuación de fantasy es **lineal** en las estadísticas:

    puntos(semana) = Σ coeficiente_i × estadística_i(semana)

Y la media es lineal. Así que la media ponderada de los puntos semanales es
idéntica a puntuar las medias ponderadas de cada componente:

    media(Σ cᵢ·xᵢ) = Σ cᵢ·media(xᵢ)

No es una aproximación que salga «parecida»: es la misma cantidad, y por eso el
test de equivalencia exige diferencia **cero**, no una tolerancia.

## Dónde deja de ser exacto, dicho antes de que sorprenda

Los **bonus por partido** (300 yardas de pase, 100 de carrera) no son lineales:
dependen de la distribución semana a semana, no de la media. Un jugador con dos
partidos de 150 y ocho de 40 promedia 62 y cobra dos bonus; otro con diez de 62
promedia lo mismo y no cobra ninguno. Desde las medias no se puede saber.

Por eso `compile_points` **avisa** cuando la liga tiene bonus activos en vez de
devolver un número que parece exacto y no lo es. La alternativa —ignorarlos en
silencio— produce un board equivocado justo en los jugadores de techo alto, que
es donde más se nota.

## Lo que NO hay

No hay componentes de pateador ni de defensa. El modelo no proyecta ninguna de
las dos posiciones (`KICKER_ORDINAL_RANKING` está REJECTED y `DST_STREAMING` es
DESIGN_ONLY), así que publicar sus componentes sería publicar ceros con nombre
de dato.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .scoring import ScoringRules

# Los diez componentes que la puntuación toca. Cada uno es una **media por
# partido ponderada por antigüedad**, en la misma escala que `points_per_game`.
#
# El orden importa sólo para la legibilidad del payload; el cálculo va por
# nombre. Añadir uno exige tocar `COEFFICIENTS` a la vez, y hay un test que lo
# comprueba: un componente sin coeficiente se sumaría como cero en silencio.
COMPONENTS: tuple[str, ...] = (
    "passing_yards",
    "passing_tds",
    "interceptions",
    "rushing_yards",
    "rushing_tds",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "fumbles_lost",
    "two_point_conversions",
)

# Componente -> atributo de `ScoringRules`. `receptions` no está: su coeficiente
# depende de la posición (TE premium) y se resuelve aparte.
COEFFICIENTS: dict[str, str] = {
    "passing_yards": "passing_yards",
    "passing_tds": "passing_td",
    "interceptions": "interception",
    "rushing_yards": "rushing_yards",
    "rushing_tds": "rushing_td",
    "receiving_yards": "receiving_yards",
    "receiving_tds": "receiving_td",
    "fumbles_lost": "fumble_lost",
    "two_point_conversions": "two_point",
}

# Las columnas de nflverse que componen cada componente. Varias se suman: las
# pérdidas de balón y las conversiones de dos puntos vienen repartidas por tipo
# de jugada, y sumarlas aquí es lo que hace que el componente sea uno solo.
#
# `passing_interceptions` e `interceptions` son el mismo dato con dos nombres —
# nflverse lo renombró—, así que se toma **el primero que exista**, nunca los
# dos: sumarlos penalizaría a los quarterbacks el doble.
SOURCES: dict[str, tuple[str, ...]] = {
    "passing_yards": ("passing_yards",),
    "passing_tds": ("passing_tds",),
    "interceptions": ("passing_interceptions", "interceptions"),
    "rushing_yards": ("rushing_yards",),
    "rushing_tds": ("rushing_tds",),
    "receptions": ("receptions",),
    "receiving_yards": ("receiving_yards",),
    "receiving_tds": ("receiving_tds",),
    "fumbles_lost": ("rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"),
    "two_point_conversions": (
        "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions",
    ),
}

# Los componentes cuyas columnas son ALIAS del mismo dato: se toma una, no la
# suma. Sin esto, un histórico que mezcle los dos esquemas de nflverse contaría
# las intercepciones dos veces.
ALIASED: frozenset[str] = frozenset({"interceptions"})


def component_series(frame: pd.DataFrame, component: str) -> pd.Series:
    """El valor por fila de un componente, sumando o eligiendo alias según toque."""
    columns = [c for c in SOURCES[component] if c in frame.columns]
    if not columns:
        # Una columna que no existía en 2003 no puede tumbar veinte años de
        # historia: cuenta como cero, igual que en `score_player_weeks`.
        return pd.Series(0.0, index=frame.index)
    if component in ALIASED:
        return frame[columns[0]].fillna(0.0).astype(float)
    total = pd.Series(0.0, index=frame.index)
    for column in columns:
        total = total + frame[column].fillna(0.0).astype(float)
    return total


def weighted_components(frame: pd.DataFrame, weights: np.ndarray) -> dict[str, float]:
    """Media por partido de cada componente, ponderada por antigüedad."""
    total = float(np.sum(weights))
    if total <= 0:
        return dict.fromkeys(COMPONENTS, 0.0)
    return {
        name: float((component_series(frame, name).to_numpy(dtype=float) * weights).sum() / total)
        for name in COMPONENTS
    }


class BonusesNotSupported(ValueError):
    """La liga paga bonus por partido y desde las medias no se pueden calcular."""


def compile_points(
    components: pd.DataFrame,
    rules: ScoringRules,
    positions: pd.Series | None = None,
    *,
    strict: bool = True,
) -> pd.Series:
    """Puntos por partido a partir de los componentes y las reglas de una liga.

    Es el compilador: **una sola** función que convierte componentes en puntos, y
    la única que conoce las reglas. Todo lo demás del pipeline trabaja con
    componentes o con puntos ya compilados, nunca con las dos cosas a la vez.
    """
    if strict and (
        rules.passing_300_bonus or rules.rushing_100_bonus or rules.receiving_100_bonus
    ):
        raise BonusesNotSupported(
            "Esta liga paga bonus por partido (300/100 yardas). Dependen de la "
            "distribución semanal, no de la media, así que no se pueden calcular "
            "desde los componentes. Falla en vez de devolver un número que parece "
            "exacto y no lo es."
        )

    points = pd.Series(0.0, index=components.index)
    for name, attribute in COEFFICIENTS.items():
        if name in components.columns:
            points = points + components[name].fillna(0.0) * getattr(rules, attribute)

    if "receptions" in components.columns:
        receptions = components["receptions"].fillna(0.0)
        if rules.reception_by_position and positions is not None:
            # El valor de la recepción por posición: el TE premium cambia el
            # ranking de la posición entera, no un matiz.
            value = positions.map(lambda p: rules.reception_value(p)).astype(float)
            points = points + receptions * value
        else:
            points = points + receptions * rules.reception
    return points
