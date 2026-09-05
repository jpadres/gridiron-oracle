"""Descarga de nflverse y agregación a nivel equipo-partido.

nflverse publica cada dataset como un release de GitHub. Todo es público y sin
autenticación: no hay ni una clave en este proyecto.

**El detalle que más tiempo cuesta si se ignora:** nflverse *no* es consistente
en las abreviaturas de equipo entre datasets. El play-by-play dice `LA`, el
calendario dice `LAR`; unos años usan `AZ` y otros `ARI`. Un join sin normalizar
no falla — simplemente pierde filas en silencio, que es mucho peor. Por eso todo
lo que entra pasa por `normalize_team`.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import FIRST_PBP_SEASON, Paths
from .coverage import blank_gaps

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
PBP_URL = NFLVERSE + "/pbp/play_by_play_{season}.parquet"
ROSTER_URL = NFLVERSE + "/weekly_rosters/roster_weekly_{season}.parquet"
# nflverse renombró este dataset: era `player_stats/player_stats_{season}` y
# ahora es `stats_player/stats_player_week_{season}`. El nombre viejo sigue
# publicado hasta 2024 y deja de existir en 2025, así que apuntar al antiguo no
# falla al clonar — falla meses después, justo con la temporada en curso.
PLAYER_STATS_URL = NFLVERSE + "/stats_player/stats_player_week_{season}.parquet"
# El calendario con líneas de mercado vive en otro repo (nfldata) y es un único
# CSV con todas las temporadas, no uno por año.
#
# Se apunta a raw.githubusercontent.com y no a `github.com/.../raw/...`: la
# segunda es una redirección a la primera, y hay entornos (proxies corporativos,
# runners con el acceso a GitHub restringido por repo) que la cortan con un 403
# mientras que la URL directa pasa sin problema. Sin redirección hay menos
# cosas que puedan fallar.
SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"

# Reubicaciones y alias. La política es colapsar la franquicia a su abreviatura
# actual: los ratings siguen a la organización, no a la ciudad. STL y LAR son el
# mismo equipo con la misma plantilla; separarlos reiniciaría el rating en 2016
# sin ningún motivo deportivo.
TEAM_ALIASES: dict[str, str] = {
    "AZ": "ARI",
    "ARZ": "ARI",
    "BLT": "BAL",
    "CLV": "CLE",
    "HST": "HOU",
    "JAC": "JAX",
    "SL": "LAR",
    "STL": "LAR",
    "LA": "LAR",
    "RAM": "LAR",
    "SD": "LAC",
    "SDG": "LAC",
    "OAK": "LV",
    "LVR": "LV",
    "RAI": "LV",
    "WSH": "WAS",
    "WFT": "WAS",
    "GNB": "GB",
    "KAN": "KC",
    "NWE": "NE",
    "NOR": "NO",
    "SFO": "SF",
    "TAM": "TB",
}

VALID_TEAMS = frozenset(
    """ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV
    MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS""".split()
)


def normalize_team(team: object) -> str | None:
    """Abreviatura canónica de un equipo, o None si no se reconoce.

    Devolver None en vez de propagar la basura es deliberado: una fila con
    equipo desconocido se descarta arriba, donde se puede contar y avisar.
    """
    if team is None or (isinstance(team, float) and np.isnan(team)):
        return None
    key = str(team).strip().upper()
    key = TEAM_ALIASES.get(key, key)
    return key if key in VALID_TEAMS else None


def normalize_team_series(series: pd.Series) -> pd.Series:
    return series.map(normalize_team)


def _download(
    url: str, dest: Path, force: bool = False, optional: bool = False
) -> Path | None:
    """Descarga con caché en disco.

    nflverse reescribe los ficheros de la temporada en curso cada semana, así
    que `force` existe para refrescarlos.

    `optional=True` devuelve None ante un 404 en vez de propagar el error. No es
    laxitud: **la cobertura de nflverse no es la misma en todos los datasets.**
    El play-by-play llega a 1999, pero los rosters semanales empiezan en 2002.
    Sin esto, una descarga de 27 temporadas aborta en la primera y hay que
    descubrir a mano cuál faltaba.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_modified = None
    try:
        with urllib.request.urlopen(url) as response, open(tmp, "wb") as handle:
            handle.write(response.read())
            last_modified = _http_date(response.headers.get("Last-Modified"))
    except urllib.error.HTTPError as error:
        tmp.unlink(missing_ok=True)
        if optional and error.code == 404:
            return None
        raise
    # LA FECHA DEL DATO ES LA DEL DATO, NO LA DE LA DESCARGA. `data_dates` fecha
    # cada sección por el mtime del fichero de origen, así que un `force=True`
    # que reescribiera el mismo contenido cada refresh le pondría al calendario
    # la fecha de hoy sin que nflverse hubiera cambiado un byte — la regla 5
    # fabricada dentro del propio refresco. Dos defensas: contenido idéntico no
    # se toca (conserva su mtime), y si el servidor dice Last-Modified, el
    # fichero lleva ESA fecha, que es la de publicación del origen.
    if dest.exists() and _same_bytes(tmp, dest):
        tmp.unlink(missing_ok=True)
        return dest
    # Rename atómico: un Ctrl-C a media descarga no deja un parquet truncado en
    # la caché, que luego falla al leer de forma incomprensible.
    tmp.replace(dest)
    if last_modified is not None:
        os.utime(dest, (last_modified, last_modified))
    return dest


