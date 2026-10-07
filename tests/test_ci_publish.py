"""PUBLICAR ES UNA SOLA DEFINICIÓN, Y REBASA.

    DOS WORKFLOWS QUE EMPUJAN A LA MISMA RAMA SE PISAN.

Esta rama la escriben cinco workflows. Sin rebase, el segundo ve su push
RECHAZADO con el trabajo ya hecho y commiteado, y el job muere sin publicar.

Medido el 7 de octubre de 2026: `weekly-predictions.yml` —el único que
regenera el payload— había fallado sus CUATRO ejecuciones programadas (9, 16,
23 y 30 de septiembre), todas en el push y ninguna calculando. Producción
llevaba ocho días en la jornada 4 estando en la 5, y no porque la ingesta se
hubiera parado: porque **nunca publicó sola**.

Lo que lo hace un fallo de este repositorio y no un descuido: el bucle correcto
YA existía en `adp.yml`, `research-feeds.yml` y `weekly-refresh.yml` — copiado
tres veces— y los dos que no lo tenían eran justo los dos que fallaban. Tres
copias de una regla son tres coberturas distintas de la misma regla.
"""
from __future__ import annotations

import re
import stat
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
WORKFLOWS = RAIZ / ".github" / "workflows"
PUBLICADOR = RAIZ / "scripts" / "ci_publish.sh"


def _sin_comentarios(texto: str) -> str:
    """Un comentario que NARRA el fallo lo casaría igual que el código."""
    return re.sub(r"^\s*#.*$", "", texto, flags=re.MULTILINE)


def test_el_publicador_existe_y_es_ejecutable():
    assert PUBLICADOR.exists(), "falta scripts/ci_publish.sh"
    assert PUBLICADOR.stat().st_mode & stat.S_IXUSR, (
        "ci_publish.sh no es ejecutable: el `run:` del workflow lo invoca directo"
    )


def test_ningun_workflow_empuja_por_su_cuenta():
    culpables = []
    for ruta in sorted(WORKFLOWS.glob("*.yml")):
        cuerpo = _sin_comentarios(ruta.read_text(encoding="utf-8"))
        for linea in cuerpo.splitlines():
            if re.search(r"\bgit push\b", linea):
                culpables.append(f"{ruta.name}: {linea.strip()[:70]}")
    assert not culpables, (
        "estos workflows empujan sin pasar por ci_publish.sh, así que no rebasan "
        f"ni reintentan y pierden su trabajo cuando otro llega primero: {culpables}"
    )


def test_hay_workflows_que_publican_de_verdad():
    """La comprobación de arriba pasaría EN VACÍO si nadie publicara."""
    usan = [
        r.name for r in sorted(WORKFLOWS.glob("*.yml"))
        if "ci_publish.sh" in r.read_text(encoding="utf-8")
    ]
    assert len(usan) >= 5, f"sólo {usan} llaman al publicador: ¿cambió la forma?"


def test_el_publicador_rebasa_y_reintenta():
    cuerpo = _sin_comentarios(PUBLICADOR.read_text(encoding="utf-8"))
    assert "--rebase" in cuerpo, "sin rebase, el push se rechaza y el trabajo se pierde"
    assert re.search(r"for \w+ in 1 2 3", cuerpo), "sin reintento, una colisión basta"
    # Y NO puede salir con 0 cuando no pudo publicar: salir verde es cómo esto
    # pasó cuatro semanas inadvertido.
    assert re.search(r"exit 1\s*$", cuerpo.strip()), (
        "el publicador tiene que acabar en ROJO si no consiguió publicar"
    )


def test_se_anade_al_indice_antes_de_comparar():
    """`git diff --quiet` NO VE UN FICHERO NUEVO, y un artefacto diario lo es.

    Ese fallo ya dejó un barrido en VERDE sin publicar su primer artefacto.
    """
    cuerpo = _sin_comentarios(PUBLICADOR.read_text(encoding="utf-8"))
    add = cuerpo.index("git add")
    diff = cuerpo.index("git diff --cached")
    assert add < diff, "se compara antes de añadir: un fichero nuevo pasaría por «sin cambios»"
