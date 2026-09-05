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

from .kickers import KickerScoring, distance_mix, fit_opportunity, project
from .scoring import PPR, ScoringRules, regular_season, score_player_weeks

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
        default_factory=lambda: {"QB": 1.022, "RB": 1.022, "WR": 1.061, "TE": 1.127}
    )

    # Cuánto pesa la forma reciente del jugador frente al modelo. Ajustado
    # SOBRE 2022-2023 y evaluado sobre 2024-2025 sin volver a tocarlo.
    #
    # Existe porque el modelo puro NO bate a su baseline —la media ponderada de
    # los últimos seis partidos— en ninguna de las cuatro posiciones, y el
    # preregistro fijaba de antemano qué hacer en ese caso: mezclar. La mezcla
    # sí lo bate en MAE en las cuatro y en Spearman en RB, WR y TE.
    #
    # El quarterback es la excepción y se dice tal cual: la mezcla baja el
    # error (6,57 frente a 6,71) pero **ordena algo peor** que la media de sus
    # seis últimos partidos (Spearman 0,236 frente a 0,248).
    blend_to_baseline: dict[str, float] = field(
        default_factory=lambda: {"QB": 0.35, "RB": 0.60, "WR": 0.50, "TE": 0.65}
    )

    def get(self, position: str) -> float:
        return self.multipliers.get(position, 1.0)

    def blend(self, position: str) -> float:
        return self.blend_to_baseline.get(position, 0.0)


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

    # Sólo temporada regular (ver `regular_season`) y anterior a (season, week).
    player_weeks = regular_season(player_weeks)
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
                stat_lines = _project_stats(player, position, volume)
                multiplier = _matchup_multiplier(matchup, opponent, position)
                model_points = projection * multiplier * calibration.get(position)

                # La proyección publicada es una MEZCLA con la forma reciente,
                # no la salida del modelo. Medido fuera de muestra: el modelo
                # solo no bate a la media ponderada de seis partidos en ninguna
                # posición, y la mezcla sí. Publicar el modelo puro sería
                # publicar lo peor de los dos por razones estéticas.
                weight = calibration.blend(position)
                baseline = float(player["recent_ppg"])
                points = weight * baseline + (1.0 - weight) * model_points

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
                        # Las dos mitades de la mezcla se publican por separado.
                        # Antes se publicaba `baseline_points` y un
                        # `matchup_multiplier` que no componían con el
                        # proyectado: quien intentara multiplicarlos obtenía otro
                        # número, y eso invita a una aritmética que el código no
                        # hace.
                        "model_points": float(model_points),
                        "baseline_points": baseline,
                        "blend_weight": float(weight),
                        "matchup_multiplier": float(multiplier),
                        "is_home": int(game_team["is_home"]),
                        "pred_margin_for": float(game_team["pred_margin_for"]),
                        "pred_total": float(game_team["pred_total"]),
                        # Líneas de stats: MEDIAS del mecanismo volumen ×
                        # eficiencia, sin ajuste de rival ni calibración (esas
                        # capas operan en puntos). Contexto de props, no props.
                        **{k: float(v) for k, v in stat_lines.items()},
                    }
                )

    if not rows:
        return pd.DataFrame(
            columns=["player_id", "player_name", "position", "team", "opponent", "season",
                     "week", "projected_points", "model_points", "baseline_points",
                     "blend_weight", "matchup_multiplier"]
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

    # Los acarreos del equipo son los de la casilla: escapadas del QB incluidas.
    #
    # Aquí había una resta de escapadas, con el razonamiento de que contarlas dos
    # veces inflaría al corredor titular. No las contaba dos veces: el
    # denominador de `rush_share` son los acarreos de la casilla, que YA
    # incluyen las escapadas, así que la cuota del quarterback ya las separa.
    # Restarlas otra vez las quitaba dos veces y deprimía a todos los corredores
    # y receptores un 8,4%.
    #
    # Medido sobre 2.174 equipo-partidos de 2022-2025, alimentando el modelo con
    # el marcador REAL para aislarlo del error del modelo de partidos:
    #   con la resta:  24,71 proyectados frente a 26,98 reales  (ratio 0,916)
    #   sin la resta:  26,89 proyectados frente a 26,98 reales  (ratio 1,004)
    rush_attempts = plays * (1 - pass_rate)

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
                # nflverse renombró esta columna al pasar de `player_stats` a
                # `stats_player_week`. Se coge la primera que exista y NO se
                # suman: un DataFrame que mezclara los dos esquemas contaría las
                # intercepciones dos veces y penalizaría al doble. Es el mismo
                # cuidado que `_redundant_aliases` en `scoring.py`, y viene del
                # mismo susto.
                "interceptions": weighted(
                    "passing_interceptions"
                    if "passing_interceptions" in group.columns
                    else "interceptions"
                ),
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
    stats = _project_stats(player, position, volume)
    if position == "QB":
        return (
            stats["proj_pass_yds"] * rules.passing_yards
            + stats["proj_pass_tds"] * rules.passing_td
            # Sin este término la proyección de QB era casi una constante: se
            # quedaba con lo que menos distingue —yardas y touchdowns de pase
            # sobre un volumen de intentos casi igual para todos— y perdía los
            # tres términos que sí separan a un quarterback de otro.
            + stats["proj_pass_ints"] * rules.interception
            + stats["proj_rush_yds"] * rules.rushing_yards
            + stats["proj_rush_tds"] * rules.rushing_td
        )
    return (
        stats["proj_rush_yds"] * rules.rushing_yards
        + stats["proj_rush_tds"] * rules.rushing_td
        + stats["proj_rec_yds"] * rules.receiving_yards
        + stats["proj_receptions"] * rules.reception
        + stats["proj_rec_tds"] * rules.receiving_td
    )


def _project_stats(player: pd.Series, position: str, volume: TeamVolume) -> dict[str, float]:
    """Las LÍNEAS DE STATS esperadas de un titular: el mecanismo entero.

    Es la misma aritmética que siempre puntuó `_project_player`, sacada a la luz
    para que las medias por estadística (intentos, yardas, recepciones…) se
    puedan publicar como contexto de props. Dos cosas que NO son:

    - No están ajustadas por rival ni calibradas: el multiplicador de defensa y
      la calibración se aplican a los PUNTOS, y estirarlos por stat sería una
      transformación que nadie ha validado.
    - Son MEDIAS, no distribuciones: E7 valida el agregado en puntos; el nivel
      de stat individual no tiene validación propia y la interfaz lo dice.
    """
    if position == "QB":
        attempts = volume.pass_attempts
        yards_per_attempt = _safe_ratio(player["passing_yards"], player["attempts"], 7.0)
        td_per_attempt = _safe_ratio(player["passing_tds"], player["attempts"], 0.045)
        int_per_attempt = _safe_ratio(player["interceptions"], player["attempts"], 0.024)

        # El volumen de carrera sale de su cuota de acarreos del equipo, igual
        # que en el resto de posiciones. Antes salía de `escapadas * 0,55`, y una
        # escapada es improvisada: un quarterback de carrera diseñada —Hurts,
        # Jackson, Daniels— tiene acarreos que no son escapadas, y son justo los
        # que separan a un QB1 de un QB15.
        carries = volume.rush_attempts * player["rush_share"]
        yards_per_carry = _safe_ratio(player["rushing_yards"], player["carries"], 4.5)
        # La tasa por defecto es alta a propósito: un acarreo de quarterback
        # pasa cerca de la línea de gol mucho más a menudo que uno de corredor.
        rush_td_rate = _safe_ratio(player["rushing_tds"], player["carries"], 0.045)
        return {
            "proj_pass_att": attempts,
            "proj_pass_yds": attempts * yards_per_attempt,
            "proj_pass_tds": attempts * td_per_attempt,
            "proj_pass_ints": attempts * int_per_attempt,
            "proj_carries": carries,
            "proj_rush_yds": carries * yards_per_carry,
            "proj_rush_tds": carries * rush_td_rate,
        }

    carries = volume.rush_attempts * player["rush_share"]
    targets = volume.pass_attempts * player["target_share"]
    yards_per_carry = _safe_ratio(player["rushing_yards"], player["carries"], 4.2)
    yards_per_target = _safe_ratio(player["receiving_yards"], player["targets"], 7.8)
    catch_rate = _safe_ratio(player["receptions"], player["targets"], 0.65)
    rush_td_rate = _safe_ratio(player["rushing_tds"], player["carries"], 0.030)
    rec_td_rate = _safe_ratio(player["receiving_tds"], player["targets"], 0.055)
    return {
        "proj_carries": carries,
        "proj_rush_yds": carries * yards_per_carry,
        "proj_rush_tds": carries * rush_td_rate,
        "proj_targets": targets,
        "proj_receptions": targets * catch_rate,
        "proj_rec_yds": targets * yards_per_target,
        "proj_rec_tds": targets * rec_td_rate,
    }


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


# ---------------------------------------------------------------------------
# Pateadores y defensas: las dos posiciones con OTRA autoridad
# ---------------------------------------------------------------------------
# No se cuelgan del ranking QB/RB/WR/TE a propósito. El pateador tiene un modelo
# de PROYECCIÓN validado (E8: MAE 3,73 frente a 3,77 y 4,07 de sus baselines)
# pero su ORDEN dentro del top-12 está rechazado (E8b: +0,26 pts/partido con IC
# que cruza cero), así que se publica el proyectado y nunca un K1…K12. La
# defensa ni siquiera tiene modelo: DST_STREAMING es DESIGN_ONLY, y lo único
# defendible hoy son HECHOS — el total implícito del rival (que sale del modelo
# de partidos, ése sí validado) y las medias recientes observadas.


def weekly_kickers(
    player_weeks: pd.DataFrame,
    team_points: pd.DataFrame,
    predictions: pd.DataFrame,
    season: int,
    week: int,
    scoring: KickerScoring | None = None,
) -> pd.DataFrame:
    """Proyección semanal del pateador TITULAR de cada equipo.

    Todo lo que entra es del equipo: sus puntos proyectados por el modelo de
    partidos, el reparto de distancias de la liga y las tasas de conversión de
    la liga. La identidad del pateador sólo decide QUIÉN cobra la oportunidad,
    no cuánta — r 0,024 año contra año en acierto; ver `kickers.py`.

    `team_points` son equipo-semanas con `points_for` (el parquet de
    `team_games`). Sólo se usa historial anterior a (season, week).
    """
    scoring = scoring or KickerScoring()
    player_weeks = regular_season(player_weeks)
    before = (player_weeks["season"] < season) | (
        (player_weeks["season"] == season) & (player_weeks["week"] < week)
    )
    kickers = player_weeks[before & (player_weeks["position"] == "K")].copy()
    columns = ["player_id", "player_name", "player_full_name", "team", "opponent",
               "is_home", "team_points", "projected_points"]
    if kickers.empty:
        return pd.DataFrame(columns=columns)

    points_before = team_points[
        (team_points["season"] < season)
        | ((team_points["season"] == season) & (team_points["week"] < week))
    ]
    # Oportunidad y conversión se ajustan con TODO el historial anterior: son
    # parámetros de liga, no de pateador, y más muestra sólo los mejora.
    model = fit_opportunity(kickers, points_before[["season", "week", "team", "points_for"]])
    mix = distance_mix(kickers)

    # El titular, con la misma ventana de plantilla que el resto del ranking:
    # su equipo actual es el de su último partido, y entre los candidatos de un
    # equipo manda el volumen de intentos reciente (no la mera recencia, que
    # elegiría al suplente de la semana 18 sobre el titular lesionado una vez).
    recent = kickers[kickers["season"] >= season - ROSTER_LOOKBACK_SEASONS]
    if recent.empty:
        return pd.DataFrame(columns=columns)
    latest = recent.sort_values(["season", "week"]).groupby("player_id", observed=True).tail(1)
    current_team = dict(zip(latest["player_id"], latest["team"], strict=True))
    recent = recent.assign(now=recent["player_id"].map(current_team))
    named = recent.assign(
        tries=recent["fg_att"].fillna(0) + recent["pat_att"].fillna(0),
        full_name=recent.get("player_display_name", recent["player_name"]),
    )
    attempts = (
        named.groupby(["now", "player_id"], observed=True)
        .agg(tries=("tries", "sum"), player_name=("player_name", "last"),
             player_full_name=("full_name", "last"))
        .reset_index()
    )
    starters = attempts.sort_values("tries", ascending=False).groupby("now", observed=True).head(1)
    starter_by_team = starters.set_index("now")[
        ["player_id", "player_name", "player_full_name"]
    ]

    rows = []
    for _, game_team in _schedule_frame(predictions).iterrows():
        team = game_team["team"]
        if team not in starter_by_team.index:
            # Equipo sin pateador identificable en la ventana: no se inventa
            # uno. La fila falta y eso también es información.
            continue
        implied = (game_team["pred_total"] + game_team["pred_margin_for"]) / 2.0
        rows.append(
            {
                "player_id": starter_by_team.loc[team, "player_id"],
                "player_name": starter_by_team.loc[team, "player_name"],
                "player_full_name": starter_by_team.loc[team, "player_full_name"],
                "team": team,
                "opponent": game_team["opponent"],
                "is_home": int(game_team["is_home"]),
                "team_points": float(implied),
                "projected_points": project(implied, model, mix, scoring),
            }
        )
    board = pd.DataFrame(rows, columns=columns)
    # Orden por proyectado, SIN columna de rank: publicar K1…K12 es lo que E8b
    # rechaza. El orden de lectura es inevitable; el número ordinal, no.
    return board.sort_values("projected_points", ascending=False).reset_index(drop=True)


def weekly_defenses(
    team_games: pd.DataFrame,
    predictions: pd.DataFrame,
    season: int,
    week: int,
    window: int = 6,
) -> pd.DataFrame:
    """Contexto de streaming de defensas: HECHOS, sin proyección.

    Deliberadamente no hay columna de puntos proyectados ni de rank: no existe
    modelo de DST (DESIGN_ONLY en el registro). Lo que sí se sabe: el total
    implícito del rival predice los puntos permitidos a r 0,388 — por eso la
    tabla se ordena por él — y las medias recientes son observaciones, con la
    advertencia medida de que las pérdidas forzadas NO son estables (r 0,044).
    """
    played = team_games[
        team_games["played"]
        & (
            (team_games["season"] < season)
            | ((team_games["season"] == season) & (team_games["week"] < week))
        )
    ].sort_values(["season", "week"])

    rows = []
    for _, game_team in _schedule_frame(predictions).iterrows():
        team = game_team["team"]
        recent = played[played["team"] == team].tail(window)
        opp_implied = (game_team["pred_total"] - game_team["pred_margin_for"]) / 2.0
        rows.append(
            {
                "team": team,
                "opponent": game_team["opponent"],
                "is_home": int(game_team["is_home"]),
                "opponent_implied": float(opp_implied),
                "points_allowed_recent": float(recent["points_against"].mean())
                if len(recent) else float("nan"),
                "sacks_recent": float(recent["def_sacks_taken"].mean())
                if len(recent) else float("nan"),
                "takeaways_recent": float(
                    (recent["def_interceptions"] + recent["def_fumbles_lost"]).mean()
                )
                if len(recent) else float("nan"),
                "recent_games": int(len(recent)),
            }
        )
    board = pd.DataFrame(rows)
    # Ascendente: la defensa con el rival más flojo primero. Es un orden por un
    # HECHO del modelo de partidos, no un ranking de defensas.
    return board.sort_values("opponent_implied").reset_index(drop=True)
