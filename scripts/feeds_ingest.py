#!/usr/bin/env python3
"""Ingesta de feeds RSS/Atom. Es lo primero del barrido diario, antes del modelo.

Baja los feeds de `narrative/sources.py`, normaliza instantes a UTC canónico,
funde duplicados por URL y escribe `out/feed_entries.json`. **No clasifica ni
resume**: eso lo hace el paso del modelo, y sobre estas entradas en vez de sobre
una búsqueda a ciegas.

    python3 scripts/feeds_ingest.py            # baja los feeds configurados
    python3 scripts/feeds_ingest.py --from-dir fixtures/   # sin red, para probar

El `--from-dir` no es sólo para tests: el proxy de algunos entornos bloquea los
dominios de los medios, y sin esa vía no habría forma de trabajar en la ingesta.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths
from oracle.narrative import feeds
from oracle.narrative.sources import ALL_FEEDS
from oracle.narrative.timestamps import now

TIMEOUT = 20
# Los feeds piden un agente que identifique a quien llama. `api.weather.gov` lo
# exige explícitamente y varios medios devuelven 403 sin él.
USER_AGENT = "gridiron-oracle/1.0 (proyecto personal de análisis NFL)"


def _fetch(url: str) -> str | None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
            return response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        # Un feed caído no puede tumbar la ingesta de los otros. Se cuenta y se
        # sigue: el recuento de fallos es lo que después dirá si una fuente vale
        # la pena mantener.
        print(f"  fallo en {url}: {error}")
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingesta de feeds RSS/Atom.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--from-dir", dest="from_dir",
                        help="Lee los feeds de ficheros en vez de la red.")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    stamp = now()

    entries: list[feeds.Entry] = []
    failures = 0
    for feed in ALL_FEEDS:
        if args.from_dir:
            name = feed.url.replace("://", "_").replace("/", "_")
            local = Path(args.from_dir) / f"{name}.xml"
            xml = local.read_text(encoding="utf-8") if local.exists() else None
        else:
            xml = _fetch(feed.url)
        if xml is None:
            failures += 1
            continue
        parsed = feeds.parse(xml, feed, ingested_at=stamp)
        entries.extend(parsed)
        print(f"  {feed.outlet}: {len(parsed)} entradas")

    merged = feeds.merge_duplicates(entries)
    signed = sum(1 for entry in merged if entry.author)
    dated = sum(1 for entry in merged if entry.published_at)

    destination = paths.out / "feed_entries.json"
    destination.write_text(
        json.dumps(
            {"ingested_at": stamp, "entries": [asdict(entry) for entry in merged]},
            ensure_ascii=False, indent=1,
        ),
        encoding="utf-8",
    )

    print(f"\n{len(entries)} entradas -> {len(merged)} tras fundir duplicados.")
    print(f"  con firma: {signed}   con hora fiable: {dated}   feeds caídos: {failures}")
    if merged and not dated:
        # Merece aviso: sin `published_at` no hay latencia que medir, y la causa
        # suele ser que los feeds traen la fecha sin huso.
        print("  (aviso) ningún feed trajo hora con huso: no habrá latencia medible.")
    print(f"\nEscrito {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
