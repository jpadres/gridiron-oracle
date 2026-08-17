#!/usr/bin/env python3
"""Mete la sección de research en el payload ya publicado, sin reentrenar nada.

El barrido de prensa es diario; el modelo se regenera los miércoles. Volver a
entrenar y a hacer el walk-forward cada día para cambiar unos párrafos de texto
serían cuatro minutos de CPU y, peor, un riesgo: cualquier fallo en la
regeneración tumbaría también los números que ya estaban bien.

Así que esto abre `web/data/model.b64.js` —el artefacto versionado, que siempre
está en el repo—, le sustituye **sólo** la clave `research`, y lo vuelve a
comprimir. Los números no se tocan.

    python scripts/research_build.py     # genera out/research.json
    python scripts/research_patch.py     # lo mete en el payload
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from export_web_data import write_payload  # noqa: E402

from oracle.config import paths as resolve_paths

_B64 = re.compile(r'MODEL_B64\s*=\s*"([^"]*)"')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Actualiza sólo la sección de research")
    parser.add_argument("--root", default=None)
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root)
    research_file = paths.out / "research.json"
    if not research_file.exists():
        print("No hay out/research.json. Nada que hacer.")
        return 0

    payload = _read_payload(paths.web_data / "model.b64.js")
    if payload is None:
        print(
            "No se pudo leer web/data/model.b64.js. La sección de research se publicará "
            "en la próxima regeneración completa."
        )
        return 0

    payload["research"] = json.loads(research_file.read_text(encoding="utf-8"))
    write_payload(paths.web_data, payload)
    print(f"Payload actualizado con {len(payload['research'].get('items', []))} fichas.")
    return 0


def _read_payload(path: Path) -> dict | None:
    if not path.exists():
        return None
    match = _B64.search(path.read_text(encoding="utf-8"))
    if not match or not match.group(1):
        return None
    try:
        raw = gzip.decompress(base64.b64decode(match.group(1)))
        return json.loads(raw.decode("utf-8"))
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f"  payload ilegible: {error}")
        return None


if __name__ == "__main__":
    raise SystemExit(main())
