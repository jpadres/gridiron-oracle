"""§37 — Paridad Python ↔ JS del compilador de puntos, con entradas AL AZAR.

Genera 500 casos (componentes y reglas aleatorios, sin bonus por partido) y
escribe lo que dice `components.compile_points`; `web/tests/scoringParity.test.mjs`
compila los mismos con `scoring.js::compilePoints` y exige igualdad a 1e-9.
Ocho casos a mano dan confianza falsa: la deriva vive en el coeficiente que
nadie tocó a mano.
"""
from __future__ import annotations

import json
import random
import sys
from dataclasses import asdict, fields
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from oracle.fantasy.components import COEFFICIENTS, compile_points  # noqa: E402
from oracle.fantasy.scoring import PPR, ScoringRules  # noqa: E402

rng = random.Random(20260905)
POS = ["QB", "RB", "WR", "TE"]


def random_rules() -> ScoringRules:
    base = asdict(PPR)
    out = {}
    for f in fields(ScoringRules):
        v = base[f.name]
        if f.name in ("passing_300_bonus", "rushing_100_bonus", "receiving_100_bonus"):
            out[f.name] = 0.0
        elif isinstance(v, dict):
            out[f.name] = {k: round(rng.uniform(0, 2), 2) for k in v} if rng.random() < 0.5 else v
        elif isinstance(v, bool):
            out[f.name] = v
        elif isinstance(v, (int, float)):
            out[f.name] = round(v * rng.uniform(0.3, 1.7) + rng.uniform(-0.5, 0.5), 3)
        else:
            out[f.name] = v
    return ScoringRules(**out)


def main() -> int:
    cases = []
    for _ in range(500):
        comps = {name: round(rng.uniform(0, 30), 3) for name in COEFFICIENTS}
        comps["receptions"] = round(rng.uniform(0, 10), 3)
        pos = rng.choice(POS)
        rules = random_rules()
        pts = float(compile_points(pd.DataFrame([comps]), rules, pd.Series([pos])).iloc[0])
        cases.append({"components": comps, "position": pos, "rules": asdict(rules), "points": pts})
    out = ROOT / "web/tests/fixtures/scoring_parity.json"
    out.write_text(json.dumps({"generated_by": "scripts/scoring_parity_fixture.py", "cases": cases}) + "\n")
    print(f"{len(cases)} casos → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
