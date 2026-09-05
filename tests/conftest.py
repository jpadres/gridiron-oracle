"""Datos sintéticos para los tests.

Los tests **no** usan los datos reales, y es a propósito: `data/raw` va en
`.gitignore` (son ~490 MB) y CI no los descarga. Un test que sólo pasa si
alguien ha corrido `oracle refresh` no es un test, es una nota mental.

Lo que sí se exige a los datos sintéticos: que tengan la misma forma que los
reales (mismas columnas, mismos tipos, orden cronológico) y una estructura
suficiente para que un modelo pueda aprender algo. Si el generador produjera
ruido puro, los tests que comprueban que el modelo aprende pasarían por
casualidad o no pasarían nunca, y en ninguno de los dos casos dirían nada.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.data.ingest import VALID_TEAMS

TEAMS = sorted(VALID_TEAMS)
SEASONS = tuple(range(2010, 2023))
WEEKS_PER_SEASON = 16


def _round_robin(teams: list[str], week: int) -> list[tuple[str, str]]:
    """Emparejamientos de una jornada: rotación simple sobre la lista de equipos.

    No pretende imitar el calendario real de la NFL (divisiones, conferencias).
    Para lo que se prueba aquí — que el estado avanza en orden y que las
    features no miran al futuro — el calendario concreto es irrelevante.
    """
    rotated = teams[:1] + teams[1:][week % (len(teams) - 1):] + teams[1:][: week % (len(teams) - 1)]
    half = len(rotated) // 2
    return list(zip(rotated[:half], rotated[half:][::-1], strict=True))


@pytest.fixture(scope="session")
def synthetic_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """(games, team_games) con estructura aprendible y ruido realista."""
    rng = np.random.default_rng(20260816)

    # Fuerza latente por equipo, con arrastre entre temporadas. Es lo que el
    # modelo debería recuperar; sin esto, no hay nada que aprender.
    strength = {team: rng.normal(0, 3.0) for team in TEAMS}

    games: list[dict] = []
    team_rows: list[dict] = []
    game_number = 0

    for season in SEASONS:
        for team in TEAMS:
            strength[team] = 0.75 * strength[team] + rng.normal(0, 1.5)
        for week in range(1, WEEKS_PER_SEASON + 1):
            for home, away in _round_robin(TEAMS, week):
                game_number += 1
                game_id = f"{season}_{week:02d}_{away}_{home}"
                # HFA de 2 puntos + fuerza relativa + ruido con σ≈13, que es la
                # dispersión real del margen en la NFL.
                expected = strength[home] - strength[away] + 2.0
                margin = float(np.round(expected + rng.normal(0, 13.0)))
                total_points = float(np.round(44.0 + rng.normal(0, 9.0)))
                home_score = max(int(round((total_points + margin) / 2)), 0)
                away_score = max(int(round((total_points - margin) / 2)), 0)

                # La "línea de mercado" es la expectativa verdadera con un ruido
                # pequeño: imita un mercado eficiente. Es lo que hace que el
                # test de "no batir al mercado por mucho" tenga sentido.
                spread_line = float(np.round((expected + rng.normal(0, 1.2)) * 2) / 2)
                total_line = float(np.round((44.0 + rng.normal(0, 2.0)) * 2) / 2)

                games.append(
                    {
                        "game_id": game_id,
                        "season": season,
                        "week": week,
                        "game_type": "REG",
                        "gameday": pd.Timestamp(f"{season}-09-01") + pd.Timedelta(days=7 * week),
                        "home_team": home,
                        "away_team": away,
                        "home_score": home_score,
                        "away_score": away_score,
                        "spread_line": spread_line,
                        "total_line": total_line,
                        "home_moneyline": -110.0,
                        "away_moneyline": -110.0,
                        "margin": float(home_score - away_score),
                        "total": float(home_score + away_score),
                        "neutral_site": 0,
                        "played": 1,
                        "home_qb_id": f"QB_{home}",
                        "away_qb_id": f"QB_{away}",
                    }
                )

                for team, opponent, own_strength, other in (
                    (home, away, strength[home], strength[away]),
                    (away, home, strength[away], strength[home]),
                ):
                    epa = own_strength / 40.0 + rng.normal(0, 0.12)
                    team_rows.append(
                        {
                            "game_id": game_id,
                            "team": team,
                            "opponent": opponent,
                            "off_epa": epa,
                            "pass_epa": epa + rng.normal(0, 0.05),
                            "rush_epa": epa * 0.5 + rng.normal(0, 0.05),
                            "off_plays": float(rng.integers(55, 75)),
                            "pass_plays": float(rng.integers(28, 45)),
                            "rush_plays": float(rng.integers(18, 35)),
                            "dropbacks": float(rng.integers(30, 48)),
                            "def_epa": other / 40.0 + rng.normal(0, 0.12),
                        }
                    )

    games_frame = pd.DataFrame(games)
    team_games_frame = pd.DataFrame(team_rows)
    return games_frame, team_games_frame


@pytest.fixture(scope="session")
def features(synthetic_data) -> pd.DataFrame:
    from oracle.data.features import build_features

    games, team_games = synthetic_data
    frame, _ = build_features(games, team_games)
    return frame


@pytest.fixture(scope="session")
def player_weeks() -> pd.DataFrame:
    """Estadística semanal sintética de jugadores para los tests de fantasy."""
    rng = np.random.default_rng(4242)
    rows: list[dict] = []

    for team in TEAMS[:8]:
        roster = (
            [(f"{team}_QB1", "QB", 1.0), (f"{team}_QB2", "QB", 0.15)]
            + [(f"{team}_RB{i}", "RB", 1.0 / i) for i in (1, 2, 3)]
            + [(f"{team}_WR{i}", "WR", 1.0 / i) for i in (1, 2, 3, 4)]
            + [(f"{team}_TE1", "TE", 1.0)]
        )
        for season in (2023, 2024):
            for week in range(1, 15):
                for player_id, position, usage in roster:
                    rows.append(
                        _player_row(rng, player_id, position, usage, team, season, week)
                    )
    return pd.DataFrame(rows)


def _player_row(rng, player_id, position, usage, team, season, week) -> dict:
    base = {
        "player_id": player_id,
        "player_name": player_id.replace("_", " "),
        "position": position,
        "team": team,
        "opponent": TEAMS[(hash(player_id) + week) % len(TEAMS)],
        "season": season,
        "week": week,
        # nflverse trae la etapa en cada fila; sin ella `regular_season` FALLA
        # CERRADO a propósito, así que el doble tiene que parecerse al original.
        "season_type": "REG",
        "attempts": 0.0,
        "carries": 0.0,
        "targets": 0.0,
        "receptions": 0.0,
        "passing_yards": 0.0,
        "passing_tds": 0.0,
        "interceptions": 0.0,
        "rushing_yards": 0.0,
        "rushing_tds": 0.0,
        "receiving_yards": 0.0,
        "receiving_tds": 0.0,
    }
    if position == "QB":
        attempts = max(rng.normal(34, 5) * usage, 0)
        base.update(
            attempts=attempts,
            passing_yards=attempts * rng.normal(7.2, 0.8),
            passing_tds=rng.poisson(1.6 * usage),
            interceptions=rng.poisson(0.8 * usage),
            carries=max(rng.normal(4, 2) * usage, 0),
            rushing_yards=max(rng.normal(14, 10) * usage, 0),
        )
    elif position == "RB":
        carries = max(rng.normal(14, 4) * usage, 0)
        targets = max(rng.normal(3.5, 1.5) * usage, 0)
        base.update(
            carries=carries,
            rushing_yards=carries * rng.normal(4.3, 0.7),
            rushing_tds=rng.poisson(0.5 * usage),
            targets=targets,
            receptions=targets * 0.75,
            receiving_yards=targets * rng.normal(6.5, 1.5),
        )
    else:
        targets = max(rng.normal(7, 2) * usage, 0)
        base.update(
            targets=targets,
            receptions=targets * 0.64,
            receiving_yards=targets * rng.normal(8.2, 1.5),
            receiving_tds=rng.poisson(0.45 * usage),
        )
    return base
