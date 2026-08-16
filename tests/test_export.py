"""Tests del exportador del payload de la web.

Existen por un fallo concreto: un `NaN` en el JSON tumbaba la web entera.
"""

from __future__ import annotations

import base64
import gzip
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from export_web_data import _finite, write_payload  # noqa: E402


def _decode(directory: Path) -> str:
    """Deshace lo que hace `write_payload`: base64 -> gzip -> texto."""
    source = (directory / "model.b64.js").read_text(encoding="utf-8")
    encoded = source.split('"')[1]
    return gzip.decompress(base64.b64decode(encoded)).decode("utf-8")


def test_nan_never_reaches_the_payload(tmp_path):
    """**JavaScript no acepta NaN.** `JSON.parse` revienta con el payload entero.

    El fallo no se ve desde Python (que relee su propio NaN sin quejarse) y en
    la web aparece como «todavía no hay datos» en *todas* las secciones — que
    parece un problema de generación, no de serialización. Un solo jugador sin
    fecha de nacimiento bastaba para tumbar la página.
    """
    write_payload(
        tmp_path,
        {
            "placeholder": False,
            "fantasy": {"board": [{"player_name": "Sin edad", "age": float("nan"),
                                   "vor": 12.5}]},
            "ratings": [{"team": "KC", "elo": float("inf")}],
        },
    )

    raw = _decode(tmp_path)
    assert "NaN" not in raw
    assert "Infinity" not in raw

    payload = json.loads(raw)
    assert payload["fantasy"]["board"][0]["age"] is None
    assert payload["fantasy"]["board"][0]["vor"] == 12.5
    assert payload["ratings"][0]["elo"] is None


def test_payload_is_valid_json_for_javascript(tmp_path):
    """La comprobación de verdad: que lo parsee un motor de JavaScript.

    Python acepta su propio dialecto con NaN, así que un `json.loads` en Python
    no habría detectado el fallo original. Este test lo valida con node.
    """
    write_payload(tmp_path, {"placeholder": False, "value": float("nan"), "ok": [1, 2, 3]})

    node = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            f"import {{ MODEL_B64 }} from '{(tmp_path / 'model.b64.js').as_posix()}';"
            "import {gunzipSync} from 'node:zlib';"
            "const data = JSON.parse(gunzipSync(Buffer.from(MODEL_B64,'base64')).toString());"
            "if (data.value !== null) throw new Error('NaN no se convirtió a null');"
            "console.log('ok');",
        ],
        capture_output=True,
        text=True,
    )
    if node.returncode != 0 and "Cannot find module" in node.stderr:
        pytest.skip("node no disponible")
    assert node.returncode == 0, node.stderr
    assert "ok" in node.stdout


def test_finite_leaves_normal_values_alone():
    payload = {"a": 1, "b": 2.5, "c": "texto", "d": None, "e": [1, {"f": True}]}
    assert _finite(payload) == payload


def test_compression_is_reproducible(tmp_path):
    """Dos ejecuciones con los mismos datos producen los mismos bytes.

    Sin `mtime=0` el gzip lleva una marca de tiempo, cada regeneración cambia el
    fichero aunque los datos sean idénticos, y el workflow semanal publicaría un
    commit de ruido cada semana.
    """
    payload = {"placeholder": False, "predictions": [{"home_team": "KC", "pred_margin": 3.5}]}
    write_payload(tmp_path, payload)
    first = (tmp_path / "model.b64.js").read_bytes()
    write_payload(tmp_path, payload)
    assert (tmp_path / "model.b64.js").read_bytes() == first


def test_accents_survive_the_round_trip(tmp_path):
    """El proyecto está en español: el payload no puede escapar los acentos."""
    write_payload(tmp_path, {"placeholder": False, "nota": "validación y calibración"})
    assert json.loads(_decode(tmp_path))["nota"] == "validación y calibración"
