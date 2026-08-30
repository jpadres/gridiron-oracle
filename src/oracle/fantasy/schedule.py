"""Calendario y semanas de descanso. Hechos, no modelo.

## Por qué esto es un primitivo y no una funcionalidad

Una semana de descanso es **derivable y exacta**: un equipo que no juega en una
semana de temporada regular en la que sí se juega, descansa. No hace falta
proyectar nada, ni pedirle permiso a ninguna capacidad, ni conectarse a nada —
el calendario de 2026 ya está publicado con sus 272 partidos.

Eso lo convierte en la clase de dato que este proyecto puede afirmar sin
matices, y en la base de varias cosas que hoy no existen: alineación incompleta,
titular de descanso, concentración de descansos en una plantilla.

    UN HECHO COMPROBABLE VALE MÁS QUE UNA PREDICCIÓN SIN VALIDAR.

## La distinción que hay que respetar

Ausencia en temporada regular = **descanso**.
Ausencia en playoffs = **eliminado**, que es otra cosa.
Ausencia porque no hay datos de esa semana = **UNKNOWN**, que es una tercera.

Colapsar las tres daría «descansa» para un equipo eliminado, y eso es
exactamente el tipo de dato falso que parece correcto.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

REGULAR = "REG"


@dataclass(frozen=True)
class SeasonSchedule:
    """El calendario de una temporada, con sus descansos ya derivados."""

    season: int
    weeks: tuple[int, ...]
    """Semanas de temporada regular con al menos un partido."""
    bye_week: dict[str, int]
    """Equipo -> su semana de descanso. Sin entrada si no tiene o no se sabe."""
    teams: tuple[str, ...]
    complete: bool
    """¿Juega cada equipo en todas las semanas menos una? Si no, hay huecos."""

    def is_bye(self, team: str, week: int) -> bool | None:
        """¿Descansa ese equipo esa semana? `None` si no se puede establecer.

        El `None` es la parte importante: un equipo del que no se sabe nada no
        «juega», y decir que juega para no devolver nulo es fabricar un dato.
        """
        if team not in self.teams or week not in self.weeks:
            return None
        bye = self.bye_week.get(team)
        return None if bye is None else bye == week

    def byes_in_week(self, week: int) -> tuple[str, ...]:
        return tuple(sorted(t for t, w in self.bye_week.items() if w == week))


def season_schedule(games: pd.DataFrame, season: int) -> SeasonSchedule:
    """Deriva el calendario y los descansos de una temporada.

    Sólo mira temporada regular. Los playoffs no producen descansos: un equipo
    que no está es un equipo eliminado.
    """
    frame = games[games["season"] == season]
    if "game_type" in frame.columns:
        frame = frame[frame["game_type"] == REGULAR]
    if frame.empty:
        return SeasonSchedule(season, (), {}, (), complete=False)

    weeks = tuple(sorted(int(w) for w in frame["week"].unique()))
    teams = tuple(sorted(set(frame["home_team"]) | set(frame["away_team"])))

    # Qué semanas juega cada equipo. Un `set` por equipo y una diferencia: no
    # hay ventanas de pandas por medio, así que no hay forma de colar futuro.
    played: dict[str, set[int]] = {t: set() for t in teams}
    for home, away, week in zip(frame["home_team"], frame["away_team"],
                                frame["week"], strict=True):
        played[home].add(int(week))
        played[away].add(int(week))

    bye: dict[str, int] = {}
    completo = True
    for team in teams:
        libres = sorted(set(weeks) - played[team])
        if len(libres) == 1:
            bye[team] = libres[0]
        else:
            # Cero libres (temporada sin descanso) o más de una: no se afirma.
            completo = False

    return SeasonSchedule(season, weeks, bye, teams, complete=completo)


def roster_byes(
    schedule: SeasonSchedule,
    players: list[dict],
    week: int | None = None,
) -> dict:
    """Descansos de una plantilla. Conteo, nunca consejo.

    Devuelve `{"this_week": [...], "by_week": {semana: [jugadores]},
    "unknown": [...]}`. Lo que NO devuelve es qué hacer: un titular de descanso
    es un hecho de calendario, y convertirlo en «ficha a alguien» sería una
    recomendación que nadie ha validado.
    """
    esta: list[dict] = []
    por_semana: dict[int, list[dict]] = {}
    desconocidos: list[dict] = []

    for player in players:
        team = str(player.get("team") or "").upper()
        if not team or team not in schedule.teams:
            desconocidos.append(player)
            continue
        semana = schedule.bye_week.get(team)
        if semana is None:
            desconocidos.append(player)
            continue
        por_semana.setdefault(semana, []).append(player)
        if week is not None and semana == week:
            esta.append(player)

    return {"this_week": esta, "by_week": por_semana, "unknown": desconocidos}
