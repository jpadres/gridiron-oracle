#!/usr/bin/env python3
"""Barrido diario de prensa. Escribe `research/YYYY-MM-DD.json` y `out/research.json`.

    research/2026-08-17.json   archivo del día, SE VERSIONA (unos KB de texto)
    out/research.json          ventana de los últimos días, la lee export_web_data.py

Lo que hace, en orden: lee los titulares que ya se publicaron los días
anteriores, barre once beats (ocho divisiones y tres temas transversales)
buscando en internet, quita repetidos, cuelga cada ficha de los jugadores del
ranking semanal que le correspondan, y guarda.

**Esto no toca el modelo.** Ninguna de estas noticias entra en un cálculo; se
publican al lado de los rankings, con su fuente y su fecha, para que el ajuste lo
haga el ojo humano. La garantía anti-fuga del modelo depende de que siga siendo
así.

Sin `ANTHROPIC_API_KEY` no falla: avisa y sale con 0, y la web se construye sin la
sección igual que se construye sin los artefactos de fantasy.

    export ANTHROPIC_API_KEY=...            # en CI, un secret del repo
    python scripts/research_build.py
    python scripts/research_build.py --beats insiders,campamentos --max-searches 4
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths
from oracle.narrative import archive, research
from oracle.narrative.client import NarrativeUnavailable, available, resolve_model

# Días de titulares que se le enseñan al modelo para que no repita. Cinco es
# suficiente: una noticia de hace una semana ya no se recicla sola.
MEMORY_DAYS = 5

# Días que viajan a la web. Diez cubre la semana entera más el arrastre, y a
# partir de ahí la página se vuelve un archivo que nadie baja.
WINDOW_DAYS = 10

# Tope de fichas en el payload. El resto sigue en `research/`, que es el archivo.
WEB_ITEMS = 60


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Barrido diario de prensa e insiders")
    parser.add_argument("--root", default=None)
    parser.add_argument("--date", default=None, help="Fecha del barrido (YYYY-MM-DD).")
    parser.add_argument("--beats", default=None, help="Lista separada por comas. Vacío = todos.")
    parser.add_argument("--max-items", type=int, default=8, help="Fichas por beat.")
    parser.add_argument("--max-searches", type=int, default=8, help="Búsquedas por beat.")
    parser.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh"])
    parser.add_argument("--model", default=None, help="Sobrescribe ORACLE_NARRATIVE_MODEL.")
    parser.add_argument("--window", type=int, default=WINDOW_DAYS, help="Días que van a la web.")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    today = date.fromisoformat(args.date) if args.date else date.today()

    if not available():
        print(
            "Sin ANTHROPIC_API_KEY (o sin el SDK): no se genera research.\n"
            "  pip install -e '.[narrative]' y exporta la clave. En CI es un secret del repo.\n"
            "  La web se construye igual, sin esta sección."
        )
        # Se refresca de todos modos por si hay archivo de días anteriores: la
        # sección debe seguir viva aunque hoy no se pueda barrer.
        _publish(paths.root, paths.out, today, args.window)
        return 0

    selection = [name.strip() for name in args.beats.split(",")] if args.beats else None
    todo = research.beats(selection)
    if not todo:
        print(f"Ningún beat coincide con {args.beats!r}. Disponibles: {', '.join(research.beats())}")
        return 2

    memory = archive.known_headlines(paths.root, MEMORY_DAYS, today)
    reporters = _reporters(paths.root)
    print(f"Barrido de {today} con {resolve_model(args.model)} — {len(todo)} beats, "
          f"{len(memory)} titulares en memoria.")

    collected: list[dict] = []
    failed: list[str] = []
    for name, focus in todo.items():
        print(f"  {name}...", flush=True)
        try:
            items = research.sweep(
                name,
                focus,
                today=today.isoformat(),
                known_headlines=memory,
                reporters=reporters,
                max_items=args.max_items,
                max_searches=args.max_searches,
                effort=args.effort,
                model=args.model,
            )
        except NarrativeUnavailable as error:
            # Que un beat se caiga no puede tirar el barrido entero: los otros
            # diez ya cuestan dinero y son publicables.
            print(f"    falla: {error}")
            failed.append(name)
            continue
        print(f"    {len(items)} fichas")
        collected.extend(items)
        memory.extend(item["headline"] for item in items)

    items = research.dedupe(collected)
    print(f"{len(collected)} fichas, {len(items)} tras quitar repetidos.")

    path = archive.save_day(
        paths.root,
        today,
        items,
        meta={
            "model": resolve_model(args.model),
            "beats": list(todo),
            "failed_beats": failed,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    print(f"Escrito {path.relative_to(paths.root)}")

    _publish(paths.root, paths.out, today, args.window)
    return 0


def _reporters(root: Path) -> list[dict]:
    """El directorio del beat, si está. Orienta la búsqueda a quien está allí."""
    path = root / "research" / "dossier.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("reporters", [])


def _publish(root: Path, out: Path, today: date, window: int) -> None:
    """Consolida la ventana y cuelga cada ficha de los jugadores del ranking."""
    weekly = out / "fantasy_weekly.json"
    players = []
    if weekly.exists():
        players = json.loads(weekly.read_text(encoding="utf-8")).get("rankings", [])

    payload = archive.consolidate(
        root, days=window, today=today, players=players, limit=WEB_ITEMS
    )
    if payload is None:
        print("No hay archivo de research todavía; no se escribe out/research.json.")
        return

    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    (out / "research.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    linked = sum(1 for item in payload["items"] if item["player_ids"])
    print(
        f"Escrito out/research.json — {len(payload['items'])} de {payload['total']} fichas, "
        f"{linked} enlazadas a un jugador del ranking."
    )


if __name__ == "__main__":
    raise SystemExit(main())
