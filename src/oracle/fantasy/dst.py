"""CONTEXTO de defensa por matchup. Contexto, no ranking.

    ORDENAR POR ALGO QUE NO ESTÁ VALIDADO ES INVENTAR EL RANKING
    QUE LA PÁGINA LLEVA MESES DICIENDO QUE NO TIENE.

Este módulo reúne los hechos comprobables de la semana de cada defensa —a qué
quarterback se enfrenta, en qué estado lo da el parte oficial, qué total
implícito lleva su rival, qué hizo ella en los últimos partidos— y **no** los
combina en una nota. La única señal medida de este bloque es el total implícito
del rival (r 0,388 frente a r 0,060 de sus propios puntos del partido anterior),
así que es lo único que ordena, y se dice que es eso lo que ordena.

Vive aquí y no dentro del exportador ni del barrido porque los DOS lo necesitan:
el barrido diario para el artefacto fechado y el exportador para la pantalla. Dos
copias de la misma derivación es el fallo que más veces ha aparecido en este
repositorio —catorce— y la última vez estaba dentro de un guardián.

Lo que NO se afirma, y conviene tenerlo escrito al lado del código: que el
quarterback rival esté dudoso es un hecho; que eso valga puntos de fantasy es
otra afirmación, y no está medida aquí.
"""
from __future__ import annotations

import pandas as pd

from ..data.ingest import normalize_team

#: De dónde sale el nombre del quarterback rival. No es una afirmación del club:
#: es el QB con más puntos proyectados de ese equipo en el propio ranking semanal.
#: Se etiqueta para que la pantalla no lo presente como un parte oficial.
QB_BASIS_MODEL = "MODEL_PROJECTED_STARTER"
QB_BASIS_UNKNOWN = "UNKNOWN"

#: Cómo se ordena la tabla, dicho en el dato para que la pantalla no se lo invente.
ORDERING = "OPPONENT_IMPLIED_TOTAL_ASC"


def projected_starting_qbs(rankings: list[dict]) -> dict[str, dict]:
    """El QB con más puntos proyectados de cada equipo, por código normalizado."""
    qbs: dict[str, dict] = {}
    for r in rankings or []:
        if r.get("position") != "QB":
            continue
        equipo = normalize_team(str(r.get("team") or ""))
        actual = qbs.get(equipo)
        if actual is None or (r.get("projected_points") or 0) > (actual.get("projected_points") or 0):
            qbs[equipo] = r
    return qbs


def _designaciones_qb(injury_rows: list[dict]) -> dict[str, dict[str, str]]:
    """Designación oficial por equipo y apellido, sólo de quarterbacks."""
    fuera: dict[str, dict[str, str]] = {}
    for f in injury_rows or []:
        if str(f.get("position") or "") != "QB":
            continue
        estado = f.get("report_status")
        if not estado:
            continue
        equipo = normalize_team(str(f.get("team") or ""))
        nombre = str(f.get("full_name") or "")
        if not nombre:
            continue
        fuera.setdefault(equipo, {})[nombre.split()[-1].lower()] = str(estado)
    return fuera


def context_rows(
    defenses: list[dict], rankings: list[dict], injury_rows: list[dict] | None = None
) -> list[dict]:
    """Una fila de contexto por defensa, ordenadas por el total implícito del rival.

    El emparejamiento del quarterback con su designación se hace por APELLIDO
    dentro del equipo, y si hay dos apellidos iguales en la misma plantilla no se
    empareja: «ante la duda no se empareja» es la regla que costó dos iteraciones
    con los dos B.Robinson de Atlanta.
    """
    qbs = projected_starting_qbs(rankings)
    designaciones = _designaciones_qb(injury_rows or [])
    filas = []
    for d in defenses or []:
        equipo = normalize_team(str(d.get("team") or ""))
        rival = normalize_team(str(d.get("opponent") or ""))
        qb = qbs.get(rival)
        nombre = str(qb.get("player_name")) if qb else None
        designacion = None
        if nombre:
            apellido = nombre.replace(".", " ").split()[-1].lower()
            del_rival = designaciones.get(rival, {})
            coincidencias = [v for k, v in del_rival.items() if k == apellido]
            designacion = coincidencias[0] if len(coincidencias) == 1 else None
        filas.append({
            "team": equipo,
            "opponent": rival,
            "is_home": d.get("is_home"),
            "opponent_implied": d.get("opponent_implied"),
            "opposing_qb": nombre,
            "opposing_qb_basis": QB_BASIS_MODEL if qb else QB_BASIS_UNKNOWN,
            "opposing_qb_designation": designacion,
            "points_allowed_recent": d.get("points_allowed_recent"),
            "sacks_recent": d.get("sacks_recent"),
            "takeaways_recent": d.get("takeaways_recent"),
            "recent_games": d.get("recent_games"),
        })
    filas.sort(key=lambda f: (f["opponent_implied"] is None, f["opponent_implied"] or 0))
    return filas


def attach(defenses: list[dict], rankings: list[dict],
           injury_rows: list[dict] | None = None) -> int:
    """Escribe el contexto sobre las filas de defensa. Sólo campos `opposing_*`.

    Devuelve cuántas filas quedaron con quarterback identificado — el número que
    permite ver de un vistazo si la derivación llegó o se cayó en silencio.
    """
    por_equipo = {f["team"]: f for f in context_rows(defenses, rankings, injury_rows)}
    con_qb = 0
    for d in defenses or []:
        ctx = por_equipo.get(normalize_team(str(d.get("team") or "")))
        if ctx is None:
            continue
        d["opposing_qb"] = ctx["opposing_qb"]
        d["opposing_qb_basis"] = ctx["opposing_qb_basis"]
        d["opposing_qb_designation"] = ctx["opposing_qb_designation"]
        con_qb += 1 if ctx["opposing_qb"] else 0
    return con_qb


def load_injury_rows(path, season: int, week: int) -> list[dict]:
    """Las filas del parte OFICIAL de esa jornada, o vacío si no está publicado.

    Vacío significa «no publicado todavía» y NO se rellena con la jornada
    anterior: una designación de la jornada 1 leída en la 2 es un dato real con
    fecha vieja, que es exactamente la regla 5.
    """
    if not path or not getattr(path, "exists", lambda: False)():
        return []
    df = pd.read_parquet(path)
    d = df[(df["season"] == season) & (df["week"] == week)]
    if d.empty:
        return []
    return [
        {"team": r.team, "full_name": r.full_name, "position": r.position,
         "report_status": (r.report_status if pd.notna(r.report_status) else None)}
        for r in d.itertuples()
    ]