# Primera temporada de cada dataset. La cobertura de nflverse no es uniforme:
# el play-by-play llega a 1999, los rosters semanales empiezan en 2002.
FIRST_SEASON_BY_DATASET = {"pbp": 1999, "roster": 2002, "player_stats": 1999}


def _is_optional(dataset: str, season: int, current_season: int) -> bool:
    """Si la ausencia de este fichero es esperable en vez de un error.

    Dos casos legítimos, y ninguno debe abortar una descarga de 27 temporadas:

    1. **Demasiado antiguo.** El dataset no llega tan atrás (rosters < 2002).
    2. **Demasiado nuevo.** Entre febrero y septiembre, la temporada que viene
       ya tiene calendario y líneas publicadas, pero **todavía no se ha jugado
       ningún partido**: no existe su play-by-play ni su estadística. Es el
       caso normal de la pretemporada, que es justo cuando se quiere predecir
       la semana 1.
    """
    return season < FIRST_SEASON_BY_DATASET[dataset] or season >= current_season


def _same_bytes(a: Path, b: Path) -> bool:
    """¿Mismo contenido? Se compara por hash, no por tamaño: un CSV de líneas
    puede cambiar una cuota sin cambiar de longitud."""
    import hashlib

    def digest(path: Path) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    return digest(a) == digest(b)


def _http_date(value: str | None) -> float | None:
    """`Last-Modified` en segundos desde la época, o None si no viene o no se lee."""
    if not value:
        return None
    from email.utils import parsedate_to_datetime

    try:
        return parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError):
        return None


def download_season(
    season: int, paths: Paths, force: bool = False, current_season: int | None = None
) -> dict[str, Path | None]:
    """Descarga los tres datasets de una temporada.

    Un valor None en el resultado significa "no publicado", no "falló": las
    funciones de agregación ya saltan los ficheros que no existen.
    """
    current_season = current_season if current_season is not None else _current_season()
    urls = {
        "pbp": (PBP_URL, f"pbp_{season}.parquet"),
        "roster": (ROSTER_URL, f"roster_{season}.parquet"),
        "player_stats": (PLAYER_STATS_URL, f"player_stats_{season}.parquet"),
    }
    return {
        dataset: _download(
            url.format(season=season),
            paths.raw / filename,
            force,
            optional=_is_optional(dataset, season, current_season),
        )
        for dataset, (url, filename) in urls.items()
    }


def download_schedules(paths: Paths, force: bool = False) -> Path:
    return _download(SCHEDULE_URL, paths.raw / "games.csv", force)


