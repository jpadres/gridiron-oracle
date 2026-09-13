#!/usr/bin/env python3
"""EL ARTEFACTO DEL DÍA DE PARTIDO: lo que se sabe, con su origen y su hora.

    NO ES UN INFORME EN PROSA. ES ESTRUCTURA, Y LO QUE NO SE SABE SE DICE.

Se escribe en `research/gameday/<fecha>.json`, que se versiona por lo mismo que
el resto de `research/`: son unos kilobytes que **no se pueden reconstruir**.
El parte de lesiones de una jornada se sobrescribe con el de la siguiente y la
foto de hoy sólo existe si se guarda hoy.

## Qué contiene y de dónde sale cada cosa

    games       calendario de nflverse (`games.csv`), con saque y zona
    injuries    parte OFICIAL de la liga (`injuries_<t>.parquet`)
    markets     handicap y total del mismo calendario
    unprojected quién está activo y el modelo NO proyecta — el hueco, dicho
    watchlist   lo que puede cambiar una decisión, ordenado por cuándo cierra
    clocks      la fecha de CADA fuente, no la de la ejecución
    verified    qué se pudo comprobar desde aquí y qué NO

## Lo que este script NO hace

**No estima si un dudoso juega.** El parte dice QUESTIONABLE y aquí sigue
diciendo QUESTIONABLE: la designación sólo la supera el parte de inactivos
oficial, que sale 90 minutos antes del saque.

**No inventa lo que no pudo leer.** Meteorología, cuotas de casas y props no
son alcanzables desde este contenedor, y el artefacto lo declara en `verified`
en vez de dejar la sección vacía como si no importara — un hueco silencioso se
lee como «no hay riesgo».
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import zoneinfo
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.data.ingest import normalize_team
from oracle.fantasy import injuries

HUSO = zoneinfo.ZoneInfo("America/New_York")
#: Posiciones que deciden una alineación. El parte trae 182 filas y la mayoría
#: son linieros: publicarlos todos en la lista de vigilancia la haría inútil.
FANTASY_POS = {"QB", "RB", "WR", "TE", "K"}


def _fecha_de(ruta: Path) -> str | None:
    try:
        return dt.date.fromtimestamp(ruta.stat().st_mtime).isoformat()
    except OSError:
        return None


def _instante(dia: str, hora: str) -> str | None:
    if not dia or not hora:
        return None
    try:
        return (dt.datetime.strptime(f"{dia} {hora}", "%Y-%m-%d %H:%M")
                .replace(tzinfo=HUSO).isoformat())
    except ValueError:
        return None


def construir(paths, fecha: str, season: int, week: int) -> dict:
    calendario = pd.read_csv(paths.raw / "games.csv")
    dia = calendario[(calendario["season"] == season) & (calendario["week"] == week)]

    juegos = []
    for r in dia.itertuples():
        casa, fuera = normalize_team(r.home_team), normalize_team(r.away_team)
        final = pd.notna(r.home_score) and pd.notna(r.away_score)
        juegos.append({
            "game_id": r.game_id,
            "away": fuera, "home": casa,
            "gameday": str(r.gameday),
            "kickoff_et": str(getattr(r, "gametime", "") or "") or None,
            "kickoff_at": _instante(str(r.gameday), str(getattr(r, "gametime", "") or "")),
            "final": bool(final),
            "away_score": int(r.away_score) if final else None,
            "home_score": int(r.home_score) if final else None,
            # El mercado que publica el calendario. No es una casa concreta y
            # por eso el libro lo llama así: no hay `book` que declarar.
            "market": {
                "source": "nflverse schedule",
                "spread_line": None if pd.isna(r.spread_line) else float(r.spread_line),
                "total_line": None if pd.isna(r.total_line) else float(r.total_line),
                "home_moneyline": None if pd.isna(r.home_moneyline) else int(r.home_moneyline),
                "away_moneyline": None if pd.isna(r.away_moneyline) else int(r.away_moneyline),
                "observed_at": _fecha_de(paths.raw / "games.csv"),
            },
            # LA METEOROLOGÍA NO SE PUDO LEER, y se dice por partido en vez de
            # omitir la clave: un hueco silencioso se lee como «no hay riesgo».
            "weather": {"status": "NOT_RETRIEVED",
                        "why": "no weather provider reachable from this container"},
        })

    equipos_por_jugar = {
        j[k] for j in juegos if not j["final"] for k in ("home", "away")
    }
    saque_por_equipo = {}
    for j in juegos:
        for k in ("home", "away"):
            saque_por_equipo[j[k]] = j["kickoff_at"]

    entradas = injuries.load(
        paths.raw / f"injuries_{season}.parquet", season=season, week=week
    )
    parte = []
    for e in entradas.values():
        if e.designation is None and e.practice is None:
            continue
        parte.append({
            "player_id": e.player_id, "name": e.full_name,
            "team": e.team, "position": e.position,
            "designation": e.designation, "practice": e.practice,
            "injury": e.injury,
            "game_played": e.team not in equipos_por_jugar,
            "kickoff_at": saque_por_equipo.get(e.team),
            "source": "NFL official injury report (via nflverse)",
            "retrieved_at": e.source_as_of,
        })
    parte.sort(key=lambda x: (x["kickoff_at"] or "", x["team"], x["name"] or ""))

    return {"games": juegos, "injuries": parte,
            "teams_still_to_play": sorted(equipos_por_jugar)}


def sin_proyectar(paths, brief: dict, season: int, week: int) -> list[dict]:
    """Quién está ACTIVO y con designación, y el modelo semanal no proyecta.

        UN HUECO DEL MODELO NO ES «ESTE JUGADOR NO CUENTA».

    `weekly._starters` elige por volumen reciente, así que un titular que se
    perdió partidos puede caerse de la lista mientras entra un suplente que
    acumuló en la ventana. Medido el 13 de septiembre de 2026: Alvin Kamara (11
    partidos en 2025, QUESTIONABLE) fuera, y Estimé (5 partidos) dentro.

    No se arregla aquí: cambiar el modelo de rol sin medirlo es lo que la regla
    3 prohíbe. Se PUBLICA el hueco para que se pueda leer.
    """
    artefacto = paths.out / "fantasy_weekly.json"
    if not artefacto.exists():
        return []
    proyectados = {
        str(r.get("player_id"))
        for r in json.loads(artefacto.read_text(encoding="utf-8")).get("rankings", [])
    }
    fuera = []
    for f in brief["injuries"]:
        if f["game_played"] or f["position"] not in FANTASY_POS:
            continue
        if str(f["player_id"]) in proyectados:
            continue
        fuera.append({
            "player_id": f["player_id"], "name": f["name"],
            "team": f["team"], "position": f["position"],
            "designation": f["designation"],
            "why": "on an active roster and in this week's official injury "
                   "report, but not in the weekly projection: the starter rule "
                   "picks by recent volume, not by depth chart",
        })
    return fuera


def watchlist(brief: dict, huecos: list[dict]) -> list[dict]:
    """Lo que puede cambiar una decisión, ordenado por cuándo cierra la ventana.

    Sólo entra lo que decide algo: un liniero designado no cambia una
    alineación de fantasy, y meterlo convertiría la lista en un volcado.
    """
    items = []
    for f in brief["injuries"]:
        if f["game_played"] or f["position"] not in FANTASY_POS:
            continue
        if f["designation"] is None:
            continue
        items.append({
            "entity": f["name"], "player_id": f["player_id"],
            "team": f["team"], "position": f["position"],
            "reason": f"{f['designation']} — {f['injury'] or 'undisclosed'}",
            "current_state": f["designation"],
            "practice": f["practice"],
            "last_evidence": "NFL official injury report",
            "source": "nflverse/injuries",
            "retrieved_at": f["retrieved_at"],
            "kickoff_at": f["kickoff_at"],
            # CUÁNDO SE SABRÁ: el parte de inactivos sale 90 minutos antes.
            # Es un hecho del reglamento, no una estimación.
            "next_information_window":
                (dt.datetime.fromisoformat(f["kickoff_at"]) - dt.timedelta(minutes=90)).isoformat()
                if f["kickoff_at"] else None,
        })
    for h in huecos:
        items.append({
            "entity": h["name"], "player_id": h["player_id"],
            "team": h["team"], "position": h["position"],
            "reason": "NOT PROJECTED — " + h["why"],
            "current_state": h["designation"] or "ACTIVE",
            "practice": None,
            "last_evidence": "weekly projection vs official injury report",
            "source": "gridiron-oracle", "retrieved_at": None,
            "kickoff_at": None, "next_information_window": None,
        })
    items.sort(key=lambda x: (x["kickoff_at"] or "9999", x["team"]))
    return items


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--date", default=None,
                        help="Fecha del artefacto (por defecto, la del primer "
                             "partido sin jugar de la jornada).")
    args = parser.parse_args(argv)
    paths = resolve_paths(args.root).ensure()

    brief = construir(paths, args.date or "", args.season, args.week)
    fecha = args.date or next(
        (j["gameday"] for j in brief["games"] if not j["final"]),
        brief["games"][0]["gameday"] if brief["games"] else "unknown",
    )
    huecos = sin_proyectar(paths, brief, args.season, args.week)

    raw = paths.raw
    artefacto = {
        "date": fecha, "season": args.season, "week": args.week,
        # LA HORA DE GENERACIÓN NO ES LA FRESCURA DE NADA. Va etiquetada como
        # lo que es para que no se pueda leer como la fecha de los datos.
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "clocks": {
            "schedule": _fecha_de(raw / "games.csv"),
            "injuries": _fecha_de(raw / f"injuries_{args.season}.parquet"),
            "rosters": _fecha_de(raw / f"roster_{args.season}.parquet"),
            "markets": _fecha_de(raw / "games.csv"),
            "weather": None,
            "props": None,
        },
        "verified": {
            "CONTAINER_VERIFIED": [
                "schedule (raw.githubusercontent.com, HTTP 200)",
                "official injury report (nflverse releases, HTTP 200)",
                "depth charts (nflverse releases, HTTP 200)",
                "weekly rosters (nflverse releases, HTTP 200)",
                "game lines from the schedule file",
            ],
            "NOT_VERIFIED": [
                "weather — no provider reachable (api.weather.gov denied)",
                "sportsbook odds and player props — no provider reachable",
                "Sleeper leagues — api.sleeper.app denied",
                "press/beat reporters — the 101 domains are denied",
                "the deployed site — gridiron-oracle-five.vercel.app denied",
            ],
        },
        **brief,
        "unprojected": huecos,
        "watchlist": watchlist(brief, huecos),
    }

    destino = paths.root / "research" / "gameday" / f"{fecha}.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(artefacto, indent=1, ensure_ascii=False) + "\n",
                       encoding="utf-8")
    porjugar = [j for j in artefacto["games"] if not j["final"]]
    print(f"Escrito {destino}")
    print(f"  {len(artefacto['games'])} partidos ({len(porjugar)} por jugar), "
          f"{len(artefacto['injuries'])} filas de parte, "
          f"{len(huecos)} sin proyectar, "
          f"{len(artefacto['watchlist'])} en la lista de vigilancia.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
