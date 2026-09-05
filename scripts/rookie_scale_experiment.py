"""E25 — la escala del novato con la convención del veterano. Ver docs/PREREGISTRO_novato_escala.md."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fantasy_build import rookie_rows  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.draft import project_season  # noqa: E402
from oracle.fantasy.scoring import PPR, regular_season, score_player_weeks  # noqa: E402

EVALUATION = range(2019, 2026)
GAMES = 15.5
VENTANA = 10.0
ACCEPT = {"pair_diff_abs": 20.0, "spearman_slack": 0.02, "n_min": 100}


def _pairs(rookies: pd.DataFrame, vets: pd.DataFrame, col: str) -> list[float]:
    out = []
    for row in rookies.itertuples(index=False):
        same = vets[vets["position"] == row.position]
        near = same[(same["projected_points"] - getattr(row, col)).abs() <= VENTANA]
        if len(near) >= 5:
            out.append(float(row.real - near["real"].mean()))
    return out


def main() -> int:
    paths = resolve_paths(None).ensure()
    players = pd.read_parquet(paths.player_weeks)
    weeks = regular_season(players).copy()
    weeks["fp"] = score_player_weeks(weeks, PPR)
    realized = weeks.groupby(["player_id", "season"], observed=True)["fp"].sum()
    rows = []
    for season in EVALUATION:
        vets = project_season(players, season, PPR).copy()
        rk, _ = rookie_rows(paths, players, PPR, season)
        if rk.empty:
            continue
        vets["real"] = [float(realized.get((p, season), 0.0)) for p in vets["player_id"]]
        rk = rk.copy()
        rk["real"] = [float(realized.get((p, season), 0.0)) for p in rk["player_id"]]
        rk["baseline"] = rk["projected_points"].astype(float)
        # La previa del novato vive en `projected_points` = ritmo × E[partidos de
        # su celda]; `points_per_game` es un campo de veterano y para el novato
        # vale cero (la primera pasada lo destapó: C1 salía constante). El ritmo
        # de la previa se recupera dividiendo por sus partidos esperados.
        eg = rk["expected_games"].astype(float).replace(0.0, np.nan)
        rk["C1"] = (rk["projected_points"].astype(float) / eg * GAMES).fillna(0.0)
        rows.append({
            "season": season, "n_rookies": int(len(rk)),
            "pairs_baseline": _pairs(rk, vets, "baseline"), "pairs_C1": _pairs(rk, vets, "C1"),
            "spearman_baseline": float(spearmanr(rk["baseline"], rk["real"]).statistic),
            "spearman_C1": float(spearmanr(rk["C1"], rk["real"]).statistic),
            "mae_baseline": float((rk["baseline"] - rk["real"]).abs().mean()),
            "mae_C1": float((rk["C1"] - rk["real"]).abs().mean()),
            "bias_baseline": float((rk["real"] - rk["baseline"]).mean()),
            "bias_C1": float((rk["real"] - rk["C1"]).mean()),
        })
    pb = [d for r in rows for d in r["pairs_baseline"]]
    pc = [d for r in rows for d in r["pairs_C1"]]
    n_r = sum(r["n_rookies"] for r in rows)
    sp_b = sum(r["spearman_baseline"] * r["n_rookies"] for r in rows) / n_r
    sp_c = sum(r["spearman_C1"] * r["n_rookies"] for r in rows) / n_r
    summary = {
        "baseline": {"pair_diff": float(np.mean(pb)), "n_pairs": len(pb), "spearman": sp_b,
                     "mae": sum(r["mae_baseline"] * r["n_rookies"] for r in rows) / n_r,
                     "bias": sum(r["bias_baseline"] * r["n_rookies"] for r in rows) / n_r},
        "C1": {"pair_diff": float(np.mean(pc)) if pc else None, "n_pairs": len(pc), "spearman": sp_c,
               "mae": sum(r["mae_C1"] * r["n_rookies"] for r in rows) / n_r,
               "bias": sum(r["bias_C1"] * r["n_rookies"] for r in rows) / n_r},
    }
    c = summary["C1"]
    accepted = (c["pair_diff"] is not None and abs(c["pair_diff"]) < ACCEPT["pair_diff_abs"]
                and c["spearman"] >= sp_b - ACCEPT["spearman_slack"] and c["n_pairs"] >= ACCEPT["n_min"])
    summary["C1"]["ACCEPTED"] = bool(accepted)
    out = {"experiment": "E25", "preregistration": "docs/PREREGISTRO_novato_escala.md", "acceptance": ACCEPT,
           "per_season": [{k: v for k, v in r.items() if not k.startswith("pairs")} for r in rows], "summary": summary}
    Path("docs/evidence").mkdir(exist_ok=True)
    Path("docs/evidence/rookie_scale_experiment.json").write_text(json.dumps(out, indent=1) + "\n")
    for name, sm in summary.items():
        pd_ = sm["pair_diff"]
        print(f"{name:9} pares {sm['n_pairs']:>4}  dif emparejada {(pd_ if pd_ is not None else float('nan')):+7.1f}  Spearman {sm['spearman']:.3f}"
              f"  MAE {sm['mae']:6.1f}  sesgo {sm['bias']:+6.1f}" + (f"  ACEPTA={'SÍ' if sm.get('ACCEPTED') else 'no'}" if name == "C1" else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