def refresh(
    paths: Paths,
    first_season: int = FIRST_PBP_SEASON,
    last_season: int | None = None,
    force_last: int = 1,
) -> None:
    """Descarga todo lo que falte y reconstruye las tablas procesadas.

    `force_last` fuerza la redescarga de las N últimas temporadas: la temporada
    en curso cambia cada semana y la caché la dejaría congelada en la semana 1.
    """
    paths.ensure()
    current_season = _current_season()
    last_season = last_season or current_season
    for season in range(first_season, last_season + 1):
        force = season > last_season - force_last
        download_season(season, paths, force=force, current_season=current_season)

    # El calendario se refresca SIEMPRE, y es el único dataset imprescindible
    # para la temporada que viene: entre febrero y septiembre trae ya sus
    # partidos con líneas, mucho antes de que exista un solo play-by-play.
    download_schedules(paths, force=True)

    games = build_games(paths, first_season, last_season)
    games.to_parquet(paths.games, index=False)
    team_games = build_team_games(paths, first_season, last_season, games)
    team_games.to_parquet(paths.team_games, index=False)
    player_weeks = build_player_weeks(paths, first_season, last_season)
    player_weeks.to_parquet(paths.player_weeks, index=False)


def _current_season() -> int:
    """La temporada NFL X va de septiembre de X a febrero de X+1."""
    today = pd.Timestamp.today()
    return today.year if today.month >= 3 else today.year - 1


# --------------------------------------------------------------------------
# Calendario y líneas de mercado
# --------------------------------------------------------------------------

def build_games(paths: Paths, first_season: int, last_season: int) -> pd.DataFrame:
    """Un registro por partido con resultado y línea de cierre.

    `spread_line` en nfldata está en la convención "puntos que se le dan al
    visitante", positiva cuando el local es favorito. El margen del local es
    `home_score - away_score`, así que un modelo perfecto tendría
    `margin ≈ spread_line`. Se conserva esa convención en todo el proyecto para
    no tener que recordar dónde se invirtió el signo.
    """
    raw = pd.read_csv(paths.raw / "games.csv", low_memory=False)
    raw = raw[(raw["season"] >= first_season) & (raw["season"] <= last_season)].copy()

    out = pd.DataFrame(
        {
            "game_id": raw["game_id"].astype(str),
            "season": raw["season"].astype(int),
            "week": raw["week"].astype(int),
            "game_type": raw.get("game_type", pd.Series("REG", index=raw.index)),
            "gameday": pd.to_datetime(raw["gameday"], errors="coerce"),
            "home_team": normalize_team_series(raw["home_team"]),
            "away_team": normalize_team_series(raw["away_team"]),
            "home_score": pd.to_numeric(raw.get("home_score"), errors="coerce"),
            "away_score": pd.to_numeric(raw.get("away_score"), errors="coerce"),
            "spread_line": pd.to_numeric(raw.get("spread_line"), errors="coerce"),
            "total_line": pd.to_numeric(raw.get("total_line"), errors="coerce"),
            "home_moneyline": pd.to_numeric(raw.get("home_moneyline"), errors="coerce"),
            "away_moneyline": pd.to_numeric(raw.get("away_moneyline"), errors="coerce"),
            "roof": raw.get("roof"),
            "surface": raw.get("surface"),
            "temp": pd.to_numeric(raw.get("temp"), errors="coerce"),
            "wind": pd.to_numeric(raw.get("wind"), errors="coerce"),
            "location": raw.get("location"),
            # La sede del partido, no la del equipo. nflverse la publica en los
            # 7.548 partidos sin un solo nulo, y es estable frente a los cambios
            # de patrocinador que renombran el estadio cinco veces. Sin esto, el
            # viaje se calculaba desde la ciudad a la que el equipo se mudó
            # DESPUÉS, y los 102 partidos en sede neutral no se situaban.
            "stadium_id": raw.get("stadium_id"),
            "home_rest": pd.to_numeric(raw.get("home_rest"), errors="coerce"),
            "away_rest": pd.to_numeric(raw.get("away_rest"), errors="coerce"),
            "home_qb_id": raw.get("home_qb_id"),
            "away_qb_id": raw.get("away_qb_id"),
            "home_qb_name": raw.get("home_qb_name"),
            "away_qb_name": raw.get("away_qb_name"),
        }
    )
    out = out.dropna(subset=["home_team", "away_team"])
    out["margin"] = out["home_score"] - out["away_score"]
    out["total"] = out["home_score"] + out["away_score"]
    out["neutral_site"] = (out["location"].astype(str).str.lower() != "home").astype(int)
    out["played"] = out["home_score"].notna().astype(int)

    # Orden cronológico estable. El desempate por game_id importa: la pasada de
    # features tiene que ser reproducible bit a bit para que el test anti-fuga
    # pueda comparar dos ejecuciones.
    return out.sort_values(["gameday", "game_id"], kind="mergesort").reset_index(drop=True)


