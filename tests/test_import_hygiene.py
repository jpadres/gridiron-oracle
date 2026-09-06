"""Ningún test puede depender de CÓMO se invoque a pytest.

    `python -m pytest` METE EL DIRECTORIO ACTUAL EN sys.path. `pytest` NO.

Ese detalle costó dos commits con CI en rojo dados por buenos: un
`from scripts import source_date_repair` importaba perfectamente en local —donde
se verificó con `python -m pytest`— y en CI, que ejecuta `pytest -q`, la suite
ENTERA se quedaba sin recolectar (`ModuleNotFoundError: No module named
'scripts'`, exit 2). No fallaban unos tests: no se ejecutaba ninguno.

Se arregló cargando los scripts POR RUTA con `importlib`. Este fichero existe
para que el arreglo no dependa de acordarse: la forma que rompe es un import
del paquete `scripts`, y aquí se prohíbe explícitamente. Es estrecho a
propósito — mira la forma concreta que ocurrió, no «imports raros».
"""
from __future__ import annotations

import re
from pathlib import Path

TESTS = Path(__file__).resolve().parent
#: `from scripts import x`, `import scripts`, `import scripts.x as y`.
PROHIBIDO = re.compile(r"^\s*(?:from\s+scripts(?:\.\w+)*\s+import\b|import\s+scripts\b)", re.M)


def test_ningun_test_importa_el_paquete_scripts():
    culpables = []
    for path in sorted(TESTS.glob("test_*.py")):
        texto = path.read_text(encoding="utf-8")
        # Fuera las cadenas de documentación que EXPLICAN el fallo: lo que se
        # persigue es la sentencia, no la palabra.
        sin_docs = re.sub(r'"""[\s\S]*?"""', "", texto)
        if PROHIBIDO.search(sin_docs):
            culpables.append(path.name)
    assert culpables == [], (
        f"{culpables} importan el paquete `scripts`. Eso funciona con "
        "`python -m pytest` y NO con `pytest`, que es el comando de CI: la suite "
        "entera deja de recolectarse. Cárgalo por ruta con `importlib.util."
        "spec_from_file_location`, como hacen test_source_date_repair.py y "
        "test_roster_status.py."
    )


def test_no_existe_scripts_slash_init():
    """Y `scripts/__init__.py` tampoco vuelve.

    Se añadió una vez para que aquel import funcionara. Con él, `scripts` es un
    paquete instalable y el import empieza a funcionar en local otra vez — o
    sea, el fallo vuelve a esconderse en vez de arreglarse.
    """
    assert not (TESTS.parent / "scripts" / "__init__.py").exists(), (
        "`scripts/` no es un paquete importable: es un directorio de utilidades "
        "que se cargan por ruta"
    )
