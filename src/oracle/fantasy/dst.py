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
#: El titular declarado por el club (depth chart de registro, con su instante).
QB_BASIS_DEPTH_CHART = "DEPTH_CHART_OF_RECORD"
#: Quien de verdad tomó los snaps en la última jornada JUGADA.
QB_BASIS_LAST_PLAYED = "LAST_PLAYED"
#: Los testigos no coinciden y NO se elige en silencio.
QB_BASIS_DISPUTED = "DISPUTED"


def starting_qb_of_record(
    team: str,
    *,
    depth: dict | None = None,
    last_played: dict | None = None,
) -> dict:
    """Quién es el QB titular de `team`, con los testigos que lo sostienen.

        TRES TESTIGOS, Y NINGUNO BASTA SOLO.

    1. **El modelo de rol** cogía al quarterback con más puntos proyectados, que
       contesta otra pregunta: toma los dos primeros por VOLUMEN en la ventana,
       así que quien acaba de perder el puesto arrastra el volumen de las
       jornadas que sí jugó. El 7 de octubre de 2026 publicaba a Dart como
       titular de NYG estando **en reserva**.

    2. **El depth chart** es lo que el club DECLARA, y va por detrás. Medido el
       mismo día: daba a Mayfield en TB y a Caleb Williams en CHI cuando la
       jornada 4 la jugaron Jalon Daniels (63 snaps) y Tyson Bagent (93).

    3. **Los snaps de la última jornada jugada** son un HECHO, y tampoco son la
       respuesta: «quién jugó» no es «quién empieza». Un titular que vuelve de
       lesión lo invierte — pasó con Washington, donde el registro daba a Daniels
       y los snaps a Mariota.

    Así que no hay un desempate correcto, y escribir uno sería inventar una
    medición. Se aplica la regla 5 tal cual: primero lo OFICIAL (el depth
    chart), y **conservando el desacuerdo** cuando el hecho más nuevo dice otra
    cosa. La fila se marca `DISPUTED` y enseña los dos nombres, que es lo que
    deja decidir a quien mira en vez de esconderle la duda.
    """
    declarado = (depth or {}).get(team)
    jugo = (last_played or {}).get(team)
    nombre_d = (declarado or {}).get("player_name")
    nombre_j = (jugo or {}).get("player_name")

    #: Sufijos que NO son apellido. Sin quitarlos, «Michael Penix Jr.» del depth
    #: chart y «Michael Penix» de los snaps salían EN DISPUTA siendo la misma
    #: persona: cuatro disputas medidas y una era ésta. Un falso positivo en una
    #: marca de disputa es peor que no tenerla — enseña una duda que no existe
    #: justo donde el lector viene a resolver dudas.
    SUFIJOS = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}

    def _apellido(n: str | None) -> str:
        partes = [x for x in str(n or "").replace(".", ". ").split() if x.strip()]
        partes = [x for x in partes if x.lower().strip(".") not in {s.strip(".") for s in SUFIJOS}]
        if not partes:
            return ""
        ultimo = partes[-1]
        # El formato abreviado de nflverse («J.Dart») no separa con espacio.
        return (ultimo.split(".")[-1] if "." in ultimo else ultimo).lower()

    if nombre_d and nombre_j and _apellido(nombre_d) != _apellido(nombre_j):
        return {
            "name": nombre_d,
            "basis": QB_BASIS_DISPUTED,
            "declared": nombre_d,
            "declared_as_of": (declarado or {}).get("effective_at"),
            "last_played": nombre_j,
            "last_played_week": (jugo or {}).get("week"),
            "note": (f"the club lists {nombre_d}; {nombre_j} took the snaps in week "
                     f"{(jugo or {}).get('week')}"),
        }
    if nombre_d:
        return {"name": nombre_d, "basis": QB_BASIS_DEPTH_CHART,
                "declared": nombre_d,
                "declared_as_of": (declarado or {}).get("effective_at")}
    if nombre_j:
        return {"name": nombre_j, "basis": QB_BASIS_LAST_PLAYED,
                "last_played": nombre_j, "last_played_week": (jugo or {}).get("week")}
    return {"name": None, "basis": QB_BASIS_UNKNOWN}


