"""LA JORNADA QUE DICE SLEEPER, FECHADA Y CON SU ALCANZABILIDAD.

    NO SUSTITUYE AL CALENDARIO: LO CONTRASTA.

La jornada del producto sale de `schedule.py::current_point` (el primer partido
sin jugar) y ésa es la autoridad única desde que tres reglas contestaban la
misma pregunta y una estaba mal. Este script añade un segundo testigo
INDEPENDIENTE para cazar el caso que de verdad duele: el sitio publicando la
jornada 4 mientras el mundo va por la 5.

Escribe `research/sleeper_state.json` —versionado, como el resto de lo que no se
puede reconstruir— con `season`, `week`, `retrieved_at` y un `status`:

    OK            se leyó; viaja con su instante.
    UNREACHABLE   no se pudo leer, y se dice POR QUÉ.

Lo que NO hace: inventar una jornada, ni conservar la anterior como si fuera de
hoy. Si no se pudo leer, el artefacto lo dice y `/salud` lo pinta como tal —
«no pude comprobar» no es «coinciden».

Medido el 7 de octubre de 2026: desde el contenedor de desarrollo
`api.sleeper.app` da CONNECT 403 (el proxy deniega), así que aquí sale
UNREACHABLE y es correcto. Donde hay salida general —GitHub Actions— sale OK.
Y no se escribe en ningún sitio que sea alcanzable desde CI hasta que una
ejecución en CI lo demuestre: afirmar cobertura que no se ha ejecutado ya fue
un error de este repositorio.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

URL = "https://api.sleeper.app/v1/state/nfl"
TIMEOUT = 15


def leer(url: str = URL, *, timeout: int = TIMEOUT) -> dict:
    ahora = datetime.now(UTC).isoformat(timespec="seconds")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310
            datos = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {"status": "UNREACHABLE", "retrieved_at": ahora, "url": url,
                "note": f"{type(exc).__name__}: {str(exc)[:160]}"}
    # `week` de Sleeper es la jornada en curso; `display_week` la que enseña su
    # interfaz. Se guardan las dos: no son lo mismo fuera de temporada y
    # quedarse con una sola borra el desacuerdo.
    return {
        "status": "OK",
        "retrieved_at": ahora,
        "url": url,
        "season": datos.get("season"),
        "season_type": datos.get("season_type"),
        "week": datos.get("week"),
        "display_week": datos.get("display_week"),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="research/sleeper_state.json")
    ap.add_argument("--require-ok", action="store_true",
                    help="salir en ROJO si no se pudo leer (para el entorno que SÍ tiene salida)")
    args = ap.parse_args(argv)

    estado = leer()
    destino = Path(args.out)
    destino.parent.mkdir(parents=True, exist_ok=True)
    # Se escribe SIEMPRE, también el UNREACHABLE: un artefacto que sólo existe
    # cuando salió bien deja a `/salud` sin poder distinguir «no se intentó» de
    # «no se pudo», y son cosas distintas.
    destino.write_text(json.dumps(estado, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if estado["status"] == "OK":
        print(f"Sleeper: temporada {estado['season']} jornada {estado['week']} "
              f"({estado['season_type']}) · leído {estado['retrieved_at']}")
        return 0
    print(f"Sleeper INALCANZABLE: {estado['note']}", file=sys.stderr)
    return 1 if args.require_ok else 0


if __name__ == "__main__":
    raise SystemExit(main())
