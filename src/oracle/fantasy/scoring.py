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

from collections.abc import Mapping
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

    # Valor de la recepción por posición, cuando la liga no lo paga igual a
    # todos. El caso corriente es el «TE premium»: 1,5 puntos por recepción de
    # ala cerrada y 1 para el resto, que cambia el ranking de la posición
    # entera y no es un matiz — un ala cerrada de 80 recepciones pasa de valer
    # como un WR3 a valer como un WR1.
    #
    # `None` significa «todos igual, según `reception`». Un diccionario sólo
    # necesita las posiciones que se apartan: `{"TE": 1.5}` deja QB, RB y WR en
    # el valor general.
    reception_by_position: Mapping[str, float] | None = None

    def reception_value(self, position: object) -> float:
        """Puntos por recepción de esa posición."""
        if not self.reception_by_position:
            return self.reception
        return self.reception_by_position.get(str(position).upper(), self.reception)


PPR = ScoringRules()
HALF_PPR = ScoringRules(reception=0.5)
STANDARD = ScoringRules(reception=0.0)
# El premium más extendido. Se deja como preset porque escribirlo a mano en cada
# sitio es la forma de que un día alguien ponga 1.0 y no se entere nadie.
TE_PREMIUM = ScoringRules(reception_by_position={"TE": 1.5})


# Nombres de columna de nflverse -> atributo de las reglas. Se mantiene aquí y
# no en línea para que añadir un mercado nuevo sea una fila, no una expresión.
#
# `passing_interceptions` e `interceptions` son el mismo dato con dos nombres:
# nflverse lo renombró al pasar de `player_stats` a `stats_player_week`. Están
# los dos porque el histórico descargado puede mezclar ambos esquemas, y sólo
# se suma el que exista — nunca los dos a la vez (ver el aserto de abajo).
_STAT_COLUMNS: dict[str, str] = {
    "passing_yards": "passing_yards",
    "passing_tds": "passing_td",
    "passing_interceptions": "interception",
    "interceptions": "interception",
    "rushing_yards": "rushing_yards",
    "rushing_tds": "rushing_td",
    "receiving_yards": "receiving_yards",
    "receiving_tds": "receiving_td",
}

# Grupos de alias: si un DataFrame trajese los dos nombres, sumar ambos contaría
# las intercepciones dos veces y penalizaría a los quarterbacks el doble.
_ALIAS_GROUPS: tuple[tuple[str, ...], ...] = (("passing_interceptions", "interceptions"),)


def regular_season(player_weeks: pd.DataFrame) -> pd.DataFrame:
    """Sólo temporada regular: la que la fantasy puntúa.

    `player_weeks` trae también los playoffs (20.004 filas de `season_type ==
    "POST"`), y hasta el 5 de septiembre de 2026 entraban en la proyección de
    draft, en la semanal y en la del pateador sin que nada los filtrara. Sólo
    `availability.py` y `rookies.py` lo hacían, cada uno por su cuenta.

    Medido antes de arreglarlo, sobre la proyección 2026 en PPR: 347 de 858
    jugadores cambian más de medio punto, **106 de los 150 primeros cambian de
    puesto** (hasta 21 puestos), y los que más bajan son justo los de equipos
    que llegan lejos en enero — Walker 173,7 → 162,4, Nacua 241,6 → 232,4,
    Barkley 205,4 → 197,5, Allen 287,9 → 281,3. Cuatro partidos de playoffs
    prestaban muestra y puntos a una proyección que se paga en las 17 jornadas
    de la temporada regular, y sólo a quien los había jugado.

    No es una decisión de modelado que alguien validara: era una unión sin
    filtrar. Una liga de fantasy es una competición de temporada regular y el
    historial tiene que ser de la misma competición que predice.
    """
    if "season_type" not in player_weeks.columns:
        return player_weeks
    return player_weeks[player_weeks["season_type"] == "REG"]


def score_player_weeks(stats: pd.DataFrame, rules: ScoringRules = PPR) -> pd.Series:
    """Puntos de fantasy por fila (jugador-semana).

    Las columnas que falten se tratan como cero: nflverse cambia de esquema
    entre temporadas antiguas y recientes, y fallar por una columna que no
    existía en 2003 dejaría fuera veinte años de historia por nada.
    """
    points = pd.Series(0.0, index=stats.index)

    skip = _redundant_aliases(stats.columns)
    for column, attribute in _STAT_COLUMNS.items():
        if column in stats.columns and column not in skip:
            points += stats[column].fillna(0.0) * getattr(rules, attribute)

    points += _reception_points(stats, rules)

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


def _reception_points(stats: pd.DataFrame, rules: ScoringRules) -> pd.Series:
    """Puntos por recepción, con el valor de cada posición si la liga lo distingue.

    Si la liga paga la recepción por posición y el DataFrame no trae `position`,
    esto **revienta** en vez de aplicar el valor general. Es el mismo criterio
    que `UnmappedScoring` en el cliente de Sleeper: un board de TE premium
    calculado como PPR normal no es aproximado, es de otra liga, y el ala
    cerrada que decide tu draft aparecería veinte puestos más abajo.
    """
    if "receptions" not in stats.columns:
        return pd.Series(0.0, index=stats.index)

    receptions = stats["receptions"].fillna(0.0)
    if not rules.reception_by_position:
        return receptions * rules.reception

    if "position" not in stats.columns:
        raise ValueError(
            "Estas reglas pagan la recepción por posición "
            f"({dict(rules.reception_by_position)}) y las estadísticas no traen "
            "`position`. Sin ella el premium se perdería en silencio."
        )
    values = stats["position"].map(rules.reception_value).astype(float)
    return receptions * values


def _redundant_aliases(columns) -> set[str]:
    """De cada grupo de alias presente, conserva el primero y descarta el resto.

    Sin esto, un DataFrame que mezcle esquemas de nflverse (por ejemplo tras
    concatenar temporadas descargadas antes y después del renombrado) sumaría
    las intercepciones dos veces.
    """
    present = set(columns)
    skip: set[str] = set()
    for group in _ALIAS_GROUPS:
        found = [c for c in group if c in present]
        skip.update(found[1:])
    return skip


def rules_from_name(name: str) -> ScoringRules:
    presets = {
        "ppr": PPR, "half": HALF_PPR, "half-ppr": HALF_PPR, "standard": STANDARD,
        "te-premium": TE_PREMIUM, "te_premium": TE_PREMIUM,
    }
    key = name.strip().lower()
    if key not in presets:
        raise ValueError(f"Puntuación desconocida: {name!r}. Usa {sorted(presets)}.")
    return presets[key]
