"""Proyecciones de temporada y board de draft por VOR.

## Cómo se proyecta

Volumen y eficiencia de las tres últimas temporadas, ponderadas **56/30/14**.
No es una media: el año pasado dice mucho más que hace tres, pero hace tres años
sigue diciendo algo — sobre todo para separar al jugador bueno que tuvo una
temporada mala del jugador mediocre que tuvo una buena.

Encima van tres correcciones, por orden de cuánto cambian el resultado:

1. **Encogimiento hacia la media posicional según el tamaño de muestra.** Un
   jugador con seis partidos no tiene derecho a una proyección extrema.
2. **Regresión de touchdowns, más fuerte que la de todo lo demás.** Los TD son
   la estadística más ruidosa del fantasy y la que más engaña al mirar el año
   anterior: la tasa de TD por acarreo dentro de la zona roja no persiste casi
   nada de un año a otro, pero el volumen sí. Un corredor con 14 TD y 220
   acarreos casi siempre baja; el que no ve nadie es que el que tuvo 4 TD con
   los mismos acarreos casi siempre sube.
3. **Curva de edad por posición.** El acantilado del running back a partir de
   los 28 está bien documentado y es brutal. Los receptores aguantan hasta los
   30-31 y los quarterbacks hasta bien pasados los 35.

## Por qué el orden final es por VOR y no por puntos

Comparar un quarterback con un running back por puntos totales no significa
nada: el QB siempre gana y aun así se le elige en la ronda 8. Lo que importa no
es cuántos puntos hace un jugador, sino **cuántos más hace que el que puedes
conseguir gratis en su posición**. Eso es VOR (valor sobre reemplazo), y es la
única comparación honesta entre posiciones.

Los tiers salen de los huecos reales en VOR, no de cortar la lista en trozos de
doce. Un hueco grande dice "si no coges a uno de estos ahora, ya no hay"; una
zona plana dice "puedes esperar una ronda entera y da igual".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .scoring import PPR, ScoringRules, score_player_weeks

# Ponderación de las tres últimas temporadas. Suma 1.
SEASON_WEIGHTS = (0.56, 0.30, 0.14)

# Partidos proyectados para todos. Es una simplificación consciente y está en
# las limitaciones del README: no se diferencia el riesgo de lesión individual,
# porque las lesiones pasadas predicen las futuras mucho peor de lo que se cree
# y una proyección "ajustada por lesiones" mal hecha es peor que ninguna.
PROJECTED_GAMES = 15.5

# Partidos de prior del encogimiento hacia la media posicional. 10 ≈ media
# temporada: con menos de eso, la proyección es sobre todo la media de su
# posición, que es exactamente lo que debe ser.
SHRINK_PRIOR_GAMES = 10.0

# Los TD se encogen mucho más que el resto. 0.55 significa que sólo se conserva
# el 55% de la desviación del jugador respecto a la tasa esperada de su posición.
TD_PERSISTENCE = 0.55

# Curvas de edad: (edad de pico, caída anual antes del pico, caída anual después).
# Las cifras son fracción de producción por año de distancia al pico.
AGE_CURVES: dict[str, tuple[float, float, float]] = {
    "QB": (28.0, 0.010, 0.010),
    "RB": (25.5, 0.015, 0.055),  # el acantilado: 5,5% por año pasados los 25,5
    "WR": (26.5, 0.020, 0.025),
    "TE": (27.0, 0.030, 0.025),
}

# Titulares por equipo en una liga estándar de 12. El nivel de reemplazo sale de
# aquí: en una liga de 10 o con dos QB, cambia — y cambia el board entero.
DEFAULT_STARTERS = {"QB": 1.0, "RB": 2.5, "WR": 3.0, "TE": 1.0}
DEFAULT_TEAMS = 12

FANTASY_POSITIONS = ("QB", "RB", "WR", "TE")


@dataclass(frozen=True)
class LeagueSettings:
    teams: int = DEFAULT_TEAMS
    starters: tuple[tuple[str, float], ...] = tuple(DEFAULT_STARTERS.items())

    def replacement_rank(self, position: str) -> int:
        """Puesto del jugador de reemplazo en esa posición.

        RB y WR llevan 0.5 de más por el hueco flexible: en la práctica se
        draftean más de los que se alinean.
        """
        per_team = dict(self.starters).get(position, 1.0)
        return max(int(round(self.teams * per_team)), 1)


def project_season(
    player_weeks: pd.DataFrame,
    season: int,
    rules: ScoringRules = PPR,
    ages: pd.Series | None = None,
) -> pd.DataFrame:
    """Proyección de temporada completa para `season`.

    Usa **sólo** temporadas anteriores a `season`. Es la misma regla
    walk-forward del modelo de partidos: la validación de 2024 no puede haber
    visto 2024.
    """
    history = player_weeks[player_weeks["season"] < season].copy()
    if history.empty:
        raise ValueError(f"No hay historial anterior a {season}.")

    history["fantasy_points"] = score_player_weeks(history, rules)
    seasons = sorted(history["season"].unique())[-len(SEASON_WEIGHTS):]
    history = history[history["season"].isin(seasons)]

    # Peso por temporada: la más reciente se lleva 0.56. Si sólo hay dos
    # temporadas de historial, los pesos se renormalizan solos.
    weight_by_season = {
        s: w for s, w in zip(sorted(seasons, reverse=True), SEASON_WEIGHTS, strict=False)
    }
    history["season_weight"] = history["season"].map(weight_by_season).fillna(0.0)

    grouped = history.groupby(["player_id", "position"], observed=True)
    aggregated = grouped.apply(_weighted_player_row, include_groups=False).reset_index()

    aggregated = aggregated[aggregated["position"].isin(FANTASY_POSITIONS)].copy()
    aggregated = aggregated[aggregated["weighted_games"] > 0]

    projections = []
    for position, group in aggregated.groupby("position", observed=True):
        group = group.copy()
        position_mean = np.average(
            group["points_per_game"], weights=group["weighted_games"]
        )
        # Encogimiento hacia la media de la posición.
        reliability = group["weighted_games"] / (group["weighted_games"] + SHRINK_PRIOR_GAMES)
        group["ppg_shrunk"] = position_mean + reliability * (
            group["points_per_game"] - position_mean
        )
        # Los TD se tratan aparte y se encogen más. Se descuenta el exceso de TD
        # sobre lo esperado y se devuelve sólo la parte que persiste.
        td_mean = np.average(group["td_per_game"], weights=group["weighted_games"])
        excess_td = group["td_per_game"] - td_mean
        td_correction = (TD_PERSISTENCE - 1.0) * excess_td * reliability
        group["ppg_shrunk"] += td_correction * _td_points(position, rules)
        projections.append(group)

    board = pd.concat(projections, ignore_index=True)

    if ages is not None:
        board["age"] = board["player_id"].map(ages)
        board["age_factor"] = [
            _age_factor(position, age) for position, age in zip(board["position"], board["age"],
                                                               strict=True)
        ]
    else:
        # Sin fechas de nacimiento no se inventa una corrección: factor 1 y se
        # dice en la salida que no se aplicó.
        board["age"] = np.nan
        board["age_factor"] = 1.0

    board["projected_points"] = board["ppg_shrunk"] * board["age_factor"] * PROJECTED_GAMES
    board["season"] = season
    return board.sort_values("projected_points", ascending=False).reset_index(drop=True)


def _weighted_player_row(group: pd.DataFrame) -> pd.Series:
    """Agrega la historia de un jugador con los pesos por temporada."""
    weights = group["season_weight"].to_numpy(dtype=float)
    total = weights.sum()
    if total <= 0:
        return pd.Series({"weighted_games": 0.0, "points_per_game": 0.0, "td_per_game": 0.0})

    points = group["fantasy_points"].fillna(0.0).to_numpy(dtype=float)
    tds = sum(
        group[c].fillna(0.0).to_numpy(dtype=float)
        for c in ("passing_tds", "rushing_tds", "receiving_tds")
        if c in group.columns
    )
    tds = tds if isinstance(tds, np.ndarray) else np.zeros(len(group))

    return pd.Series(
        {
            # `weighted_games` no son partidos reales: son partidos ponderados
            # por antigüedad, y es la escala correcta para el encogimiento
            # (una temporada de hace tres años debe dar menos confianza).
            "weighted_games": float(total),
            "points_per_game": float((points * weights).sum() / total),
            "td_per_game": float((tds * weights).sum() / total),
            "player_name": group["player_name"].iloc[-1] if "player_name" in group else "",
            "team": group["team"].iloc[-1] if "team" in group else "",
        }
    )


def _td_points(position: str, rules: ScoringRules) -> float:
    """Puntos por TD de la posición, para convertir la corrección de TD a puntos."""
    return rules.passing_td if position == "QB" else rules.rushing_td


def _age_factor(position: str, age: float) -> float:
    """Multiplicador por edad. 1.0 en el pico de la posición."""
    if age is None or not np.isfinite(age):
        return 1.0
    peak, rise, decline = AGE_CURVES.get(position, (27.0, 0.02, 0.03))
    distance = age - peak
    slope = decline if distance > 0 else rise
    # Suelo en 0.55: ni el running back más viejo produce cero, y sin suelo la
    # extrapolación lineal daría factores negativos a los 38.
    return float(max(1.0 - slope * abs(distance), 0.55))


def draft_board(
    projections: pd.DataFrame,
    settings: LeagueSettings | None = None,
    tier_threshold: float = 0.6,
) -> pd.DataFrame:
    """Ordena por VOR y agrupa en tiers.

    `tier_threshold` está en desviaciones típicas del hueco entre jugadores
    consecutivos: un corte cuando el hueco es claramente mayor de lo normal.
    """
    settings = settings or LeagueSettings()
    board = projections.copy()

    replacement: dict[str, float] = {}
    for position, group in board.groupby("position", observed=True):
        ranked = group.sort_values("projected_points", ascending=False)
        index = min(settings.replacement_rank(position), len(ranked)) - 1
        replacement[position] = float(ranked["projected_points"].iloc[index])

    board["replacement_points"] = board["position"].map(replacement)
    board["vor"] = board["projected_points"] - board["replacement_points"]
    board = board.sort_values("vor", ascending=False).reset_index(drop=True)
    board["overall_rank"] = np.arange(1, len(board) + 1)
    board["position_rank"] = board.groupby("position", observed=True)["vor"].rank(
        ascending=False, method="first"
    ).astype(int)
    board["tier"] = _tiers(board["vor"].to_numpy(dtype=float), tier_threshold)
    return board


def _tiers(vor: np.ndarray, threshold: float) -> np.ndarray:
    """Corta en tiers donde el hueco entre jugadores consecutivos es anómalo."""
    if vor.size == 0:
        return np.array([], dtype=int)
    gaps = -np.diff(vor)
    if gaps.size == 0:
        return np.ones(1, dtype=int)
    cut = gaps.mean() + threshold * gaps.std()
    tiers = np.ones(vor.size, dtype=int)
    current = 1
    for i, gap in enumerate(gaps):
        if gap > cut:
            current += 1
        tiers[i + 1] = current
    return tiers
