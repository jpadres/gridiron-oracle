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

from ..data.ingest import normalize_team

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


def full_name_key(name: str) -> str:
    """Clave del nombre COMPLETO: «Bijan Robinson» y «Brian Robinson Jr.» son distintas.

    `player_key` reduce los dos a «b.robinson» a propósito, porque el formato
    abreviado de nflverse no da más. Pero el board lleva `player_full_name`
    desde agosto de 2026 exactamente para esto, y cuando las DOS partes tienen
    el nombre entero, tirarlo para comparar iniciales es cómo Bijan (#2 del
    consenso) acabó emparejado con Brian (#318 del board): «el consenso sube a
    Robinson 316 puestos», sobre el Robinson equivocado.
    """
    tokens = [token for token in re.split(r"\s+", name.strip()) if token]
    while len(tokens) > 1 and _fold(tokens[-1]) in _SUFFIXES:
        tokens.pop()
    return " ".join(_fold(token) for token in tokens)


def _is_abbreviated(name: str) -> bool:
    """«J.Burrow» sí; «Joe Burrow» no. Lo abreviado no puede decir el nombre."""
    return bool(re.match(r"^[A-Za-z]\.\s*\S", name.strip()))


def build_index(players: Iterable[dict]) -> dict[tuple[str, str], list[tuple[str | None, str]]]:
    """Índice (clave, equipo) -> [(nombre completo o None, player_id), ...].

    Se guardan TODOS los que comparten clave y equipo, no el último: un
    diccionario que se queda con uno convierte una colisión en un emparejamiento
    equivocado que no falla. Bijan y Brian Robinson, los dos «B.Robinson» de
    ATL, ya costaron «el consenso sube a Robinson 316 puestos» sobre el Robinson
    equivocado — y ese arreglo vivía sólo en el consenso: `resolve`, que cuelga
    la PRENSA de las filas, seguía devolviendo al último indexado. Se cazó con
    los fixtures adversarios de `tests/test_identity_redteam.py`.
    """
    index: dict[tuple[str, str], list[tuple[str | None, str]]] = {}
    for player in players:
        key = player_key(str(player.get("player_name", "")))
        team = normalize_team(player.get("team")) or ""
        if not key or not team:
            continue
        full = str(player.get("player_full_name") or "").strip()
        index.setdefault((key, team), []).append(
            (full_name_key(full) if full else None, str(player.get("player_id", "")))
        )
    return index


def _pick(name: str, candidates: list[tuple[str | None, str]]) -> str | None:
    """Uno, o ninguno. Nunca «el primero que haya».

      · Nombre completo en la nota y en el board: tienen que ser el MISMO nombre
        completo. Dos apellidos iguales con nombre distinto no son la misma
        persona aunque la clave abreviada coincida.
      · Nombre completo en la nota y el board sin él: vale la clave abreviada
        sólo si es única en ese equipo.
      · Nota abreviada («B.Robinson»): sólo si la clave es única. Con dos, no
        hay forma de saber cuál, y elegir es peor que callar.
    """
    if not candidates:
        return None
    if _is_abbreviated(name):
        return candidates[0][1] if len(candidates) == 1 else None
    wanted = full_name_key(name)
    exact = [pid for full, pid in candidates if full == wanted]
    if len(exact) == 1:
        return exact[0]
    if exact:
        return None
    # Ningún nombre completo coincide. Si alguno del board SÍ tiene nombre
    # completo y es otro, no es él; sólo los que no lo tienen pueden serlo.
    unnamed = [pid for full, pid in candidates if full is None]
    named_other = [pid for full, pid in candidates if full is not None]
    if named_other and not unnamed:
        return None
    return unnamed[0] if len(unnamed) == 1 and not named_other else None


def resolve(names: Iterable[str], team: str, index: dict) -> list[str]:
    """`player_id` de los nombres citados en una noticia de ese equipo.

    Los que no aparecen en el ranking se descartan en silencio: la mayoría de las
    noticias hablan de jugadores que el modelo no clasifica (defensas, suplentes,
    liniero ofensivo), y eso no es un error. Los AMBIGUOS también se descartan,
    y eso tampoco lo es: ver `_pick`.
    """
    team = normalize_team(team) or ""
    if not team:
        return []
    resolved = []
    for name in names:
        name = str(name)
        player_id = _pick(name, index.get((player_key(name), team), []))
        if player_id and player_id not in resolved:
            resolved.append(player_id)
    return resolved


def attach(notes: list[dict], players: Iterable[dict]) -> list[dict]:
    """Añade `player_ids` a cada nota. Devuelve la misma lista, mutada."""
    index = build_index(players)
    for note in notes:
        note["player_ids"] = resolve(note.get("players", []), note.get("team", ""), index)
    return notes
