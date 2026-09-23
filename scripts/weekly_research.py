"""EL BARRIDO DE LA JORNADA: qué se sabe hoy, con la fecha de cada cosa.

    LO QUE NO SE PUDO LEER SE DICE. LO QUE NO SE HA PUBLICADO TODAVÍA SE DICE.
    NINGUNA DE LAS DOS SE RELLENA CON LA SEMANA PASADA.

Corre a diario durante la jornada y escribe un artefacto FECHADO en
`research/weekly/<temporada>-W<jornada>/<fecha>.json`, sin pisar el del día
anterior. Ese archivo es lo que permite auditar después qué cambió, cuándo y por
qué — y la comparación con el día anterior sale de él, no de la memoria.

## Las cuatro cosas que este barrido NO hace

1. **No reentrena nada.** Datos a diario, modelos según su ciclo de validación.
   Un artículo publicado no mueve un ranking; sólo lo mueve un INPUT del modelo.
2. **No convierte una designación en probabilidad de jugar.** `DNP`, `LIMITED`,
   `FULL` y `QUESTIONABLE` se publican tal cual. Traducirlos a un 65% sería
   inventar la medición que nadie hizo.
3. **No arrastra la jornada anterior.** Si el parte de la jornada en curso no
   está publicado —los clubes lo entregan a partir del miércoles—, se dice
   `NOT_PUBLISHED_YET` con la última jornada que sí tiene. Un `QUESTIONABLE` de
   la jornada 1 leído en la 2 es la regla 5 exacta.
4. **No afirma cobertura que no tuvo.** El registro de fuentes lleva lo intentado,
   lo leído y lo que falló con su motivo. «No pude leer» no es «no hay noticias».
"""
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from oracle.config import Paths
from oracle.data.ingest import normalize_team
from oracle.fantasy import dst
from oracle.fantasy.jobs import DepthChartUnavailable, jobs_of_record
from oracle.fantasy.schedule import current_point

# Los dominios de prensa no se intentan desde aquí: están medidos y bloqueados
# (docs/RED_ENTORNOS.md, CONNECT 403 a los 101). Se declara el hecho del ENTORNO
# en vez de fingir un intento — y el barrido de feeds corre donde sí hay red.
PRENSA_ESTADO = "BLOCKED_FROM_DEV_ENV"


