#!/usr/bin/env python3
"""Lee el draft de tu liga de Sleeper y marca a los ya elegidos.

Escribe `research/draft_state.json`, que el modo draft de la web consume para
tachar solo a quien ya se llevaron. Sin esto hay que ir marcando 250 nombres a
mano en un móvil mientras corre el reloj del pick.

## Sobre el catálogo de jugadores

El emparejamiento Sleeper -> nflverse va por `gsis_id`, que es literalmente el
mismo identificador en las dos fuentes. Nada de emparejar por nombre: el formato
abreviado ya produjo aquí el problema de los dos «B.Robinson» de Atlanta.

El catálogo pesa ~5 MB y Sleeper pide no descargarlo más de una vez al día, así
que se cachea en `data/sleeper_players.json` y sólo se refresca con `--refresh`
o si no existe. En un draft en vivo esto importa: el catálogo se baja una vez
antes de empezar y las llamadas de dentro del draft son sólo los picks, que son
unos kilobytes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths
from oracle.leagues import sleeper

# Cada cuánto se considera viejo el catálogo. Un día, que es lo que pide
# Sleeper.
CATALOG_MAX_AGE = 24 * 3600


def _catalog(path: Path, refresh: bool) -> dict:
    fresh = path.exists() and (time.time() - path.stat().st_mtime) < CATALOG_MAX_AGE
    if fresh and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    print("Descargando el catálogo de jugadores de Sleeper (~5 MB)...")
    catalog = sleeper.players()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(catalog), encoding="utf-8")
    return catalog


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sincroniza el draft de Sleeper.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--league", help="ID de la liga (sale de la URL de Sleeper).")
    parser.add_argument("--draft", help="ID del draft, si la liga tiene varios.")
    parser.add_argument("--refresh", action="store_true",
                        help="Fuerza la descarga del catálogo de jugadores.")
    parser.add_argument("--picks-file", dest="picks_file",
                        help="Lee los picks de un JSON en vez de la API (para pruebas).")
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root)
    league_id = args.league or _league_from_config(paths.root)
    if not league_id and not args.picks_file:
        parser.error("Hace falta --league, o haber corrido antes sleeper_sync.py.")

    if args.picks_file:
        picks = json.loads(Path(args.picks_file).read_text(encoding="utf-8"))
        draft_id = "local"
    else:
        draft_id = args.draft
        if not draft_id:
            found = sleeper.drafts(league_id)
            if not found:
                print("La liga no tiene ningún draft todavía.")
                return 1
            # El más reciente por temporada. En dynasty hay uno por año y el que
            # interesa es siempre el del año en curso.
            found.sort(key=lambda entry: str(entry.get("season") or ""), reverse=True)
            draft_id = found[0]["draft_id"]
            print(f"Draft {draft_id} ({found[0].get('season')}, "
                  f"{found[0].get('status')}).")
        picks = sleeper.draft_picks(draft_id)

    catalog = _catalog(paths.processed.parent / "sleeper_players.json", args.refresh)
    index = sleeper.gsis_index(catalog)
    result = sleeper.picked_players(picks, index)

    payload = {
        "platform": "sleeper",
        "league_id": league_id,
        "draft_id": draft_id,
        "picked": result["matched"],
        "unmatched": result["unmatched"],
    }
    out = paths.root / "research" / "draft_state.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{len(result['matched'])} picks emparejados con el board.")
    if result["unmatched"]:
        # Se enseñan siempre y por nombre. Un pick sin traducir hace que el modo
        # draft crea libre a quien ya no lo está, que es el fallo más caro de
        # esa pantalla: te recomienda a alguien que ya no puedes elegir.
        print(f"{len(result['unmatched'])} SIN emparejar — el modo draft los "
              f"seguirá dando por libres:")
        for entry in result["unmatched"][:20]:
            print(f"  #{entry.get('pick')}  {entry.get('name')} "
                  f"({entry.get('position')}, {entry.get('team')})")
        print("  Casi siempre son rookies: sin partido NFL no tienen gsis_id,")
        print("  y el board tampoco los proyecta.")
    print(f"\nEscrito {out.relative_to(paths.root)}")
    return 0


def _league_from_config(root: Path) -> str | None:
    path = root / "research" / "league.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8")).get("league_id")


if __name__ == "__main__":
    raise SystemExit(main())
