#!/usr/bin/env python3
"""¿La etiqueta de riesgo predice un error mayor? Si no, no es riesgo.

    python scripts/fantasy_risk_validate.py

## El umbral, fijado antes de ver el resultado

1. La correlación de Spearman entre `risk_score` y el error absoluto normalizado
   debe ser **positiva y >= 0.10**, agrupando las temporadas de evaluación.
2. El tercio de más riesgo debe tener un error medio **>= 10% mayor** que el
   tercio más seguro.

Si falla cualquiera de las dos, las etiquetas **no se publican como riesgo**. Se
podrán publicar sus componentes por separado —muestra, encogimiento, dependencia
del touchdown, que son hechos medidos— pero sin afirmar que anticipan nada.

Cada temporada se proyecta con datos **anteriores** a esa temporada, igual que
todo lo demás del proyecto.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd
from scipy.stats import spearmanr

from oracle.config import paths as resolve_paths
from oracle.fantasy import risk
from oracle.fantasy.draft import _td_points, project_season
from oracle.fantasy.scoring import rules_from_name, score_player_weeks

SEASONS = (2022, 2023, 2024, 2025)
MIN_SPEARMAN = 0.10
MIN_GAP = 0.10


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Valida la etiqueta de riesgo")
    parser.add_argument("--root", default=None)
    parser.add_argument("--scoring", default="ppr")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root)
    players = pd.read_parquet(paths.player_weeks)
    rules = rules_from_name(args.scoring)
    td_points = {pos: _td_points(pos, rules) for pos in ("QB", "RB", "WR", "TE")}

    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()

    rows = []
    for season in SEASONS:
        if season not in set(players["season"].unique()):
            continue
        projected = project_season(players, season, rules).set_index("player_id")
        truth = actual.xs(season, level="season")
        common = projected.index.intersection(truth.index)
        if len(common) < 40:
            continue
        subset = risk.score(projected.loc[common].reset_index(), td_points)
        subset["observed"] = truth.loc[subset["player_id"]].to_numpy(dtype=float)

        # Se normaliza DENTRO de cada posición y temporada: si no, la
        # correlación mide sobre todo qué posición es cada jugador.
        for position, group in subset.groupby("position", observed=True):
            if len(group) < 15:
                continue
            error = risk.normalised_error(
                group["projected_points"].to_numpy(dtype=float),
                group["observed"].to_numpy(dtype=float),
            )
            rows.append(pd.DataFrame({
                "season": season, "position": position,
                "risk_score": group["risk_score"].to_numpy(),
                "risk_label": group["risk_label"].to_numpy(),
                "error": error,
            }))

    if not rows:
        print("Sin datos suficientes.")
        return 1

    data = pd.concat(rows, ignore_index=True)
    rho, pvalue = spearmanr(data["risk_score"], data["error"])

    terciles = data["risk_score"].quantile([1 / 3, 2 / 3]).to_numpy()
    safe = data[data["risk_score"] <= terciles[0]]["error"].mean()
    risky = data[data["risk_score"] >= terciles[1]]["error"].mean()
    gap = (risky - safe) / safe if safe else 0.0

    print(f"Jugador-temporadas evaluados: {len(data)} ({data['season'].nunique()} temporadas)\n")
    print(f"Spearman(riesgo, error normalizado): {rho:+.4f}  (p={pvalue:.4g})")
    print(f"Error medio tercio seguro:    {safe:.4f}")
    print(f"Error medio tercio arriesgado: {risky:.4f}")
    print(f"Diferencia relativa:           {gap:+.1%}\n")

    print("Por etiqueta:")
    print(data.groupby("risk_label")["error"].agg(["count", "mean"]).round(4).to_string())
    print("\nPor posición:")
    for position, group in data.groupby("position", observed=True):
        r, _ = spearmanr(group["risk_score"], group["error"])
        print(f"  {position}: Spearman {r:+.3f}  (n={len(group)})")

    passed = rho >= MIN_SPEARMAN and gap >= MIN_GAP
    print("\n" + ("=" * 62))
    if passed:
        print(f"PASA. Spearman {rho:+.3f} >= {MIN_SPEARMAN} y diferencia {gap:+.1%} >= {MIN_GAP:.0%}.")
        print("La etiqueta de riesgo se puede publicar como tal.")
    else:
        print(f"NO PASA. Spearman {rho:+.3f} (umbral {MIN_SPEARMAN}), "
              f"diferencia {gap:+.1%} (umbral {MIN_GAP:.0%}).")
        print("NO se publica como riesgo. Sus componentes son hechos medidos y")
        print("se pueden enseñar, pero sin afirmar que anticipan el error.")
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
