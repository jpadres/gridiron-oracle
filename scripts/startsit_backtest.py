#!/usr/bin/env python3
"""Backtest de Start/Sit por pares. Umbral en docs/PREREGISTRO_startsit.md

Bloques 11 y 12 del espec adversarial.

La pregunta no es si el modelo acierta los puntos: es si ayuda cuando la
decisión es difícil. Sólo se evalúan pares que un manager se habría planteado
de verdad.
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.fantasy.scoring import regular_season, rules_from_name, score_player_weeks
from oracle.fantasy.weekly import WeeklyCalibration, weekly_rankings
from oracle.pipeline import Oracle

EVALUATION = (2024, 2025)
# La zona de decisión, fijada en el preregistro.
MIN_PROJECTION = 8.0
MAX_GAP = 3.0
# Para el análisis por tramos hace falta ver más allá de la zona apretada.
WIDE_GAP = 12.0
BIG_MISS = 10.0


def wilson(wins: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    """Intervalo de Wilson. Con n moderado es honesto donde el normal no lo es."""
    if n == 0:
        return float("nan"), float("nan"), float("nan")
    p = wins / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return p, centre - half, centre + half


def build_pairs(board: pd.DataFrame, require_played: bool,
                limite: float = MAX_GAP) -> pd.DataFrame:
    filas = []
    for (_season, _week, position), group in board.groupby(["season", "week", "position"]):
        candidatos = group[group["projected_points"] >= MIN_PROJECTION]
        for a, b in itertools.combinations(candidatos.itertuples(index=False), 2):
            if abs(a.projected_points - b.projected_points) > limite:
                continue
            if require_played and (not np.isfinite(a.fantasy_points)
                                   or not np.isfinite(b.fantasy_points)):
                continue
            filas.append({
                "position": position,
                "proj_a": a.projected_points, "proj_b": b.projected_points,
                "base_a": a.baseline_points, "base_b": b.baseline_points,
                "real_a": a.fantasy_points if np.isfinite(a.fantasy_points) else 0.0,
                "real_b": b.fantasy_points if np.isfinite(b.fantasy_points) else 0.0,
            })
    return pd.DataFrame(filas)


def evaluate(pairs: pd.DataFrame) -> dict:
    """Tasa de acierto y arrepentimiento de cada criterio de decisión."""
    mejor = np.maximum(pairs.real_a, pairs.real_b)
    out = {}
    for name, (ca, cb) in (("modelo", ("proj_a", "proj_b")),
                           ("forma reciente", ("base_a", "base_b"))):
        elige_a = pairs[ca] > pairs[cb]
        # Los empates exactos de criterio no son una decisión: se descartan y se
        # cuentan aparte, en vez de repartirlos a medias y fingir que decidió.
        decide = pairs[ca] != pairs[cb]
        elegido = np.where(elige_a, pairs.real_a, pairs.real_b)
        acierta = np.where(elige_a, pairs.real_a > pairs.real_b, pairs.real_b > pairs.real_a)
        n = int(decide.sum())
        wins = int((acierta & decide).sum())
        p, lo, hi = wilson(wins, n)
        regret = (mejor - elegido)[decide]
        out[name] = {
            "n": n, "aciertos": wins, "tasa": p, "ic_low": lo, "ic_high": hi,
            "arrepentimiento_medio": float(regret.mean()),
            "arrepentimiento_mediano": float(regret.median()),
            "tasa_error_grave": float((regret > BIG_MISS).mean()),
            "empates": int((~decide).sum()),
        }
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=None)
    parser.add_argument("--scoring", default="ppr")
    args = parser.parse_args()
    paths = resolve_paths(args.root).ensure()
    rules = rules_from_name(args.scoring)

    players = pd.read_parquet(paths.player_weeks)
    # E11 se midió el 2026-08-29 CON jornadas de playoffs en la evaluación; se
    # recomprueba sólo sobre temporada regular con los umbrales ya escritos.
    players = regular_season(players)
    oracle = Oracle.train(args.root)
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)
    truth = scored[["player_id", "season", "week", "fantasy_points"]]

    frames = []
    subset = players[players["season"].isin(EVALUATION)]
    weeks = [(int(s), int(w)) for s, w in
             subset[["season", "week"]].drop_duplicates().itertuples(index=False) if w >= 4]
    for season, week in weeks:
        try:
            ranking = weekly_rankings(
                scored, oracle.predict(oracle.week_features(season, week)),
                season, week, rules, WeeklyCalibration(),
            )
        except ValueError:
            continue
        if not ranking.empty:
            frames.append(ranking)
    board = pd.concat(frames, ignore_index=True).merge(
        truth, on=["player_id", "season", "week"], how="left"
    )
    print(f"{len(board):,} proyecciones sobre {EVALUATION}\n")

    resultados = {}
    for etiqueta, require in (("los dos jugaron", True), ("sin condicionar (incluye DNP)", False)):
        pairs = build_pairs(board, require)
        print(f"=== {etiqueta} — {len(pairs):,} pares en la zona de decisión ===")
        print(f"    (misma posición y jornada, los dos >= {MIN_PROJECTION:g} proyectados, "
              f"diferencia <= {MAX_GAP:g})\n")
        metricas = evaluate(pairs)
        print(f"{'criterio':18}{'n':>7}{'acierto':>10}{'IC95%':>18}"
              f"{'arrep.medio':>13}{'error grave':>13}")
        for name, m in metricas.items():
            print(f"{name:18}{m['n']:>7,}{m['tasa']:>10.1%}"
                  f"   [{m['ic_low']:>5.1%}, {m['ic_high']:>5.1%}]"
                  f"{m['arrepentimiento_medio']:>13.2f}{m['tasa_error_grave']:>13.1%}")
        resultados[etiqueta] = metricas

        m, b = metricas["modelo"], metricas["forma reciente"]
        bate = m["tasa"] > b["tasa"]
        significativo = m["ic_low"] > 0.50
        print(f"\n  bate a la forma reciente: {'SÍ' if bate else 'NO'}")
        print(f"  IC inferior por encima del 50%: {'SÍ' if significativo else 'NO'}")
        print(f"  umbral de alarma (>62%): {'SALTA' if m['tasa'] > 0.62 else 'no salta'}\n")

        print("  por posición:")
        for position in ("QB", "RB", "WR", "TE"):
            sub = pairs[pairs.position == position]
            if len(sub) < 50:
                continue
            mm = evaluate(sub)
            print(f"    {position}  n={mm['modelo']['n']:>5,}  "
                  f"modelo {mm['modelo']['tasa']:.1%}  "
                  f"forma {mm['forma reciente']['tasa']:.1%}  "
                  f"arrep. {mm['modelo']['arrepentimiento_medio']:.2f}")
        print()

    # Bloques 54 y 77: ¿a partir de qué diferencia de proyección significa algo
    # el orden? Es lo que decide si se puede decir CLARO, LEVE o MONEDA AL AIRE,
    # y sale de los datos en vez de de tres etiquetas elegidas a ojo.
    todos = build_pairs(board, require_played=False, limite=WIDE_GAP)
    todos["gap"] = (todos.proj_a - todos.proj_b).abs()
    todos["acierta"] = np.where(
        todos.proj_a > todos.proj_b,
        todos.real_a > todos.real_b,
        todos.real_b > todos.real_a,
    )
    print("=== bloque 54: acierto por tamaño de la diferencia proyectada ===\n")
    print(f"{'diferencia':14}{'n':>8}{'acierto':>10}{'IC95%':>18}")
    cortes = [(0, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 5.0), (5.0, 100.0)]
    escala = []
    for lo, hi in cortes:
        sub = todos[(todos.gap >= lo) & (todos.gap < hi)]
        if len(sub) < 100:
            continue
        p_, l_, h_ = wilson(int(sub.acierta.sum()), len(sub))
        etiqueta = f"{lo:g}-{hi:g}" if hi < 100 else f"{lo:g}+"
        print(f"{etiqueta:14}{len(sub):>8,}{p_:>10.1%}   [{l_:>5.1%}, {h_:>5.1%}]")
        escala.append({"lo": lo, "hi": hi, "n": len(sub), "tasa": p_, "ic_low": l_})
    resultados["por_diferencia"] = escala

    json.dump(resultados, open("/tmp/startsit.json", "w"), default=float)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