def qbs_by_last_played(snaps, *, position: str = "QB") -> dict[str, dict]:
    """Quién tomó más snaps de `position` en la última jornada JUGADA, por equipo.

    La última jornada jugada y no «la actual»: en la actual no se ha jugado nada
    todavía y el fichero no trae filas, así que preguntarle por ella devolvería
    vacío y el testigo desaparecería justo cuando hace falta.
    """
    import pandas as pd

    from oracle.data.ingest import normalize_team

    if snaps is None or len(snaps) == 0:
        return {}
    df = snaps[snaps["position"] == position].copy()
    if df.empty:
        return {}
    df["week"] = pd.to_numeric(df["week"], errors="coerce")
    df["offense_snaps"] = pd.to_numeric(df["offense_snaps"], errors="coerce").fillna(0)
    ultima = df["week"].max()
    df = df[df["week"] == ultima]
    df["team"] = df["team"].map(lambda t: normalize_team(str(t)))
    salida: dict[str, dict] = {}
    for equipo, grupo in df.groupby("team"):
        mejor = grupo.sort_values("offense_snaps", ascending=False).iloc[0]
        if float(mejor["offense_snaps"]) <= 0:
            continue
        salida[str(equipo)] = {
            "player_name": str(mejor["player"]),
            "week": int(ultima),
            "snaps": int(mejor["offense_snaps"]),
        }
    return salida

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
    defenses: list[dict], rankings: list[dict], injury_rows: list[dict] | None = None,
    *, depth: dict | None = None, last_played: dict | None = None,
) -> list[dict]:
    """Una fila de contexto por defensa, ordenadas por el total implícito del rival.

    El emparejamiento del quarterback con su designación se hace por APELLIDO
    dentro del equipo, y si hay dos apellidos iguales en la misma plantilla no se
    empareja: «ante la duda no se empareja» es la regla que costó dos iteraciones
    con los dos B.Robinson de Atlanta.
    """
    # El modelo de rol queda como ÚLTIMO recurso y no como fuente: contesta
    # «quién acumuló volumen», no «quién tiene el puesto». Ver
    # `starting_qb_of_record`, que cruza los tres testigos y conserva el
    # desacuerdo en vez de inventar un desempate.
    qbs = projected_starting_qbs(rankings)
    designaciones = _designaciones_qb(injury_rows or [])
    filas = []
    for d in defenses or []:
        equipo = normalize_team(str(d.get("team") or ""))
        rival = normalize_team(str(d.get("opponent") or ""))
        resuelto = starting_qb_of_record(rival, depth=depth, last_played=last_played)
        qb = qbs.get(rival)
        if resuelto.get("name"):
            nombre = str(resuelto["name"])
            base = resuelto["basis"]
        else:
            # Sin ningún testigo oficial, el modelo es mejor que un hueco — pero
            # se DICE que es el modelo, que es lo que permite no fiarse.
            nombre = str(qb.get("player_name")) if qb else None
            base = QB_BASIS_MODEL if qb else QB_BASIS_UNKNOWN
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
            "opposing_qb_basis": base,
            "opposing_qb_designation": designacion,
            # El desacuerdo viaja con la fila: quién lo declara, quién jugó de
            # verdad y cuándo. Quedarse con uno borra lo que decide si streameas
            # esa defensa.
            "opposing_qb_declared": resuelto.get("declared"),
            "opposing_qb_declared_as_of": resuelto.get("declared_as_of"),
            "opposing_qb_last_played": resuelto.get("last_played"),
            "opposing_qb_note": resuelto.get("note"),
            "points_allowed_recent": d.get("points_allowed_recent"),
            "sacks_recent": d.get("sacks_recent"),
            "takeaways_recent": d.get("takeaways_recent"),
            "recent_games": d.get("recent_games"),
        })
    filas.sort(key=lambda f: (f["opponent_implied"] is None, f["opponent_implied"] or 0))
    return filas


def witnesses(depth_charts=None, snaps=None) -> tuple[dict, dict]:
    """Los dos testigos del QB titular, construidos UNA vez.

    Existe porque los construían dos sitios —el barrido diario y el exportador—
    y uno de los dos se quedó sin ellos: el artefacto del día publicaba
    `DEPTH_CHART_OF_RECORD` mientras el payload seguía en
    `MODEL_PROJECTED_STARTER`. Dos traductores del mismo hecho, otra vez, y esta
    la introduje yo arreglando el hecho.
    """
    from oracle.fantasy.jobs import DepthChartUnavailable, jobs_of_record

    declarado: dict = {}
    if depth_charts is not None and len(depth_charts):
        try:
            declarado = {
                t: {"player_name": r.player_name, "effective_at": r.effective_at}
                for t, r in jobs_of_record(depth_charts, "QB").items()
            }
        except DepthChartUnavailable:
            declarado = {}
    jugaron = qbs_by_last_played(snaps) if snaps is not None else {}
    return declarado, jugaron


def attach(defenses: list[dict], rankings: list[dict],
           injury_rows: list[dict] | None = None,
           *, depth: dict | None = None, last_played: dict | None = None) -> int:
    """Escribe el contexto sobre las filas de defensa. Sólo campos `opposing_*`.

    Devuelve cuántas filas quedaron con quarterback identificado — el número que
    permite ver de un vistazo si la derivación llegó o se cayó en silencio.

    Los campos se copian DERIVADOS de la fila de contexto y no de una lista
    escrita a mano: la versión anterior enumeraba tres, así que los cuatro que
    traen el desacuerdo del quarterback (`declared`, `declared_as_of`,
    `last_played`, `note`) nunca llegaban al payload — el dato computado que no
    llega a la pantalla, por sexta vez. El prefijo `opposing_` es la frontera, y
    se puede comprobar leyendo una línea.
    """
    por_equipo = {
        f["team"]: f
        for f in context_rows(defenses, rankings, injury_rows,
                              depth=depth, last_played=last_played)
    }
    con_qb = 0
    for d in defenses or []:
        ctx = por_equipo.get(normalize_team(str(d.get("team") or "")))
        if ctx is None:
            continue
        for clave, valor in ctx.items():
            if clave.startswith("opposing_"):
                d[clave] = valor
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
