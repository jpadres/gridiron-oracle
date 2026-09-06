"""Rellena `data_dates` en el payload publicado, SIN reentrenar el modelo.

    ESTO FECHA EL DATO PUBLICADO, NO EL FICHERO QUE HAY EN DISCO.

Se corre DESPUÉS de exportar el payload desde esos ficheros, nunca antes. El
6 de septiembre se refrescaron `roster_2026.parquet` y `games.csv` y se corrió
esto sin regenerar el payload: `data_dates.rosters` pasó a decir 6-sep mientras
cada fila del board seguía llevando `roster_source_as_of: 2026-09-05`, que es
la instantánea de la que salió. Dos fechas del mismo hecho en la misma
pantalla, y la de arriba —la que se lee primero— afirmando más de lo que las
filas sostienen. Refrescar el fichero no actualiza lo que ya está publicado.

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


def fechas_que_se_perderian(antes: dict, ahora: dict) -> list[str]:
    """Secciones que el payload YA fecha y que este cálculo dejaría en UNKNOWN.

    Aparte para poder probarla: `main` resuelve las rutas desde la raíz del
    repositorio, así que el caso —un clon sin `data/`— no se puede montar
    llamándolo.

    Sólo mira las claves que este cálculo SÍ produce. Una que no produce en
    absoluto —`research` no sale de ningún fichero de origen, sale de
    `fecha_del_research` sobre las fichas— no se pierde: `main` FUNDE en vez
    de sustituir, así que sigue en el payload. Contarla aquí bloquearía el
    parche por una pérdida que no ocurre.
    """
    return sorted(k for k, v in ahora.items() if not v and (antes or {}).get(k))


def main() -> int:
    paths = resolve_paths(RAIZ)
    destino = RAIZ / "web" / "data"
    crudo = destino / "model.json"
    if not crudo.exists():
        sys.exit(f"No encuentro {crudo}: hay que exportar el payload primero.")

    payload = json.loads(crudo.read_text(encoding="utf-8"))
    fechas = _fechas_de_origen(paths)
    antes = payload.get("data_dates") or {}

    # BORRAR UNA FECHA CIERTA NO ES «PUBLICAR UNKNOWN».
    #
    # `data/` está en `.gitignore` y pesa 490 MB: en un clon recién hecho no
    # hay un solo fichero de origen, así que este script calcularía tres
    # `None` y los escribiría ENCIMA de las fechas que el payload ya traía,
    # medidas cuando sí había datos. El resultado —tres UNKNOWN— parece
    # prudente y es una pérdida de información: la regla dice UNKNOWN antes
    # que INVENTADO, no UNKNOWN antes que MEDIDO.
    #
    # Es el mismo fallo que el research diario, que publicaba 45 fichas
    # sueltas encima de las buenas porque su índice vivía en `out/`.
    perdidas = fechas_que_se_perderian(antes, fechas)
    if perdidas:
        print("No sobrescribo fechas medidas con UNKNOWN. Sin fichero de origen "
              f"para: {', '.join(perdidas)}.")
        print("Ejecuta `oracle refresh` antes, o deja el payload como está.")
        return 1

    # Se FUNDE en vez de sustituir: lo que este script no calcula, no lo toca.
    payload["data_dates"] = {**antes, **fechas}
    write_payload(destino, payload)

    print(f"data_dates: {antes or None} -> {fechas}")
    faltan = [k for k, v in fechas.items() if not v]
    if faltan:
        # Aquí sí es correcto: el payload tampoco las tenía. UNKNOWN es la
        # verdad y la interfaz lo escribe.
        print(f"  (aviso) sin fichero de origen para: {', '.join(faltan)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
