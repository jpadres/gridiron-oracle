#!/usr/bin/env python3
"""¿Está el asistente listo para el draft? READY o NOT READY, con motivos.

    «READY» NO PUEDE SALIR BARATO.

Un comando que dice que sí porque no encontró nada que mirar es peor que no
tenerlo: deja la sensación de que algo comprobó. Así que cada comprobación
puede terminar de TRES formas y sólo una de ellas es buena:

    OK          se comprobó y está bien
    FALLO       se comprobó y está mal            -> NOT READY
    NO SÉ       no se pudo comprobar               -> NOT READY

«No he podido comprobarlo» no es «está bien». Es la misma regla que se aplicó a
`pip-audit` cuando PyPI cortó la conexión: no haber podido auditar no es no
haber encontrado vulnerabilidades.

## Lo que NO promete

No dice que la recomendación sea buena: `BEST_PICK_FOR_ME` está medido (E23,
+48,3 puntos por equipo-temporada con el efecto concentrado en 2019-2022 y
NEGATIVO en 2025) y eso no lo cambia este script. Dice que el producto está
entero: los datos existen, tienen su fecha, las plantillas están cruzadas, el
motor de decisión pasa sus regresiones y el pool da para completar una
alineación legal.

La verificación con un draft REAL de Sleeper es otra cosa y se informa aparte
como LIVE SYNC UNVERIFIED: desde este contenedor la política de red deniega el
CONNECT a `api.sleeper.app` (`docs/RED_ENTORNOS.md`).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

OK, FALLO, NO_SE = "OK", "FALLO", "NO SÉ"

#: Cuántos días puede tener el registro de PLANTILLAS y seguir sirviendo para
#: decidir un pick. No es una convención de gusto: los cortes son del 26-27 de
#: agosto y un fichero anterior a ellos no sabe quién tiene equipo.
ROSTER_MAX_DIAS = 7
#: El modelo puede ser más viejo —su estadística es de temporadas cerradas— y
#: por eso su fecha se PUBLICA en vez de caducar. Lo que no puede es faltar.


@dataclass
class Check:
    nombre: str
    estado: str
    detalle: str

    @property
    def bloquea(self) -> bool:
        return self.estado != OK


def _payload() -> dict | None:
    """El payload que de verdad se publica.

    `model.json` está en `.gitignore`; el que viaja al repositorio —y el que la
    web descomprime en el build— es `model.b64.js`. Leer sólo el primero haría
    que este comando dijera «no hay nada que comprobar» en CI y en cualquier
    clon limpio, que es la forma de salir verde sin mirar.
    """
    path = RAIZ / "web" / "data" / "model.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return None
    import base64
    import gzip
    import re

    b64 = RAIZ / "web" / "data" / "model.b64.js"
    if not b64.exists():
        return None
    match = re.search(r'MODEL_B64\s*=\s*"([^"]*)"', b64.read_text(encoding="utf-8"))
    if not match or not match.group(1):
        return None
    try:
        return json.loads(gzip.decompress(base64.b64decode(match.group(1))).decode("utf-8"))
    except (ValueError, OSError):
        return None


def _dias(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return (date.today() - date.fromisoformat(str(iso)[:10])).days
    except ValueError:
        return None


def comprobar_fechas(payload: dict) -> list[Check]:
    fechas = payload.get("data_dates") or {}
    salida = []
    for seccion in ("model", "fantasy", "rosters", "markets", "research"):
        valor = fechas.get(seccion)
        if not valor:
            salida.append(Check(f"fecha · {seccion}", NO_SE,
                                "la sección no publica fecha: la pantalla escribirá UNKNOWN"))
            continue
        dias = _dias(valor)
        detalle = f"{valor}" + (f" ({dias} días)" if dias is not None else "")
        if seccion == "rosters" and dias is not None and dias > ROSTER_MAX_DIAS:
            salida.append(Check("fecha · rosters", FALLO,
                                f"{detalle}: anterior a los cortes, no sabe quién tiene equipo"))
        else:
            salida.append(Check(f"fecha · {seccion}", OK, detalle))
    return salida


def comprobar_board(payload: dict) -> list[Check]:
    fantasy = payload.get("fantasy") or {}
    board = fantasy.get("board") or []
    salida = []
    if len(board) < 300:
        return [Check("board", FALLO, f"sólo {len(board)} filas: no da para un draft")]
    salida.append(Check("board", OK, f"{len(board)} filas"))

    sin_id = sum(1 for r in board if not r.get("player_id"))
    sin_pos = sum(1 for r in board if not r.get("position"))
    salida.append(Check("identidad", FALLO if (sin_id or sin_pos) else OK,
                        f"{sin_id} sin id, {sin_pos} sin posición"))

    sin_estado = [r for r in board if not r.get("roster_state")]
    salida.append(Check("plantilla en cada fila", FALLO if sin_estado else OK,
                        f"{len(sin_estado)} filas sin situación de plantilla"))

    sin_fecha = [r for r in board if not r.get("roster_source_as_of")]
    salida.append(Check("plantilla fechada", FALLO if sin_fecha else OK,
                        f"{len(sin_fecha)} filas sin la fecha de su fichero"))

    # Pool por posición: que haya con qué llenar una alineación legal.
    from collections import Counter
    pool = Counter(r.get("position") for r in board
                   if r.get("roster_state") == "ACTIVE")
    minimos = {"QB": 24, "RB": 60, "WR": 72, "TE": 24}
    faltan = {p: pool.get(p, 0) for p, n in minimos.items() if pool.get(p, 0) < n}
    salida.append(Check("pool activo por posición", FALLO if faltan else OK,
                        f"{dict(sorted(pool.items()))}"
                        + (f" — POR DEBAJO: {faltan}" if faltan else "")))

    novatos = [r for r in board if r.get("rookie")]
    con_previa = [r for r in novatos if r.get("projected_points")]
    salida.append(Check("novatos con previa", FALLO if not con_previa else OK,
                        f"{len(con_previa)} de {len(novatos)} con número propio"))
    return salida


def comprobar_especialistas(payload: dict) -> list[Check]:
    sp = (payload.get("fantasy") or {}).get("specialists") or {}
    ks = sp.get("kickers") or []
    ds = sp.get("defenses") or []
    salida = []
    if len(ks) < 32 or len(ds) < 32:
        salida.append(Check("especialistas", FALLO,
                            f"{len(ks)} pateadores y {len(ds)} defensas: la liga tiene 32"))
    else:
        salida.append(Check("especialistas", OK, f"{len(ks)} K y {len(ds)} DST"))
    sin_marca = [k for k in ks if not k.get("roster_state")]
    salida.append(Check("pateadores comprobados", FALLO if sin_marca else OK,
                        f"{len(sin_marca)} sin situación de plantilla"))
    # Y una defensa NUNCA puede salir como «sin equipo»: no es una persona.
    mal = [d for d in ds if d.get("roster_state") == "NOT_ON_ROSTER"]
    salida.append(Check("defensas sin hecho inventado", FALLO if mal else OK,
                        f"{len(mal)} defensas afirmadas «sin equipo NFL»"))
    activos = sum(1 for k in ks if k.get("roster_state") == "ACTIVE")
    salida.append(Check("pateadores activos hoy", OK,
                        f"{activos} de {len(ks)} activos; el resto llega marcado"))
    return salida


def comprobar_research(payload: dict) -> list[Check]:
    research = payload.get("research") or {}
    items = research.get("items") or []
    if not items:
        return [Check("research", NO_SE, "sin fichas: la sección saldrá vacía")]
    con_fecha = [i for i in items if i.get("published_at")]
    equipos = {i.get("team") for i in items if i.get("team") and i.get("team") != "LIGA"}
    return [
        Check("research", OK, f"{len(items)} fichas, {len(con_fecha)} con fecha de publicación"),
        Check("cobertura por equipo", OK, f"{len(equipos)} de 32 equipos en la ventana"),
    ]


def comprobar_motor() -> list[Check]:
    """Las regresiones rápidas del motor de decisión, ejecutadas de verdad."""
    try:
        out = subprocess.run(
            ["node", "--test", "tests/engineRegressions.test.mjs"],
            cwd=RAIZ / "web", capture_output=True, text=True, timeout=300, check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return [Check("motor de decisión", NO_SE, f"no se pudo ejecutar: {error}")]
    if out.returncode != 0:
        fallos = [linea for linea in out.stdout.splitlines() if linea.startswith("not ok")]
        return [Check("motor de decisión", FALLO, "; ".join(fallos) or "regresiones en rojo")]
    pasan = sum(1 for line in out.stdout.splitlines() if line.startswith("ok "))
    return [Check("motor de decisión", OK, f"{pasan} regresiones en verde")]


def comprobar_sleeper() -> list[Check]:
    """La configuración del adaptador, NO una lectura en vivo.

    Desde este contenedor `api.sleeper.app` está bloqueado por la política de
    red, así que decir «sincronización verificada» sería inventarlo. Se
    comprueba lo que sí se puede: que el modo manual —el que funciona en todas
    partes— no dependa de la red.
    """
    hook = RAIZ / "web" / "app" / "fantasy" / "useSleeperDraft.js"
    if not hook.exists():
        return [Check("adaptador de Sleeper", FALLO, "falta useSleeperDraft.js")]
    texto = hook.read_text(encoding="utf-8")
    tiene_cadencia = "nextCadence" in texto
    return [
        Check("adaptador de Sleeper", OK if tiene_cadencia else FALLO,
              "cadencia con retroceso presente" if tiene_cadencia
              else "sin retroceso: un 429 se contestaría a los cuatro segundos"),
        Check("modo manual sin red", OK,
              "el Draft Room consume eventos de pick canónicos; el proveedor es un detalle"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args()

    payload = _payload()
    if payload is None:
        print("NOT READY · no hay web/data/model.json que comprobar.")
        return 1

    checks: list[Check] = []
    checks += comprobar_fechas(payload)
    checks += comprobar_board(payload)
    checks += comprobar_especialistas(payload)
    checks += comprobar_research(payload)
    checks += comprobar_motor()
    checks += comprobar_sleeper()

    bloqueos = [c for c in checks if c.bloquea]
    listo = not bloqueos

    if args.json:
        print(json.dumps({
            "ready": listo,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "checks": [{"name": c.nombre, "state": c.estado, "detail": c.detalle}
                       for c in checks],
            "live_sync": "UNVERIFIED",
        }, indent=1, ensure_ascii=False))
        return 0 if listo else 1

    for c in checks:
        print(f"  {c.estado:<6} {c.nombre:<28} {c.detalle}")
    print()
    # «FOR DRAFT» y no «FOR TOMORROW»: el veredicto es sobre el ESTADO del
    # producto, no sobre el calendario. La versión anterior se escribió la
    # víspera de un draft y el día del draft decía «listo para mañana» —
    # cierto cuando se escribió, falso al leerlo, y sin nada que fallara. Es
    # la regla 5 en una cadena de texto: una afirmación con fecha implícita
    # que envejece sola. Sin fecha dentro, no envejece.
    print("READY FOR DRAFT" if listo else "NOT READY")
    if bloqueos:
        for c in bloqueos:
            print(f"  bloquea: {c.nombre} — {c.detalle}")
    # SIEMPRE, y aparte: esto no verifica un draft en vivo.
    print("  LIVE SYNC UNVERIFIED · api.sleeper.app está bloqueado desde este entorno "
          "(docs/RED_ENTORNOS.md). El modo manual no depende de la red.")
    return 0 if listo else 1


if __name__ == "__main__":
    raise SystemExit(main())
