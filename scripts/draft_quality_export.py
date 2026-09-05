#!/usr/bin/env python3
"""Exporta los boards históricos + lo que cada jugador REALIZÓ, para medir drafts.

No mide nada: sólo saca los datos que el simulador necesita. La medición vive en
`web/tools/lab/draft-quality.mjs`, en Node, porque el motor que se está juzgando
es JavaScript y **reimplementarlo en Python para medirlo sería un segundo
traductor** — el fallo que este repositorio lleva siete veces cometiendo. Se
juzga la función que corre en producción o no se juzga.

Walk-forward por construcción: `project_season(players, S)` compila el board de
la temporada S usando sólo datos anteriores a S. Lo realizado se suma aparte, de
`player_weeks`, y NO entra en ninguna proyección.

    python scripts/draft_quality_export.py     # ~1 min por temporada
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.draft import draft_board, project_season  # noqa: E402
from oracle.fantasy.scoring import PPR, score_player_weeks  # noqa: E402

# Las mismas del resto de validaciones del repositorio, para que los números se
# puedan comparar entre estudios sin preguntarse por la ventana.
EVALUATION = range(2019, 2026)
# Cuántos jugadores viajan por temporada. Un draft de 12 × 15 son 180 picks;
# 400 deja pool de sobra para que las dos ramas no se queden sin nadie.
POOL = 400


def main() -> int:
    paths = resolve_paths()
    players = pd.read_parquet(paths.player_weeks)
    weeks = players[players["season_type"] == "REG"].copy()
    weeks["fp"] = score_player_weeks(weeks, PPR)
    realizado = weeks.groupby(["player_id", "season"], observed=True)["fp"].sum()

    salida = {}
    for season in EVALUATION:
        proyeccion = project_season(players, season, PPR)
        board = draft_board(proyeccion).head(POOL).copy()
        board["realized"] = [
            float(realizado.get((pid, season), 0.0)) for pid in board["player_id"]
        ]
        salida[str(season)] = [
            {
                "player_id": str(r.player_id),
                "player_name": str(r.player_name),
                "position": str(r.position),
                "projected_points": float(r.projected_points),
                "vor": float(r.vor),
                "tier": int(r.tier) if pd.notna(r.tier) else None,
                "realized": float(r.realized),
            }
            for r in board.itertuples()
        ]
        print(f"  {season}: {len(salida[str(season)])} jugadores, "
              f"realizado medio {board['realized'].mean():.1f}")

    destino = paths.out / "draft_quality_boards.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(salida), encoding="utf-8")
    print(f"Escrito {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
