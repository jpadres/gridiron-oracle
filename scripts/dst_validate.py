"""¿Se puede proyectar una defensa (DST) con lo que hay? Umbral en PREREGISTRO_dst.md.

Puntuación PARCIAL —capturas, intercepciones, balones y puntos permitidos—
porque `team_games` no tiene touchdowns defensivos, safeties ni bloqueos. Se
mide walk-forward: cada temporada 2018–2025 con un ajuste que sólo ha visto las
anteriores, y el total implícito del rival sale del backtest de partidos, que
tampoco ha visto la jornada.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from oracle.pipeline import resolve_paths  # noqa: E402

EVALUATION = list(range(2018, 2026))
FORM_WINDOW, FORM_DECAY = 6, 0.85


# Tramos estándar de puntos permitidos (Sleeper/ESPN por defecto).
_TIERS = ((0, 10.0), (6, 7.0), (13, 4.0), (20, 1.0), (27, 0.0), (34, -1.0))


def points_allowed_tier(pa: float) -> float:
    for limit, points in _TIERS:
        if pa <= limit:
            return points
    return -4.0


def dst_points(tg: pd.DataFrame) -> pd.Series:
    return (tg["def_sacks_taken"] * 1.0 + tg["def_interceptions"] * 2.0
            + tg["def_fumbles_lost"] * 2.0 + tg["points_against"].map(points_allowed_tier))


def recent_form(values: np.ndarray) -> np.ndarray:
    out = np.full(len(values), np.nan)
    for i in range(len(values)):
        past = values[max(0, i - FORM_WINDOW):i]
        if len(past) == 0:
            continue
        w = FORM_DECAY ** np.arange(len(past) - 1, -1, -1)
        out[i] = float((past * w).sum() / w.sum())
    return out


def main() -> int:
    paths = resolve_paths(Path(__file__).resolve().parent.parent)
    tg = pd.read_parquet(paths.team_games)
    tg = tg[(tg["game_type"] == "REG") & tg["played"].astype(bool)].copy()
    tg = tg.sort_values(["team", "season", "week"]).reset_index(drop=True)
    tg["dst"] = dst_points(tg)
    for col in ("def_sacks_taken", "def_interceptions", "def_fumbles_lost"):
        tg[f"{col}_form"] = tg.groupby("team")[col].transform(lambda s: recent_form(s.to_numpy(dtype=float)))
    tg["dst_form"] = tg.groupby("team")["dst"].transform(lambda s: recent_form(s.to_numpy(dtype=float)))
    tg["takeaways_form"] = tg["def_interceptions_form"] + tg["def_fumbles_lost_form"]

    preds = pd.read_parquet(paths.out / "backtest_preds.parquet")
    lados = []
    for row in preds.itertuples(index=False):
        # Lo que el RIVAL de cada equipo tiene proyectado anotar.
        home_pts = (row.pred_total + row.pred_margin) / 2.0
        away_pts = (row.pred_total - row.pred_margin) / 2.0
        lados.append({"season": int(row.season), "week": int(row.week), "team": row.home_team, "opp_implied": away_pts})
        lados.append({"season": int(row.season), "week": int(row.week), "team": row.away_team, "opp_implied": home_pts})
    tg = tg.merge(pd.DataFrame(lados), on=["season", "week", "team"], how="inner")

    feats = ["opp_implied", "def_sacks_taken_form", "takeaways_form"]
    rows = []
    per_season = []
    for season in EVALUATION:
        train = tg[(tg["season"] < season) & (tg["season"] >= season - 8)].dropna(subset=feats + ["dst"])
        test = tg[tg["season"] == season].dropna(subset=feats + ["dst", "dst_form"]).copy()
        if len(train) < 400 or test.empty:
            continue
        X = np.column_stack([np.ones(len(train))] + [train[f].to_numpy(float) for f in feats])
        beta, *_ = np.linalg.lstsq(X, train["dst"].to_numpy(float), rcond=None)
        Xt = np.column_stack([np.ones(len(test))] + [test[f].to_numpy(float) for f in feats])
        test["modelo"] = Xt @ beta
        Xc = np.column_stack([np.ones(len(train)), train["opp_implied"].to_numpy(float)])
        bc, *_ = np.linalg.lstsq(Xc, train["dst"].to_numpy(float), rcond=None)
        test["baseline_C"] = np.column_stack([np.ones(len(test)), test["opp_implied"].to_numpy(float)]) @ bc
        test["baseline_A"] = float(tg[tg["season"] == season - 1]["dst"].mean())
        test["baseline_B"] = test["dst_form"]

        res = {"season": season, "n": int(len(test))}
        for name in ("modelo", "baseline_A", "baseline_B", "baseline_C"):
            mae = float((test[name] - test["dst"]).abs().mean())
            rhos = []
            for _, wk in test.groupby("week"):
                if wk[name].nunique() > 1 and len(wk) >= 8:
                    rhos.append(spearmanr(wk[name], wk["dst"]).statistic)
            res[f"{name}_mae"] = mae
            res[f"{name}_rho"] = float(np.nanmean(rhos)) if rhos else float("nan")
        per_season.append(res)
        rows.append(test)

    table = pd.DataFrame(per_season)
    print("Evaluación walk-forward DST (puntuación PARCIAL: sin TD/safety/bloqueo)\n")
    print(table.round(3).to_string(index=False))
    wins = 0
    for r in per_season:
        beats = all(r["modelo_mae"] < r[f"{b}_mae"] and r["modelo_rho"] > r[f"{b}_rho"]
                    for b in ("baseline_A", "baseline_B", "baseline_C"))
        wins += int(beats)
    mean_rho = float(table["modelo_rho"].mean())
    print(f"\nTemporadas en que el modelo bate a los TRES baselines (MAE y Spearman): {wins} de {len(per_season)}")
    print(f"Spearman medio dentro de jornada del modelo: {mean_rho:.3f}")
    print(f"Umbral EXPERIMENTAL (>=6 de 8): {'CUMPLE' if wins >= 6 else 'NO CUMPLE'}")
    print(f"Umbral SUPPORTED (además rho >= 0.20): {'CUMPLE' if wins >= 6 and mean_rho >= 0.20 else 'NO CUMPLE'}")
    print(f"Alarma de fuga (rho > 0.45): {'SALTA' if mean_rho > 0.45 else 'no'}")
    out = {"per_season": per_season, "wins": wins, "mean_rho": mean_rho,
           "experimental": wins >= 6, "supported": wins >= 6 and mean_rho >= 0.20}
    (paths.out / "dst_validate.json").write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
