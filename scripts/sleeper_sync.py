#!/usr/bin/env python3
"""Lee tu liga de Sleeper y escribe `research/league.json`.

    python3 scripts/sleeper_sync.py --league 1389751577354461184
    python3 scripts/sleeper_sync.py --user jpadres --season 2026   # lista tus ligas
    python3 scripts/sleeper_sync.py --from-file liga.json          # sin red

Sin esto, el board se construye asumiendo PPR y doce equipos. **La puntuación
cambia el ranking**: en PPR un receptor de volumen vale más que un corredor de
1.100 yardas y en estándar es al revés, así que un board con las reglas
equivocadas no es aproximado — es de otra liga. El tamaño de la liga hace lo
mismo con el nivel de reemplazo del VOR.

La API de Sleeper es pública y de sólo lectura: no hay clave, no hay OAuth y no
hay nada que rotar. Por eso esto no añade ninguna credencial al proyecto.

`--from-file` existe porque hay entornos con proxy donde `api.sleeper.app` está
bloqueado. Guardas la respuesta a mano y el resto funciona igual:

    curl -s https://api.sleeper.app/v1/league/1389751577354461184 > liga.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths
from oracle.leagues import sleeper


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sincroniza la configuración de tu liga")
    parser.add_argument("--root", default=None)
    parser.add_argument("--league", help="ID de la liga (sale de la URL de Sleeper).")
    parser.add_argument("--user", help="Nombre de usuario o user_id, para listar tus ligas.")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--from-file", dest="from_file",
                        help="Respuesta de /v1/league/<id> guardada en disco.")
    parser.add_argument("--loose", action="store_true",
                        help="No falla ante reglas de puntuación desconocidas. Úsalo sabiendo "
                             "que el board saldrá con reglas incompletas.")
    args = parser.parse_args(argv)

    if args.user and not (args.league or args.from_file):
        return _list_leagues(args.user, args.season)

    if args.from_file:
        data = json.loads(Path(args.from_file).read_text(encoding="utf-8"))
    elif args.league:
        data = sleeper.league(args.league)
    else:
        parser.error("Hace falta --league, --user o --from-file.")

    paths = resolve_paths(args.root)
    try:
        rules = sleeper.scoring_from(data, strict=not args.loose)
    except sleeper.UnmappedScoring as error:
        print(f"\n{error}\n")
        print("No se escribe nada. Un board con reglas incompletas es un board de otra liga;")
        print("es preferible no tenerlo a tenerlo mal. Con --loose se genera igualmente.")
        return 2

    settings = sleeper.league_settings_from(data)

    # La sincronización se parte en dos ficheros, y el motivo no es de estilo.
    #
    # `research/` se versiona, y este repositorio es público. Un `league_id` de
    # Sleeper basta para que cualquiera pida `/league/<id>/users` y se lleve los
    # nombres y los apodos de los otros once miembros de tu liga — gente que no
    # ha decidido nada sobre este proyecto. Que la API de Sleeper sea pública no
    # convierte en tuya la decisión de publicar el identificador.
    #
    # Lo que el MODELO necesita para reconstruir el board —puntuación, titulares,
    # número de equipos— no identifica a nadie y sí tiene que estar versionado:
    # el workflow semanal regenera el board en CI, y sin estas reglas caería en
    # PPR por defecto sin decir nada, que es justo el fallo silencioso que este
    # proyecto persigue.
    public = {
        "platform": "sleeper",
        "season": data.get("season"),
        "teams": settings.teams,
        "scoring": {field: getattr(rules, field) for field in rules.__dataclass_fields__},
        "starters": dict(settings.starters),
        "roster_positions": data.get("roster_positions"),
    }
    # Y lo que identifica a personas se queda fuera del control de versiones.
    # Se guarda el user_id y no el nombre de usuario: Sleeper avisa de que el
    # nombre puede cambiar, y una sincronización guardada por nombre empieza a
    # dar 404 el día que lo cambies — pareciendo un problema de red.
    private = {
        "platform": "sleeper",
        "league_id": data.get("league_id"),
        "name": data.get("name"),
        "season": data.get("season"),
    }

    research = paths.root / "research"
    research.mkdir(parents=True, exist_ok=True)
    out = research / "league.json"
    out.write_text(json.dumps(public, ensure_ascii=False, indent=1), encoding="utf-8")
    (research / "league_private.json").write_text(
        json.dumps(private, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    payload = {**public, **private}

    print(f"Liga: {payload['name']} ({payload['teams']} equipos, {payload['season']})")
    print(f"  reglas (se versionan, no identifican a nadie): {out}")
    print(f"  identificadores (NO se versionan):             {research / 'league_private.json'}")
    print(f"Titulares: {', '.join(f'{k} {v:g}' for k, v in settings.starters)}")
    print(f"Recepción: {rules.reception:g} punto(s)  ·  TD de pase: {rules.passing_td:g}")
    print(f"\nEscrito {out.relative_to(paths.root)}")
    print("Ahora `python3 scripts/fantasy_build.py --league` construye el board con estas reglas.")
    return 0


def _list_leagues(user: str, season: int) -> int:
    account = sleeper.user(user)
    print(f"{account.get('display_name')} — user_id {account['user_id']}")
    print("(guarda el user_id, no el nombre: Sleeper avisa de que el nombre puede cambiar)\n")
    found = sleeper.leagues(account["user_id"], season)
    if not found:
        print(f"Sin ligas en {season}.")
        return 0
    for entry in found:
        print(f"  {entry.get('league_id')}  {entry.get('name')}  "
              f"({entry.get('total_rosters')} equipos, {entry.get('status')})")
    print("\nDespués: python3 scripts/sleeper_sync.py --league <league_id>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
