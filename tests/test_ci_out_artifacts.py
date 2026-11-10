"""LO QUE EL EXPORTADOR LEE DE `out/` TIENE QUE GENERARSE EN EL WORKFLOW.

`out/` está en `.gitignore`. En local los artefactos se quedan de una ejecución
para otra y todo parece estar; en CI el directorio nace vacío en cada
ejecución, así que una sección cuyo script NO corre en el workflow se publica
`null` para siempre — y no falla nada, porque `_load_optional` existe justo
para que una sección que falta no tumbe el export.

Ha pasado tres veces con tres secciones: el ranking semanal («la web publicada
SIN ranking semanal»), el informe previo al draft, y el 10 de noviembre de 2026
el plan de survivor: /survivor llevaba vacía en producción desde que el
workflow publica, con /salud diciéndolo en una fila que nadie miraba.

No se arregla una cuarta vez a mano: se cruza. Cada `paths.out / "x.json"` que
el exportador lee tiene que tener un script que lo ESCRIBA, y ese script tiene
que correr en `weekly-predictions.yml` ANTES del export.
"""

from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
EXPORT = (RAIZ / "scripts" / "export_web_data.py").read_text(encoding="utf-8")
WORKFLOW = (RAIZ / ".github" / "workflows" / "weekly-predictions.yml").read_text(encoding="utf-8")

#: Lo que NO sale de un script del workflow, a propósito, y por qué.
EXENTOS = {
    # Caché del walk-forward: si no está, el export lo recalcula él mismo.
    "backtest.json",
    # Lo escribe el barrido de prensa; el export tiene su segunda vía desde
    # `research/` (versionado) precisamente porque en CI no existe.
    "research.json",
}


def _sin_comentarios_yaml(texto: str) -> str:
    # La prosa que EXPLICA el fallo nombra el script igual que el paso que lo
    # corre: sin quitarla, borrar el paso dejaría el test en verde.
    return "\n".join(linea for linea in texto.splitlines() if not linea.lstrip().startswith("#"))


def _leidos() -> set[str]:
    return set(re.findall(r'paths\.out\s*/\s*"([a-z_]+\.json)"', EXPORT))


def _quien_escribe(artefacto: str) -> list[str]:
    """Los scripts que escriben `out/<artefacto>` (por asignación o `write_text`)."""
    autores = []
    for script in sorted((RAIZ / "scripts").glob("*.py")):
        if script.name == "export_web_data.py":
            continue
        codigo = script.read_text(encoding="utf-8")
        patron = (
            rf'(?:destination|destino)\s*=\s*paths\.out\s*/\s*"{re.escape(artefacto)}"'
            rf'|\(paths\.out\s*/\s*"{re.escape(artefacto)}"\)\.write_text'
        )
        if re.search(patron, codigo):
            autores.append(script.name)
    return autores


def test_el_exportador_lee_artefactos_de_out():
    # El `conAjuste.length > 0`: si el patrón deja de casar, los tests de abajo
    # pasarían sin mirar un solo artefacto.
    leidos = _leidos()
    assert {"fantasy_draft.json", "fantasy_weekly.json", "survivor.json"} <= leidos, leidos


def test_cada_artefacto_tiene_un_script_que_lo_escribe():
    for artefacto in sorted(_leidos() - EXENTOS):
        assert _quien_escribe(artefacto), (
            f"nadie escribe out/{artefacto}: o el patrón de este test se quedó "
            "viejo o el exportador lee algo que no existe")


def test_y_ese_script_corre_en_el_workflow_antes_del_export():
    pasos = _sin_comentarios_yaml(WORKFLOW)
    donde_export = pasos.find("python scripts/export_web_data.py")
    assert donde_export > 0, "el workflow ya no exporta el payload"
    for artefacto in sorted(_leidos() - EXENTOS):
        autores = _quien_escribe(artefacto)
        posiciones = [pasos.find(f"python scripts/{a}") for a in autores]
        corridos = [p for p in posiciones if p >= 0]
        assert corridos, (
            f"out/{artefacto} lo escribe {autores} y el workflow no corre ninguno: "
            "en CI `out/` nace vacío, así que esa sección se publica null para siempre")
        assert min(corridos) < donde_export, (
            f"out/{artefacto} se genera DESPUÉS del export: se publica el de la "
            "ejecución anterior, que en CI no existe")


def test_los_exentos_siguen_siendo_lecturas_reales():
    # Una exención de algo que ya no se lee es una puerta abierta sin dueño.
    assert EXENTOS <= _leidos(), EXENTOS - _leidos()


def test_ningun_paso_que_alimenta_el_export_puede_fallar_en_silencio():
    """`continue-on-error` en un paso que escribe `out/` es publicar sin él.

    El ranking semanal lo llevaba: si el script fallaba, el workflow seguía, el
    export no encontraba `out/fantasy_weekly.json` y publicaba la sección a
    `null` en verde. Es la otra mitad de este fichero — no basta con que el
    script corra, tiene que poder PARAR la publicación.
    """
    pasos = _sin_comentarios_yaml(WORKFLOW)
    assert "continue-on-error" not in pasos, (
        "un paso del workflow semanal puede fallar sin parar la publicación")
    assert "|| true" not in pasos