def _ahora() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _mtime(p: Path) -> str | None:
    if not p.exists():
        return None
    return datetime.fromtimestamp(p.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _leer(paths: Paths, nombre: str, registro: list[dict]) -> pd.DataFrame | None:
    """Lee un parquet de `data/raw` y anota el intento en el registro de fuentes.

    `retrieved_at` es el mtime del fichero: es cuándo se BAJÓ y se llama así. La
    frescura del DATO sale de sus propias columnas (`week`, `dt`), nunca de esto.
    """
    ruta = paths.raw / nombre
    entrada = {"source": nombre, "kind": "NFLVERSE_FILE", "retrieved_at": _mtime(ruta)}
    if not ruta.exists():
        entrada.update(status="MISSING", rows=0,
                       note="file not present in data/raw: a refresh is needed")
        registro.append(entrada)
        return None
    try:
        df = pd.read_parquet(ruta)
    except Exception as exc:                                  # noqa: BLE001
        entrada.update(status="UNREADABLE", rows=0, note=str(exc)[:200])
        registro.append(entrada)
        return None
    entrada.update(status="OK", rows=int(len(df)))
    registro.append(entrada)
    return df


def _reloj_del_parte(parte: dict) -> str:
    """Qué se puede AFIRMAR del parte, en una línea.

    Un parte a medias no puede fecharse como el de la jornada a secas: el lector
    necesita saber que la ausencia de designación no le cubre a todos.
    """
    if parte["status"] == "PUBLISHED":
        return f"week {parte['week']}"
    if parte["status"] == "PARTIALLY_FILED":
        return (f"week {parte['week']} PARTIAL · {parte['teams']} of "
                f"{parte['teams_expected']} clubs filed")
    return parte["status"]


def parte_de_lesiones(inj: pd.DataFrame | None, season: int, week: int,
                      equipos: set[str] | None = None) -> dict:
    """El parte OFICIAL de la jornada EN CURSO, o la razón de que no lo haya.

    Devuelve las filas tal como las entrega el club: designación
    (`report_status`) y participación en el entrenamiento (`practice_status`).
    Sin traducir a probabilidades.

        QUE NO HAYA PARTE DE UN CLUB NO ES QUE SUS JUGADORES ESTÉN SANOS.

    Y por eso `PUBLISHED` no puede ser todo lo que no sea «vacío». El martes de
    la jornada 3 de 2026 habían entregado DOS clubes de treinta y dos —los del
    partido del jueves, que reportan antes—, y la pantalla escribía «week 3 · 0
    designations»: una frase cierta palabra por palabra que se lee como «el
    parte está y no hay nadie tocado». Es la regla 5 con el signo cambiado —una
    AUSENCIA presentada como afirmación— y encima en la pantalla con la que se
    alinea.

    `equipos` son los que JUEGAN esa jornada, derivados del calendario. No se
    supone 32: una jornada con descansos tiene menos, y un valor por defecto
    colado como configuración real es el `counts[pos] or DEFAULT` de siempre.
    Sin ese dato no se puede decir que falte nadie, así que `teams_expected`
    queda en `None` y el estado no se degrada por una cuenta que no se tiene.
    """
    if inj is None:
        return {"status": "SOURCE_UNAVAILABLE", "week": week, "rows": [],
                "note": "the injury report file could not be read"}
    de_temporada = inj[inj["season"] == season]
    semanas = sorted(int(w) for w in de_temporada["week"].dropna().unique())
    de_jornada = de_temporada[de_temporada["week"] == week]
    if de_jornada.empty:
        return {
            "status": "NOT_PUBLISHED_YET",
            "week": week,
            "rows": [],
            "last_published_week": (max(semanas) if semanas else None),
            # Se dice explícitamente lo que NO se va a hacer, porque la
            # tentación es justo ésa.
            # Esta nota SE PINTA, así que va en inglés como el resto de la
            # interfaz. Los comentarios del código siguen en español.
            "note": ("clubs file the week's report from Wednesday on; the previous "
                     "week's designation is NOT carried forward as if it were this "
                     "week's"),
        }
    campos = ["team", "gsis_id", "full_name", "position", "report_status",
              "report_primary_injury", "practice_status"]
    filas = []
    for r in de_jornada.itertuples():
        fila = {c: (getattr(r, c, None) if pd.notna(getattr(r, c, None)) else None)
                for c in campos}
        fila["team"] = normalize_team(str(fila["team"] or ""))
        filas.append(fila)
    con_designacion = [f for f in filas if f.get("report_status")]
    entregado = {f["team"] for f in filas}
    esperados = {normalize_team(str(t)) for t in (equipos or set())} or None
    pendientes = sorted(esperados - entregado) if esperados else []
    return {
        # Parcial y completo no son el mismo hecho: con clubes sin entregar, la
        # falta de designación de un jugador no dice nada sobre ese jugador.
        "status": "PARTIALLY_FILED" if pendientes else "PUBLISHED",
        "week": week,
        "rows": filas,
        "teams": len(entregado),
        # Quién SÍ ha entregado, para poder nombrar la lista MÁS CORTA de las
        # dos: un martes faltan treinta de treinta y dos y escupir esos treinta
        # códigos en un teléfono es un muro que nadie lee.
        "teams_filed": sorted(entregado),
        "teams_expected": (len(esperados) if esperados else None),
        "teams_pending": pendientes,
        "with_designation": len(con_designacion),
    }


def trabajos(dc: pd.DataFrame | None) -> dict:
    """El pateador de registro de cada equipo, con la fecha de la instantánea."""
    if dc is None:
        return {"status": "SOURCE_UNAVAILABLE", "kickers": {}}
    try:
        jobs = jobs_of_record(dc, "PK")
    except DepthChartUnavailable as exc:
        return {"status": "UNAVAILABLE", "kickers": {}, "note": str(exc)}
    return {
        "status": "PUBLISHED",
        "effective_at": next(iter(jobs.values())).effective_at if jobs else None,
        "teams": len(jobs),
        "kickers": {
            t: {"player_id": j.player_id, "player_name": j.player_name,
                "contested": j.contested, "competition": list(j.competition)}
            for t, j in sorted(jobs.items())
        },
    }


def uso(snaps: pd.DataFrame | None, season: int, week: int) -> dict:
    """Cambios de ROL medidos: % de jugadas ofensivas, con anterior y muestra.

    Una jornada no es una tendencia, así que se publica `sample_games` y se
    comparan las dos últimas jugadas del jugador — no una media contra un pico.
    """
    if snaps is None:
        return {"status": "SOURCE_UNAVAILABLE", "changes": []}
    d = snaps[(snaps["season"] == season) & (snaps["week"] < week)].copy()
    if d.empty:
        return {"status": "NO_GAMES_YET", "changes": [],
                "note": f"no games played before week {week}"}
    d["team"] = d["team"].map(lambda x: normalize_team(str(x)))
    d["offense_pct"] = pd.to_numeric(d["offense_pct"], errors="coerce")
    ultima = int(d["week"].max())
    cambios = []
    for (jugador, equipo, pos), g in d.groupby(["player", "team", "position"]):
        g = g.sort_values("week")
        actual = g[g["week"] == ultima]
        if actual.empty:
            continue
        pct_ahora = float(actual["offense_pct"].iloc[0])
        previas = g[g["week"] < ultima]["offense_pct"].dropna()
        pct_antes = float(previas.iloc[-1]) if len(previas) else None
        cambios.append({
            "player": str(jugador), "team": str(equipo), "position": str(pos),
            "snap_pct": round(pct_ahora, 3),
            "snap_pct_prev": (round(pct_antes, 3) if pct_antes is not None else None),
            "delta": (round(pct_ahora - pct_antes, 3) if pct_antes is not None else None),
            "sample_games": int(len(g)),
            "as_of_week": ultima,
        })
    # Sin jornada previa no hay delta que ordenar: se ordena por lo que HAY.
    cambios.sort(key=lambda c: (c["delta"] if c["delta"] is not None else c["snap_pct"]),
                 reverse=True)
    return {"status": "PUBLISHED", "as_of_week": ultima,
            "baseline": ("PREVIOUS_GAME" if any(c["delta"] is not None for c in cambios)
                         else "NONE_ONE_GAME_ONLY"),
            "changes": cambios}


def contexto_dst(weekly: dict, parte: dict) -> dict:
    """Contexto por matchup, derivado en `fantasy/dst.py`.

    La derivación NO vive aquí: la necesitan el barrido y el exportador, y dos
    copias de la misma regla es el fallo que más veces ha aparecido en este
    repositorio. Esto sólo la llama y envuelve su resultado.
    """
    filas = dst.context_rows(
        weekly.get("defenses") or [], weekly.get("rankings") or [], parte.get("rows") or []
    )
    return {"ordering": dst.ORDERING, "rows": filas}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=".")
    ap.add_argument("--weekly", default="out/fantasy_weekly.json")
    ap.add_argument("--out-dir", default="research/weekly")
    ap.add_argument("--date", default=None, help="fecha del artefacto (por defecto, hoy UTC)")
    args = ap.parse_args(argv)

    paths = Paths(Path(args.root))
    fuentes: list[dict] = []

    games = pd.read_parquet(paths.games)
    punto = current_point(games)
    if punto is None:
        print("No se puede resolver la jornada: el calendario no trae `played`.")
        return 1
    season, week = punto.season, punto.week
    sem = games[(games["season"] == season) & (games["week"] == week)]

    inj = _leer(paths, f"injuries_{season}.parquet", fuentes)
    dc = _leer(paths, f"depth_charts_{season}.parquet", fuentes)
    snaps = _leer(paths, f"snap_counts_{season}.parquet", fuentes)
    fuentes.append({"source": "press_feeds", "kind": "NEWS", "status": PRENSA_ESTADO,
                    "rows": 0, "retrieved_at": None,
                    "note": ("all 101 press domains return CONNECT 403 from this "
                             "environment (docs/RED_ENTORNOS.md). The feed sweep runs "
                             "in GitHub Actions, which does have egress.")})

    weekly = json.loads(Path(args.weekly).read_text()) if Path(args.weekly).exists() else {}
    if weekly.get("week") not in (None, week):
        print(f"AVISO: {args.weekly} es de la jornada {weekly.get('week')} y la actual es {week}")

    # Los equipos que JUEGAN esta jornada salen del calendario, nunca de un 32
    # escrito a mano: con descansos son menos, y ese número es lo que decide si
    # el parte está completo o sólo lo han entregado algunos.
    equipos_jornada = {
        normalize_team(str(t))
        for col in ("away_team", "home_team")
        for t in sem.get(col, pd.Series(dtype=str)).dropna()
    }
    parte = parte_de_lesiones(inj, season, week, equipos_jornada or None)
    artefacto = {
        "generated_at": _ahora(),
        "season": season,
        "week": week,
        "schedule": {
            "games": int(len(sem)),
            "from": (str(sem["gameday"].min())[:10] if len(sem) else None),
            "to": (str(sem["gameday"].max())[:10] if len(sem) else None),
            "played": int(sem["played"].sum()) if "played" in sem.columns else None,
            "kickoffs": sorted({str(t) for t in sem.get("gametime", pd.Series(dtype=str)).dropna()}),
        },
        "clocks": {
            "research_as_of": _ahora(),
            "injuries_as_of": _reloj_del_parte(parte),
            "roster_as_of": _mtime(paths.raw / f"roster_{season}.parquet"),
            "schedule_as_of": _mtime(paths.raw / "games.csv"),
        },
        "injury_report": parte,
        "jobs": trabajos(dc),
        "usage": uso(snaps, season, week),
        "dst_context": contexto_dst(weekly, parte),
        "sources": fuentes,
        "unknowns": [],
    }
    # Los desconocidos se derivan del propio artefacto, no se escriben a mano:
    # una lista de huecos mantenida a mano se queda vieja sin que nada falle.
    if parte["status"] == "PARTIALLY_FILED":
        artefacto["unknowns"].append(
            f"official injury report for week {week}: {len(parte['teams_pending'])} of "
            f"{parte['teams_expected']} clubs have not filed yet "
            f"({', '.join(parte['teams_pending'])}) — no designation for their players "
            f"means NOT REPORTED, not healthy")
    elif parte["status"] != "PUBLISHED":
        artefacto["unknowns"].append(
            f"official injury report for week {week}: {parte['status']}")
    if artefacto["usage"]["status"] != "PUBLISHED":
        artefacto["unknowns"].append(f"role and usage: {artefacto['usage']['status']}")
    artefacto["unknowns"].append(
        "route participation: nflverse does not publish per-player routes in this "
        "dataset, so role is measured by snap share and targets, not routes")
    if any(f.get("status") == PRENSA_ESTADO for f in fuentes):
        artefacto["unknowns"].append(
            "press, unofficial depth charts and transactions: SOURCE UNAVAILABLE "
            "from this environment")

    dia = args.date or datetime.now(UTC).strftime("%Y-%m-%d")
    carpeta = Path(args.out_dir) / f"{season}-W{week:02d}"
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / f"{dia}.json"

    # EL DIFF SALE DEL ARTEFACTO ANTERIOR, no de la memoria. Y el anterior no se
    # pisa: la historia es lo que permite auditar qué cambió y cuándo.
    previos = sorted(p for p in carpeta.glob("*.json") if p.name != destino.name)
    artefacto["diff"] = diff_contra(previos[-1] if previos else None, artefacto)

    destino.write_text(json.dumps(artefacto, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Jornada {season} W{week} · {artefacto['schedule']['games']} partidos "
          f"({artefacto['schedule']['from']} a {artefacto['schedule']['to']})")
    print(f"  parte de lesiones : {parte['status']}"
          + (f" · {parte.get('with_designation')} con designación, "
             f"{parte.get('teams')}/{parte.get('teams_expected')} equipos"
             if parte["status"] in ("PUBLISHED", "PARTIALLY_FILED")
             else f" · última publicada: jornada {parte.get('last_published_week')}"))
    print(f"  pateadores        : {artefacto['jobs']['status']} · "
          f"{artefacto['jobs'].get('teams')} equipos, instantánea "
          f"{artefacto['jobs'].get('effective_at')}")
    print(f"  uso/rol           : {artefacto['usage']['status']} · "
          f"{len(artefacto['usage']['changes'])} jugadores, base "
          f"{artefacto['usage'].get('baseline')}")
    print(f"  contexto DST      : {len(artefacto['dst_context']['rows'])} defensas")
    print("  fuentes           : " + ", ".join(
        f"{f['source']}={f['status']}" for f in fuentes))
    print(f"  desconocidos      : {len(artefacto['unknowns'])}")
    d = artefacto["diff"]
    print(f"  contra {d['against'] or 'nada (primer artefacto)'}: "
          f"{len(d['new'])} nuevo, {len(d['changed'])} cambiado, {len(d['removed'])} fuera")
    print(f"\nEscrito {destino}")
    return 0


def diff_contra(anterior: Path | None, ahora: dict) -> dict:
    """NEW / CHANGED / REMOVED / UNCHANGED contra el artefacto del día anterior.

    Se compara sobre HECHOS con clave estable —designación por jugador, puesto de
    pateador por equipo— y no sobre el JSON entero: `generated_at` cambia siempre
    y un diff textual diría que todo cambió todos los días.
    """
    vacio = {"against": None, "new": [], "changed": [], "removed": [], "unchanged": 0}
    if anterior is None or not anterior.exists():
        return vacio
    try:
        prev = json.loads(anterior.read_text())
    except Exception:                                          # noqa: BLE001
        return {**vacio, "against": anterior.name,
                "note": "the previous day's artifact could not be read"}

    def designaciones(art: dict) -> dict[str, str]:
        return {f"{f['team']}:{f.get('full_name')}": str(f.get("report_status"))
                for f in (art.get("injury_report", {}).get("rows") or [])}

    def pateadores(art: dict) -> dict[str, str]:
        return {f"K:{t}": str(v.get("player_name"))
                for t, v in (art.get("jobs", {}).get("kickers") or {}).items()}

    antes = {**designaciones(prev), **pateadores(prev)}
    despues = {**designaciones(ahora), **pateadores(ahora)}
    nuevos = [{"key": k, "now": despues[k]} for k in despues if k not in antes]
    fuera = [{"key": k, "was": antes[k]} for k in antes if k not in despues]
    cambiados = [{"key": k, "was": antes[k], "now": despues[k]}
                 for k in despues if k in antes and antes[k] != despues[k]]
    iguales = sum(1 for k in despues if k in antes and antes[k] == despues[k])
    return {"against": anterior.name, "new": nuevos, "changed": cambiados,
            "removed": fuera, "unchanged": iguales}


if __name__ == "__main__":
    raise SystemExit(main())
