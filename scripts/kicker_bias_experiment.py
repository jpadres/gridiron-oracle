"""E8d — de dónde sale el sesgo del pateador. Ver docs/PREREGISTRO_kicker_bias.md.

Walk-forward 2022-2025, calibrando con todas las temporadas anteriores. Cuatro
candidatos contra el modelo actual; los umbrales están escritos ANTES en el
preregistro y este script sólo los aplica. Escribe docs/evidence/kicker_bias_experiment.json.
"""
from __future__ import annotations

import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from kicker_validate import score_kicker  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.data.stadiums import TEAM_STADIUMS  # noqa: E402
from oracle.fantasy.kickers import (  # noqa: E402
    DISTANCE_BUCKETS,
    OpportunityModel,
    distance_mix,
    fit_opportunity,
    project,
)
from oracle.fantasy.scoring import regular_season  # noqa: E402

EVALUATION = (2022, 2023, 2024, 2025)
FIRST = 2016
ACCEPT = {"mae_slack": 0.02, "bias_half": 0.33, "dome_seasons": 3}


def _fill_small_buckets(model: OpportunityModel) -> OpportunityModel:
    """C1: un tramo sin tasa hereda la del vecino con muestra (el contiguo más cercano)."""
    keys = [made for made, _ in DISTANCE_BUCKETS]
    conv = dict(model.conversion)
    for i, key in enumerate(keys):
        if np.isfinite(conv.get(key, float("nan"))):
            continue
        for d in (1, -1, 2, -2, 3, -3):
            j = i + d
            if 0 <= j < len(keys) and np.isfinite(conv.get(keys[j], float("nan"))):
                conv[key] = conv[keys[j]]
                break
    return replace(model, conversion=conv)


def _project_quadratic(points: float, cal: pd.DataFrame, model: OpportunityModel, mix, coefs) -> float:
    """C2m: intentos cuadráticos en puntos del equipo CON MESETA tras el vértice.

    Es exactamente lo que envía `OpportunityModel` (mismo código): la variante
    sin meseta (C2) se evaluó primero y pasó; se re-evalúa la que se envía.
    """
    quad = replace(model, pat_quad=float(coefs["pat"][0]), pat_slope=float(coefs["pat"][1]),
                   pat_intercept=float(coefs["pat"][2]), fg_quad=float(coefs["fg"][0]),
                   fg_slope=float(coefs["fg"][1]), fg_intercept=float(coefs["fg"][2]))
    return project(points, quad, mix)


def _linear(cal: pd.DataFrame, team_points: pd.DataFrame) -> OpportunityModel:
    """El modelo lineal previo a E8d, reajustado igual que entonces."""
    fitted = fit_opportunity(cal, team_points)
    merged = cal.merge(team_points, on=["season", "week", "team"], how="inner")
    pts = merged["points_for"].to_numpy(float)
    pat_slope, pat_intercept = np.polyfit(pts, merged["pat_att"].fillna(0).to_numpy(float), 1)
    fg_slope, fg_intercept = np.polyfit(pts, merged["fg_att"].fillna(0).to_numpy(float), 1)
    return replace(fitted, pat_quad=0.0, fg_quad=0.0, pat_slope=float(pat_slope), pat_intercept=float(pat_intercept),
                   fg_slope=float(fg_slope), fg_intercept=float(fg_intercept))


