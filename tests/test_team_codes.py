"""Códigos de equipo: que un alias no rompa un join en silencio.

Este fallo ya apareció dos veces en el proyecto —en el importador del dossier y
al leer las plantillas— y las dos veces del mismo modo: sin excepción, sin log,
simplemente una fila que no empareja con nada. Estos tests existen para que no
haya una tercera.
"""

from __future__ import annotations

import pandas as pd

from oracle.data.ingest import normalize_team
from oracle.leagues import sleeper
from oracle.narrative import matching, research

# Alias del MISMO equipo en el mismo sitio: sólo cambia cómo lo escribe la fuente.
ALIASES = {
    "AZ": "ARI", "ARZ": "ARI", "BLT": "BAL", "CLV": "CLE", "HST": "HOU",
    "JAC": "JAX", "LA": "LAR", "RAM": "LAR", "LVR": "LV", "RAI": "LV",
    "WSH": "WAS", "GNB": "GB", "KAN": "KC", "NWE": "NE", "NOR": "NO",
    "SFO": "SF", "TAM": "TB",
}

# Mudanzas de verdad: la franquicia se movió de ciudad. Se colapsan al código
# actual a propósito —es el mismo equipo y la misma historia de producción— pero
# NO son lo mismo que un alias, y conviene que el test lo diga: un partido de
# 2015 etiquetado LAR se jugó en San Luis.
RELOCATIONS = {
    "STL": "LAR",  # San Luis -> Los Ángeles, 2016
    "SL": "LAR",
    "SD": "LAC",   # San Diego -> Los Ángeles, 2017
    "SDG": "LAC",
    "OAK": "LV",   # Oakland -> Las Vegas, 2020
    "WFT": "WAS",  # cambio de nombre, no de ciudad
}


def test_every_alias_and_relocation_resolves():
    for source, canonical in {**ALIASES, **RELOCATIONS}.items():
        assert normalize_team(source) == canonical, source
        # Y en minúsculas y con espacios, que es como llegan de un feed.
        assert normalize_team(f" {source.lower()} ") == canonical


def test_an_unknown_code_returns_none_instead_of_propagating():
    """Devolver None permite contar y avisar arriba. Propagar la basura, no."""
    assert normalize_team("XYZ") is None
    assert normalize_team("") is None
    assert normalize_team(None) is None
    assert normalize_team(float("nan")) is None


def test_research_normalises_the_team_of_a_note():
    """Una ficha con "LA" tiene que quedar en LAR, o no empareja con nadie."""
    item = {
        "team": "LA",
        "players": ["P.Nacua"],
        "kind": "lesion",
        "headline": "h",
        "summary": "s",
        "impact": "baja",
        "confidence": "informado",
        "sources": [{"outlet": "o", "title": "t", "url": "https://x.com/a"}],
    }
    assert research._clean(item, "NFC Oeste")["team"] == "LAR"


def test_a_league_wide_note_keeps_its_sentinel():
    """"LIGA" no es un equipo y `normalize_team` lo rechazaría."""
    item = {
        "team": None, "players": [], "kind": "otro", "headline": "h", "summary": "s",
        "impact": "neutro", "confidence": "rumor",
        "sources": [{"outlet": "o", "title": "t", "url": "https://x.com/a"}],
    }
    assert research._clean(item, "Liga")["team"] == "LIGA"


def test_player_matching_survives_a_team_alias():
    """El índice se construye con LAR y la ficha llega con LA."""
    index = matching.build_index([
        {"player_id": "00-1", "player_name": "Puka Nacua", "team": "LAR"},
    ])
    # La ficha llega con el alias; el índice se construyó con el canónico.
    assert matching.resolve(["Puka Nacua"], "LA", index) == ["00-1"]


def test_a_sleeper_pick_with_la_matches_the_board():
    """El fallo más caro del modo draft.

    Sleeper escribe "LA" para los Rams en algunos sitios. Sin normalizar, el
    pick no empareja, el jugador se da por LIBRE y el tablero te lo recomienda
    cuando ya se lo llevaron.
    """
    picks = [{
        "player_id": "4034", "pick_no": 1, "round": 1, "roster_id": 2,
        "metadata": {"first_name": "Puka", "last_name": "Nacua",
                     "team": "LA", "position": "WR"},
    }]
    result = sleeper.picked_players(picks, {"4034": "00-1"})
    assert result["matched"][0]["team"] == "LAR"


def test_the_dataset_contains_no_unrecognised_codes():
    """Guardia sobre los datos reales, no sólo sobre la función.

    Si nflverse introduce un código nuevo, este test lo caza antes de que se
    convierta en filas que no emparejan con nada.
    """
    frame = pd.read_parquet(
        "data/processed/player_weeks.parquet", columns=["team"]
    ) if __import__("pathlib").Path("data/processed/player_weeks.parquet").exists() else None
    if frame is None:
        return  # el repo se clona sin datos; el test no aplica
    unknown = sorted({
        str(team) for team in frame["team"].dropna().unique()
        if normalize_team(team) is None
    })
    assert not unknown, f"códigos sin reconocer en player_weeks: {unknown}"
