#!/usr/bin/env python3
"""Qué significa AUSENTE en `player_weeks`, por posición.

`availability.py` mide la fracción de partidos de su equipo en los que un
jugador **no aparece en los datos**, y trata igual cuatro cosas distintas:
lesión, inactivo por decisión técnica, suplente que no juega, y jugar sin
registrar estadística. Este script las separa con los rosters SEMANALES de
nflverse, que traen `week` y `status`, y compara la mezcla entre posiciones.

## Por qué existe

Al conectar disponibilidad a la proyección (INCONCLUSIVO, queda apagada), el
efecto salió distinto por posición: ayudaba en QB y WR y perjudicaba en RB en
3 de 4 temporadas. La hipótesis de partida era que en RB la ausencia sería
rotación de comité y no fragilidad.

**Esa hipótesis es FALSA y este script es lo que la enterró.** En RB sólo el
7,2% de las ausencias son con plantilla activa —la proporción más baja de las
cuatro posiciones— y el 87% son lista de lesionados o inactivo: ausencia real.

Lo que sí apareció, sin buscarlo, es que la contaminación está en QB: el 38%
de sus ausencias son con plantilla ACTIVA, o sea suplentes y titulares que
perdieron el puesto. En quarterback `missed_rate` mide en buena parte
SEGURIDAD DEL PUESTO y no durabilidad, y eso explica por qué al conectarlo
mejoró el MAE en las 4 temporadas sin mover el orden: cambia el nivel esperado
de un jugador que puede dejar de jugar, no lo ordena mejor.

    LA SEÑAL DE DISPONIBILIDAD NO SIGNIFICA LO MISMO EN CADA POSICIÓN.

## El hueco que queda abierto, dicho como hueco

El daño en RB es CONSISTENTE —3 de 4 temporadas, deltas de Spearman −0,085,
−0,057 y −0,030, no una temporada arrastrando la media— y **no tenemos
mecanismo que lo explique**. La primera hipótesis se descartó con datos y no se
ha sustituido por otra. Es información, no una tarea pendiente: quien reabra
disponibilidad después del encogimiento empieza sabiendo esto.

## Límite del dato

`ACT` sin fila de producción no distingue «no se vistió» de «jugó y no tocó el
balón», e `INA` no separa inactivo por lesión de decisión técnica. Se llega
hasta «disponible y sin producir» frente a «no disponible». No es un parte
médico y no se presenta como tal.

    python scripts/fantasy_absence_validate.py
"""

from __future__ import annotations

import glob
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.data.ingest import normalize_team  # noqa: E402
from oracle.fantasy.scoring import PPR, score_player_weeks  # noqa: E402

SEASONS = (2022, 2023, 2024, 2025)
FANTASY_POSITIONS = ("QB", "RB", "WR", "TE")
# La misma población drafteable que usa el harness: medir sobre el universo
# entero contesta «¿es jugador de NFL?» y no «¿es buen pick?».
DRAFTABLE = 180


def main() -> int:
    paths = resolve_paths(None)
    players = pd.read_parquet(paths.player_weeks)
    team_games = pd.read_parquet(paths.team_games)
    positions = players.drop_duplicates("player_id").set_index("player_id")["position"]

    scored = players.copy()
    scored["fp"] = score_player_weeks(scored, PPR)
    actual = scored.groupby(["player_id", "season"], observed=True)["fp"].sum()

    columns = ["season", "week", "team", "gsis_id", "status"]
    files = [
        f for f in sorted(glob.glob(str(paths.raw / "roster_*.parquet")))
        if int(Path(f).stem.split("_")[-1]) in SEASONS
    ]
    if not files:
        print("No hay rosters semanales en data/raw. Corre `oracle refresh` primero.")
        return 1
    rosters = pd.concat(
        [pd.read_parquet(f, columns=columns) for f in files], ignore_index=True
    ).dropna(subset=["gsis_id"])
    rosters["team"] = rosters["team"].map(normalize_team)

    # El calendario REAL del equipo: sin él se contarían como ausencias las
    # semanas de descanso, que es el mismo error de denominador que ya se
    # cometió una vez en `fantasy/weekly.py`.
    schedule = team_games[team_games["game_type"] == "REG"] \
        if "game_type" in team_games.columns else team_games
    if "played" in schedule.columns:
        schedule = schedule[schedule["played"].astype(bool)]
    schedule = schedule[schedule["season"].isin(SEASONS)][["season", "week", "team"]]
    schedule = schedule.drop_duplicates()
    schedule["team"] = schedule["team"].map(normalize_team)

    produced = players[
        (players["season_type"] == "REG") & players["season"].isin(SEASONS)
    ][["season", "week", "player_id"]].drop_duplicates()
    produced["produced"] = True

    chunks = []
    for season in SEASONS:
        previous = actual.xs(season - 1, level="season")
        previous = previous[previous.index.map(positions).isin(FANTASY_POSITIONS)]
        pool = set(previous.nlargest(DRAFTABLE).index)

        weeks = rosters[(rosters["season"] == season) & rosters["gsis_id"].isin(pool)]
        weeks = weeks.merge(schedule, on=["season", "week", "team"], how="inner")
        weeks = weeks.merge(
            produced.rename(columns={"player_id": "gsis_id"}),
            on=["season", "week", "gsis_id"], how="left",
        )
        weeks["produced"] = weeks["produced"].fillna(False).astype(bool)
        weeks["pos"] = weeks["gsis_id"].map(positions)
        chunks.append(weeks)

    weeks = pd.concat(chunks, ignore_index=True)
    absent = weeks[~weeks["produced"]]
    print(f"Población drafteable (top-{DRAFTABLE} por año previo), {SEASONS[0]}-{SEASONS[-1]}")
    print(f"Semanas jugador-equipo con partido: {len(weeks):,}")
    print(f"Sin fila de producción: {len(absent):,}\n")

    print("De las semanas AUSENTES, en qué situación estaba (% por posición):")
    table = absent.groupby(["pos", "status"]).size().unstack(fill_value=0)
    print(table.div(table.sum(axis=1), axis=0).mul(100).round(1).to_string())

    print("\nAusencia CON PLANTILLA ACTIVA — la parte que no es indisponibilidad:")
    for position in FANTASY_POSITIONS:
        total = int((weeks["pos"] == position).sum())
        rows = absent[absent["pos"] == position]
        active = int((rows["status"] == "ACT").sum())
        if total == 0 or len(rows) == 0:
            continue
        print(
            f"  {position}: ausente {len(rows) / total:6.1%} de sus semanas | "
            f"de esas, ACT {active / len(rows):5.1%} | "
            f"ausente-y-activo {active / total:5.1%} del total"
        )
    print(
        "\nQB es el más contaminado: su `missed_rate` mide en parte pérdida de\n"
        "titularidad. RB es el menos: su ausencia es indisponibilidad real, así\n"
        "que la hipótesis del comité NO explica que disponibilidad le perjudique\n"
        "— y no hay otro mecanismo propuesto."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
