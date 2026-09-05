"""§31 — Manifiesto de los artefactos de validación: qué datos, qué filtro, qué código.

Para cada artefacto principal deja escrito de qué fichero de origen sale
(con su fecha, que es la del DATO), cuántas filas, qué temporadas, qué
etapa se filtró y con qué commit se generó. Sirve para cazar contaminación
futura: si un número cambia sin que cambie nada de esto, algo se coló.
"""
from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.scoring import regular_season  # noqa: E402


def _date(path: Path) -> str | None:
    return dt.datetime.fromtimestamp(path.stat().st_mtime, dt.UTC).date().isoformat() if path.exists() else None


def main() -> int:
    paths = resolve_paths(None).ensure()
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
    out = {"code_sha": sha, "note": "las fechas son las de los ficheros de ORIGEN descargados (mtime), nunca la de este script", "artifacts": {}}
    pw = pd.read_parquet(paths.player_weeks)
    reg = regular_season(pw)
    out["artifacts"]["player_weeks"] = {
        "rows_all": int(len(pw)), "rows_regular_season": int(len(reg)), "stage_filter": "season_type == REG (falla cerrado sin columna)",
        "seasons": [int(pw["season"].min()), int(pw["season"].max())],
        "source_snapshot": {p.name: _date(p) for p in sorted((paths.raw).glob("player_stats_*.parquet"))[-3:]},
    }
    games = pd.read_parquet(paths.games)
    out["artifacts"]["games"] = {
        "rows": int(len(games)), "seasons": [int(games["season"].min()), int(games["season"].max())],
        "played": int(games["played"].sum()) if "played" in games else None,
        "source_snapshot": {"games.csv": _date(paths.raw / "games.csv")},
    }
    preds = paths.out / "backtest_preds.parquet"
    if preds.exists():
        bp = pd.read_parquet(preds)
        out["artifacts"]["backtest_preds"] = {
            "rows": int(len(bp)), "seasons": [int(bp["season"].min()), int(bp["season"].max())],
            "method": "walk-forward: temporada S sólo con < S", "generated_from": "oracle backtest",
        }
    for name, meta in {
        "e11_startsit": {"script": "scripts/startsit_backtest.py", "evaluation": [2024, 2025], "stage_filter": "REG", "evidence": "docs/evidence/e11_regular_season_2026-09-05.md"},
        "e8c_kicker_bias": {"script": "scripts/kicker_falsify.py", "evaluation": [2022, 2025], "calibration": "bloque fijo", "stage_filter": "REG", "evidence": "docs/evidence/kicker_falsify.json"},
        "e8d_kicker_quadratic": {"script": "scripts/kicker_bias_experiment.py", "evaluation": [2022, 2025], "calibration": "walk-forward desde 2016", "stage_filter": "REG", "evidence": "docs/evidence/kicker_bias_experiment.json"},
        "e25_rookie_scale": {"script": "scripts/rookie_scale_experiment.py", "evaluation": [2019, 2025], "stage_filter": "REG", "evidence": "docs/evidence/rookie_scale_experiment.json"},
        "bust_risk_weekly": {"scripts": ["fantasy_bust_validate.py", "fantasy_risk_validate.py", "fantasy_weekly_calibrate.py"], "stage_filter": "REG", "evidence": "docs/evidence/revalidacion_sin_playoffs_2026-09-05.md"},
    }.items():
        out["artifacts"][name] = meta
    (ROOT / "docs/evidence/validation_manifest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in out.items() if k != "artifacts"}), "artefactos:", len(out["artifacts"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
