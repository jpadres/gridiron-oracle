#!/usr/bin/env python
"""Baja el ADP público y lo guarda como instantánea fechada. Falla cerrado.

    UN ADP ES CONDUCTA DEL MERCADO, NO CALIDAD DEL JUGADOR.

Se usa para una sola cosa: poder decir «el board lo pone 31 y el mercado 52»,
que es información para decidir si puedes esperar. NO entra en ningún cálculo
—ni como feature, ni como ajuste, ni como multiplicador— por el mismo motivo
que la prensa: la garantía anti-fuga se demuestra recalculando features con el
historial truncado, y un agregado de mock drafts de septiembre no tiene fecha
comprobable dentro de esa pasada.

Desde el contenedor de desarrollo la fuente está bloqueada por la política de
egreso (403 al CONNECT). Corre donde sí hay salida: `.github/workflows/adp.yml`.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy import adp_fetch  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=None)
    parser.add_argument("--scoring", default="ppr", choices=sorted(adp_fetch.FORMATS))
    parser.add_argument("--teams", type=int, default=12)
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    paths = resolve_paths(args.root)

    try:
        snapshot = adp_fetch.fetch(args.scoring, args.teams, args.year)
    except adp_fetch.AdpUnavailable as error:
        # NO se escribe nada. Un fichero vacío con la fecha de hoy es peor que
        # el de ayer: parece actual y no lo es.
        print(f"FALLO: {error}. No se toca el artefacto anterior.", file=sys.stderr)
        return 1

    destino = Path(args.out) if args.out else (
        paths.root / "research" / f"adp_{snapshot.scoring}_{snapshot.league_size}.json"
    )
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(asdict(snapshot), indent=1, ensure_ascii=False),
                       encoding="utf-8")
    print(f"{len(snapshot.entries)} jugadores · {snapshot.source} · "
          f"{snapshot.scoring} · {snapshot.league_size} equipos · "
          f"{snapshot.sample_size} drafts · desde {snapshot.window}")
    print(f"Descargado {snapshot.fetched_at} (que NO es cuándo lo calculó la fuente).")
    print(f"Escrito {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
