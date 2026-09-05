"""Rellena `data_dates` en el payload publicado, SIN reentrenar el modelo.

El campo se añadió el 5 de septiembre de 2026 y los payloads anteriores no lo
llevan, así que la interfaz escribe «retrieved on an unknown date» — verdad, pero
verdad pobre. Regenerar el payload entero para conseguirlo obligaría a rehacer
todas las secciones, y ya hubo una publicación SIN ranking semanal por depender
de ficheros de `out/` que en algún entorno no existen. Esto toca una sola clave.

**Las fechas no se calculan aquí.** Se importa `_fechas_de_origen` del
exportador: dos implementaciones de la misma regla es el fallo que este
repositorio ha cometido ocho veces, y aquí sería especialmente malo porque la
regla ES la afirmación de frescura.

Idempotente: sobre los mismos ficheros de origen da el mismo valor, así que
volver a ejecutarlo no ensucia el repositorio.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))
sys.path.insert(0, str(RAIZ / "scripts"))

from export_web_data import _fechas_de_origen, write_payload  # noqa: E402

from oracle.pipeline import resolve_paths  # noqa: E402


def main() -> int:
    paths = resolve_paths(RAIZ)
    destino = RAIZ / "web" / "data"
    crudo = destino / "model.json"
    if not crudo.exists():
        sys.exit(f"No encuentro {crudo}: hay que exportar el payload primero.")

    payload = json.loads(crudo.read_text(encoding="utf-8"))
    fechas = _fechas_de_origen(paths)
    antes = payload.get("data_dates")
    payload["data_dates"] = fechas
    write_payload(destino, payload)

    print(f"data_dates: {antes} -> {fechas}")
    faltan = [k for k, v in fechas.items() if not v]
    if faltan:
        # No es un error: sin el fichero de origen la fecha es UNKNOWN y la
        # interfaz lo dice. Pero se avisa, porque publicar UNKNOWN teniendo el
        # dato sería media medición.
        print(f"  (aviso) sin fichero de origen para: {', '.join(faltan)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
