#!/usr/bin/env python3
"""¿Mejora la curva de edad la proyección fuera de muestra?

Umbral preregistrado en `docs/PREREGISTRO_edad.md`, fijado antes de ejecutar:
**el MAE global tiene que mejorar Y el de running back también**. La segunda es
la que importa — el acantilado del corredor es la justificación central de la
curva y su parámetro más agresivo.

Si no pasa, la curva no se activa y los parámetros NO se retocan para que pase.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.fantasy.ages import ages_for_season, birth_dates
from oracle.fantasy.draft import project_season
from oracle.fantasy.scoring import PPR, score_player_weeks

SEASONS = range(2019, 2026)
POSITIONS = ("QB", "RB", "WR", "TE")
# Sólo jugadores con volumen real. Incluir a los 800 que jugaron dos partidos
# mide sobre todo quién es titular, que no es lo que la curva pretende arreglar.
MIN_PROJECTED = 50.0


def main() -> int:
    paths = resolve_paths(None)
    players = pd.read_parquet(paths.player_weeks)
    births = birth_dates(paths.raw)
    print(f"Fechas de nacimiento disponibles: {len(births)}\n")

    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()

    rows = []
    for season in SEASONS:
        try:
            plain = project_season(players, season, PPR)
            aged = project_season(players, season, PPR,
                                 ages=ages_for_season(births, season))
        except ValueError:
            continue
        try:
            truth = actual.xs(season, level="season")
        except KeyError:
            continue

        for frame, label in ((plain, "sin"), (aged, "con")):
            subset = frame[frame["projected_points"] >= MIN_PROJECTED]
            subset = subset[subset["player_id"].isin(truth.index)]
            for _, row in subset.iterrows():
                rows.append({
                    "season": season,
                    "variant": label,
                    "position": row["position"],
                    "player_id": row["player_id"],
                    "error": abs(float(row["projected_points"])
                                 - float(truth.loc[row["player_id"]])),
                })

    panel = pd.DataFrame(rows)
    if panel.empty:
        print("Sin datos suficientes.")
        return 1

    print(f"{len(panel) // 2} jugador-temporadas por variante "
          f"({panel.season.min()}-{panel.season.max()})\n")

    print(f"{'posición':<10}{'MAE sin':>10}{'MAE con':>10}{'mejora':>10}")
    print("-" * 40)
    results = {}
    for position in ("TODAS", *POSITIONS):
        chunk = panel if position == "TODAS" else panel[panel.position == position]
        if chunk.empty:
            continue
        without = chunk[chunk.variant == "sin"]["error"].mean()
        with_age = chunk[chunk.variant == "con"]["error"].mean()
        delta = without - with_age
        results[position] = delta
        mark = "mejora" if delta > 0 else "empeora"
        print(f"{position:<10}{without:>10.2f}{with_age:>10.2f}"
              f"{delta:>+9.2f}  {mark}")

    print("-" * 40)
    overall_ok = results.get("TODAS", 0) > 0
    rb_ok = results.get("RB", 0) > 0
    print("\nUmbral preregistrado: mejora global Y mejora en RB.")
    print(f"  global: {'PASA' if overall_ok else 'NO PASA'}"
          f"   RB: {'PASA' if rb_ok else 'NO PASA'}")
    print()
    if overall_ok and rb_ok:
        print("PASA. Se activa la curva y se quita la limitación de la web.")
        return 0
    print("NO PASA. La curva NO se activa. Los parámetros no se retocan: son la")
    print("hipótesis, y ajustarlos hasta que mejore es ajustar al test.")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
