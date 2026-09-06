#!/usr/bin/env python
"""Barrido DETERMINISTA de feeds. Sin clave de modelo, y falla cerrado.

    SIN `ANTHROPIC_API_KEY` EL BARRIDO ENTERO NO CORRÍA.
    BAJAR UN RSS NO NECESITA UN MODELO.

`research_build.py` necesita la clave porque su trabajo es juzgar. Éste sólo
baja, parsea y fecha: son dos etapas y ahora fallan por separado. La consecuencia
práctica es que hay prensa la víspera de un draft aunque el secret siga sin
restaurar.

## Dónde corre

**En un entorno con salida a los medios.** Desde el contenedor de desarrollo de
este proyecto la política de red deniega el CONNECT a los 101 dominios de
prensa (`docs/RED_ENTORNOS.md`), así que aquí sólo se puede probar con dobles.
En GitHub Actions sí hay salida: `.github/workflows/research-feeds.yml`.

Eso NO se da por supuesto: si el barrido corre y no responde ninguna fuente,
este script termina en ROJO y **no toca** el artefacto anterior.

## Qué escribe

`research/feeds_latest.json`: entradas con su fecha de publicación, la salud de
cada fuente y el resumen. Se versiona por lo mismo que el resto de `research/`:
son unos kilobytes que no se pueden reconstruir si mañana el medio reescribe la
nota.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.narrative import feed_fetch, sources  # noqa: E402
from oracle.narrative.feeds import Feed  # noqa: E402


def candidatos_del_registro(root: Path) -> list[Feed]:
    """Los feeds candidatos que el registro de fuentes ya tenía curados.

    `source_registry_build.py` guardó un `feed_candidate` por cada organización
    `ON_DEMAND` — anotados a mano y **nunca verificados**, porque desde el
    entorno de desarrollo no se puede. Aquí se les da la oportunidad de
    demostrarlo: el que conteste pasa a tener lectura real, y el que no, sale en
    la salud con su error. Es la única forma honesta de que un `feed_candidate`
    deje de ser una suposición.
    """
    registro = root / "research" / "sources.json"
    if not registro.exists():
        return []
    datos = json.loads(registro.read_text(encoding="utf-8"))
    salida: list[Feed] = []
    for org in datos.get("organizations", []):
        ing = org.get("ingestibility") or {}
        url = ing.get("feed_candidate")
        if not url or ing.get("state") != "ON_DEMAND":
            continue
        salida.append(Feed(url, org.get("domain") or url, source_type="RSS"))
    return salida


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=None)
    parser.add_argument("--include-candidates", action="store_true",
                        help="Añade los feed_candidate del registro, sin verificar.")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    paths = resolve_paths(args.root)

    feeds_a_leer = list(sources.ALL_FEEDS)
    if args.include_candidates:
        vistos = {f.url for f in feeds_a_leer}
        feeds_a_leer += [f for f in candidatos_del_registro(paths.root) if f.url not in vistos]

    print(f"Leyendo {len(feeds_a_leer)} feeds...")
    recogido = feed_fetch.harvest(feeds_a_leer)
    resumen = recogido.summary()

    for salud in recogido.health:
        if salud.status != feed_fetch.OK:
            print(f"  {salud.status:<6} {salud.outlet:<28} {salud.error or ''}")
    print(
        f"Fuentes: {resumen['sources_ok']} OK, {resumen['sources_empty']} vacías, "
        f"{resumen['sources_error']} con error de {resumen['sources_total']}."
    )
    print(
        f"Entradas: {resumen['entries']} ({resumen['entries_dated']} con fecha de "
        f"publicación, {resumen['entries_undated']} SIN fecha)."
    )
    print(f"Más reciente publicada: {resumen['newest_published_at'] or 'NINGUNA'}")
    print(f"Equipos con alguna entrada: {len(resumen['teams_covered'])}")

    destino = Path(args.out) if args.out else paths.root / "research" / "feeds_latest.json"
    if not feed_fetch.publishable(recogido):
        # NO se pisa lo anterior. Un artefacto vacío con fecha de hoy es peor
        # que uno viejo: parece actual y no lo es.
        print(
            "FALLO: ninguna fuente respondió con entradas. NO se escribe nada — "
            f"se conserva {destino.name} si existía. Un artefacto vacío con la "
            "fecha de hoy es la rotura que parece que funcionó.",
            file=sys.stderr,
        )
        return 1

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(
        json.dumps(recogido.to_dict(), indent=1, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Escrito {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