def main() -> int:
    paths = resolve_paths(None).ensure()
    pw = regular_season(pd.read_parquet(paths.player_weeks))
    k = pw[pw["position"] == "K"].copy()
    k["fantasy_points"] = score_kicker(k)
    tg = pd.read_parquet(paths.team_games)
    team_points = tg[["season", "week", "team", "points_for"]].copy()
    preds = pd.read_parquet(paths.out / "backtest_preds.parquet")
    roof = {code: st.roof for code, st in TEAM_STADIUMS.items()}
    lados = []
    for row in preds.itertuples(index=False):
        for team, sign in ((row.home_team, 1.0), (row.away_team, -1.0)):
            lados.append({"season": int(row.season), "week": int(row.week), "team": team,
                          "pred_points": (row.pred_total + sign * row.pred_margin) / 2.0,
                          "dome": roof.get(row.home_team) in ("dome", "retractable")})
    proj = pd.DataFrame(lados)
    # techo de cada pateador-semana en la CALIBRACIÓN (para C3): por el estadio del local
    sched = preds[["season", "week", "home_team", "away_team"]]
    home_of = {}
    for r in sched.itertuples(index=False):
        home_of[(int(r.season), int(r.week), r.home_team)] = r.home_team
        home_of[(int(r.season), int(r.week), r.away_team)] = r.home_team
    k["dome"] = [roof.get(home_of.get((int(s), int(w), t))) in ("dome", "retractable")
                 for s, w, t in zip(k["season"], k["week"], k["team"], strict=True)]

    results = {c: [] for c in ("baseline", "C1_buckets", "C2_quadratic", "C3_roof", "C4_C1+C3")}
    for season in EVALUATION:
        cal = k[(k["season"] >= FIRST) & (k["season"] < season)]
        ev = k[k["season"] == season].merge(proj.drop(columns=["dome"]), on=["season", "week", "team"], how="inner")
        if ev.empty:
            continue
        model = fit_opportunity(cal, team_points)
        # El baseline es el modelo LINEAL de antes de E8d: se anulan los
        # términos cuadráticos que `fit_opportunity` ajusta ahora.
        model = _linear(cal, team_points)
        mix = distance_mix(cal)
        model_c1 = _fill_small_buckets(model)
        # C3: tasas por techo
        model_dome = fit_opportunity(cal[cal["dome"]], team_points)
        model_open = fit_opportunity(cal[~cal["dome"]], team_points)
        model_c3 = {True: replace(model, conversion=model_dome.conversion, pat_rate=model_dome.pat_rate),
                    False: replace(model, conversion=model_open.conversion, pat_rate=model_open.pat_rate)}
        model_c4 = {d: _fill_small_buckets(m) for d, m in model_c3.items()}
        merged = cal.merge(team_points, on=["season", "week", "team"], how="inner")
        pts = merged["points_for"].to_numpy(float)
        coefs = {"fg": np.polyfit(pts, merged["fg_att"].fillna(0).to_numpy(float), 2),
                 "pat": np.polyfit(pts, merged["pat_att"].fillna(0).to_numpy(float), 2)}
        real = ev["fantasy_points"].to_numpy(float)
        dome = ev["dome"].to_numpy(bool)
        cands = {
            "baseline": [project(p, model, mix) for p in ev["pred_points"]],
            "C1_buckets": [project(p, model_c1, mix) for p in ev["pred_points"]],
            "C2_quadratic": [_project_quadratic(p, cal, model, mix, coefs) for p in ev["pred_points"]],
            "C3_roof": [project(p, model_c3[bool(d)], mix) for p, d in zip(ev["pred_points"], dome, strict=True)],
            "C4_C1+C3": [project(p, model_c4[bool(d)], mix) for p, d in zip(ev["pred_points"], dome, strict=True)],
        }
        for name, pred in cands.items():
            pred = np.asarray(pred, float)
            results[name].append({"season": season, "n": int(len(ev)),
                                  "mae": float(np.abs(pred - real).mean()),
                                  "bias": float((pred - real).mean()),
                                  "bias_dome": float((pred - real)[dome].mean()) if dome.any() else None,
                                  "n_dome": int(dome.sum())})

    base = results["baseline"]
    summary = {}
    for name, rows in results.items():
        n = sum(r["n"] for r in rows)
        bias = sum(r["bias"] * r["n"] for r in rows) / n
        nd = sum(r["n_dome"] for r in rows)
        bias_dome = sum((r["bias_dome"] or 0) * r["n_dome"] for r in rows) / nd if nd else None
        mae_ok = all(r["mae"] <= b["mae"] + ACCEPT["mae_slack"] for r, b in zip(rows, base, strict=True))
        dome_better = sum(1 for r, b in zip(rows, base, strict=True)
                          if r["bias_dome"] is not None and abs(r["bias_dome"]) < abs(b["bias_dome"]))
        accepted = name != "baseline" and mae_ok and abs(bias) <= ACCEPT["bias_half"] and dome_better >= ACCEPT["dome_seasons"]
        summary[name] = {"mae": sum(r["mae"] * r["n"] for r in rows) / n, "bias": bias, "bias_dome": bias_dome,
                         "mae_never_worse": mae_ok, "dome_seasons_better": dome_better, "ACCEPTED": accepted}
    out = {"experiment": "E8d", "preregistration": "docs/PREREGISTRO_kicker_bias.md", "acceptance": ACCEPT,
           "evaluation": list(EVALUATION), "per_season": results, "summary": summary}
    Path("docs/evidence").mkdir(exist_ok=True)
    Path("docs/evidence/kicker_bias_experiment.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"{'candidato':14}{'MAE':>8}{'sesgo':>8}{'techo':>8}{'MAE≤':>6}{'techo↓':>8}{'ACEPTA':>8}")
    for name, sm in summary.items():
        print(f"{name:14}{sm['mae']:>8.3f}{sm['bias']:>+8.2f}{(sm['bias_dome'] or 0):>+8.2f}"
              f"{'sí' if sm['mae_never_worse'] else 'NO':>6}{sm['dome_seasons_better']:>8}{'SÍ' if sm['ACCEPTED'] else 'no':>8}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
