"""CADA CONTROL DE CI INFORMA POR SU CUENTA.

En GitHub Actions un paso que falla SALTA todos los que van detrás. Del 14 de
octubre al 10 de noviembre de 2026 «Cifras de portada» falló a diario —la
muestra del backtest crece cada jornada y la documentación se quedaba atrás— y,
por ir delante, ni el lint ni la suite de Python corrieron una sola vez en CI.
En el job de la web, un falso positivo del paso de idioma apagó los tests de
JavaScript, la simulación de draft y la verificación de cabeceras.

Un control que falla tiene que costar UN control, no todos los de detrás: si
no, el primer rojo permanente desactiva el resto y deja la sensación de que
algo vigila.
"""

from __future__ import annotations

import re
from pathlib import Path

CI = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml").read_text(
    encoding="utf-8")

#: Los jobs con varios controles encadenados, y el paso que los prepara.
JOBS = {"python": "Instalar", "web": "Build"}
CONDICION = "if: ${{ !cancelled() && steps.preparar.outcome == 'success' }}"


def _pasos(job: str) -> list[tuple[str, str]]:
    """(nombre, cuerpo) de cada paso con nombre de un job, sin comentarios."""
    m = re.search(rf"^  {job}:\n(.*?)(?=^  [a-z_-]+:\n|\Z)", CI, re.S | re.M)
    assert m, f"no encuentro el job «{job}» en ci.yml"
    cuerpo = "\n".join(ln for ln in m.group(1).splitlines() if not ln.lstrip().startswith("#"))
    trozos = re.split(r"^      - ", cuerpo, flags=re.M)[1:]
    pasos = []
    for trozo in trozos:
        nombre = re.match(r"name: (.+)", trozo)
        if nombre:
            pasos.append((nombre.group(1).strip(), trozo))
    return pasos


def test_se_leen_los_dos_jobs_y_tienen_controles():
    # El `conAjuste.length > 0`: con cero pasos leídos lo de abajo pasa en vacío.
    assert len(_pasos("python")) >= 5
    assert len(_pasos("web")) >= 9


def test_todo_control_posterior_a_la_preparacion_corre_aunque_falle_otro():
    for job, preparacion in JOBS.items():
        pasos = _pasos(job)
        nombres = [n for n, _ in pasos]
        assert nombres.count(preparacion) == 1, f"{job}: no hay un único paso «{preparacion}»"
        desde = nombres.index(preparacion)
        assert "id: preparar" in pasos[desde][1], (
            f"{job}: «{preparacion}» perdió su id y la condición de los demás no apunta a nada")
        controles = pasos[desde + 1:]
        assert controles, f"{job}: no hay controles detrás de «{preparacion}»"
        sin = [n for n, cuerpo in controles if CONDICION not in cuerpo]
        assert not sin, (
            f"{job}: {sin} se saltarían si falla un paso anterior. Un control nuevo "
            "lleva la misma condición que los demás")


def test_la_condicion_no_es_un_always_a_secas():
    # `always()` correría los controles sobre una instalación ROTA y los pondría
    # todos en rojo por un motivo que no es el suyo: ruido, que es como un
    # guardián acaba desactivado.
    assert "if: always()" not in CI
    assert "continue-on-error: true" not in "\n".join(
        ln for ln in CI.splitlines() if not ln.lstrip().startswith("#")), (
        "un control con continue-on-error no es un control")


def test_el_bucle_nocturno_corre_todos_los_laboratorios_y_falla_al_final():
    """`set -e` en un bucle es el mismo fallo que un paso que salta a los demás.

    `live-assistant` falló cada noche durante semanas y, por ir primero, los
    otros siete laboratorios del bucle no se ejecutaron ninguna de ellas: dos
    tenían un selector roto desde septiembre.
    """
    yml = (Path(__file__).resolve().parents[1] / ".github" / "workflows"
           / "labs-nightly.yml").read_text(encoding="utf-8")
    pasos = "\n".join(ln for ln in yml.splitlines() if not ln.lstrip().startswith("#"))
    bucle = pasos[pasos.index("for lab in"):]
    assert "set -e" not in pasos[pasos.index("Laboratorios profundos"):pasos.index("for lab in")], (
        "con set -e el primer laboratorio en rojo deja sin correr a los demás")
    assert re.search(r"if ! SKIP_BUILD=1 node tools/lab/\$lab\.mjs; then", bucle), (
        "el bucle ya no recoge el fallo de cada laboratorio")
    assert "exit 1" in bucle, "recoger los fallos y no salir en rojo es no tener laboratorios"
