"""Situación de plantilla de cada jugador, leída del roster de nflverse.

    ESTAR EN EL FICHERO DE PLANTILLAS NO ES ESTAR EN UN EQUIPO.

`mark_rostered` preguntaba «¿aparece este jugador en algún roster?» y daba por
bueno a todo el que apareciera. El fichero de nflverse trae **también** a los
cortados, a los retirados y a los que están en una lista de reserva, así que la
respuesta era que sí para los 444 cortados y retirados. En el board de 2026
eso son 76 filas que se leían como un jugador normal el día antes de un draft.

Este módulo separa lo que aquel booleano juntaba, con las categorías que el
propio fichero declara en su columna `status` —no las inventa nadie aquí—:

    ACT  ACTIVE          en el 53 del equipo
    RES  RESERVE         en una lista de reserva: NO está en el 53
    DEV  PRACTICE_SQUAD  equipo de prácticas
    EXE  EXEMPT          lista de exentos
    CUT  NOT_ON_ROSTER   cortado
    RET  NOT_ON_ROSTER   retirado
    (sin fila)           NOT_ON_ROSTER: no está en ninguna plantilla
    (defensa)            TEAM_UNIT: la pregunta no se le hace a un equipo

## Lo que NO se traduce, a propósito

El fichero trae además un código fino (`R01`, `R48`, `P01`…). **Aquí no se
traduce**: distinguir «reserva por lesión» de «reserva físicamente incapaz» a
partir de un código que este repositorio no puede verificar sería inventarle un
significado a un dato, y la diferencia decide un pick. El código viaja crudo en
`roster_code` y la distinción fina, cuando existe con fuente, la trae la capa de
prensa (`narrative/status.py`), que es la que sí puede citarla.

## Marca, no calcula

Como `narrative/status.py`, `attach()` escribe **sólo** campos con prefijo
`roster_`. Ningún número del board cambia: eso hace que la regla 8 se pueda
comprobar leyendo la función entera. Lo que un estado sí puede hacer es sacar a
alguien de la lista corta —igual que ya hacía SIN EQUIPO—, porque recomendar
como mejor pick a quien está cortado no es una opinión distinta: es un hecho
equivocado.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from ..data.ingest import normalize_team

ACTIVE = "ACTIVE"
RESERVE = "RESERVE"
PRACTICE_SQUAD = "PRACTICE_SQUAD"
EXEMPT = "EXEMPT"
NOT_ON_ROSTER = "NOT_ON_ROSTER"
#: UNA DEFENSA NO ES UNA PERSONA, y el registro de plantillas sólo tiene
#: personas. Sin este estado, `attach` no encontraba fila para los 32 equipos y
#: los marcaba `NOT_ON_ROSTER`: el payload afirmaba que la defensa de Kansas
#: City no está en ninguna plantilla NFL. Una fila del board que no es un
#: jugador no admite ninguna de las cinco respuestas, y la sexta no es «no» —
#: es «esa pregunta no se le hace».
TEAM_UNIT = "TEAM_UNIT"

#: Posiciones que son un equipo entero. `DST` y `DEF` conviven en las fuentes.
TEAM_UNIT_POSITIONS = frozenset({"DST", "DEF", "D/ST", "DEFENSE"})

#: Traducción de la columna `status` del roster. Sólo estas seis existen en el
#: fichero; cualquier otra levanta en vez de colarse como «activo».
FROM_NFLVERSE = {
    "ACT": ACTIVE,
    "RES": RESERVE,
    "DEV": PRACTICE_SQUAD,
    "EXE": EXEMPT,
    "CUT": NOT_ON_ROSTER,
    "RET": NOT_ON_ROSTER,
}

LABEL = {
    ACTIVE: "ACTIVE ROSTER",
    RESERVE: "RESERVE LIST",
    PRACTICE_SQUAD: "PRACTICE SQUAD",
    EXEMPT: "EXEMPT LIST",
    NOT_ON_ROSTER: "NOT ON A ROSTER",
    TEAM_UNIT: "TEAM UNIT",
}

#: Quién NO está en el 53 de su equipo. No es «malo»: es un hecho que cambia
#: para qué sirve el pick. `ACTIVE` es el único que no aparece aquí.
OFF_ACTIVE_ROSTER = frozenset({RESERVE, PRACTICE_SQUAD, EXEMPT, NOT_ON_ROSTER})

#: Quién no tiene equipo NFL ninguno. Es lo que `rostered` quiso decir siempre.
NO_TEAM = frozenset({NOT_ON_ROSTER})


class RosterStageUnknown(ValueError):
    """El fichero de plantillas no dice lo que este módulo necesita saber.

    Falla cerrado por el mismo motivo que `regular_season()`: ante un cambio de
    esquema, seguir devolviendo «todos activos» convertiría un fallo en un board
    que afirma que 444 cortados y retirados están en su equipo.
    """


@dataclass(frozen=True)
class RosterEntry:
    """La situación de un jugador, con de dónde sale y de cuándo es."""

    player_id: str
    state: str
    team: str | None
    roster_code: str | None
    season: int
    week: int
    source_as_of: str | None

    @property
    def on_active_roster(self) -> bool:
        return self.state == ACTIVE

    @property
    def has_team(self) -> bool:
        return self.state not in NO_TEAM


def _source_date(path: Path) -> str | None:
    """Cuándo publicó el ORIGEN este fichero, que no es cuándo lo bajé.

    El mtime lo pone `ingest._download` con el `Last-Modified` del servidor
    cuando lo hay. Si no lo hubo, el propio descargador ya avisó por stderr y
    aquí no se puede distinguir, así que esta fecha se publica etiquetada como
    la del fichero de origen y no como «hoy».
    """
    try:
        return date.fromtimestamp(path.stat().st_mtime).isoformat()
    except OSError:
        return None


def load(roster_path: Path) -> dict[str, RosterEntry]:
    """Lee el roster semanal y devuelve la situación por `gsis_id`.

    Se queda con la semana MÁS ALTA del fichero: un roster semanal acumula
    semanas y la vieja diría que alguien cortado en agosto sigue activo.
    """
    if not roster_path.exists():
        return {}
    frame = pd.read_parquet(
        roster_path,
        columns=["gsis_id", "status", "team", "status_description_abbr", "season", "week"],
    )
    for column in ("status", "gsis_id", "week"):
        if column not in frame.columns:
            raise RosterStageUnknown(
                f"el roster no trae la columna «{column}»: sin ella no se puede decir "
                "quién está en un equipo, y suponer que todos lo están es el fallo "
                "que este módulo existe para impedir"
            )
    frame = frame[frame["gsis_id"].notna()]
    if frame.empty:
        return {}
    week = int(frame["week"].max())
    frame = frame[frame["week"] == week]
    desconocidos = sorted(set(frame["status"].dropna().unique()) - set(FROM_NFLVERSE))
    if desconocidos:
        raise RosterStageUnknown(
            f"situaciones de plantilla que este módulo no conoce: {desconocidos}. "
            "Traducir una etiqueta nueva a «activo» por defecto sería inventar el "
            "dato que el draft usa para descartar a alguien"
        )
    as_of = _source_date(roster_path)
    entries: dict[str, RosterEntry] = {}
    for row in frame.to_dict(orient="records"):
        raw = row.get("status")
        if raw is None or (isinstance(raw, float) and pd.isna(raw)):
            # Sin situación declarada NO se supone ninguna.
            continue
        code = row.get("status_description_abbr")
        entries[str(row["gsis_id"])] = RosterEntry(
            player_id=str(row["gsis_id"]),
            state=FROM_NFLVERSE[raw],
            # NORMALIZADO AQUÍ, no en cada consumidor. El fichero escribe «LA»
            # y el board «LAR»: `team_changes` ya lo comparaba bien, pero el
            # campo CRUDO viajaba a la pantalla y el pateador de los Rams salía
            # «on LA» junto a una fila que dice LAR. Un solo sitio.
            team=normalize_team(str(row["team"])) if row.get("team") else None,
            roster_code=str(code) if code and not pd.isna(code) else None,
            season=int(row["season"]) if row.get("season") else 0,
            week=week,
            source_as_of=as_of,
        )
    return entries


def attach(rows: list[dict], entries: dict[str, RosterEntry]) -> int:
    """Cuelga la situación de plantilla en cada fila. Devuelve cuántas marcó.

    Escribe **sólo** campos con prefijo `roster_`. Un jugador que no está en el
    fichero se marca `NOT_ON_ROSTER` explícitamente: «no aparece» es la misma
    afirmación que «no tiene equipo» en este fichero —Tyreek Hill no tiene fila
    porque Miami lo cortó— y dejarlo sin marca lo devolvería a parecer normal,
    que es justo el fallo.

    Con el diccionario VACÍO no se marca a nadie: sin fichero no se sabe, y
    decir «ninguno tiene equipo» por no tener el dato es peor que no decir nada.
    """
    if not entries:
        return 0
    # LA FECHA DEL FICHERO, UNA VEZ. «No aparece en el roster» es una afirmación
    # sobre el fichero ENTERO, así que lleva su fecha igual que la de quien sí
    # aparece: 66 filas del board decían «not on any NFL roster as of an unknown
    # date» teniendo la fecha delante. Una afirmación de actualidad sin fecha
    # visible es la regla 5 rota, aunque la afirmación sea cierta.
    fecha = next((e.source_as_of for e in entries.values() if e.source_as_of), None)
    marcadas = 0
    for row in rows:
        if str(row.get("position") or "").upper() in TEAM_UNIT_POSITIONS:
            row["roster_state"] = TEAM_UNIT
            row["roster_label"] = LABEL[TEAM_UNIT]
            row["roster_code"] = None
            row["roster_team"] = row.get("team")
            row["roster_source_as_of"] = fecha
            row["roster_basis"] = "NO_ES_UN_JUGADOR"
            marcadas += 1
            continue
        entry = entries.get(str(row.get("player_id")))
        if entry is None:
            row["roster_state"] = NOT_ON_ROSTER
            row["roster_label"] = LABEL[NOT_ON_ROSTER]
            row["roster_code"] = None
            row["roster_team"] = None
            row["roster_source_as_of"] = fecha
            row["roster_basis"] = "SIN_FILA"
        else:
            row["roster_state"] = entry.state
            row["roster_label"] = LABEL[entry.state]
            row["roster_code"] = entry.roster_code
            row["roster_team"] = entry.team
            row["roster_source_as_of"] = entry.source_as_of
            row["roster_basis"] = "NFLVERSE_WEEKLY_ROSTER"
        marcadas += 1
    return marcadas


def reconcile(rows: list[dict]) -> list[dict]:
    """Cuando la PRENSA y el REGISTRO se contradicen, decide quién vio después.

        UN HECHO DE MARZO NO DESCRIBE UNA PLANTILLA DE SEPTIEMBRE.

    Caso real y medido el 6 de septiembre de 2026: la capa curada marcaba a
    **Stefon Diggs** como `NO NFL TEAM` con severidad OUT —efectivo el 11 de
    marzo, recomprobado el 3 de septiembre— mientras el registro de plantillas
    del **5 de septiembre** lo daba ACTIVO en Washington, y el mercado lo
    drafteaba en el ADP 94,6. Un OUT saca al jugador de la lista corta entera,
    así que el receptor número 72 del board desaparecía del asistente por una
    afirmación que un registro posterior contradice.

    La regla de conflicto ya estaba escrita (regla 5): **primero lo oficial,
    después lo más NUEVO, después lo mejor atribuido — conservando el
    desacuerdo.** Aquí se aplica con el discriminador que generaliza:

        el HECHO de la prensa (`status_effective_at`) es ANTERIOR a la
        instantánea del registro (`roster_source_as_of`), y el registro dice lo
        contrario  ->  el registro vio después.

    Al revés no: si a alguien lo cortan hoy y el fichero de plantillas es de la
    semana pasada, la prensa es la que vio después y no se toca.

    Lo que hace y lo que NO hace:

    * NO borra la afirmación de la prensa. Se conserva entera —etiqueta, fecha,
      fuente— porque el desacuerdo es información.
    * NO cambia ningún número. Escribe `status_disputed` y `status_dispute`, y
      nada más.
    * Sí quita el efecto de EXCLUIR: un OUT tiene que ser un hecho, y éste ha
      dejado de estarlo. Lo que se publica es la disputa, no una de las mitades.

    Devuelve las filas afectadas, para poder decir cuántas fueron.
    """
    tocadas = []
    for row in rows:
        if row.get("status_label") != "NO NFL TEAM":
            continue
        if row.get("roster_state") != ACTIVE or not row.get("roster_team"):
            continue
        efectivo = str(row.get("status_effective_at") or "")[:10]
        registro = str(row.get("roster_source_as_of") or "")[:10]
        if not efectivo or not registro or efectivo >= registro:
            # Sin las dos fechas no se puede decir quién vio después, y sin
            # saberlo NO se desactiva un aviso: UNKNOWN no es «adelante».
            continue
        row["status_disputed"] = True
        row["status_dispute"] = (
            f"Reported without an NFL team as of {efectivo}, but the "
            f"{registro} roster registry lists him active on {row['roster_team']}. "
            "Both are shown; the registry is the later look."
        )
        tocadas.append(row)
    return tocadas


def team_changes(rows: list[dict], entries: dict[str, RosterEntry]) -> list[dict]:
    """Board cuyo equipo NO es el que dice la plantilla de hoy.

    El equipo del board es el último en el que el jugador JUGÓ, que no es donde
    está. La diferencia entre los dos es un hecho comprobable y es de las cosas
    más útiles que se pueden saber la víspera de un draft.
    """
    # NFLVERSE NO ES CONSISTENTE ENTRE DATASETS: el fichero de plantillas escribe
    # «LA» donde el board escribe «LAR». Comparar en crudo publicaba a Puka
    # Nacua como «cambio de equipo» el día antes de un draft — una alarma falsa
    # en el sitio que más se mira. Es el `AZ`/`ARI` de la tabla de errores, y la
    # regla de siempre: todo código pasa por `normalize_team`.
    from ..data.ingest import normalize_team

    salida = []
    for row in rows:
        if str(row.get("position") or "").upper() in TEAM_UNIT_POSITIONS:
            continue
        entry = entries.get(str(row.get("player_id")))
        if entry is None or not entry.team or not row.get("team"):
            continue
        # A QUIEN NO TIENE EQUIPO NO SE LE ASIGNA UNO. El fichero conserva el
        # equipo que lo CORTÓ, así que Jashaun Corbin salía a la vez en «sin
        # plantilla» y en «NYG → DAL», y Dallas es quien lo despidió. Afirmar un
        # equipo de quien no lo tiene es justo el dato inventado que este módulo
        # existe para no producir.
        if not entry.has_team:
            continue
        if normalize_team(str(row["team"])) != normalize_team(entry.team):
            salida.append(
                {
                    "player_id": row.get("player_id"),
                    "player": row.get("player_full_name") or row.get("player_name"),
                    "position": row.get("position"),
                    "overall_rank": row.get("overall_rank"),
                    "board_team": normalize_team(str(row["team"])),
                    "roster_team": normalize_team(entry.team),
                    "source_as_of": entry.source_as_of,
                }
            )
    return salida
