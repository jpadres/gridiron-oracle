"""NINGÚN PASO DE CI LEE UN FICHERO QUE .gitignore GARANTIZA QUE NO EXISTE.

    `out/` Y `web/data/model.json` ESTÁN EN .gitignore: EN CI NO EXISTEN NUNCA.

En local sobreviven de la ejecución anterior, así que un script que los lea
funciona en el portátil y muere en el runner — y muere en el paso que publica,
que es donde menos se mira.

Ya ha pasado dos veces:

  · `research_build.py` sacaba el índice de enlazado de `out/fantasy_weekly.json`
    y publicaba CERO enlaces a jugador en CI.
  · `predraft_brief.py` leía `web/data/model.json` para sacar el board, y ese
    fichero lo escribe el paso SIGUIENTE del mismo job. El 23 de septiembre de
    2026 «Regenerar y publicar» llevaba muriendo con `FileNotFoundError` antes
    de exportar nada: la web no se regeneraba sola y no lo decía nadie.

Estrecho a propósito: el fichero concreto, en los scripts que corren en CI.
"""
from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]

#: Lo que .gitignore garantiza ausente en un checkout limpio.
AUSENTES_EN_CI = ("web/data/model.json",)

#: Los scripts que corren dentro de un job de CI, sacados de los workflows.
def _scripts_de_ci() -> set[str]:
    encontrados: set[str] = set()
    for wf in (RAIZ / ".github" / "workflows").glob("*.yml"):
        for m in re.finditer(r"python\s+(scripts/[\w_]+\.py)", wf.read_text(encoding="utf-8")):
            encontrados.add(m.group(1))
    return encontrados


def _sin_comentarios(texto: str) -> str:
    """Un comentario que NARRA el fallo lo casaría igual que el código.

    Ya costó una versión en `Briefs.jsx` y otra en `reloj.mjs`.
    """
    sin_docstrings = re.sub(r'"""[\s\S]*?"""', "", texto)
    return re.sub(r"#.*$", "", sin_docstrings, flags=re.MULTILINE)


def test_hay_scripts_de_ci_que_mirar():
    """La comprobación de arriba pasaría en vacío si el patrón dejara de casar."""
    scripts = _scripts_de_ci()
    assert len(scripts) >= 5, f"sólo encuentro {scripts}: ¿cambió la forma de los workflows?"


def test_ningun_script_de_ci_lee_el_payload_publicado():
    culpables = []
    for rel in sorted(_scripts_de_ci()):
        ruta = RAIZ / rel
        if not ruta.exists():
            continue
        cuerpo = _sin_comentarios(ruta.read_text(encoding="utf-8"))
        for ausente in AUSENTES_EN_CI:
            # `model.json` se nombra partido (`"web" / "data" / "model.json"`),
            # así que se busca el nombre del fichero, que es lo que no puede
            # aparecer como ENTRADA de un script que corre en el runner.
            nombre = Path(ausente).name
            # ESCRIBIRLO es legítimo —`export_web_data.py` es quien lo produce—;
            # lo que no puede es LEERLO. Se quitan las líneas de escritura en vez
            # de excluir el fichero entero, para que un `read_text` futuro dentro
            # del propio exportador siga saltando: una excepción que apaga la
            # comprobación es peor que no tenerla.
            lectura = [
                linea for linea in cuerpo.splitlines()
                if nombre in linea and not re.search(r"write_(text|bytes)\s*\(", linea)
            ]
            if lectura:
                culpables.append(f"{rel} lee {nombre}: {lectura[0].strip()[:70]}")
    assert not culpables, (
        "estos scripts corren en CI y leen un fichero que .gitignore garantiza "
        f"ausente: {culpables}. En local existe de la vez anterior; en el runner "
        "no, y el job muere en el paso que publica."
    )
