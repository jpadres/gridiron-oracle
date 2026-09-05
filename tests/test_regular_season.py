"""Los playoffs no entran en una proyección de temporada regular.

`player_weeks` trae 20.004 filas de `season_type == "POST"` y hasta el 5 de
septiembre de 2026 la proyección de draft, la semanal y la del pateador las
usaban sin filtrar. Medido sobre 2026: 106 de los 150 primeros del board
cambiaban de puesto, y los que más bajaban eran los de equipos que juegan en
enero. Cuatro partidos de playoffs prestaban muestra a una proyección que se
paga en las 17 jornadas regulares.

Las pruebas son de PROPIEDAD: añadir filas POST a un historial no puede mover
una proyección regular ni un solo decimal.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.fantasy.draft import project_season
from oracle.fantasy.scoring import PPR, regular_season


def _weeks(seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for season in (2023, 2024, 2025):
        for pid in range(40):
            pos = ["QB", "RB", "WR", "TE"][pid % 4]
            base = {"QB": 18, "RB": 12, "WR": 11, "TE": 7}[pos]
            for week in range(1, 18):
                rows.append({
                    "player_id": f"p{pid}", "player_name": f"P {pid}", "position": pos,
                    "team": f"T{pid % 8}", "season": season, "week": week,
                    "season_type": "REG",
                    "passing_yards": rng.normal(250, 40) if pos == "QB" else 0.0,
                    "passing_tds": rng.poisson(1.5) if pos == "QB" else 0,
                    "interceptions": 0, "rushing_yards": rng.normal(60, 15) if pos == "RB" else 0.0,
                    "rushing_tds": rng.poisson(0.4) if pos == "RB" else 0,
                    "receiving_yards": rng.normal(base * 5, 12) if pos in ("WR", "TE") else 0.0,
                    "receiving_tds": rng.poisson(0.3) if pos in ("WR", "TE") else 0,
                    "receptions": rng.poisson(4) if pos in ("WR", "TE", "RB") else 0,
                    "targets": 6, "carries": 12 if pos == "RB" else 0, "fumbles_lost": 0,
                    "attempts": 35 if pos == "QB" else 0,
                })
    return pd.DataFrame(rows)


def _playoff_rows(weeks: pd.DataFrame, players: list[str], season: int) -> pd.DataFrame:
    """Tres partidos de playoffs ENORMES para unos pocos: si entran, se nota."""
    sample = weeks[(weeks["season"] == season) & (weeks["player_id"].isin(players))]
    sample = sample[sample["week"] == 17].copy()
    out = []
    for week in (19, 20, 21):
        block = sample.copy()
        block["week"] = week
        block["season_type"] = "POST"
        for col in ("passing_yards", "rushing_yards", "receiving_yards"):
            block[col] = block[col] * 4.0
        for col in ("passing_tds", "rushing_tds", "receiving_tds"):
            block[col] = block[col] + 3
        out.append(block)
    return pd.concat(out, ignore_index=True)


def test_regular_season_keeps_only_REG():
    w = _weeks()
    with_post = pd.concat([w, _playoff_rows(w, ["p0", "p1"], 2025)], ignore_index=True)
    assert set(regular_season(with_post)["season_type"]) == {"REG"}
    assert len(regular_season(with_post)) == len(w)


def test_regular_season_tolerates_a_frame_without_the_column():
    w = _weeks().drop(columns=["season_type"])
    assert regular_season(w) is w


def test_playoff_rows_cannot_move_a_regular_season_projection():
    """LA PROPIEDAD. Con y sin playoffs, la proyección es idéntica."""
    w = _weeks()
    inflated = pd.concat([w, _playoff_rows(w, ["p0", "p1", "p2", "p3"], 2025)], ignore_index=True)

    clean = project_season(w, 2026, PPR).set_index("player_id").sort_index()
    dirty = project_season(inflated, 2026, PPR).set_index("player_id").sort_index()

    assert list(clean.index) == list(dirty.index)
    pd.testing.assert_series_equal(
        clean["projected_points"], dirty["projected_points"], check_names=False,
    )


def test_the_injection_would_have_been_visible():
    """Sin el filtro, esas mismas filas SÍ mueven la proyección: la prueba de
    arriba no pasa en vacío."""
    w = _weeks()
    post = _playoff_rows(w, ["p0", "p1", "p2", "p3"], 2025)
    relabeled = post.copy()
    relabeled["season_type"] = "REG"           # los mismos partidos, sin la etiqueta
    inflated = pd.concat([w, relabeled], ignore_index=True)

    clean = project_season(w, 2026, PPR).set_index("player_id")
    dirty = project_season(inflated, 2026, PPR).set_index("player_id")
    moved = (clean.loc[["p0", "p1", "p2", "p3"], "projected_points"]
             - dirty.loc[["p0", "p1", "p2", "p3"], "projected_points"]).abs()
    assert (moved > 1.0).all(), f"las filas inyectadas no mueven nada: {moved.to_dict()}"


@pytest.mark.parametrize("stamp,expected", [
    ("2026-09-04T18:00:00+00:00", "2026-09-04T18:00:00+00:00"),
    ("2026-09-06T00:00:00+00:00", "2026-09-06T00:00:00+00:00"),   # un día: tolerado
    ("2026-09-20T00:00:00+00:00", None),                          # dos semanas: imposible
    ("2027-01-01", None),
    ("no-es-fecha", None),
    ("", None),
    (None, None),
])
def test_a_publication_date_from_the_future_is_unknown(stamp, expected):
    from datetime import datetime, timezone

    from oracle.narrative.research import _not_from_the_future

    now = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)
    assert _not_from_the_future(stamp, now=now) == expected
