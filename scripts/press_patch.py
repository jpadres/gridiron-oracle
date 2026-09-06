#!/usr/bin/env python3
"""Cuelga del payload las menciones de prensa YA LEÍDAS, sin modelo y sin red.

    LO QUE ESTE SCRIPT AÑADE SE PUEDE COMPROBAR ABRIENDO EL ENLACE.

`research/feeds_latest.json` lo escribe `feed_harvest.py` donde hay salida a los
medios (GitHub Actions). Aquí sólo se cruza con el board por identidad
conservadora (`narrative/press.py`) y se mete en `research.press`. No toca un
solo número: el board es el mismo con menciones y sin ellas.

    python scripts/press_patch.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))
sys.path.insert(0, str(RAIZ / "scripts"))

from export_web_data import write_payload  # noqa: E402

from oracle.narrative import press  # noqa: E402

FEEDS = RAIZ / "research" / "feeds_latest.json"
# Cuántas menciones se publican por jugador. En el reloj de un pick no se leen
# ocho titulares: se lee el último y cuántos hay.
POR_JUGADOR = 3


def main() -> int:
    destino = RAIZ / "web" / "data"
    crudo = destino / "model.json"
    if not crudo.exists():
        sys.exit(f"No encuentro {crudo}: hay que exportar el payload primero.")
    if not FEEDS.exists():
        # Sin barrido no se publica nada: NO se escribe una sección vacía con
        # la fecha de hoy, que es la rotura que parece que funcionó.
        print(f"No hay {FEEDS}: no toco el payload.")
        return 1

    payload = json.loads(crudo.read_text(encoding="utf-8"))
    feeds = json.loads(FEEDS.read_text(encoding="utf-8"))
    entradas = feeds.get("entries") or []
    if not entradas:
        print("El barrido no trae entradas: no toco el payload.")
        return 1

    fantasy = payload.get("fantasy") or {}
    especialistas = fantasy.get("specialists") or {}
    filas = [
        *(fantasy.get("board") or []),
        *(especialistas.get("kickers") or []),
        *(especialistas.get("defenses") or []),
    ]
    enlazadas = press.mentions(entradas, filas)
    resumen = press.resumen(entradas, enlazadas)
    salud = feeds.get("health") or []
    resumen["sources_ok"] = sum(1 for s in salud if s.get("status") == "OK")
    resumen["sources_total"] = len(salud)

    research = payload.get("research") or {}
    research["press"] = {
        **resumen,
        "by_player": {pid: m[:POR_JUGADOR] for pid, m in enlazadas.items()},
    }
    payload["research"] = research
    write_payload(destino, payload)
    print(f"research.press: {resumen['players']} jugadores, "
          f"{resumen['mentions']} menciones, as_of={resumen['as_of']}, "
          f"{resumen['sources_ok']}/{resumen['sources_total']} fuentes OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
