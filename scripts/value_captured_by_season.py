#!/usr/bin/env python3
"""Valor capturado por TEMPORADA: modelo contra baseline, sobre el pool congelado.

La regla de aceptación del proyecto es por temporada —«ayuda en todas o es
INCONCLUSO»— y se aplicó a cada cambio menos a la comparación principal. Esto
es la lectura del arnés que faltaba: si el 0,810 de RB es la media de dos
temporadas buenas y dos flojas, la ventaja es más frágil de lo que se publica.

No entrena nada nuevo: llama a `validate()` y enseña la tabla sin agregar.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from fantasy_build import validate  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.ages import birth_dates  # noqa: E402
from oracle.fantasy.draft import LeagueSettings  # noqa: E402
from oracle.fantasy.scoring import rules_from_name  # noqa: E402

K = {"QB": 12, "RB": 24, "WR": 36, "TE": 12}


def main() -> int:
    paths = resolve_paths(None).ensure()
    players = pd.read_parquet(paths.player_weeks)
    team_games = pd.read_parquet(paths.team_games)
    bdays = birth_dates(paths.raw)
    # CON curva de edad: el modelo publicado. Es la serie que manda.
    v = validate(players, rules_from_name("ppr"), LeagueSettings(teams=12),
                 team_games=team_games, birth_dates_by_player=bdays)
    # SIN curva: lo que el arnés medía hasta el 2 de septiembre. Se enseña al
    # lado para poder leer qué hace la curva por ORDEN, no por MAE.
    v0 = validate(players, rules_from_name("ppr"), LeagueSettings(teams=12),
                  team_games=team_games, birth_dates_by_player=None)
    sin = v0["value_captured_by_season"]
    sin = sin[sin["predictor"] == "model"].rename(columns={"value_captured": "sin_curva"})

    caps = v["value_captured_by_season"]
    caps = caps[caps["predictor"].isin(["model", "last_season"])]
    t = caps.pivot_table(index=["position", "season"], columns="predictor",
                         values="value_captured").reset_index()
    t["delta"] = t["model"] - t["last_season"]
    t = t.merge(sin[["position", "season", "sin_curva"]], on=["position", "season"], how="left")
    t["curva"] = t["model"] - t["sin_curva"]
    pd.set_option("display.width", 200)
    print("=== VALOR CAPTURADO POR TEMPORADA (pool congelado) — model = CON curva de edad ===")
    print(t.to_string(index=False, float_format=lambda x: f"{x:.3f}"))

    print("\n=== por posición: media, mínimo, temporadas en que el modelo gana ===")
    for pos, g in t.groupby("position"):
        print(f"  {pos}: con curva {g['model'].mean():.3f} (mín {g['model'].min():.3f}, gana "
              f"{(g['delta'] > 0).sum()} de {len(g)}) · sin curva {g['sin_curva'].mean():.3f} (gana "
              f"{((g['sin_curva'] - g['last_season']) > 0).sum()} de {len(g)}) · baseline "
              f"{g['last_season'].mean():.3f} · la curva vale {g['curva'].mean():+.3f} de media, "
              f"[{g['curva'].min():+.3f}, {g['curva'].max():+.3f}]")

    print("\n=== global ponderado por k (lo que publica el arnés como ALL) ===")
    for pred in ("model", "last_season"):
        m = t.groupby("position")[pred].mean()
        print(f"  {pred:<12} {np.average([m[p] for p in K], weights=list(K.values())):.3f}")
    print("\n=== tabla agregada del arnés ===")
    print(v["value_captured"].to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    caps.to_csv(paths.out / "value_captured_by_season.csv", index=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
