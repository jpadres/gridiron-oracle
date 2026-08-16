"""Reglas de puntuación configurables.

La puntuación no es un detalle de presentación: **cambia el ranking**. En PPR
completo un receptor de volumen con 90 recepciones cortas vale más que un
corredor de 1.100 yardas; en puntuación estándar, al revés. Un board calculado
con las reglas equivocadas no es "aproximadamente correcto", es un board de otra
liga.

Por eso las reglas son un parámetro explícito en todas partes y no hay una
constante escondida a mitad del cálculo.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class ScoringRules:
    """Puntos por unidad de estadística."""

    passing_yards: float = 0.04  # 1 punto cada 25 yardas
    passing_td: float = 4.0
    interception: float = -2.0
    rushing_yards: float = 0.1
    rushing_td: float = 6.0
    receiving_yards: float = 0.1
    receiving_td: float = 6.0
    reception: float = 1.0
    fumble_lost: float = -2.0
    two_point: float = 2.0
    # Bonus por partido de 300/100 yardas: existen en algunas ligas y desplazan
    # el valor hacia los jugadores de techo alto. Por defecto, cero.
    passing_300_bonus: float = 0.0
    rushing_100_bonus: float = 0.0
    receiving_100_bonus: float = 0.0


PPR = ScoringRules()
HALF_PPR = ScoringRules(reception=0.5)
STANDARD = ScoringRules(reception=0.0)


# Nombres de columna de nflverse -> atributo de las reglas. Se mantiene aquí y
# no en línea para que añadir un mercado nuevo sea una fila, no una expresión.
_STAT_COLUMNS: dict[str, str] = {
    "passing_yards": "passing_yards",
    "passing_tds": "passing_td",
    "interceptions": "interception",
    "rushing_yards": "rushing_yards",
    "rushing_tds": "rushing_td",
    "receiving_yards": "receiving_yards",
    "receiving_tds": "receiving_td",
    "receptions": "reception",
}


def score_player_weeks(stats: pd.DataFrame, rules: ScoringRules = PPR) -> pd.Series:
    """Puntos de fantasy por fila (jugador-semana).

    Las columnas que falten se tratan como cero: nflverse cambia de esquema
    entre temporadas antiguas y recientes, y fallar por una columna que no
    existía en 2003 dejaría fuera veinte años de historia por nada.
    """
    points = pd.Series(0.0, index=stats.index)

    for column, attribute in _STAT_COLUMNS.items():
        if column in stats.columns:
            points += stats[column].fillna(0.0) * getattr(rules, attribute)

    # Las pérdidas de balón vienen repartidas en varias columnas según la
    # temporada; se suman todas las que estén presentes.
    for column in ("rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"):
        if column in stats.columns:
            points += stats[column].fillna(0.0) * rules.fumble_lost

    for column in ("passing_2pt_conversions", "rushing_2pt_conversions",
                   "receiving_2pt_conversions"):
        if column in stats.columns:
            points += stats[column].fillna(0.0) * rules.two_point

    if rules.passing_300_bonus and "passing_yards" in stats.columns:
        points += (stats["passing_yards"].fillna(0) >= 300) * rules.passing_300_bonus
    if rules.rushing_100_bonus and "rushing_yards" in stats.columns:
        points += (stats["rushing_yards"].fillna(0) >= 100) * rules.rushing_100_bonus
    if rules.receiving_100_bonus and "receiving_yards" in stats.columns:
        points += (stats["receiving_yards"].fillna(0) >= 100) * rules.receiving_100_bonus

    return points


def rules_from_name(name: str) -> ScoringRules:
    presets = {"ppr": PPR, "half": HALF_PPR, "half-ppr": HALF_PPR, "standard": STANDARD}
    key = name.strip().lower()
    if key not in presets:
        raise ValueError(f"Puntuación desconocida: {name!r}. Usa {sorted(presets)}.")
    return presets[key]
