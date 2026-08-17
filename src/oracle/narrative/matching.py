"""Emparejar nombres de prensa con nombres de nflverse.

nflverse escribe «J.Burrow»; ESPN escribe «Joe Burrow»; alguien escribirá «Joe
Burrow Jr.» o «Amon-Ra St. Brown». Sin esto, las notas de prensa no se pueden
colgar de la fila del jugador en el ranking y quedan como un muro de texto suelto
al lado de una tabla.

La clave es `inicial.apellido` normalizado, porque es lo máximo que da el formato
de nflverse. Eso hace que **colisionen** dos jugadores con la misma inicial y
apellido (hay varios «M.Williams» en la liga), y por eso el emparejamiento pide
el equipo: sin equipo no se asigna. Un fallo aquí no es cosmético — colgarle a un
receptor la noticia de la lesión de otro es peor que no colgar nada.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

# Sufijos generacionales. No forman parte del apellido en nflverse.
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _fold(text: str) -> str:
    """Minúsculas sin acentos ni puntuación. «St. Brown» -> «stbrown»."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]", "", stripped.lower())


def player_key(name: str) -> str:
    """Clave `inicial.apellido` de un nombre en cualquiera de los dos formatos.

    «Joe Burrow» y «J.Burrow» dan la misma clave. «Amon-Ra St. Brown» y
    «A.St. Brown» también, que es el caso que rompe la versión ingenua de
    quedarse con la última palabra.
    """
    name = name.strip()
    if not name:
        return ""

    # Formato nflverse: una inicial, un punto, y el resto es apellido.
    match = re.match(r"^([A-Za-z])\.\s*(.+)$", name)
    if match:
        return f"{match.group(1).lower()}.{_fold(match.group(2))}"

    tokens = [token for token in re.split(r"\s+", name) if token]
    while len(tokens) > 1 and _fold(tokens[-1]) in _SUFFIXES:
        tokens.pop()
    if len(tokens) == 1:
        return _fold(tokens[0])
    initial = _fold(tokens[0])[:1]
    return f"{initial}.{_fold(' '.join(tokens[1:]))}"


def build_index(players: Iterable[dict]) -> dict[tuple[str, str], str]:
    """Índice (clave, equipo) -> player_id a partir de las filas del ranking."""
    index: dict[tuple[str, str], str] = {}
    for player in players:
        key = player_key(str(player.get("player_name", "")))
        team = str(player.get("team", "")).upper()
        if key and team:
            index[(key, team)] = str(player.get("player_id", ""))
    return index


def resolve(names: Iterable[str], team: str, index: dict[tuple[str, str], str]) -> list[str]:
    """`player_id` de los nombres citados en una noticia de ese equipo.

    Los que no aparecen en el ranking se descartan en silencio: la mayoría de las
    noticias hablan de jugadores que el modelo no clasifica (defensas, suplentes,
    liniero ofensivo), y eso no es un error.
    """
    team = str(team or "").upper()
    if not team:
        return []
    resolved = []
    for name in names:
        player_id = index.get((player_key(str(name)), team))
        if player_id and player_id not in resolved:
            resolved.append(player_id)
    return resolved


def attach(notes: list[dict], players: Iterable[dict]) -> list[dict]:
    """Añade `player_ids` a cada nota. Devuelve la misma lista, mutada."""
    index = build_index(players)
    for note in notes:
        note["player_ids"] = resolve(note.get("players", []), note.get("team", ""), index)
    return notes
