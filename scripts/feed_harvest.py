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


def resumen_markdown(artefacto: Path) -> str:
    """La salud del último barrido, en Markdown, LEÍDA DEL ARTEFACTO.

    No vuelve a bajar nada a propósito: el resumen tiene que describir lo que se
    PUBLICÓ, no una segunda lectura que puede dar otra cosa. Si el artefacto no
    está, eso es lo que se dice — y es información, porque significa que el
    barrido no llegó a publicar.
    """
    if not artefacto.exists():
        return (
            "## Feeds\n\n**No hay artefacto publicado.** El barrido no escribió "
            f"`{artefacto.name}`: o ninguna fuente respondió (el paso anterior "
            "está en rojo) o el paso de publicación no llegó a correr.\n"
        )
    datos = json.loads(artefacto.read_text(encoding="utf-8"))
    resumen = datos.get("summary") or {}
    salud = datos.get("health") or []
    lineas = [
        "## Feeds",
        "",
        f"- Generado: `{resumen.get('generated_at')}`",
        f"- Fuentes: **{resumen.get('sources_ok')} OK**, "
        f"{resumen.get('sources_empty')} vacías, {resumen.get('sources_error')} con error "
        f"de {resumen.get('sources_total')}",
        f"- Entradas: **{resumen.get('entries')}** "
        f"({resumen.get('entries_dated')} con fecha de publicación, "
        f"{resumen.get('entries_undated')} sin ella)",
        # LAS DOS FECHAS, SEPARADAS. «Generado» es cuándo corrió esto; «más
        # reciente publicada» es de cuándo son las noticias. Confundirlas es el
        # fallo que este proyecto persigue en todas partes.
        f"- Más reciente publicada: `{resumen.get('newest_published_at') or 'NINGUNA'}`",
        f"- Equipos con alguna entrada: {len(resumen.get('teams_covered') or [])}",
        "",
    ]
    caidas = [h for h in salud if h.get("status") != feed_fetch.OK]
    if caidas:
        lineas += [
            f"### {len(caidas)} fuentes sin entradas",
            "",
            "| fuente | estado | detalle |",
            "| --- | --- | --- |",
        ]
        for h in sorted(caidas, key=lambda x: (x.get("status") or "", x.get("outlet") or "")):
            lineas.append(f"| {h.get('outlet')} | {h.get('status')} | {h.get('error') or ''} |")
        lineas.append("")
    return "\n".join(lineas)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=None)
    parser.add_argument("--include-candidates", action="store_true",
                        help="Añade los feed_candidate del registro, sin verificar.")
    parser.add_argument("--out", default=None)
    parser.add_argument("--summary-only", action="store_true",
                        help="No baja nada: escribe en Markdown la salud del ÚLTIMO "
                             "artefacto publicado. Para el resumen del job.")
    args = parser.parse_args()
    paths = resolve_paths(args.root)
    destino_por_defecto = paths.root / "research" / "feeds_latest.json"
    if args.summary_only:
        print(resumen_markdown(Path(args.out) if args.out else destino_por_defecto))
        return 0

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

    destino = Path(args.out) if args.out else destino_por_defecto
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
