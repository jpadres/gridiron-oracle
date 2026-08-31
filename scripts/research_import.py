#!/usr/bin/env python3
"""Mete en el archivo un barrido hecho A MANO, por las mismas puertas.

Existe porque el barrido automático puede estar caído —sin `ANTHROPIC_API_KEY`
no hay nada que barrer— y una tarde de draft no espera. Lo que NO hace es
abrir una puerta trasera: cada ficha pasa por `research._clean` y por
`research.dedupe` igual que las que escribe el modelo, así que una sin fuente
utilizable se cae aquí, un equipo «LA» se normaliza a LAR, y un `confidence`
inventado se degrada a rumor.

    python scripts/research_import.py fichas.json --date 2026-08-31
    python scripts/research_import.py fichas.json --dry-run

El fichero de entrada es una lista de fichas, o un objeto con `items`.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from research_build import _publish  # noqa: E402

from oracle.config import paths as resolve_paths
from oracle.narrative import research


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importa un barrido manual de research")
    parser.add_argument("archivo", help="JSON con las fichas.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--date", default=None, help="Fecha del barrido (YYYY-MM-DD).")
    parser.add_argument("--window", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true", help="No escribe nada.")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    today = date.fromisoformat(args.date) if args.date else date.today()
    raw = json.loads(Path(args.archivo).read_text(encoding="utf-8"))
    entrada = raw.get("items", []) if isinstance(raw, dict) else raw

    seen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    limpias = []
    for item in entrada:
        # El beat viaja en la propia ficha; si no, cae en «Liga».
        cleaned = research._clean(item, str(item.get("beat") or "Liga"))
        if cleaned is None:
            print(f"  descartada (sin fuente o sin texto): {str(item.get('headline'))[:70]}")
            continue
        # `first_seen_at` lo rellena la INGESTA, nunca la fuente: es cuándo lo
        # vimos nosotros, y confundirlo con la publicación es exactamente cómo
        # se fabrica una noticia falsamente actual (regla 5).
        cleaned["first_seen_at"] = seen
        limpias.append(cleaned)

    finales = research.dedupe(limpias)
    sin_fecha = [i for i in finales if not i.get("published")]
    print(
        f"{len(entrada)} de entrada -> {len(limpias)} limpias -> {len(finales)} tras deduplicar"
        + (f"  ({len(sin_fecha)} SIN FECHA de publicación)" if sin_fecha else "")
    )
    for item in sin_fecha:
        # Sin fecha no se puede afirmar que sea de hoy. Se avisa fuerte.
        print(f"  AVISO sin `published`: {item['headline'][:70]}", file=sys.stderr)

    if args.dry_run:
        print("(--dry-run: no se escribe nada)")
        return 0
    if not finales:
        print("Nada que archivar.", file=sys.stderr)
        return 1

    destino = paths.root / "research" / f"{today.isoformat()}.json"
    destino.write_text(
        json.dumps(
            {"date": today.isoformat(), "items": finales, "model": "manual", "beats": []},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"Escrito {destino} — {len(finales)} fichas.")
    return 0 if _publish(paths.root, paths.out, today, args.window) else 1


if __name__ == "__main__":
    raise SystemExit(main())
