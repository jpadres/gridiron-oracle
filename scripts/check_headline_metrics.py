"""Las cifras de portada de la documentación tienen que ser las del payload.

Durante meses `CLAUDE.md` y el cuerpo del `README.md` publicaron Brier
0.2118 / 0.2113 y MAE 10.00 / 9.97 — las del **proyecto original** del autor,
nunca reconciliadas con lo que esta implementación mide. La web nunca mintió:
lee `validation.overall` del payload y enseñaba 0.2127 / 0.2119 y 10.04. O sea
que el sitio y sus propios documentos decían cosas distintas, y la diferencia
caía del lado incómodo — la distancia real al mercado era MAYOR que la
publicada.

Nada falla cuando eso pasa: es prosa. Por eso hace falta comprobarlo.

Se lee `model.b64.js` y NO `model.json`, que está en `.gitignore`: un guardián
que dependa de un fichero ausente en CI no comprueba nada allí — la lección del
research diario, que publicaba cero enlaces porque su índice vivía en `out/`.

Y es ESTRECHO a propósito: sólo las cuatro cifras de portada, buscadas por la
frase que las contiene. Si la frase cambia de forma, el guardián se pone ROJO
por «no la encuentro» en vez de pasar en vacío — que es el fallo que este
repositorio ya ha cometido cuatro veces.
"""

from __future__ import annotations

import base64
import gzip
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def payload() -> dict:
    texto = (RAIZ / "web/data/model.b64.js").read_text(encoding="utf-8")
    m = re.search(r'MODEL_B64\s*=\s*"([A-Za-z0-9+/=]*)"', texto)
    if not m:
        sys.exit("No se pudo leer MODEL_B64 de web/data/model.b64.js")
    return json.loads(gzip.decompress(base64.b64decode(m.group(1))).decode("utf-8"))


# (fichero, descripción, patrón con un grupo por cifra, métricas y decimales)
#
# El orden de los grupos es el orden de las métricas. Cada patrón lleva `\s+`
# donde el texto puede partir de línea, porque el markdown se reajusta a 80
# columnas y una cifra correcta no puede fallar por un salto de línea.
COMPROBACIONES = [
    (
        "CLAUDE.md",
        "cifras de portada",
        r"Brier \*\*([\d.]+)\*\*\s+frente a \*\*([\d.]+)\*\*, MAE \*\*([\d.]+)\*\* frente a \*\*([\d.]+)\*\*",
        [("brier", 4), ("market_brier", 4), ("margin_mae", 2), ("market_margin_mae", 2)],
    ),
    (
        "README.md",
        "resultado honesto en una línea",
        r"Brier de \*\*([\d.]+)\*\* frente al \*\*([\d.]+)\*\* de las\s+casas de apuestas, y un MAE de margen de \*\*([\d.]+)\*\* frente a \*\*([\d.]+)\*\*",
        [("brier", 4), ("market_brier", 4), ("margin_mae", 2), ("market_margin_mae", 2)],
    ),
    (
        "README.md",
        "fila de Brier de la tabla",
        r"\| Brier \(prob\. de victoria\) \| ([\d.]+) \| ([\d.]+) \|",
        [("brier", 4), ("market_brier", 4)],
    ),
    (
        "README.md",
        "fila de MAE del margen de la tabla",
        r"\| MAE del margen \| ([\d.]+) \| ([\d.]+) \|",
        [("margin_mae", 2), ("market_margin_mae", 2)],
    ),
]


def main() -> int:
    overall = payload().get("validation", {}).get("overall")
    if not overall:
        sys.exit("El payload no trae validation.overall: no hay contra qué comprobar.")

    fallos = []
    for fichero, que, patron, metricas in COMPROBACIONES:
        texto = (RAIZ / fichero).read_text(encoding="utf-8")
        m = re.search(patron, texto)
        if not m:
            # ROJO, no verde: un guardián que no encuentra lo que vigila no ha
            # comprobado nada, y decir «pasa» sería exactamente el fallo.
            fallos.append(f"{fichero}: no encuentro las {que}. Si has reescrito la frase, actualiza el patrón.")
            continue
        for grupo, (clave, decimales) in enumerate(metricas, start=1):
            escrito = m.group(grupo)
            real = round(float(overall[clave]), decimales)
            if round(float(escrito), decimales) != real:
                fallos.append(
                    f"{fichero} ({que}): dice {clave} = {escrito}, el payload mide {real:.{decimales}f}"
                )

    if fallos:
        print("Las cifras de portada no son las del payload:\n")
        for f in fallos:
            print(f"  {f}")
        print("\nEl payload manda. Corrige la documentación, no el payload.")
        return 1

    print(
        f"Cifras de portada OK: Brier {overall['brier']:.4f} / {overall['market_brier']:.4f}, "
        f"MAE {overall['margin_mae']:.2f} / {overall['market_margin_mae']:.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
