"""Recalcula el walk-forward y lo mete en el payload publicado, sin tocar nada más.

Existe por el mismo motivo que `data_dates_patch.py`: la validación es una sola
clave del payload y regenerar el fichero entero obliga a rehacer secciones que
dependen de artefactos de `out/` — así se publicó una vez la web SIN ranking
semanal.

**El walk-forward no se reimplementa aquí.** Se importa `build_validation` del
exportador, que es la MISMA función que usa la regeneración completa.

Se añadió el 5 de septiembre de 2026 para publicar `free_brier` y
`free_margin_mae`: la variante autónoma del modelo —la que sale cuando no hay
línea publicada, es decir las jornadas futuras del survivor— se citaba en la web
con dos cifras escritas a mano que no estaban en ningún dato de este repositorio.

Determinista sobre las mismas features: si vuelve a salir un número distinto en
las claves que ya existían, eso es un hallazgo, no ruido. Por eso las compara y
lo dice.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))
sys.path.insert(0, str(RAIZ / "scripts"))

from export_web_data import build_validation, write_payload  # noqa: E402

from oracle.config import DEFAULT_BACKTEST_START  # noqa: E402
from oracle.pipeline import Oracle, resolve_paths  # noqa: E402


def main() -> int:
    paths = resolve_paths(RAIZ)
    destino = RAIZ / "web" / "data"
    crudo = destino / "model.json"
    if not crudo.exists():
        sys.exit(f"No encuentro {crudo}: hay que exportar el payload primero.")

    payload = json.loads(crudo.read_text(encoding="utf-8"))
    antes = (payload.get("validation") or {}).get("overall") or {}

    # El walk-forward reajusta el modelo temporada a temporada: sólo necesita
    # la tabla de features, no el modelo de producción. Entrenarlo aquí sería
    # entrenar con TODO el historial y no usarlo para nada.
    features = Oracle.build_features(RAIZ)
    print(f"Walk-forward desde {DEFAULT_BACKTEST_START} (tarda unos minutos)...")
    validation = build_validation(features, DEFAULT_BACKTEST_START)
    (paths.out / "backtest.json").write_text(
        json.dumps(validation, default=str), encoding="utf-8"
    )
    payload["validation"] = validation
    write_payload(destino, payload)

    ahora = validation["overall"]
    movidas = [
        (k, antes[k], ahora[k])
        for k in antes
        if k in ahora and antes[k] != ahora[k]
    ]
    for clave, viejo, nuevo in movidas:
        print(f"  CAMBIÓ {clave}: {viejo} -> {nuevo}")
    nuevas = [k for k in ahora if k not in antes]
    if nuevas:
        print(f"  claves nuevas: {', '.join(nuevas)}")
    for clave in ("brier", "market_brier", "free_brier", "margin_mae", "free_margin_mae"):
        print(f"  {clave}: {ahora.get(clave)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
