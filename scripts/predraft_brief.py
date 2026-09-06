#!/usr/bin/env python
"""Qué ha cambiado entre el board y la plantilla de HOY.

    EL MODELO PIENSA CON DATOS DEL 17 DE AGOSTO.
    LAS PLANTILLAS SON DEL 5 DE SEPTIEMBRE.
    LA DIFERENCIA ENTRE LAS DOS ES LO MÁS ÚTIL QUE SE PUEDE SABER LA VÍSPERA.

Este informe no predice nada y no mueve ni un número del board. Cruza dos cosas
que ya están en disco —el board publicado y el fichero de plantillas de
nflverse— y publica los DESACUERDOS, que es donde está la información:

* quién ya no está en ninguna plantilla (cortado, retirado, sin fichar);
* quién está fichado pero NO en el 53 activo (reserva, prácticas, exentos);
* quién juega en un equipo distinto del que dice el board;
* quién es el pateador de cada equipo hoy.

Todo con la fecha del fichero de origen al lado. Nada de esto es una opinión
sobre si el jugador es bueno: son hechos comprobables que el board, compilado
tres semanas antes, no puede saber.

## Por qué no toca el board

Porque la garantía anti-fuga del proyecto se demuestra recalculando features con
el historial truncado, y un hecho de septiembre no tiene fecha comprobable
dentro de esa pasada. En cuanto moviera un número, esa demostración deja de
valer. Se MARCA — que es exactamente lo que hace falta para decidir un pick.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy import roster_status  # noqa: E402

#: Hasta dónde se listan los casos uno a uno. Más abajo el board ya no decide
#: picks: se publica el CONTEO, que sigue siendo cierto, sin una lista de 500.
DETALLE_HASTA = 200


def _board(payload_path: Path) -> tuple[list[dict], dict]:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    fantasy = payload.get("fantasy") or {}
    return list(fantasy.get("board") or []), payload.get("data_dates") or {}


def _fila(row: dict, extra: dict | None = None) -> dict:
    salida = {
        "player_id": row.get("player_id"),
        "player": row.get("player_full_name") or row.get("player_name"),
        "position": row.get("position"),
        "overall_rank": row.get("overall_rank"),
        "team": row.get("team"),
    }
    if extra:
        salida.update(extra)
    return salida


def kickers_por_equipo(roster_path: Path) -> dict:
    """El pateador de cada equipo, hoy.

    Un pateador que perdió el puesto en agosto sigue en el board con los puntos
    del año pasado, y es un pick de última ronda que se hace sin mirar. Aquí se
    dice quién está ACTIVO hoy en cada equipo; si hay dos, se dicen los dos y se
    marca `COMPETENCIA` — que es la verdad, no un empate que haya que romper.
    """
    frame = pd.read_parquet(
        roster_path,
        columns=["gsis_id", "full_name", "position", "status", "team", "week"],
    )
    frame = frame[frame["week"] == int(frame["week"].max())]
    ks = frame[(frame["position"] == "K") & (frame["status"] == "ACT")]
    por_equipo: dict[str, list[dict]] = defaultdict(list)
    for row in ks.to_dict(orient="records"):
        por_equipo[str(row["team"])].append(
            {"player_id": str(row["gsis_id"]), "player": row.get("full_name")}
        )
    salida = {}
    for team in sorted(por_equipo):
        gente = por_equipo[team]
        salida[team] = {
            "kickers": gente,
            "state": "UNICO" if len(gente) == 1 else "COMPETENCIA",
        }
    return salida


def construir(paths, season: int) -> dict:
    board, fechas = _board(paths.root / "web" / "data" / "model.json")
    roster_path = paths.raw / f"roster_{season}.parquet"
    entries = roster_status.load(roster_path)
    if not entries:
        raise SystemExit(
            f"FALLO: sin {roster_path.name} no hay con qué comparar. El informe "
            "existe para decir qué cambió; publicarlo vacío diría que no cambió nada."
        )
    muestra = next(iter(entries.values()))

    filas = [dict(r) for r in board]
    roster_status.attach(filas, entries)

    grupos: dict[str, list[dict]] = defaultdict(list)
    conteo: Counter = Counter()
    for row in filas:
        estado = row.get("roster_state")
        conteo[estado] += 1
        if estado == roster_status.ACTIVE:
            continue
        rank = row.get("overall_rank")
        if isinstance(rank, (int, float)) and rank <= DETALLE_HASTA:
            grupos[estado].append(
                _fila(row, {"roster_code": row.get("roster_code"),
                            "basis": row.get("roster_basis")})
            )
    for key in grupos:
        grupos[key].sort(key=lambda r: r.get("overall_rank") or 10**6)

    cambios = [
        c for c in roster_status.team_changes(filas, entries)
        if isinstance(c.get("overall_rank"), (int, float))
        and c["overall_rank"] <= DETALLE_HASTA
    ]
    cambios.sort(key=lambda c: c["overall_rank"])

    pool = Counter(r.get("position") for r in board)
    novatos = [r for r in board if r.get("rookie")]

    return {
        # CUÁNDO SE GENERÓ no es CUÁNDO SON LOS DATOS. Las dos, separadas.
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_as_of": fechas.get("fantasy"),
        "roster_as_of": muestra.source_as_of,
        "roster_week": muestra.week,
        "roster_basis": "nflverse weekly rosters",
        "season": season,
        "board_size": len(board),
        "counts": {k: v for k, v in sorted(conteo.items())},
        "detail_through_rank": DETALLE_HASTA,
        "not_on_roster": grupos.get(roster_status.NOT_ON_ROSTER, []),
        "reserve": grupos.get(roster_status.RESERVE, []),
        "practice_squad": grupos.get(roster_status.PRACTICE_SQUAD, []),
        "exempt": grupos.get(roster_status.EXEMPT, []),
        "team_changes": cambios,
        # CUÁNTOS JUGADORES DISTINTOS, no cuántas filas. Los seis cambios de
        # equipo están TAMBIÉN en reserva o en prácticas, así que sumar las
        # cinco listas contaba a algunos dos veces y la pantalla decía 40 donde
        # hay 34. Se cuenta aquí, una vez, y la interfaz lo pinta.
        "changed_players": len({
            r.get("player_id")
            for grupo in (grupos.get(roster_status.NOT_ON_ROSTER, []),
                          grupos.get(roster_status.RESERVE, []),
                          grupos.get(roster_status.PRACTICE_SQUAD, []),
                          grupos.get(roster_status.EXEMPT, []), cambios)
            for r in grupo if r.get("player_id")
        }),
        "kickers": kickers_por_equipo(roster_path),
        "pool": {k: v for k, v in sorted(pool.items()) if k},
        "rookies_on_board": len(novatos),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Informe previo al draft.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()
    paths = resolve_paths(args.root)
    informe = construir(paths, args.season)
    destino = paths.out / "predraft_brief.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(informe, indent=1, ensure_ascii=False), encoding="utf-8")

    print(f"Board {informe['board_size']} · modelo {informe['model_as_of']} · "
          f"plantillas {informe['roster_as_of']} (semana {informe['roster_week']})")
    for estado, filas in (("SIN PLANTILLA", informe["not_on_roster"]),
                          ("RESERVA", informe["reserve"]),
                          ("PRÁCTICAS", informe["practice_squad"]),
                          ("EXENTO", informe["exempt"])):
        print(f"  {estado:<14} {len(filas):>3} en el top {DETALLE_HASTA}")
    print(f"  CAMBIO EQUIPO  {len(informe['team_changes']):>3} en el top {DETALLE_HASTA}")
    competencias = [t for t, v in informe["kickers"].items() if v["state"] == "COMPETENCIA"]
    sin_k = 32 - len(informe["kickers"])
    print(f"  pateadores: {len(informe['kickers'])}/32 equipos, "
          f"{len(competencias)} con más de uno activo, {sin_k} sin ninguno")
    print(f"Escrito {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
