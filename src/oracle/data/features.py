"""Construcción de features en UNA ÚNICA PASADA CRONOLÓGICA.

# La garantía anti-fuga

Este fichero es el corazón de la honestidad del proyecto. La regla es una sola y
no admite excepciones:

    Para cada partido se emite la fila de features con el estado ANTERIOR al
    partido, y sólo DESPUÉS se actualiza el estado con su resultado.

Por eso es una máquina de estados recorrida con un bucle, y no `groupby().shift()`
ni `rolling()` de pandas. Esas operaciones son cómodas y son también la forma más
fácil que existe de filtrar futuro sin enterarte: basta un `shift` que se olvida,
un `min_periods` mal puesto o un `sort` que no es estable para que la fila de la
semana 3 contenga información de la semana 12. El error no da ningún síntoma —
sólo hace que las métricas salgan sospechosamente buenas.

Con un bucle explícito la fuga es *estructuralmente* imposible: el estado no
puede contener nada que no se haya emitido ya.

Está protegido por `tests/test_model.py::test_features_have_no_future_information`,
que recalcula las features truncando el historial y comprueba que las filas
anteriores al corte salen idénticas. Si tocas este fichero, ese test es la red.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..models.elo import BASE_RATING, EloModel, MarketAnchoredElo
from ..models.ratings import EfficiencyRatings, QBRatings
from .stadiums import travel_profile

# Suavizado exponencial de la forma reciente. 0.30 ≈ media efectiva de los
# últimos 5-6 partidos: suficiente para captar una racha real, corto de más para
# seguir el ruido semana a semana.
FORM_ALPHA = 0.30

# Descanso "normal" entre partidos. Se usa para que la semana 1 (donde el
# descanso real son ocho meses) no entre como un valor extremo.
DEFAULT_REST_DAYS = 7.0
MAX_REST_DAYS = 14.0

FEATURE_COLUMNS = [
    "elo_diff",
    "elo_margin",
    "market_elo_margin",
    "hfa",
    "off_epa_diff",
    "def_epa_diff",
    "net_rating_diff",
    "pass_epa_diff",
    "rush_epa_diff",
    "form_diff",
    "qb_diff",
    "qb_vs_offense",
    "rest_diff",
    "travel_miles_diff",
    "tz_shift_away",
    "altitude_delta_away",
    "neutral_site",
    "indoors",
    "experience_min",
]


@dataclass
class _TeamState:
    """Lo que el modelo sabe de un equipo justo antes de su siguiente partido."""

    form_off: float = 0.0
    form_def: float = 0.0
    last_game_date: pd.Timestamp | None = None
    games_played: float = 0.0


@dataclass
class FeatureBuilder:
    """Máquina de estados de la pasada cronológica.

    Se expone como clase (y no sólo como función) porque la predicción de una
    jornada futura necesita exactamente el mismo estado que dejó el último
    partido jugado. Reconstruirlo de otra forma sería otra oportunidad de
    introducir una discrepancia entre entrenamiento y producción.
    """

    elo: EloModel = field(default_factory=EloModel)
    market_elo: MarketAnchoredElo = field(default_factory=MarketAnchoredElo)
    epa: EfficiencyRatings = field(default_factory=EfficiencyRatings)
    pass_epa: EfficiencyRatings = field(default_factory=EfficiencyRatings)
    rush_epa: EfficiencyRatings = field(default_factory=EfficiencyRatings)
    qbs: QBRatings = field(default_factory=QBRatings)
    teams: dict[str, _TeamState] = field(default_factory=dict)

    def state(self, team: str) -> _TeamState:
        if team not in self.teams:
            self.teams[team] = _TeamState()
        return self.teams[team]

    # -- emisión ----------------------------------------------------------
    def row(self, game: pd.Series) -> dict[str, float]:
        """Features de un partido con el estado actual. NO modifica nada."""
        home, away = game["home_team"], game["away_team"]
        neutral = bool(game.get("neutral_site", 0))
        home_state, away_state = self.state(home), self.state(away)

        travel = travel_profile(home, away, _venue_key(game))

        home_qb = _clean_id(game.get("home_qb_id"))
        away_qb = _clean_id(game.get("away_qb_id"))
        qb_diff = self.qbs.rating(home_qb) - self.qbs.rating(away_qb)

        # `qb_vs_offense`: cuánto se aparta el QB anunciado del nivel reciente
        # del ataque de su equipo. Es la señal que captura suplentes y lesiones
        # sin pagar por un feed de partes médicos: si el ataque venía rindiendo a
        # +0.12 y el QB que sale vale -0.05, algo ha cambiado.
        home_gap = self.qbs.rating(home_qb) - self.epa.offense(home)
        away_gap = self.qbs.rating(away_qb) - self.epa.offense(away)

        return {
            "elo_diff": self.elo.rating(home) - self.elo.rating(away),
            "elo_margin": self.elo.expected_margin(home, away, neutral),
            "market_elo_margin": self.market_elo.expected_margin(home, away, neutral),
            "hfa": 0.0 if neutral else self.elo.hfa_points,
            "off_epa_diff": self.epa.offense(home) - self.epa.offense(away),
            # Signo: `defense()` alto = permisiva, así que la resta al revés
            # deja el feature orientado "positivo favorece al local".
            "def_epa_diff": self.epa.defense(away) - self.epa.defense(home),
            "net_rating_diff": self.epa.net(home) - self.epa.net(away),
            "pass_epa_diff": self.pass_epa.net(home) - self.pass_epa.net(away),
            "rush_epa_diff": self.rush_epa.net(home) - self.rush_epa.net(away),
            "form_diff": (home_state.form_off - home_state.form_def)
            - (away_state.form_off - away_state.form_def),
            "qb_diff": qb_diff,
            "qb_vs_offense": home_gap - away_gap,
            "rest_diff": _rest_days(home_state, game["gameday"])
            - _rest_days(away_state, game["gameday"]),
            "travel_miles_diff": (travel.away_travel_miles - travel.home_travel_miles) / 1000.0,
            "tz_shift_away": travel.away_tz_shift - travel.home_tz_shift,
            "altitude_delta_away": (travel.away_altitude_delta - travel.home_altitude_delta)
            / 1000.0,
            "neutral_site": float(neutral),
            "indoors": float(travel.indoors),
            # Cuántos partidos lleva medido el equipo *menos* conocido de los
            # dos. El modelo lo usa para desconfiar de sus propios ratings en
            # las primeras semanas sin necesidad de una regla explícita.
            "experience_min": min(home_state.games_played, away_state.games_played),
        }

    # -- avance del estado -------------------------------------------------
    def update(self, game: pd.Series, home_stats: pd.Series, away_stats: pd.Series) -> None:
        """Incorpora el resultado. Se llama SIEMPRE después de `row`."""
        home, away = game["home_team"], game["away_team"]
        neutral = bool(game.get("neutral_site", 0))
        margin = float(game["margin"])

        self.elo.update(home, away, margin, neutral)
        spread = game.get("spread_line")
        if pd.notna(spread):
            self.market_elo.update_with_line(home, away, margin, float(spread), neutral)
        else:
            self.market_elo.update(home, away, margin, neutral)

        for ratings, column in (
            (self.epa, "off_epa"),
            (self.pass_epa, "pass_epa"),
            (self.rush_epa, "rush_epa"),
        ):
            plays_column = {
                "off_epa": "off_plays",
                "pass_epa": "pass_plays",
                "rush_epa": "rush_plays",
            }[column]
            for team, opponent, stats in (
                (home, away, home_stats),
                (away, home, away_stats),
            ):
                value = stats.get(column)
                if value is None or pd.isna(value):
                    continue
                ratings.update(team, opponent, float(value), float(stats.get(plays_column) or 0.0))

        # El EPA por *dropback* del QB se aproxima con el EPA de pase del equipo.
        # No es perfecto (incluye la protección y a los receptores), pero es la
        # única señal por partido disponible sin datos de seguimiento, y es la
        # misma para todos los QB, así que no introduce sesgo relativo.
        for qb_id, stats in ((_clean_id(game.get("home_qb_id")), home_stats),
                             (_clean_id(game.get("away_qb_id")), away_stats)):
            value, dropbacks = stats.get("pass_epa"), stats.get("dropbacks")
            if value is not None and not pd.isna(value):
                self.qbs.update(qb_id, float(value), float(dropbacks or 0.0))

        for team, stats in ((home, home_stats), (away, away_stats)):
            team_state = self.state(team)
            off, dfn = stats.get("off_epa"), stats.get("def_epa")
            if off is not None and not pd.isna(off):
                team_state.form_off += FORM_ALPHA * (float(off) - team_state.form_off)
            if dfn is not None and not pd.isna(dfn):
                team_state.form_def += FORM_ALPHA * (float(dfn) - team_state.form_def)
            team_state.last_game_date = game["gameday"]
            team_state.games_played += 1.0

    def start_season(self, season: int) -> None:
        for component in (self.elo, self.market_elo, self.epa, self.pass_epa, self.rush_epa,
                          self.qbs):
            component.start_season(season)

    def snapshot(self) -> dict[str, dict[str, float]]:
        """Estado actual por equipo, para la web y para depurar."""
        return {
            team: {
                "elo": self.elo.rating(team) if team in self.elo.ratings else BASE_RATING,
                "off_epa": self.epa.offense(team),
                "def_epa": self.epa.defense(team),
                "net_epa": self.epa.net(team),
                "games": self.teams.get(team, _TeamState()).games_played,
            }
            for team in sorted(set(self.epa.games) | set(self.elo.ratings))
        }


def _clean_id(value: object) -> str | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def _venue_key(game: pd.Series) -> str | None:
    """Clave de sede neutral, si el partido no se juega en casa del local."""
    if not bool(game.get("neutral_site", 0)):
        return None
    return _clean_id(game.get("venue_key"))


def _rest_days(state: _TeamState, gameday: pd.Timestamp) -> float:
    """Días de descanso, topados.

    El tope no es cosmético: sin él, la semana 1 entra con ~240 días y domina
    cualquier regresión lineal, convirtiendo un feature útil (jugar el jueves
    tras jugar el domingo) en un indicador de "es la primera jornada".
    """
    if state.last_game_date is None or pd.isna(gameday):
        return DEFAULT_REST_DAYS
    days = (gameday - state.last_game_date).days
    return float(min(max(days, 3.0), MAX_REST_DAYS))


def build_features(
    games: pd.DataFrame,
    team_games: pd.DataFrame,
    builder: FeatureBuilder | None = None,
) -> tuple[pd.DataFrame, FeatureBuilder]:
    """Recorre los partidos en orden y devuelve la tabla de features.

    Devuelve también el builder con el estado final, que es lo que necesita
    `predict_week` para pronosticar una jornada que aún no se ha jugado sin
    recalcular nada.
    """
    builder = builder or FeatureBuilder()

    games = games.sort_values(["gameday", "game_id"], kind="mergesort").reset_index(drop=True)
    stats_by_game = {
        game_id: group.set_index("team")
        for game_id, group in team_games.groupby("game_id", observed=True)
    }

    rows: list[dict[str, float]] = []
    for game in games.itertuples(index=False):
        game = pd.Series(game._asdict())
        builder.start_season(int(game["season"]))

        features = builder.row(game)
        features.update(
            {
                "game_id": game["game_id"],
                "season": int(game["season"]),
                "week": int(game["week"]),
                "gameday": game["gameday"],
                "home_team": game["home_team"],
                "away_team": game["away_team"],
                "spread_line": game.get("spread_line"),
                "total_line": game.get("total_line"),
                "margin": game.get("margin"),
                "total": game.get("total"),
                "played": int(game.get("played", 0)),
            }
        )
        rows.append(features)

        # Un partido sin jugar no puede actualizar nada. Este `continue` es la
        # otra mitad de la garantía anti-fuga: cuando se pronostica la jornada
        # que viene, el estado se queda exactamente donde lo dejó el último
        # partido con resultado.
        if not int(game.get("played", 0)) or pd.isna(game.get("margin")):
            continue

        stats = stats_by_game.get(game["game_id"])
        empty = pd.Series(dtype=float)
        home_stats = stats.loc[game["home_team"]] if stats is not None and game[
            "home_team"
        ] in stats.index else empty
        away_stats = stats.loc[game["away_team"]] if stats is not None and game[
            "away_team"
        ] in stats.index else empty
        builder.update(game, home_stats, away_stats)

    frame = pd.DataFrame(rows)
    return frame, builder
