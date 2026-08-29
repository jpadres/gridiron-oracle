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
from typing import Any

from oracle.fantasy.draft import DEFAULT_STARTERS, LeagueSettings
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
    unmapped: list[str] = []
    for key, value in settings.items():
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

    return ScoringRules(**fields)


def league_settings_from(league: dict[str, Any]) -> LeagueSettings:
    """Número de equipos y titulares por posición, desde `roster_positions`.

    El hueco flexible se reparte entre RB y WR a partes iguales. No es exacto —
    en la práctica el flex se llena más con corredores— pero repartirlo es mucho
    mejor que ignorarlo: sin él, el nivel de reemplazo de las dos posiciones sale
    demasiado alto y el VOR de todos ellos, demasiado bajo.
    """
    teams = league.get("total_rosters")
    if not isinstance(teams, int) or teams < 2:
        raise SleeperError(f"`total_rosters` inesperado: {teams!r}")

    positions = league.get("roster_positions")
    if not isinstance(positions, list):
        raise SleeperError("La liga no trae `roster_positions`.")

    counts = dict.fromkeys(("QB", "RB", "WR", "TE"), 0.0)
    flex = 0.0
    superflex = 0.0
    for slot in positions:
        if slot in counts:
            counts[slot] += 1.0
        elif slot in ("FLEX", "REC_FLEX", "WRRB_FLEX"):
            flex += 1.0
        elif slot in ("SUPER_FLEX", "QB_FLEX"):
            superflex += 1.0

    counts["RB"] += flex / 2
    counts["WR"] += flex / 2
    # El superflex se llena casi siempre con un quarterback, y por eso cambia
    # tanto el valor de la posición: deja de haber uno por equipo.
    counts["QB"] += superflex

    if sum(counts.values()) == 0:
        raise SleeperError(f"Ninguna posición reconocible en {positions!r}")

    starters = tuple(
        (position, counts[position] or DEFAULT_STARTERS.get(position, 1.0))
        for position in ("QB", "RB", "WR", "TE")
    )
    return LeagueSettings(teams=teams, starters=starters)


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
