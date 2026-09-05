"""Intentar FALSAR el modelo de pateadores (E8) por estratos.

E8 mide MAE y Spearman globales contra dos baselines. Un modelo puede ganar en
media y estar sesgado en un tipo de partido: total alto o bajo, favorito o no,
techo cerrado. Aquí se reparte la evaluación 2022–2025 por esos estratos y se
mira el SESGO (proyectado − real) y el MAE en cada uno, contra el baseline de
forma. No se toca el modelo: sólo se le busca dónde falla.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.data.stadiums import TEAM_STADIUMS as STADIUMS  # noqa: E402
from oracle.fantasy.kickers import (  # noqa: E402
    KickerScoring,
    distance_mix,
    fit_opportunity,
    project,
)

CALIBRATION = (2018, 2019, 2020, 2021)
EVALUATION = (2022, 2023, 2024, 2025)
FORM_WINDOW, FORM_DECAY = 6, 0.85


def score_kicker(rows: pd.DataFrame, scoring: KickerScoring = KickerScoring()) -> pd.Series:
    made = rows.get("fg_made", pd.Series(0, index=rows.index)).fillna(0)
    pat = rows.get("pat_made", pd.Series(0, index=rows.index)).fillna(0)
    missed = rows.get("fg_missed", pd.Series(0, index=rows.index)).fillna(0)
    return made * 3.0 + pat * 1.0 - missed * 1.0


def main() -> int:
    paths = resolve_paths(None).ensure()
    pw = pd.read_parquet(paths.player_weeks)
    k = pw[(pw["position"] == "K") & (pw["season_type"] == "REG")].copy()
    cols = [c for c in k.columns if "fg" in c.lower() or "pat" in c.lower() or "xp" in c.lower()]
    print("columnas de pateador:", cols[:12])
    # Reutiliza el scorer del validador: mismas reglas.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from kicker_validate import score_kicker as _score  # noqa: E402
    k["fantasy_points"] = _score(k)

    tg = pd.read_parquet(paths.team_games)
    team_points = tg[["season", "week", "team", "points_for", "is_home"]].copy()
    cal = k[k["season"].isin(CALIBRATION)]
    model = fit_opportunity(cal, team_points)
    mix = distance_mix(cal)

    preds = pd.read_parquet(paths.out / "backtest_preds.parquet")
    lados = []
    for row in preds.itertuples(index=False):
        for team, sign in ((row.home_team, 1.0), (row.away_team, -1.0)):
            lados.append({
                "season": int(row.season), "week": int(row.week), "team": team,
                "pred_points": (row.pred_total + sign * row.pred_margin) / 2.0,
                "pred_total": float(row.pred_total),
                "favorite": (sign * row.pred_margin) > 0,
                "home_team": row.home_team,
            })
    proj = pd.DataFrame(lados)
    ev = k[k["season"].isin(EVALUATION)].merge(proj, on=["season", "week", "team"], how="inner")
    ev = ev.sort_values(["season", "week"])
    ev["proyectado"] = [project(p, model, mix) for p in ev["pred_points"]]

    def recent(group):
        v = group["fantasy_points"].to_numpy(dtype=float)
        out = np.full(len(v), np.nan)
        for i in range(len(v)):
            past = v[max(0, i - FORM_WINDOW):i]
            if len(past):
                w = FORM_DECAY ** np.arange(len(past) - 1, -1, -1)
                out[i] = float((past * w).sum() / w.sum())
        return pd.Series(out, index=group.index)
    ev["forma"] = ev.groupby("player_id", group_keys=False)[["fantasy_points"]].apply(recent)
    ev = ev.dropna(subset=["forma"])

    roof = {code: st.roof for code, st in STADIUMS.items()}
    ev["dome"] = ev["home_team"].map(roof).isin(["dome", "retractable"])
    terciles = ev["pred_total"].quantile([1 / 3, 2 / 3]).to_numpy()
    ev["total_bin"] = np.where(ev["pred_total"] <= terciles[0], "total bajo",
                               np.where(ev["pred_total"] <= terciles[1], "total medio", "total alto"))
    ev["fav_bin"] = np.where(ev["favorite"], "favorito", "no favorito")
    ev["roof_bin"] = np.where(ev["dome"], "techo cerrado", "aire libre")

    print(f"\nEvaluación {EVALUATION}: {len(ev):,} pateador-semanas. Sesgo = proyectado − real.\n")
    print(f"{'estrato':16}{'n':>6}{'sesgo modelo':>14}{'MAE modelo':>12}{'MAE forma':>11}{'gana':>6}")
    alarmas = []
    for col in ("total_bin", "fav_bin", "roof_bin"):
        for name, g in ev.groupby(col):
            bias = float((g["proyectado"] - g["fantasy_points"]).mean())
            mae_m = float((g["proyectado"] - g["fantasy_points"]).abs().mean())
            mae_f = float((g["forma"] - g["fantasy_points"]).abs().mean())
            gana = mae_m < mae_f
            print(f"{name:16}{len(g):>6}{bias:>+14.2f}{mae_m:>12.3f}{mae_f:>11.3f}{'sí' if gana else 'NO':>6}")
            # Un sesgo de más de medio punto por partido en un estrato es un
            # fallo del modelo aunque la media global sea cero.
            if abs(bias) > 0.5 or not gana:
                alarmas.append((name, bias, gana))
        print()
    print("Estratos con sesgo > 0,5 o donde pierde con la forma:", alarmas or "ninguno")
    global_bias = float((ev["proyectado"] - ev["fantasy_points"]).mean())
    print(f"Sesgo global: {global_bias:+.2f}")
    # Se deja escrito para que el registro de capacidades cite un fichero y
    # no un recuerdo. Es un resultado NEGATIVO y se publica tal cual.
    out = {
        "experiment": "E8c", "evaluation": list(EVALUATION), "n": int(len(ev)),
        "global_bias": global_bias,
        "strata": [
            {"stratum": name, "n": int(len(g)),
             "bias": float((g["proyectado"] - g["fantasy_points"]).mean()),
             "mae_model": float((g["proyectado"] - g["fantasy_points"]).abs().mean()),
             "mae_form": float((g["forma"] - g["fantasy_points"]).abs().mean())}
            for col in ("total_bin", "fav_bin", "roof_bin") for name, g in ev.groupby(col)
        ],
        "alarms": [{"stratum": n, "bias": b, "beats_form": bool(g)} for n, b, g in alarmas],
    }
    Path("out").mkdir(exist_ok=True)
    Path("out/kicker_falsify.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print("Escrito out/kicker_falsify.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