# --------------------------------------------------------------------------
# Agregación equipo-partido desde el play-by-play
# --------------------------------------------------------------------------

def _aggregate_pbp_season(path: Path) -> pd.DataFrame:
    """Agrega el play-by-play de una temporada a dos filas por partido."""
    columns = [
        "game_id", "season", "week", "posteam", "defteam", "play_type", "epa",
        "success", "pass", "rush", "yards_gained", "qb_dropback", "sack",
        "interception", "fumble_lost", "penalty", "series_success", "wp",
    ]
    pbp = pd.read_parquet(path, columns=[c for c in columns if c])
    # Sólo jugadas de scrimmage: despejes, patadas y las jugadas anuladas por
    # penalti no dicen nada de la eficiencia del ataque y sí ensucian el EPA.
    plays = pbp[pbp["play_type"].isin(["pass", "run"])].copy()
    plays["posteam"] = normalize_team_series(plays["posteam"])
    plays["defteam"] = normalize_team_series(plays["defteam"])
    plays = plays.dropna(subset=["posteam", "defteam"])

    # Garbage time: con la probabilidad de victoria fuera de [5%, 95%] las dos
    # defensas juegan otra cosa. Se marca, no se borra: el volumen sí cuenta
    # para fantasy aunque la eficiencia no cuente para los ratings.
    plays["competitive"] = plays["wp"].between(0.05, 0.95, inclusive="both").fillna(True)

    grouped = plays.groupby(["game_id", "posteam"], observed=True)
    comp = plays[plays["competitive"]].groupby(["game_id", "posteam"], observed=True)

    agg = pd.DataFrame(
        {
            "off_plays": grouped.size(),
            "off_epa_total": grouped["epa"].sum(),
            "off_success": grouped["success"].mean(),
            "off_yards": grouped["yards_gained"].sum(),
            "dropbacks": grouped["qb_dropback"].sum(),
            "sacks_taken": grouped["sack"].sum(),
            "interceptions": grouped["interception"].sum(),
            "fumbles_lost": grouped["fumble_lost"].sum(),
            "off_epa_competitive": comp["epa"].mean(),
            "off_plays_competitive": comp.size(),
        }
    ).reset_index()
    agg["off_epa"] = agg["off_epa_total"] / agg["off_plays"]

    pass_plays = plays[plays["play_type"] == "pass"].groupby(
        ["game_id", "posteam"], observed=True
    )
    rush_plays = plays[plays["play_type"] == "run"].groupby(
        ["game_id", "posteam"], observed=True
    )
    agg = agg.merge(
        pd.DataFrame(
            {"pass_epa": pass_plays["epa"].mean(), "pass_plays": pass_plays.size()}
        ).reset_index(),
        on=["game_id", "posteam"],
        how="left",
    ).merge(
        pd.DataFrame(
            {"rush_epa": rush_plays["epa"].mean(), "rush_plays": rush_plays.size()}
        ).reset_index(),
        on=["game_id", "posteam"],
        how="left",
    )

    agg = agg.rename(columns={"posteam": "team"})
    return agg


