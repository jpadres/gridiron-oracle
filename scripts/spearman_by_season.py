"""Spearman modelo vs baseline, temporada a temporada, con el arnés real.

La página afirma que el modelo «gana 8 de 16 temporadas-posición» en
correlación de rango. Esa cifra no salía de ningún fichero: el arnés sólo
publicaba la media de cuatro temporadas. Este script imprime la tabla sin
agregar (`by_position_season`) para que la afirmación se pueda comprobar y
reescribir cuando cambie.

    python scripts/spearman_by_season.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))

import pandas as pd
from fantasy_build import validate  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.ages import birth_dates  # noqa: E402
from oracle.fantasy.draft import LeagueSettings  # noqa: E402
from oracle.fantasy.scoring import rules_from_name  # noqa: E402


def main() -> int:
    paths = resolve_paths(None).ensure()
    players = pd.read_parquet(paths.player_weeks)
    team_games = pd.read_parquet(paths.team_games)
    bdays = birth_dates(paths.raw)
    v = validate(players, rules_from_name("ppr"), LeagueSettings(teams=12),
                 team_games=team_games, birth_dates_by_player=bdays)
    t = v["by_position_season"]
    t = t[t["predictor"].isin(["model", "last_season"])]
    wide = t.pivot_table(index=["position", "season"], columns="predictor",
                         values="spearman").reset_index()
    wide["delta"] = wide["model"] - wide["last_season"]
    wide["gana"] = wide["delta"] > 0
    print("=== SPEARMAN POR TEMPORADA (pool congelado, board real) ===")
    print(wide.round(3).to_string(index=False))
    print()
    resumen = wide.groupby("position").agg(
        model=("model", "mean"), last_season=("last_season", "mean"), gana=("gana", "sum"))
    print(resumen.round(3).to_string())
    print(f"\nmodelo gana {int(wide['gana'].sum())} de {len(wide)} temporadas-posición")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
