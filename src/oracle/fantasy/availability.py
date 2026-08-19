"""Tasa de ausencia de un jugador: cuántos partidos de su equipo se pierde.

## Qué mide y qué NO mide

Mide la fracción de partidos de temporada regular de su equipo en los que el
jugador **no aparece en los datos**. Nada más.

No es un parte médico. Un jugador puede no aparecer por lesión, por ser suplente,
por estar inactivo o por una suspensión, y `player_weeks` no los distingue: una
fila existe cuando el jugador registró estadística. Llamar a esto «riesgo de
lesión» sería vender un diagnóstico clínico que estos datos no contienen — y en
la misma fila del board ya hay una etiqueta de disponibilidad que **sí** viene de
un parte real (el dossier), así que confundirlas sería especialmente caro.

Para fantasy la distinción importa menos de lo que parece: un partido sin
producción y un partido sin jugar valen lo mismo en tu alineación. Por eso la
señal sirve aunque su causa sea ambigua. Pero se nombra por lo que es.

## Por qué se encoge

Un jugador con una temporada de historial y un partido perdido tiene una tasa
observada del 6%, y eso no es información: es ruido con dos decimales. La tasa
se encoge hacia la media de su posición con el mismo prior de partidos que usa
la proyección, por el mismo motivo.

## Validación

`scripts/fantasy_availability_validate.py`, con el umbral fijado en
`docs/PREREGISTRO_riesgo.md` antes de ejecutarlo. El comentario de
`draft.PROJECTED_GAMES` afirma que las lesiones pasadas predicen las futuras
«mucho peor de lo que se cree»; esa afirmación es comprobable y este módulo
existe para comprobarla, no para asumirla.
"""

from __future__ import annotations

import pandas as pd

# Mismo 56/30/14 que la proyección: si la ausencia se ponderase distinto que los
# puntos, dos números de la misma fila estarían mirando ventanas distintas del
# historial y la comparación entre ellos dejaría de significar nada.
SEASON_WEIGHTS = (0.56, 0.30, 0.14)

# Mismo prior que `draft.SHRINK_PRIOR_GAMES`, y por la misma razón: con menos de
# media temporada de historial la tasa publicada debe ser esencialmente la de su
# posición.
SHRINK_PRIOR_GAMES = 10.0


def season_availability(
    player_weeks: pd.DataFrame, team_games: pd.DataFrame
) -> pd.DataFrame:
    """Partidos disponibles y jugados por jugador-temporada.

    El denominador es el calendario del **equipo**, no 17 fijo: las temporadas
    cortas (1999-2020 tenían 16) y los equipos con partidos no jugados darían
    ausencias inventadas. Es el mismo error de denominador que ya se cometió una
    vez en `fantasy/weekly.py` sumando medias condicionales, y que se descubrió
    dibujando la gráfica.
    """
    regular = player_weeks[player_weeks["season_type"] == "REG"]
    schedule = (
        team_games[team_games["game_type"] == "REG"]
        if "game_type" in team_games.columns
        else team_games
    )
    # `played` llega como 0/1, no como bool: indexar con la columna cruda
    # explota con un KeyError de enteros en vez de filtrar.
    played = (
        schedule[schedule["played"].astype(bool)]
        if "played" in schedule.columns
        else schedule
    )

    team_size = (
        played.groupby(["season", "team"], observed=True)["game_id"]
        .nunique()
        .rename("team_games")
        .reset_index()
    )

    appearances = (
        regular.groupby(["season", "player_id", "team"], observed=True)["game_id"]
        .nunique()
        .rename("appearances")
        .reset_index()
    )

    # Un jugador traspasado a mitad de temporada aparece con dos equipos. Su
    # denominador es la suma de los partidos que **le quedaban** en cada uno, y
    # eso no se puede reconstruir sin fechas de traspaso. Se usa el equipo donde
    # más jugó y se acota el resultado: preferimos subestimar la ausencia de un
    # traspasado a inventarle una del 50%.
    primary = appearances.sort_values("appearances").groupby(
        ["season", "player_id"], observed=True
    ).tail(1)
    total = appearances.groupby(["season", "player_id"], observed=True)["appearances"].sum()

    frame = primary.merge(team_size, on=["season", "team"], how="left")
    frame["appearances"] = frame.set_index(["season", "player_id"]).index.map(total)
    frame["team_games"] = frame["team_games"].fillna(0.0)
    frame = frame[frame["team_games"] > 0].copy()
    frame["missed_share"] = (
        1.0 - frame["appearances"] / frame["team_games"]
    ).clip(lower=0.0, upper=1.0)
    return frame[["season", "player_id", "team", "appearances", "team_games", "missed_share"]]


def history(
    availability: pd.DataFrame,
    positions: pd.Series,
    season: int,
) -> pd.DataFrame:
    """Tasa de ausencia ponderada y encogida, usando **sólo** temporadas < season.

    `positions` mapea player_id -> posición y sirve para el encogimiento. Un
    jugador sin posición conocida se encoge hacia la media global, que es lo
    conservador.
    """
    past = availability[availability["season"] < season]
    if past.empty:
        return pd.DataFrame(
            columns=["player_id", "missed_rate", "missed_games", "availability_sample"]
        )

    rows = []
    for offset, weight in enumerate(SEASON_WEIGHTS):
        chunk = past[past["season"] == season - 1 - offset]
        if chunk.empty:
            continue
        piece = chunk[["player_id", "missed_share", "team_games"]].copy()
        piece["weight"] = weight
        rows.append(piece)
    if not rows:
        return pd.DataFrame(
            columns=["player_id", "missed_rate", "missed_games", "availability_sample"]
        )

    stacked = pd.concat(rows, ignore_index=True)
    stacked["weighted_games"] = stacked["team_games"] * stacked["weight"]
    stacked["weighted_missed"] = stacked["missed_share"] * stacked["weighted_games"]

    grouped = stacked.groupby("player_id", observed=True).agg(
        weighted_games=("weighted_games", "sum"),
        weighted_missed=("weighted_missed", "sum"),
    )
    grouped = grouped[grouped["weighted_games"] > 0]
    raw = grouped["weighted_missed"] / grouped["weighted_games"]

    position = grouped.index.map(positions).to_series(index=grouped.index).fillna("__all__")
    means = raw.groupby(position).mean()
    global_mean = float(raw.mean())
    prior = position.map(means).astype(float).fillna(global_mean)

    reliability = grouped["weighted_games"] / (grouped["weighted_games"] + SHRINK_PRIOR_GAMES)
    shrunk = reliability * raw + (1.0 - reliability) * prior

    out = pd.DataFrame(
        {
            "player_id": grouped.index,
            "missed_rate": shrunk.to_numpy(),
            "missed_rate_raw": raw.to_numpy(),
            "availability_sample": grouped["weighted_games"].to_numpy(),
        }
    )
    # Partidos que se espera que pierda de una temporada de 17.
    out["missed_games"] = out["missed_rate"] * 17.0
    return out.reset_index(drop=True)
