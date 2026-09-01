"""Cliente de la API de Sleeper y traducción de sus reglas a las de este proyecto.

## Lo que hace y lo que no

Sólo lectura, sin autenticación: la propia documentación de Sleeper dice que su
API no autentica porque únicamente contiene información de ligas. No se escribe
nada, no se manda nada, y no hay credencial que rotar.

Se usa `urllib` de la librería estándar en vez de `requests` a propósito: una
dependencia nueva en un proyecto que tiene cinco no se paga por ahorrar cuatro
líneas.

## El identificador que se guarda es el `user_id`, no el nombre

La documentación avisa de que el nombre de usuario **puede cambiar** y el id no.
Guardar el nombre significa que la sincronización se rompe el día que lo cambies,
y se rompe en silencio: devolvería 404 y parecería un problema de red.

## Fallar ruidosamente

Traducir la puntuación de Sleeper a `ScoringRules` es donde esto puede salir mal
de la peor forma posible: **en silencio**. Si una liga tiene bonus por recepción
de ala cerrada o touchdown de pase a 6 puntos y lo ignoramos, el board sale
entero y es de otra liga. Por eso `scoring_from` **levanta `UnmappedScoring`**
con la lista de claves que no supo traducir, en vez de aplicar un valor por
defecto. Es preferible no publicar un board a publicar el de otra liga.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterable
from dataclasses import replace
from pathlib import Path
from typing import Any

import pandas as pd

from oracle.fantasy.draft import LeagueSettings
from oracle.fantasy.league import (
    FANTASY_POSITIONS,
    LeagueContext,
    UnsupportedRoster,
    roster_context,
)
from oracle.fantasy.scoring import ScoringRules

from ..data.ingest import normalize_team

BASE = "https://api.sleeper.app/v1"
TIMEOUT = 20


class SleeperError(RuntimeError):
    """La API no respondió lo que se esperaba."""


class UnmappedScoring(SleeperError):
    """La liga puntúa algo que este proyecto no sabe traducir.

    Se levanta a propósito en vez de ignorar la clave: un board calculado con
    reglas incompletas no es aproximado, es de otra liga.
    """

    def __init__(self, keys: list[str], values: dict[str, float]) -> None:
        self.keys = keys
        self.values = values
        detalle = ", ".join(f"{k}={values[k]}" for k in keys)
        super().__init__(
            f"Sleeper puntúa {len(keys)} cosas que no sé traducir: {detalle}. "
            "Añádelas a SCORING_MAP o a IGNORED antes de generar un board con esta liga."
        )


# --- traducción de la puntuación -------------------------------------------

# Clave de Sleeper -> atributo de `ScoringRules`. Los nombres salen de
# `scoring_settings` de la liga.
SCORING_MAP: dict[str, str] = {
    "pass_yd": "passing_yards",
    "pass_td": "passing_td",
    "pass_int": "interception",
    "rush_yd": "rushing_yards",
    "rush_td": "rushing_td",
    "rec_yd": "receiving_yards",
    "rec_td": "receiving_td",
    "rec": "reception",
    "fum_lost": "fumble_lost",
    "pass_2pt": "two_point",
    "rush_2pt": "two_point",
    "rec_2pt": "two_point",
    "bonus_pass_yd_300": "passing_300_bonus",
    "bonus_rush_yd_100": "rushing_100_bonus",
    "bonus_rec_yd_100": "receiving_100_bonus",
}

# Claves que se ignoran **con conocimiento de causa**, porque el modelo no
# proyecta esas estadísticas y por tanto no puede puntuarlas de ninguna manera.
#
# Ignorar defensas y pateadores no distorsiona el board: este proyecto sólo
# clasifica QB, RB, WR y TE, así que sus puntos no entran en ninguna comparación.
# Ignorar algo de un jugador ofensivo sí distorsionaría, y por eso no está aquí.
IGNORED = frozenset({
    # Pateador
    "fgm", "fgmiss", "xpm", "xpmiss", "fgm_0_19", "fgm_20_29", "fgm_30_39",
    "fgm_40_49", "fgm_50p", "fgm_yds", "fgm_yds_over_30", "xpm_yds",
    "fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50p",
    # Defensa y equipos especiales
    "def_td", "def_st_td", "def_st_ff", "def_st_fum_rec", "def_st_tkl_solo",
    "st_td", "st_ff", "st_fum_rec", "st_tkl_solo", "sack", "int", "ff",
    "fum_rec", "safe", "blk_kick", "pts_allow_0", "pts_allow_1_6",
    "pts_allow_7_13", "pts_allow_14_20", "pts_allow_21_27", "pts_allow_28_34",
    "pts_allow_35p", "yds_allow_0_100", "yds_allow_100_199", "yds_allow_200_299",
    "yds_allow_300_349", "yds_allow_350_399", "yds_allow_400_449",
    "yds_allow_450_499", "yds_allow_500_549", "yds_allow_550p", "def_2pt",
    "def_pass_def", "def_forced_punts", "def_3_and_out", "def_4_and_stop",
    "tkl", "tkl_loss", "tkl_ast", "qb_hit", "idp_tkl", "idp_sack", "idp_int",
    # Sin efecto sobre una proyección de temporada
    "fum", "fum_rec_td", "pass_fd", "rush_fd", "rec_fd", "bonus_fd_te",
    "pass_cmp", "pass_inc", "pass_att", "rush_att", "pass_cmp_40p",
    "pass_td_40p", "rush_td_40p", "rec_td_40p", "bonus_pass_cmp_25",
})


# Bonus de recepción POR POSICIÓN. Sleeper los publica como un EXTRA sobre `rec`,
# no como el valor total: en una liga con `rec: 1` y `bonus_rec_te: 1`, el ala
# cerrada cobra 2 por recepción, no 1.
#
# Estaban en el traductor de JavaScript y NO aquí, así que `scoring_from`
# levantaba `UnmappedScoring` ante `bonus_rec_te` y `sleeper_sync.py` rechazaba
# la liga entera. Dos traductores del mismo formato con distinta cobertura: el
# navegador sabía leer una liga que el pipeline no podía sincronizar.
RECEPTION_BY_POSITION: dict[str, str] = {
    "bonus_rec_te": "TE", "bonus_rec_rb": "RB", "bonus_rec_wr": "WR",
}


def scoring_from(league: dict[str, Any], *, strict: bool = True) -> ScoringRules:
    """Traduce `scoring_settings` de Sleeper a las reglas de este proyecto.

    Con `strict` (el valor por defecto) levanta `UnmappedScoring` en cuanto
    aparece una clave que afecte a un jugador ofensivo y no se sepa traducir.
    """
    settings = league.get("scoring_settings")
    if not isinstance(settings, dict):
        raise SleeperError(
            "La liga no trae `scoring_settings`. ¿Es la respuesta de "
            "/v1/league/<league_id>?"
        )

    fields: dict[str, float] = {}
    per_position: dict[str, float] = {}
    unmapped: list[str] = []
    for key, value in settings.items():
        if key in RECEPTION_BY_POSITION:
            if float(value) != 0.0:
                per_position[RECEPTION_BY_POSITION[key]] = float(value)
            continue
        attribute = SCORING_MAP.get(key)
        if attribute is None:
            if key not in IGNORED:
                unmapped.append(key)
            continue
        # Los tres «2pt» apuntan al mismo atributo. Si una liga los puntúa
        # distinto no se puede representar, y es mejor decirlo que promediar.
        if attribute in fields and fields[attribute] != float(value):
            raise SleeperError(
                f"La liga puntúa {attribute} con dos valores distintos "
                f"({fields[attribute]} y {value}); este modelo sólo admite uno."
            )
        fields[attribute] = float(value)

    if unmapped and strict:
        raise UnmappedScoring(sorted(unmapped), {k: settings[k] for k in unmapped})

    rules = ScoringRules(**fields)
    if per_position:
        # El bonus es un EXTRA sobre la recepción base. Sumarlo mal aquí
        # convierte un TE premium de 2,0 en 1,0 — y con un ala cerrada valiendo
        # la mitad, el board entero de una liga como esa sale en otro orden.
        rules = replace(
            rules,
            reception_by_position={
                position: rules.reception + extra for position, extra in per_position.items()
            },
        )
    return rules


def roster_context_from(league: dict[str, Any]) -> LeagueContext:
    """Contexto de liga desde `roster_positions`. Delega en el compilador único.

    Antes esto tenía su PROPIO reparto del flex (mitad RB, mitad WR, nada al ala
    cerrada), distinto del de `league.roster_context` y distinto del de
    `draft.DEFAULT_STARTERS`. Tres modelos para la misma liga: para
    QB/RB/RB/WR/WR/WR/TE/FLEX en 12 equipos daban el reemplazo del receptor en el
    puesto 36, 42 y 41. Ninguno era «el» modelo y nada decía cuál se estaba
    usando.

    Y algo peor que la discrepancia: llevaba
    `counts[position] or DEFAULT_STARTERS[position]`, así que una liga **sin ala
    cerrada titular** recibía un TE inventado. Un valor por defecto colado como
    configuración real es justo lo que la regla 6 prohíbe — y el `or` lo hacía
    invisible, porque cero es falso en Python.
    """
    # Los campos se validan aquí, con los NOMBRES DE SLEEPER. `roster_context` es
    # genérico y habla de «equipos» y «plantilla»; quien depura esto está mirando
    # un JSON de Sleeper y necesita saber qué clave falta.
    if not isinstance(league.get("total_rosters"), int) or league["total_rosters"] < 2:
        raise SleeperError(
            f"`total_rosters` inesperado: {league.get('total_rosters')!r}"
        )
    if not isinstance(league.get("roster_positions"), list) or not league["roster_positions"]:
        raise SleeperError("La liga no trae `roster_positions`.")
    try:
        return roster_context(
            league.get("roster_positions"),
            league.get("total_rosters"),
            league_id=str(league.get("league_id") or "") or None,
            season=int(league["season"]) if str(league.get("season", "")).isdigit() else None,
        )
    except UnsupportedRoster as error:
        # El compilador levanta `UnsupportedRoster`, que es de `fantasy` y no
        # sabe de Sleeper. Quien llama a este módulo captura `SleeperError`, así
        # que se traduce: delegar el cálculo no puede cambiar el contrato de
        # errores del adaptador, o un `except SleeperError` de antes deja de
        # capturar una liga rota y el fallo sube sin filtrar.
        raise SleeperError(str(error)) from error


def league_settings_from(league: dict[str, Any]) -> LeagueSettings:
    """Compatibilidad: `LeagueSettings` derivado del contexto único.

    Se conserva porque la ruta histórica del board la usa y es la que fija la
    equivalencia de la línea base. Los titulares salen ya del compilador, así
    que el modelo de flex es uno solo.
    """
    context = roster_context_from(league)
    return LeagueSettings(
        teams=context.teams,
        starters=tuple((position, context.starters[position]) for position in FANTASY_POSITIONS),
    )


# --- llamadas ---------------------------------------------------------------


def _get(path: str) -> Any:
    url = f"{BASE}/{path.lstrip('/')}"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise SleeperError(f"{url} devolvió {error.code}") from error
    except urllib.error.URLError as error:
        raise SleeperError(
            f"No se pudo llegar a {url}: {error.reason}. "
            "Si estás en un entorno con proxy, puede estar bloqueado."
        ) from error


def user(username_or_id: str) -> dict:
    """El usuario, por nombre o por id.

    **Guarda el `user_id` que devuelve, no el nombre.** La documentación de
    Sleeper avisa de que el nombre puede cambiar; el día que lo cambies, una
    sincronización guardada por nombre empieza a dar 404 y parece un problema de
    red.
    """
    data = _get(f"user/{username_or_id}")
    if not isinstance(data, dict) or "user_id" not in data:
        raise SleeperError(f"Respuesta inesperada para el usuario {username_or_id!r}.")
    return data


def leagues(user_id: str, season: int) -> list[dict]:
    data = _get(f"user/{user_id}/leagues/nfl/{season}")
    if not isinstance(data, list):
        raise SleeperError("Se esperaba una lista de ligas.")
    return data


def league(league_id: str) -> dict:
    data = _get(f"league/{league_id}")
    if not isinstance(data, dict):
        raise SleeperError(f"Respuesta inesperada para la liga {league_id!r}.")
    return data


def rosters(league_id: str) -> list[dict]:
    data = _get(f"league/{league_id}/rosters")
    if not isinstance(data, list):
        raise SleeperError("Se esperaba una lista de rosters.")
    return data


def draft_picks(draft_id: str) -> list[dict]:
    data = _get(f"draft/{draft_id}/picks")
    if not isinstance(data, list):
        raise SleeperError("Se esperaba una lista de picks.")
    return data


def drafts(league_id: str) -> list[dict]:
    """Los drafts de la liga. Normalmente uno; en dynasty hay uno por año."""
    data = _get(f"league/{league_id}/drafts")
    if not isinstance(data, list):
        raise SleeperError("Se esperaba una lista de drafts.")
    return data


# El catálogo completo de jugadores. **Pesa unos 5 MB** y Sleeper pide
# explícitamente que no se llame más de una vez al día: es un volcado, no un
# endpoint de consulta. Por eso se cachea en disco y por eso `picked_players`
# lo recibe ya cargado en vez de pedirlo él.
PLAYERS_PATH = "players/nfl"


def players() -> dict[str, dict]:
    data = _get(PLAYERS_PATH)
    if not isinstance(data, dict):
        raise SleeperError("Se esperaba el catálogo de jugadores.")
    return data


def gsis_index(catalog: dict[str, dict]) -> dict[str, str]:
    """`sleeper_id` -> `player_id` de nflverse.

    Sleeper publica el `gsis_id` de cada jugador y **es el mismo identificador
    que usa nflverse**, así que el emparejamiento es exacto y no hay que
    adivinar por nombre. Eso importa más de lo que parece: el emparejamiento por
    nombre abreviado ya produjo en este proyecto el problema de los dos
    «B.Robinson» de Atlanta, y ante la duda hubo que renunciar a emparejar.

    Los jugadores sin `gsis_id` —rookies antes de su primer partido, sobre todo—
    se quedan fuera. Es correcto: el modelo tampoco los proyecta.
    """
    index: dict[str, str] = {}
    for sleeper_id, entry in catalog.items():
        if not isinstance(entry, dict):
            continue
        gsis = entry.get("gsis_id")
        if isinstance(gsis, str) and gsis.strip():
            index[str(sleeper_id)] = gsis.strip()
    return index


def picked_players(picks: list[dict], index: dict[str, str]) -> dict[str, list]:
    """Traduce los picks de un draft a ids de nflverse.

    Devuelve los que se pudieron traducir y, **por separado**, los que no. Un
    pick sin traducir no es un detalle: si se descarta en silencio, el modo
    draft cree que ese jugador sigue libre y te lo recomienda cuando ya se lo
    llevaron. Es el fallo más caro posible en esta pantalla, así que se cuenta y
    se enseña.
    """
    matched: list[dict] = []
    unmatched: list[dict] = []
    for pick in picks:
        if not isinstance(pick, dict):
            continue
        sleeper_id = str(pick.get("player_id") or "")
        metadata = pick.get("metadata") or {}
        name = " ".join(
            part for part in (metadata.get("first_name"), metadata.get("last_name")) if part
        ).strip()
        entry = {
            "pick": pick.get("pick_no"),
            "round": pick.get("round"),
            "roster_id": pick.get("roster_id"),
            "picked_by": pick.get("picked_by"),
            "name": name or None,
            # Normalizado, y no es una formalidad: Sleeper escribe "LA" para
            # los Rams en algunos sitios. Sin traducir, un pick de LAR no
            # empareja con el board y el modo draft da por LIBRE a un jugador
            # que ya se llevaron — el fallo más caro de esa pantalla.
            "team": normalize_team(metadata.get("team")) or metadata.get("team"),
            "position": metadata.get("position"),
        }
        gsis = index.get(sleeper_id)
        if gsis:
            entry["player_id"] = gsis
            matched.append(entry)
        else:
            entry["sleeper_id"] = sleeper_id or None
            unmatched.append(entry)
    return {"matched": matched, "unmatched": unmatched}


# Temporadas de rosters que se unen para construir el mapa de identidad. Un
# `sleeper_id` no cambia con los años, así que unir varias temporadas recupera a
# quien no esté en el roster de la actual —lesionados, agentes libres, veteranos
# sin equipo en pretemporada— sin arriesgar nada: el par (gsis, sleeper) es el
# mismo en todas.
IDENTITY_SEASONS = 8


def sleeper_id_map(
    raw_dir: Path,
    *,
    board_ids: Iterable[str] = (),
    defense_teams: Iterable[str] = (),
    seasons: int = IDENTITY_SEASONS,
) -> dict[str, str]:
    """`sleeper_id` -> `player_id` de nflverse, desde los rosters ya descargados.

    **Por qué desde nflverse y no desde el catálogo de Sleeper.** El catálogo son
    5 MB y una petición de red en tiempo de build; los rosters ya están en disco
    porque el board se construye con ellos. Da el MISMO par —nflverse publica
    `sleeper_id` junto a `gsis_id`— y deja el exportador sin red.

    **Por qué se hornea.** Es información ESTABLE: la identidad de un jugador no
    cambia durante un draft. Resolverla en caliente obligaría a bajar el catálogo
    entero en el navegador, que es justo lo que Sleeper pide que no se haga a
    menudo. Horneada, un pick se resuelve por id sin una sola petición extra.

    Las defensas van aparte: Sleeper las identifica por el código del equipo
    (`ARI`), no por un id de jugador, y el board las llama `DST_ARI`.
    """
    wanted = set(board_ids)
    index: dict[str, str] = {}
    files = sorted(raw_dir.glob("roster_*.parquet"))[-seasons:]
    for path in files:
        frame = pd.read_parquet(path, columns=["gsis_id", "sleeper_id"])
        for gsis, sleeper in zip(frame["gsis_id"], frame["sleeper_id"], strict=True):
            if not isinstance(gsis, str) or not gsis.strip():
                continue
            if sleeper is None or str(sleeper).strip() in {"", "nan", "None"}:
                continue
            key = str(sleeper).strip()
            value = gsis.strip()
            if wanted and value not in wanted:
                continue
            # El primero que aparece manda y los repetidos se ignoran: un
            # `sleeper_id` que apuntara a dos jugadores distintos sería un
            # emparejamiento ambiguo, y ante la duda no se empareja.
            if key in index and index[key] != value:
                index.pop(key, None)
                continue
            index[key] = value
    for team in defense_teams:
        code = normalize_team(team)
        if code:
            index[code] = f"DST_{code}"
    return index


def rookies_2026(raw_dir: Path, season: int = 2026) -> list[dict]:
    """Los novatos de la temporada, con identidad verificada y SIN valor.

    Existen aunque el modelo no los proyecte. Un draft real los ofrece, así que
    el asistente tiene que poder enseñarlos, buscarlos y tacharlos cuando
    alguien los elige — y sobre todo resolver su pick de Sleeper por id, porque
    marcarlos UNMAPPED descuadraría el contador del draft.

        EXISTIR != DRAFTEABLE != PROYECTADO != RANKEADO != RECOMENDABLE

    Lo que NO se hace aquí es inventarles un número. Sin partidos NFL no hay
    proyección defendible, así que no viajan ni `vor` ni `projected_points` ni
    `tier`: la interfaz escribe UNKNOWN. Un cero diría «vale lo que su
    reemplazo», que es una afirmación, no la ausencia de una.

    La identidad sale de los rosters de nflverse —`entry_year`, `sleeper_id` y
    `gsis_id` en la misma fila—, no de emparejar nombres.
    """
    path = raw_dir / f"roster_{season}.parquet"
    if not path.exists():
        return []
    columns = [
        "gsis_id", "sleeper_id", "full_name", "position", "team",
        "entry_year", "draft_number", "draft_club",
    ]
    frame = pd.read_parquet(path, columns=columns)
    frame = frame[
        (frame["entry_year"] == season)
        & (frame["position"].isin(FANTASY_POSITIONS))
        & frame["gsis_id"].notna()
        & frame["sleeper_id"].notna()
    ].drop_duplicates("gsis_id")

    out: list[dict] = []
    for row in frame.itertuples(index=False):
        team = normalize_team(row.team)
        if not team:
            continue
        pick = row.draft_number
        out.append({
            "player_id": str(row.gsis_id),
            "sleeper_id": str(row.sleeper_id),
            "player_full_name": str(row.full_name),
            "player_name": str(row.full_name),
            "position": str(row.position),
            "team": team,
            # El capital de draft es un HECHO comprobable, no una proyección.
            # Se publica porque ordena la lista de forma defendible; no es un
            # ranking del modelo y la interfaz no lo llama así.
            "draft_pick": int(pick) if pick == pick and pick is not None else None,
            "rookie": True,
        })
    # Los elegidos primero y por número de pick; los no elegidos, después.
    out.sort(key=lambda r: (r["draft_pick"] is None, r["draft_pick"] or 0, r["player_full_name"]))
    return out
