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

from oracle.capabilities import REGISTRY

ROOT = Path(__file__).resolve().parents[1]


def _registry_numbers() -> tuple[float, float]:
    cap = next(c for c in REGISTRY if c.id == "KICKER_PROJECTION")
    text = " ".join(cap.limitations)
    m = re.search(r"sesgo global −(\d,\d\d) .*? −(\d,\d\d) en estadios con techo fijo o retráctil", text)
    assert m, "el registro no declara el sesgo de E8c con la frase esperada"
    return float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))


def test_weekly_screen_repeats_the_registry():
    src = (ROOT / "web/app/fantasy/semanal/WeeklyExplorer.jsx").read_text()
    m = re.search(r"projections sit (\d\.\d\d) points\s+per game under .*? and (\d\.\d\d) in domes and retractable-roof stadiums", src, re.S)
    assert m, "la pantalla semanal no declara el sesgo con la frase esperada"
    assert (float(m.group(1)), float(m.group(2))) == _registry_numbers()


def test_registry_matches_the_measurement():
    # La medición se VERSIONA en docs/evidence: `out/` no existe en CI y un
    # guardián que se salta en CI son dos copias, no tres.
    out = ROOT / "docs/evidence/kicker_falsify.json"
    assert out.exists(), "falta docs/evidence/kicker_falsify.json: correr scripts/kicker_falsify.py"
    data = json.loads(out.read_text())
    dome = next(s for s in data["strata"] if s["stratum"] == "techo cerrado")
    assert (round(-data["global_bias"], 2), round(-dome["bias"], 2)) == _registry_numbers()
