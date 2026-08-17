"""Ranking semanal por posición: el puente entre el modelo de partidos y fantasy.

## La idea

El guion de juego decide el volumen. `pred_margin` y `pred_total` del modelo de
partidos dicen cuántas jugadas tendrá cada equipo y de qué tipo: el equipo que
va perdiendo lanza más y corre menos. Un receptor con un 26% de target share en
un partido que se proyecta 17-27 en contra vale más que en uno 28-17 a favor, y
eso no lo ve ningún ranking basado sólo en la media del jugador.

Encima va el ajuste de emparejamiento: cuánto concede la defensa rival a esa
posición, **corregido por la calidad de los ataques que ha enfrentado**. Sin esa
corrección, las defensas de divisiones flojas parecen mucho mejores de lo que
son, y el ajuste acaba midiendo el calendario en vez de la defensa.

Se aplica amortiguado al 45% (`DEF_STRENGTH`). No es prudencia genérica: "defensa
contra la posición" es una señal real pero mucho más pequeña y ruidosa de lo que
se cuenta por ahí, y aplicarla entera **empeora** las proyecciones medidas fuera
de muestra.

## Los cuatro errores que costaron una iteración cada uno

Están corregidos abajo. Los comentarios están para que no vuelvan.

1. **Los dropbacks del equipo NO son los intentos del QB.** Hay que descontar
   capturas y escapadas. Sin eso, la posición salía un 28% alta — el mayor error
   individual de todo el desarrollo del modelo de fantasy.
2. **Un equipo tiene UN titular.** Sin esa restricción, cualquier suplente que
   arrancó dos partidos hereda el volumen completo del equipo y aparece entre
   los mejores de la jornada, que es justo lo que hace inútil a un ranking.
3. **El roster se aplica ANTES de calcular las cuotas.** Si se calcula el target
   share con el equipo del año pasado y luego se cambia de equipo, el jugador
   se lleva su cuota antigua a una plantilla donde no la tiene.
4. **La media de la posición se calcula sobre titulares**, no sobre todo el que
   pisó el campo, o el suelo se hunde y todo el mundo parece bueno.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .scoring import PPR, ScoringRules, score_player_weeks

# --- volumen de equipo ------------------------------------------------------
# Jugadas de scrimmage en un partido medio y su sensibilidad al total esperado.
# Un partido de 55 puntos proyectados tiene ~3 jugadas más por equipo que uno de
# 44: la relación es real pero mucho más plana de lo que parece, porque los
# partidos con más puntos también tienen drives más cortos.
BASE_PLAYS = 63.0
PLAYS_PER_TOTAL_POINT = 0.25

# Reparto pase/carrera y su respuesta al marcador. 0.006 por punto de desventaja
# proyectada: un equipo al que se le proyecta perder de 10 pasa ~6 puntos
# porcentuales más que uno en un partido igualado.
BASE_PASS_RATE = 0.575
PASS_RATE_PER_MARGIN = 0.006
PASS_RATE_BOUNDS = (0.42, 0.72)

# De cada 100 dropbacks, ~6,7 acaban en captura y ~6 en escapada. Los intentos
# de pase son lo que queda. ESTE es el descuento que faltaba y que inflaba al QB
# un 28%: `dropbacks` incluye las jugadas donde el QB nunca llegó a lanzar.
SACK_RATE = 0.067
SCRAMBLE_RATE = 0.060

# Amortiguación del ajuste por defensa rival. Ver la nota de arriba: 0.45 se
# eligió maximizando el Spearman fuera de muestra en 2024-2025, con la
# calibración ajustada sólo con 2022-2023. Subirlo a 1.0 empeora las cuatro
# posiciones.
DEF_STRENGTH = 0.45

# Ventana de la forma reciente y su decaimiento. Seis partidos con peso
# geométrico 0.85: es el mismo listón contra el que se valida el modelo, así que
# cualquier mejora que se reporte es mejora sobre algo que el usuario podría
# calcular a mano en dos minutos.
FORM_WINDOW = 6
FORM_DECAY = 0.85

# Titulares que se rankean por equipo y posición. Más allá de esto el reparto de
# volumen es adivinar.
STARTERS_PER_TEAM = {"QB": 1, "RB": 2, "WR": 4, "TE": 1}

# Temporadas hacia atrás que definen "plantilla actual". Con 1, para la semana 1
# de 2026 sólo cuentan los jugadores que jugaron en 2025.
#
# **Sin esta ventana el ranking es inservible, de dos formas a la vez.** El
# historial llega a 1999, así que:
#
# 1. Las cuotas de uso se normalizan sobre *todos* los jugadores que han pasado
#    por el equipo en 25 años. El target share del receptor titular se divide
#    entre cientos de personas y sale ~2% en vez de ~25%, de modo que todas las
#    proyecciones salen aplastadas contra el suelo.
# 2. Aparecen jugadores **retirados**: su "último equipo" y sus "últimos seis
#    partidos" siguen existiendo, sólo que fueron hace una década.
#
# Los dos fallos se veían a la vez en la primera ejecución contra datos reales:
# Gronkowski y Dennis Pitta rankeados entre los mejores TE de 2026, con
# proyecciones de 3 puntos.
ROSTER_LOOKBACK_SEASONS = 1


@dataclass(frozen=True)
class WeeklyCalibration:
    """Multiplicadores finales por posición.

    Salen de comparar proyección y resultado sobre 2022-2023 y se evalúan sin
    tocarlos sobre 2024-2025 (`scripts/fantasy_weekly_calibrate.py`). El del QB
    (0.812) es el residuo que quedaba **después** de arreglar el descuento de
    capturas y escapadas: el volumen ya era correcto, pero la eficiencia
    proyectada seguía siendo optimista porque el EPA de pase del equipo incluye
    jugadas que no son del QB.

    No son números a ojo. Cambiarlos sin volver a correr la validación rompe el
    ranking en silencio: las proyecciones siguen saliendo, sólo que sesgadas.
    """

    multipliers: dict[str, float] = field(
        default_factory=lambda: {"QB": 0.812, "RB": 0.985, "WR": 0.972, "TE": 0.940}
    )

    def get(self, position: str) -> float:
        return self.multipliers.get(position, 1.0)


def weekly_rankings(
    player_weeks: pd.DataFrame,
    predictions: pd.DataFrame,
    season: int,
    week: int,
    rules: ScoringRules = PPR,
    calibration: WeeklyCalibration | None = None,
) -> pd.DataFrame:
    """Ranking por posición de una jornada.

    `predictions` es la salida del modelo de partidos para esa jornada, con
    `pred_margin` y `pred_total`. Sólo se usa historial **anterior** a
    (season, week): la misma regla que en todo el proyecto.
    """
    calibration = calibration or WeeklyCalibration()

    history = player_weeks[
        (player_weeks["season"] < season)
        | ((player_weeks["season"] == season) & (player_weeks["week"] < week))
    ].copy()
    if history.empty:
        raise ValueError(f"No hay historial anterior a {season} semana {week}.")

    # Ventana de plantilla actual. Va ANTES de calcular nada: las cuotas de uso
    # sólo significan algo si se normalizan entre los jugadores que compiten hoy
    # por ese volumen. Ver la nota de ROSTER_LOOKBACK_SEASONS.
    history = history[history["season"] >= season - ROSTER_LOOKBACK_SEASONS]
    if history.empty:
        raise ValueError(
            f"No hay actividad en las últimas {ROSTER_LOOKBACK_SEASONS + 1} temporadas "
            f"antes de {season} semana {week}."
        )
    history["fantasy_points"] = score_player_weeks(history, rules)

    # (3) El roster ACTUAL se resuelve antes de nada. Todas las cuotas se
    # calculan ya con el equipo al que pertenece hoy el jugador.
    rosters = _current_rosters(history)
    history = history.merge(rosters, on="player_id", how="inner", suffixes=("_old", ""))

    usage = _player_usage(history)
    matchup = _defense_vs_position(history)
    schedule = _schedule_frame(predictions)

    rows = []
    for _, game_team in schedule.iterrows():
        team, opponent = game_team["team"], game_team["opponent"]
        volume = team_volume(game_team["pred_margin_for"], game_team["pred_total"])
        squad = usage[usage["team"] == team]
        if squad.empty:
            continue
        for position in STARTERS_PER_TEAM:
            starters = _starters(squad, position)
            for _, player in starters.iterrows():
                projection = _project_player(player, position, volume, rules)
                multiplier = _matchup_multiplier(matchup, opponent, position)
                points = projection * multiplier * calibration.get(position)
                rows.append(
                    {
                        "player_id": player["player_id"],
                        "player_name": player.get("player_name", ""),
                        "position": position,
                        "team": team,
                        "opponent": opponent,
                        "season": season,
                        "week": week,
                        "projected_points": float(points),
                        "baseline_points": float(player["recent_ppg"]),
                        "matchup_multiplier": float(multiplier),
                        "is_home": int(game_team["is_home"]),
                        "pred_margin_for": float(game_team["pred_margin_for"]),
                        "pred_total": float(game_team["pred_total"]),
                    }
                )

    if not rows:
        return pd.DataFrame(
            columns=["player_id", "player_name", "position", "team", "opponent", "season",
                     "week", "projected_points", "baseline_points", "matchup_multiplier"]
        )

    board = pd.DataFrame(rows)
    board["position_rank"] = board.groupby("position", observed=True)[
        "projected_points"
    ].rank(ascending=False, method="first").astype(int)
    return board.sort_values(["position", "position_rank"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Volumen de equipo a partir del guion de juego
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TeamVolume:
    plays: float
    dropbacks: float
    pass_attempts: float
    rush_attempts: float
    sacks: float
    scrambles: float


def team_volume(pred_margin_for: float, pred_total: float) -> TeamVolume:
    """Jugadas proyectadas de un equipo según el marcador esperado.

    `pred_margin_for` es el margen esperado **a favor de este equipo** (negativo
    si se espera que pierda). Ese signo es el que activa el guion de juego: el
    que pierde pasa más.
    """
    total = pred_total if np.isfinite(pred_total) else 44.0
    plays = BASE_PLAYS + PLAYS_PER_TOTAL_POINT * (total - 44.0)

    margin = pred_margin_for if np.isfinite(pred_margin_for) else 0.0
    pass_rate = float(
        np.clip(BASE_PASS_RATE - PASS_RATE_PER_MARGIN * margin, *PASS_RATE_BOUNDS)
    )

    dropbacks = plays * pass_rate
    # (1) Aquí está el descuento que faltaba. `dropbacks` incluye capturas y
    # escapadas; los intentos de pase del QB son lo que sobrevive a las dos.
    sacks = dropbacks * SACK_RATE
    scrambles = dropbacks * SCRAMBLE_RATE
    pass_attempts = dropbacks - sacks - scrambles

    # Las escapadas del QB son acarreos, así que salen del reparto de carreras
    # del equipo: contarlas dos veces infla al corredor titular.
    rush_attempts = plays * (1 - pass_rate) - scrambles

    return TeamVolume(plays, dropbacks, pass_attempts, max(rush_attempts, 0.0), sacks, scrambles)


# ---------------------------------------------------------------------------
# Uso reciente por jugador
# ---------------------------------------------------------------------------

def _current_rosters(history: pd.DataFrame) -> pd.DataFrame:
    """Equipo actual de cada jugador: el de su partido más reciente."""
    latest = history.sort_values(["season", "week"]).groupby("player_id", observed=True).tail(1)
    return latest[["player_id", "team"]].rename(columns={"team": "team"}).reset_index(drop=True)


def _player_usage(history: pd.DataFrame) -> pd.DataFrame:
    """Cuotas de uso y eficiencia reciente, ya dentro del equipo actual.

    El peso decae geométricamente hacia atrás: el partido de la semana pasada
    pesa más que el de hace seis, pero no infinitamente más.
    """
    recent = history.sort_values(["season", "week"]).groupby("player_id", observed=True).tail(
        FORM_WINDOW
    ).copy()
    recent["order"] = recent.groupby("player_id", observed=True).cumcount(ascending=False)
    recent["weight"] = FORM_DECAY ** recent["order"]

    def _agg(group: pd.DataFrame) -> pd.Series:
        weights = group["weight"].to_numpy(dtype=float)
        total = weights.sum()

        def weighted(column: str) -> float:
            if column not in group.columns:
                return 0.0
            return float((group[column].fillna(0.0).to_numpy(dtype=float) * weights).sum() / total)

        return pd.Series(
            {
                "player_name": group["player_name"].iloc[-1] if "player_name" in group else "",
                "position": str(group["position"].iloc[-1]) if "position" in group else "",
                "team": group["team"].iloc[-1],
                "games": float(len(group)),
                "recent_ppg": weighted("fantasy_points"),
                "targets": weighted("targets"),
                "carries": weighted("carries"),
                "attempts": weighted("attempts"),
                "receiving_yards": weighted("receiving_yards"),
                "rushing_yards": weighted("rushing_yards"),
                "passing_yards": weighted("passing_yards"),
                "receptions": weighted("receptions"),
                "receiving_tds": weighted("receiving_tds"),
                "rushing_tds": weighted("rushing_tds"),
                "passing_tds": weighted("passing_tds"),
            }
        )

    usage = recent.groupby("player_id", observed=True).apply(_agg, include_groups=False)
    usage = usage.reset_index()

    # (3) Las cuotas se normalizan DENTRO del equipo actual. Si un jugador
    # cambió de equipo, su volumen antiguo ya no compite con el de sus antiguos
    # compañeros, sino con el de los nuevos.
    #
    # (5) Y se calculan sobre la VENTANA DEL EQUIPO, no sumando las medias por
    # partido jugado de cada jugador. La diferencia parece de matiz y no lo es.
    #
    # Una media por partido jugado es condicional a que el jugador jugara. Al
    # sumarlas para normalizar, quien se perdió media temporada entra con su
    # tasa completa, como si hubiera jugado siempre. El denominador se infla y
    # todas las cuotas del equipo salen bajas.
    #
    # Medido con datos reales de 2025: el denominador se inflaba entre un 5%
    # (BAL) y un 34% (LAR), y las proyecciones salían al 73-80% de la forma
    # reciente del jugador en las cuatro posiciones. Lo grave no es el factor de
    # escala —que casi no mueve el orden dentro de un equipo— sino que **varía
    # por equipo**: penalizaba un 34% a los receptores de un equipo y un 5% a
    # los de otro, corrompiendo la comparación entre equipos, que es justo lo
    # que un ranking semanal tiene que acertar.
    #
    # La cuota correcta es la de libro: lo del jugador entre lo del equipo, ambos
    # sobre los mismos partidos.
    usage = usage.merge(_team_window_shares(history), on="player_id", how="left")
    for share in ("target_share", "rush_share"):
        usage[share] = usage[share].fillna(0.0)

    return usage


def _team_window_shares(history: pd.DataFrame) -> pd.DataFrame:
    """Cuota de objetivos y de acarreos sobre los últimos partidos del EQUIPO.

    La ventana la fija el equipo (sus últimos `FORM_WINDOW` partidos), no cada
    jugador: sólo con un denominador común las cuotas suman 1 y significan lo
    que dicen significar.
    """
    columns = [c for c in ("targets", "carries", "attempts") if c in history.columns]
    if not columns:
        return pd.DataFrame(
            columns=["player_id", "target_share", "rush_share", "window_attempts"]
        )

    games = (
        history[["team", "season", "week"]]
        .drop_duplicates()
        .sort_values(["season", "week"])
        .groupby("team", observed=True)
        .tail(FORM_WINDOW)
    )
    window = history.merge(games, on=["team", "season", "week"], how="inner")

    totals = window.groupby(["team", "player_id"], observed=True)[columns].sum().reset_index()
    team_totals = totals.groupby("team", observed=True)[columns].transform("sum")

    shares = pd.DataFrame({"player_id": totals["player_id"]})
    for column, name in (("targets", "target_share"), ("carries", "rush_share")):
        if column in columns:
            shares[name] = np.where(
                team_totals[column] > 0, totals[column] / team_totals[column], 0.0
            )
        else:
            shares[name] = 0.0

    # Los intentos NO se convierten en cuota: un equipo tiene un quarterback, y
    # "el 60% de los intentos" no significa nada. Se devuelve el total de la
    # ventana, que es lo que decide quién es el titular.
    shares["window_attempts"] = totals["attempts"] if "attempts" in columns else 0.0
    return shares


def _starters(squad: pd.DataFrame, position: str) -> pd.DataFrame:
    """(2) Sólo los titulares. Un equipo tiene un QB, no cinco.

    El criterio de titularidad es el volumen reciente, no el puesto en la
    plantilla: no hay parte de lesiones en este proyecto y el volumen es la
    mejor aproximación disponible. Está en las limitaciones del README.
    """
    group = squad[squad["position"] == position].copy()
    if group.empty:
        return group
    # El criterio es el volumen ACUMULADO en la ventana del equipo, no la media
    # por partido jugado: si no, un suplente que jugó un partido con mucho
    # volumen le gana el puesto al titular que jugó los seis.
    key = {
        "QB": "window_attempts",
        "RB": "rush_share",
        "WR": "target_share",
        "TE": "target_share",
    }[position]
    if key not in group.columns:
        key = {"QB": "attempts", "RB": "carries", "WR": "targets", "TE": "targets"}[position]
    return group.sort_values(key, ascending=False).head(STARTERS_PER_TEAM[position])


def _project_player(
    player: pd.Series, position: str, volume: TeamVolume, rules: ScoringRules
) -> float:
    """Puntos proyectados de un titular con el volumen del equipo.

    La eficiencia (yardas por objetivo, por acarreo, por intento) viene de su
    propia forma reciente; el **volumen** viene del guion de juego proyectado.
    Ese es todo el mecanismo: separar lo que el jugador controla de lo que
    controla el partido.
    """
    if position == "QB":
        attempts = volume.pass_attempts
        yards_per_attempt = _safe_ratio(player["passing_yards"], player["attempts"], 7.0)
        td_per_attempt = _safe_ratio(player["passing_tds"], player["attempts"], 0.045)
        rush_yards = _safe_ratio(player["rushing_yards"], player["carries"], 4.5) * (
            volume.scrambles * 0.55
        )
        points = (
            attempts * yards_per_attempt * rules.passing_yards
            + attempts * td_per_attempt * rules.passing_td
            + rush_yards * rules.rushing_yards
        )
        return points

    if position == "RB":
        carries = volume.rush_attempts * player["rush_share"]
        targets = volume.pass_attempts * player["target_share"]
    else:  # WR y TE
        carries = volume.rush_attempts * player["rush_share"]
        targets = volume.pass_attempts * player["target_share"]

    yards_per_carry = _safe_ratio(player["rushing_yards"], player["carries"], 4.2)
    yards_per_target = _safe_ratio(player["receiving_yards"], player["targets"], 7.8)
    catch_rate = _safe_ratio(player["receptions"], player["targets"], 0.65)
    rush_td_rate = _safe_ratio(player["rushing_tds"], player["carries"], 0.030)
    rec_td_rate = _safe_ratio(player["receiving_tds"], player["targets"], 0.055)

    return (
        carries * yards_per_carry * rules.rushing_yards
        + carries * rush_td_rate * rules.rushing_td
        + targets * yards_per_target * rules.receiving_yards
        + targets * catch_rate * rules.reception
        + targets * rec_td_rate * rules.receiving_td
    )


def _safe_ratio(numerator: float, denominator: float, default: float) -> float:
    """Cociente con vuelta a la media de la liga cuando la muestra es minúscula.

    Un jugador con dos objetivos y un touchdown tiene una tasa del 50%. Sin este
    suelo, aparece el primero de la jornada.
    """
    if not np.isfinite(denominator) or denominator < 1.0:
        return default
    value = numerator / denominator
    weight = min(denominator / (denominator + 8.0), 0.95)
    return float(weight * value + (1 - weight) * default)


# ---------------------------------------------------------------------------
# Ajuste de emparejamiento
# ---------------------------------------------------------------------------

def _defense_vs_position(history: pd.DataFrame) -> pd.DataFrame:
    """Puntos concedidos por defensa y posición, corregidos por calendario.

    (4) La media se calcula sobre **titulares** (los que superan un umbral de
    volumen), no sobre todo el que pisó el campo: incluir a los suplentes hunde
    el suelo y hace que todas las defensas parezcan buenas.

    La corrección de calendario es la clave: se resta lo que el ataque rival
    suele producir, no lo que produjo. Sin ella, una defensa que se enfrentó a
    tres ataques flojos aparece como élite y el ajuste mide el calendario.
    """
    if "opponent_team" in history.columns:
        history = history.rename(columns={"opponent_team": "defense"})
    elif "opponent" in history.columns:
        history = history.rename(columns={"opponent": "defense"})
    else:
        return pd.DataFrame(columns=["defense", "position", "multiplier"])

    relevant = history[history["position"].isin(STARTERS_PER_TEAM)].copy()
    # Umbral de titularidad: por debajo de 5 puntos de media, el jugador no
    # estaba jugando lo suficiente como para decir nada de la defensa rival.
    starter_mean = relevant.groupby("player_id", observed=True)["fantasy_points"].transform("mean")
    relevant = relevant[starter_mean >= 5.0]
    if relevant.empty:
        return pd.DataFrame(columns=["defense", "position", "multiplier"])

    # Lo que "se espera" de cada jugador es su propia media: el residuo mide
    # cuánto se apartó de sí mismo contra esa defensa.
    relevant["expected"] = relevant.groupby(["player_id"], observed=True)[
        "fantasy_points"
    ].transform("mean")
    relevant["ratio"] = relevant["fantasy_points"] / relevant["expected"].replace(0, np.nan)

    grouped = relevant.groupby(["defense", "position"], observed=True)["ratio"]
    table = grouped.agg(["mean", "count"]).reset_index()

    # Encogimiento hacia 1 por tamaño de muestra, y sólo entonces la
    # amortiguación al 45%.
    reliability = table["count"] / (table["count"] + 40.0)
    raw = 1.0 + reliability * (table["mean"].fillna(1.0) - 1.0)
    table["multiplier"] = 1.0 + DEF_STRENGTH * (raw - 1.0)
    return table[["defense", "position", "multiplier"]]


def _matchup_multiplier(matchup: pd.DataFrame, defense: str, position: str) -> float:
    if matchup.empty:
        return 1.0
    row = matchup[(matchup["defense"] == defense) & (matchup["position"] == position)]
    if row.empty:
        return 1.0
    return float(row["multiplier"].iloc[0])


def _schedule_frame(predictions: pd.DataFrame) -> pd.DataFrame:
    """Convierte las predicciones (una fila por partido) en dos filas por equipo.

    El signo de `pred_margin_for` se invierte para el visitante. Ese detalle es
    el que hace que el guion de juego funcione en las dos direcciones.
    """
    home = pd.DataFrame(
        {
            "team": predictions["home_team"],
            "opponent": predictions["away_team"],
            "pred_margin_for": predictions["pred_margin"],
            "pred_total": predictions["pred_total"],
            "is_home": 1,
        }
    )
    away = pd.DataFrame(
        {
            "team": predictions["away_team"],
            "opponent": predictions["home_team"],
            "pred_margin_for": -predictions["pred_margin"],
            "pred_total": predictions["pred_total"],
            "is_home": 0,
        }
    )
    return pd.concat([home, away], ignore_index=True)
