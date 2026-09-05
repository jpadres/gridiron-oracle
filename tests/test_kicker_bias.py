"""E8c: el sesgo del pateador se publica en tres sitios y los tres dicen lo mismo.

El registro (`capabilities.py`), la pantalla semanal y el fichero medido
(`out/kicker_falsify.json`, cuando existe). Copiar un número a mano es cómo las
cifras de portada acabaron siendo las de otro proyecto; aquí el guardián es
estrecho: exactamente los dos números, buscados por su frase.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from oracle.capabilities import REGISTRY

ROOT = Path(__file__).resolve().parents[1]


def _registry_numbers() -> tuple[float, float]:
    cap = next(c for c in REGISTRY if c.id == "KICKER_PROJECTION")
    text = " ".join(cap.limitations)
    m = re.search(r"sesgo global −(\d,\d\d) .*? −(\d,\d\d) bajo techo cerrado", text)
    assert m, "el registro no declara el sesgo de E8c con la frase esperada"
    return float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))


def test_weekly_screen_repeats_the_registry():
    src = (ROOT / "web/app/fantasy/semanal/WeeklyExplorer.jsx").read_text()
    m = re.search(r"projections sit (\d\.\d\d) points\s+per game under .*? and (\d\.\d\d) under a closed roof", src, re.S)
    assert m, "la pantalla semanal no declara el sesgo con la frase esperada"
    assert (float(m.group(1)), float(m.group(2))) == _registry_numbers()


def test_registry_matches_the_measurement():
    out = ROOT / "out/kicker_falsify.json"
    if not out.exists():
        pytest.skip("out/kicker_falsify.json no existe: correr scripts/kicker_falsify.py")
    data = json.loads(out.read_text())
    dome = next(s for s in data["strata"] if s["stratum"] == "techo cerrado")
    assert (round(-data["global_bias"], 2), round(-dome["bias"], 2)) == _registry_numbers()
