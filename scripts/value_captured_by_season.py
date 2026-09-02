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
from oracle.fantasy.draft import LeagueSettings  # noqa: E402
from oracle.fantasy.scoring import rules_from_name  # noqa: E402

K = {"QB": 12, "RB": 24, "WR": 36, "TE": 12}


def main() -> int:
    paths = resolve_paths(None).ensure()
    players = pd.read_parquet(paths.player_weeks)
    team_games = pd.read_parquet(paths.team_games)
    v = validate(players, rules_from_name("ppr"), LeagueSettings(teams=12), team_games=team_games)

    caps = v["value_captured_by_season"]
    caps = caps[caps["predictor"].isin(["model", "last_season"])]
    t = caps.pivot_table(index=["position", "season"], columns="predictor",
                         values="value_captured").reset_index()
    t["delta"] = t["model"] - t["last_season"]
    pd.set_option("display.width", 200)
    print("=== VALOR CAPTURADO POR TEMPORADA (pool congelado) ===")
    print(t.to_string(index=False, float_format=lambda x: f"{x:.3f}"))

    print("\n=== por posición: media, mínimo, temporadas en que el modelo gana ===")
    for pos, g in t.groupby("position"):
        print(f"  {pos}: modelo {g['model'].mean():.3f} (mín {g['model'].min():.3f}) · "
              f"baseline {g['last_season'].mean():.3f} · delta medio {g['delta'].mean():+.3f} · "
              f"gana en {(g['delta'] > 0).sum()} de {len(g)}")

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