def build_team_games(
    paths: Paths, first_season: int, last_season: int, games: pd.DataFrame | None = None
) -> pd.DataFrame:
    """Tabla equipo-partido: dos filas por partido, ataque propio y del rival.

    La fila del equipo lleva su ataque (`off_*`) y, como `def_*`, el ataque que
    le hizo el rival. Un `def_epa` **alto** significa defensa permisiva. Ese
    signo se mantiene en todo el proyecto, incluido `ratings.py`; invertirlo
    "porque suena mejor" ya costó una sesión de depuración.
    """
    games = games if games is not None else pd.read_parquet(paths.games)

    frames = []
    for season in range(first_season, last_season + 1):
        path = paths.raw / f"pbp_{season}.parquet"
        if not path.exists():
            continue
        frames.append(_aggregate_pbp_season(path))
    if not frames:
        raise FileNotFoundError(
            f"No hay play-by-play en {paths.raw}. Ejecuta `oracle refresh` primero."
        )
    offense = pd.concat(frames, ignore_index=True)

    long = games.melt(
        id_vars=["game_id", "season", "week", "gameday", "game_type", "neutral_site", "played"],
        value_vars=["home_team", "away_team"],
        var_name="side",
        value_name="team",
    )
    long["is_home"] = (long["side"] == "home_team").astype(int)
    long = long.merge(
        games[["game_id", "home_team", "away_team", "home_score", "away_score"]],
        on="game_id",
        how="left",
    )
    long["opponent"] = np.where(long["is_home"] == 1, long["away_team"], long["home_team"])
    long["points_for"] = np.where(long["is_home"] == 1, long["home_score"], long["away_score"])
    long["points_against"] = np.where(long["is_home"] == 1, long["away_score"], long["home_score"])
    long["margin"] = long["points_for"] - long["points_against"]
    long = long.drop(columns=["side", "home_team", "away_team", "home_score", "away_score"])

    merged = long.merge(offense, on=["game_id", "team"], how="left")
    # El "rating defensivo" de un equipo es el ataque que concedió: se toma la
    # fila del rival en el mismo partido.
    opponent_offense = offense.rename(columns={"team": "opponent"})
    defensive_cols = {
        c: f"def_{c.removeprefix('off_')}" if c.startswith("off_") else f"def_{c}"
        for c in opponent_offense.columns
        if c not in ("game_id", "opponent")
    }
    merged = merged.merge(
        opponent_offense.rename(columns=defensive_cols),
        on=["game_id", "opponent"],
        how="left",
    )

    return merged.sort_values(["gameday", "game_id", "is_home"], kind="mergesort").reset_index(
        drop=True
    )


# --------------------------------------------------------------------------
# Estadística semanal de jugadores (fantasy)
# --------------------------------------------------------------------------

def build_player_weeks(paths: Paths, first_season: int, last_season: int) -> pd.DataFrame:
    """Estadística por jugador y semana, con el equipo normalizado."""
    frames = []
    for season in range(first_season, last_season + 1):
        path = paths.raw / f"player_stats_{season}.parquet"
        if not path.exists():
            continue
        stats = pd.read_parquet(path)
        stats["season"] = season
        frames.append(stats)
    if not frames:
        raise FileNotFoundError(
            f"No hay estadística de jugadores en {paths.raw}. Ejecuta `oracle refresh`."
        )
    players = pd.concat(frames, ignore_index=True)

    team_col = "recent_team" if "recent_team" in players.columns else "team"
    players["team"] = normalize_team_series(players[team_col])
    players = players.dropna(subset=["team"])
    if "position" in players.columns:
        players["position"] = players["position"].astype(str).str.upper()

    # Los ceros que nunca fueron ceros pasan a nulos aquí, lo más arriba
    # posible. nflverse entrega `targets` como 0 —no como nulo— en 2003-2008,
    # que es cuando esa marcación no está en su fuente: 20.657 filas con más
    # recepciones que objetivos, imposible en un partido de verdad.
    #
    # Un nulo se ve; un cero no. Pasa por `fillna(0)`, sobrevive a `dropna()` y
    # sale convertido en una cuota del 0%. Ver `coverage.py` para la regla
    # general que los detecta, que no está escrita contra esas seis temporadas
    # concretas sino contra la implicación que las delata.
    players = blank_gaps(players)
    return players.reset_index(drop=True)
