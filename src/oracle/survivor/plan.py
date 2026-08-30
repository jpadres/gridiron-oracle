"""El cálculo del survivor: matriz de probabilidades, plan óptimo y coste de quemar.

Ver `oracle/survivor/__init__.py` para el porqué. Aquí está el cómo.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

# Coste que se le pone a una casilla imposible (bye, equipo ya gastado). No es
# infinito porque el húngaro necesita una matriz finita; es lo bastante grande
# como para que el solucionador sólo la toque si no queda absolutamente nada,
# caso que no se da con 32 equipos y 18 jornadas.
IMPOSSIBLE = 1e6

# Suelo de probabilidad. Un 0 exacto daría log(0) = -inf y rompería la suma; y
# ninguna probabilidad de este modelo es realmente cero.
FLOOR = 1e-6


@dataclass
class Plan:
    """Un camino completo: qué equipo en cada jornada y con qué supervivencia."""

    picks: list[dict] = field(default_factory=list)
    survival: float = 0.0

    def teams(self) -> list[str]:
        return [pick["team"] for pick in self.picks]


def win_probabilities(predictions: pd.DataFrame) -> pd.DataFrame:
    """Pasa los pronósticos de partido a una fila por equipo y jornada.

    Un partido son dos filas: cada equipo con su probabilidad de ganarlo. Es la
    forma que necesita la matriz, y además hace evidente que la de un equipo y
    la de su rival suman uno.
    """
    home = predictions.assign(
        team=predictions["home_team"],
        opponent=predictions["away_team"],
        home=True,
        win_prob=predictions["home_win_prob"],
    )
    away = predictions.assign(
        team=predictions["away_team"],
        opponent=predictions["home_team"],
        home=False,
        win_prob=1.0 - predictions["home_win_prob"],
    )
    columns = ["season", "week", "team", "opponent", "home", "win_prob"]
    frame = pd.concat([home[columns], away[columns]], ignore_index=True)
    return frame.sort_values(["week", "win_prob"], ascending=[True, False]).reset_index(drop=True)


def probability_matrix(
    frame: pd.DataFrame, weeks: list[int] | None = None, teams: list[str] | None = None
) -> tuple[np.ndarray, list[int], list[str]]:
    """Matriz [jornada x equipo] con la probabilidad de ganar. NaN si no juega.

    NaN y no cero: «no juega esa semana» y «juega y pierde seguro» son cosas
    distintas, y confundirlas haría que el solucionador tratara una semana de
    descanso como una derrota casi segura en vez de como una casilla prohibida.
    """
    weeks = weeks if weeks is not None else sorted(frame["week"].unique())
    teams = teams if teams is not None else sorted(frame["team"].unique())
    matrix = np.full((len(weeks), len(teams)), np.nan)
    week_index = {week: i for i, week in enumerate(weeks)}
    team_index = {team: j for j, team in enumerate(teams)}
    for row in frame.itertuples():
        i = week_index.get(row.week)
        j = team_index.get(row.team)
        if i is not None and j is not None:
            matrix[i, j] = row.win_prob
    return matrix, list(weeks), list(teams)


def best_plan(
    matrix: np.ndarray,
    weeks: list[int],
    teams: list[str],
    *,
    used: set[str] | None = None,
    forced: tuple[int, str] | None = None,
) -> Plan:
    """El camino que maximiza la probabilidad de sobrevivir todas las jornadas.

    `used` son equipos ya gastados en jornadas anteriores. `forced` obliga a una
    (jornada, equipo) concreta, que es lo que permite medir cuánto cuesta
    quemar a alguien hoy.

    Se maximiza la suma de logaritmos y no el producto directo: multiplicar
    dieciocho probabilidades pequeñas se va al subdesbordamiento, y además el
    húngaro necesita un objetivo aditivo.
    """
    used = used or set()
    costs = np.full(matrix.shape, IMPOSSIBLE)
    playable = ~np.isnan(matrix)
    costs[playable] = -np.log(np.clip(matrix[playable], FLOOR, 1.0))

    for j, team in enumerate(teams):
        if team in used:
            costs[:, j] = IMPOSSIBLE

    if forced is not None:
        week, team = forced
        i = weeks.index(week)
        j = teams.index(team)
        if not playable[i, j]:
            return Plan(picks=[], survival=0.0)
        # Se fuerza abaratando esa casilla por debajo de cualquier otra y
        # cerrando el resto de su fila: el óptimo pasa por ahí sí o sí.
        costs[i, :] = IMPOSSIBLE
        costs[i, j] = -np.log(max(matrix[i, j], FLOOR))

    rows, columns = linear_sum_assignment(costs)

    picks: list[dict] = []
    total_log = 0.0
    for i, j in zip(rows, columns, strict=True):
        if costs[i, j] >= IMPOSSIBLE:
            # Jornada sin ningún equipo disponible: el plan no llega hasta el
            # final y hay que decirlo, no fingir que sí.
            return Plan(picks=picks, survival=0.0)
        picks.append({
            "week": int(weeks[i]),
            "team": teams[j],
            "win_prob": float(matrix[i, j]),
        })
        total_log += float(np.log(max(matrix[i, j], FLOOR)))

    picks.sort(key=lambda pick: pick["week"])
    return Plan(picks=picks, survival=float(np.exp(total_log)))


def week_board(
    matrix: np.ndarray,
    weeks: list[int],
    teams: list[str],
    week: int,
    *,
    used: set[str] | None = None,
) -> list[dict]:
    """Los candidatos de una jornada, ordenados por lo que importa de verdad.

    Y lo que importa no es la probabilidad de esta semana: es la supervivencia
    del mejor plan **completo** que empiece usando a ese equipo hoy. Un favorito
    del 78% que además es tu única salida sólida en la jornada 12 puede ser peor
    elección que uno del 74% al que no vas a echar de menos.

    `cost` es exactamente eso, en puntos de probabilidad: cuánto pierdes por
    gastar a ese equipo hoy en vez de al mejor momento.
    """
    used = used or set()
    reference = best_plan(matrix, weeks, teams, used=used)
    row = weeks.index(week)

    board = []
    for j, team in enumerate(teams):
        probability = matrix[row, j]
        if np.isnan(probability) or team in used:
            continue
        plan = best_plan(matrix, weeks, teams, used=used, forced=(week, team))
        cost = float(reference.survival - plan.survival)
        board.append({
            "team": team,
            "win_prob": float(probability),
            "survival_if_used": plan.survival,
            "cost": cost,
            # El coste RELATIVO, que es el único legible.
            #
            # En absoluto, gastar hoy a un equipo cuesta 0,0008 de probabilidad y
            # se pinta como «−0,1%», que se lee como «da igual». Pero el plan
            # entero sobrevive con un 0,81%, así que esos 0,0008 son **el 10% de
            # todo lo que tienes**. El número siempre estuvo bien calculado; era
            # la escala la que lo hacía invisible.
            "cost_relative": (
                cost / reference.survival if reference.survival > FLOOR else 0.0
            ),
            "plan": [pick["team"] for pick in plan.picks],
        })

    board.sort(key=lambda entry: -entry["survival_if_used"])
    for rank, entry in enumerate(board, start=1):
        entry["rank"] = rank
        entry["advice"], entry["advice_why"] = _advice(entry)
    return board


# Umbrales de la recomendación. Salen de la forma real del board, no de números
# redondos: con 18 jornadas y 32 equipos, el coste relativo del mejor candidato
# ronda el 0% y el de un equipo valioso pero prescindible hoy pasa del 15%.
SAFE_ENOUGH = 0.65      # por debajo de esto, ganar hoy ya no está asegurado
EXPENSIVE = 0.15        # por encima, quemarlo hoy se lleva un pellizco del plan


def _advice(entry: dict) -> tuple[str, str]:
    """PICK / SAVE / AVOID, con el motivo en una frase.

    Las tres salen de cruzar las dos cantidades que ya están calculadas —lo
    probable que es ganar hoy y lo que cuesta gastar a ese equipo hoy— y no
    añaden ninguna información nueva. Su valor es que ahorran hacer el cruce
    mentalmente treinta y dos veces.
    """
    # Se decide sobre el valor REDONDEADO, el mismo que se pinta.
    #
    # Con el valor crudo, dos equipos que la tabla enseña como «65%» pueden caer
    # a lados distintos del corte y salir uno con GUARDAR y otro con EVITAR. El
    # umbral seguiría siendo defendible y la fila, indefendible: nadie puede
    # creerse una tabla donde el mismo número lleva a consejos opuestos.
    win = round(entry["win_prob"], 2)
    relative = round(entry["cost_relative"], 2)

    if win < SAFE_ENOUGH:
        return "AVOID", f"only wins {win:.0%}: too much risk for an elimination pool"
    if relative > EXPENSIVE:
        return "SAVE", (
            f"safe today ({win:.0%}), but spending them costs {relative:.0%} "
            "of your plan: you need them later"
        )
    return "PICK", (
        f"wins {win:.0%} and is barely needed later "
        f"(costs {relative:.0%} of the plan)"
    )
