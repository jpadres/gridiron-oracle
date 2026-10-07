"""DE DÓNDE SALE EL PAYLOAD EN UN TEST.

    `web/data/model.json` ESTÁ EN .gitignore. EN CI NO EXISTE NUNCA.

Y eso convertía en un `skip` silencioso a todo test que lo leyera: el contrato
de esquema entero —las colecciones que la web lee, la aritmética de la mezcla
semanal, las fechas por sección— no corría en CI. Es el fallo que este
repositorio ya anotó dos veces (el research diario sacando su índice de `out/`,
y el informe previo leyendo el payload) y aquí estaba dentro de la propia suite.

Lo que SÍ se versiona es `web/data/model.b64.js`, que es el MISMO payload en
gzip+base64 y es el que la web descomprime en build time. O sea que es el que
de verdad se publica: un contrato comprobado contra él es más fuerte, no más
débil. No es un respaldo silencioso a algo correcto-para-otra-cosa — es el
mismo dato, y de hecho el que llega a la pantalla.
"""

from __future__ import annotations

import base64
import gzip
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CRUDO = RAIZ / "web" / "data" / "model.json"
COMPRIMIDO = RAIZ / "web" / "data" / "model.b64.js"


def _del_comprimido() -> dict | None:
    if not COMPRIMIDO.exists():
        return None
    texto = COMPRIMIDO.read_text(encoding="utf-8")
    m = re.search(r'MODEL_B64\s*=\s*"([A-Za-z0-9+/=]*)"', texto)
    if not m or not m.group(1):
        return None
    return json.loads(gzip.decompress(base64.b64decode(m.group(1))).decode("utf-8"))


def load() -> dict | None:
    """El payload publicado, o `None` si no hay ninguno.

    Se prefiere `model.json` cuando está —es el que acaba de escribir el
    exportador en local, así que un test ve el efecto de su cambio sin
    recomprimir— y si no, el comprimido, que es el que viaja en el repositorio.
    `None` sólo en un clon sin ninguno de los dos.
    """
    if CRUDO.exists():
        return json.loads(CRUDO.read_text(encoding="utf-8"))
    return _del_comprimido()
