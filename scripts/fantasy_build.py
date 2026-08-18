#!/usr/bin/env python3
"""Board de draft de fantasy: proyecciones de temporada ordenadas por VOR.

Tarda ~5 minutos porque además de proyectar la temporada que viene, valida la
metodología proyectando las cuatro anteriores contra su resultado real. Esa
validación no es opcional: un board sin correlación medida es una lista de
opiniones.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from oracle.config import paths as resolve_paths
from oracle.fantasy import risk
from oracle.fantasy.draft import (
    LeagueSettings,
    _td_points,
    draft_board,
    project_season,
)
from oracle.fantasy.scoring import rules_from_name, score_player_weeks

# Temporadas sobre las que se reporta la validación. Se fija antes de mirar el
# resultado, que es la regla del proyecto.
VALIDATION_SEASONS = (2022, 2023, 2024, 2025)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera el board de draft.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None, help="Temporada a proyectar.")
    parser.add_argument("--scoring", default="ppr", help="ppr | half | standard")
    parser.add_argument("--teams", type=int, default=12)
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    rules = rules_from_name(args.scoring)
    players = pd.read_parquet(paths.player_weeks)

    season = args.season or int(players["season"].max()) + 1
    settings = LeagueSettings(teams=args.teams)

    print(f"Proyectando {season} ({args.scoring}, liga de {args.teams})...")
    board = draft_board(project_season(players, season, rules), settings)

    # Etiqueta de riesgo. Validada contra el error realizado en
    # `scripts/fantasy_risk_validate.py`: Spearman +0.12 y el tercio de riesgo
    # yerra un 10.7% más. Pasa el umbral, y lo pasa por poco — la web lo dice
    # así, porque «predice el error» y «predice el error un poco» son
    # afirmaciones distintas.
    td_points = {pos: _td_points(pos, rules) for pos in ("QB", "RB", "WR", "TE")}
    board = risk.score(board, td_points)
    board["risk_reasons"] = [risk.reasons(row) for _, row in board.iterrows()]

    print("\nTop 20 por VOR:\n")
    view = board.head(20)[
        ["overall_rank", "player_name", "position", "position_rank", "tier",
         "projected_points", "vor"]
    ]
    print(view.to_string(index=False, float_format=lambda x: f"{x:8.1f}"))

    print("\nValidando la metodología sobre temporadas pasadas...")
    validation = validate(players, rules, settings)
    print(validation.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))
    print(
        "\nSpearman ~0.55 está en línea con lo mejor que se publica — y aun así\n"
        "significa que una de cada tres parejas de jugadores termina en el orden\n"
        "contrario. Los rankings sirven para no cometer errores grandes."
    )

    destination = paths.out / "fantasy_draft.json"
    destination.write_text(
        json.dumps(
            {
                "season": season,
                "scoring": args.scoring,
                "teams": args.teams,
                "board": board.head(250).round(3).to_dict(orient="records"),
                "validation": validation.round(4).to_dict(orient="records"),
            },
            ensure_ascii=False,
            default=str,
        ),
        encoding="utf-8",
    )
    print(f"\nEscrito {destination}")
    return 0


def validate(players: pd.DataFrame, rules, settings: LeagueSettings) -> pd.DataFrame:
    """Proyección de pretemporada frente al resultado real, temporada a temporada.

    Cada temporada se proyecta usando **sólo** lo anterior. Es la misma regla
    walk-forward del modelo de partidos, y por el mismo motivo: proyectar 2023
    con datos de 2023 da correlaciones preciosas y completamente falsas.
    """
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()

    rows = []
    available = sorted(players["season"].unique())
    for season in VALIDATION_SEASONS:
        if season not in available:
            continue
        try:
            projected = project_season(players, season, rules)
        except ValueError:
            continue
        projected = projected.set_index("player_id")
        truth = actual.xs(season, level="season")

        common = projected.index.intersection(truth.index)
        if len(common) < 30:
            continue

        for position in ("QB", "RB", "WR", "TE"):
            subset = projected.loc[common]
            subset = subset[subset["position"] == position]
            if len(subset) < 15:
                continue
            predicted = subset["projected_points"].to_numpy(dtype=float)
            observed = truth.loc[subset.index].to_numpy(dtype=float)
            rows.append(
                {
                    "season": season,
                    "position": position,
                    "players": len(subset),
                    "pearson": float(pearsonr(predicted, observed)[0]),
                    "spearman": float(spearmanr(predicted, observed)[0]),
                    "mae": float(np.mean(np.abs(predicted - observed))),
                }
            )

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    # Se reporta la media por posición sobre todas las temporadas validadas.
    return frame.groupby("position", as_index=False).agg(
        seasons=("season", "nunique"),
        players=("players", "mean"),
        pearson=("pearson", "mean"),
        spearman=("spearman", "mean"),
        mae=("mae", "mean"),
    )


if __name__ == "__main__":
    raise SystemExit(main())
