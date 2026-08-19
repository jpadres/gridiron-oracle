"""Dossier curado: parte médico, campamento y quién cubre cada equipo.

## Por qué es un dataset aparte y no fichas de research

Las fichas de `research.py` **exigen enlace**. Esa regla existe porque las
escribe un modelo de lenguaje, y sin una URL comprobable una ficha es una
afirmación sobre la NFL firmada por una máquina — justo lo que este proyecto no
publica.

El dossier es otra cosa: viene atribuido a un periodista con nombre, medio y
fecha, pero **sin enlace**. Meterlo por el mismo tubo obligaría a relajar la
regla del enlace, y una garantía que se relaja para que quepa el dato nuevo deja
de ser una garantía. Así que va por su lado, con su propio contrato —atribución
y fecha en vez de URL— y la web lo dice donde se enseña.

## Lo que significan las etiquetas

`Nivel` mide **disponibilidad, no gravedad clínica**. Lo que decide una
alineación no es lo fea que suene la lesión: es si juega. Y la etiqueta la pone
quien compiló el dossier leyendo la cita, no un diagnóstico médico.

`Sustancia` separa el reporte de campamento que dice algo del que rellena. Los
reportes de campamento son de los datos menos predictivos que hay en este
deporte, y por eso el nivel va delante y no escondido.

**Nada de esto entra en el modelo**, igual que el research. Se enseña al lado.
"""

from __future__ import annotations

from oracle.narrative import matching

# Disponibilidad, de menos a más disponible. El orden es el de lectura: lo
# primero que quieres ver de una lista es quién no juega.
LEVELS = ("FUERA", "DUDA", "SEGUIR")

# Cuánto pesa un reporte de campamento. `alta` es una cita de un entrenador o un
# cambio confirmado de papel; `baja` es un elogio suelto en agosto.
SUBSTANCE = ("alta", "media", "baja")


def normalise_level(value: object) -> str:
    text = str(value or "").strip().upper()
    return text if text in LEVELS else "SEGUIR"


def normalise_substance(value: object) -> str:
    text = str(value or "").strip().lower()
    return text if text in SUBSTANCE else "baja"


def attach_players(entries: list[dict], players: list[dict]) -> list[dict]:
    """Cuelga cada entrada del `player_id` del ranking, si lo hay.

    Sin esto el dossier es un documento aparte; con esto, la fila de un jugador
    en el ranking puede decir que está en duda — que es lo único que el modelo
    no puede saber y más cambia una alineación.
    """
    index = matching.build_index(players)
    for entry in entries:
        found = matching.resolve([entry.get("player", "")], entry.get("team", ""), index)
        entry["player_id"] = found[0] if found else None
    return entries


def availability_by_player(dossier: dict | None) -> dict[str, dict]:
    """Índice `player_id` -> peor situación médica conocida.

    Peor y no la más reciente: si un jugador arrastra dos avisos y uno dice
    FUERA, lo que importa para alinear es el FUERA aunque el otro sea de ayer.
    """
    if not dossier:
        return {}
    worst: dict[str, dict] = {}
    for entry in dossier.get("medical", []):
        player_id = entry.get("player_id")
        if not player_id:
            continue
        current = worst.get(player_id)
        if current is None or LEVELS.index(entry["level"]) < LEVELS.index(current["level"]):
            worst[player_id] = entry
    return worst


def summary(dossier: dict | None) -> dict:
    """Cuentas para la cabecera de la página. Vacío si no hay dossier."""
    if not dossier:
        return {}
    medical = dossier.get("medical", [])
    camp = dossier.get("camp", [])
    return {
        "medical": len(medical),
        "out": sum(1 for entry in medical if entry["level"] == "FUERA"),
        "doubt": sum(1 for entry in medical if entry["level"] == "DUDA"),
        "camp": len(camp),
        "camp_high": sum(1 for entry in camp if entry["substance"] == "alta"),
        "reporters": len(dossier.get("reporters", [])),
        "teams": len({entry["team"] for entry in medical}),
    }


def consensus_gap(board: list[dict], consensus: list[dict]) -> list[dict]:
    """Dónde el board propio se separa del consenso de expertos.

    **Esto es lo único que un board propio aporta sobre uno comprado.** Coincidir
    con el consenso no informa: si los dos dicen lo mismo, daba igual cuál
    mirases. La información está en el desacuerdo, y por eso la diferencia va
    ordenada por tamaño y en las dos direcciones.

    Ojo con la asimetría de la lista: el consenso trae 200 nombres y el board 250,
    así que un jugador puede estar en uno y no en el otro. Los que **no** están en
    el consenso son el caso más interesante y el más peligroso a la vez: o el
    consenso se ha dejado a alguien, o el modelo está proyectando a un jugador que
    nadie más considera draftable — que suele significar que le falta un dato.
    """
    # Claves que apuntan a más de un jugador. **Se descartan, no se resuelven.**
    #
    # Bijan Robinson y Brian Robinson Jr. juegan los dos en Atlanta y los dos son
    # «B.Robinson» — el formato abreviado de nflverse no los distingue, así que
    # el modelo tampoco. Quedarse con el último de la lista daba «el modelo sube
    # a Bijan 139 puestos sobre el consenso», que es una afirmación fuerte,
    # llamativa y posiblemente sobre el jugador equivocado. Es la misma lección
    # de los varios «M.Williams» de la liga, esta vez con consecuencias.
    seen: dict[tuple[str, str], object] = {}
    collisions: set[tuple[str, str]] = set()
    for entry in consensus:
        key = matching.player_key(entry.get("player", ""))
        if not key or not entry.get("rank"):
            continue
        pair = (key, entry.get("team", ""))
        if pair in seen:
            collisions.add(pair)
        seen[pair] = entry
    ranked = {pair: entry for pair, entry in seen.items() if pair not in collisions}

    rows = []
    for player in board:
        key = matching.player_key(str(player.get("player_name", "")))
        team = str(player.get("team", ""))
        entry = ranked.get((key, team))
        if entry is None:
            continue
        gap = int(entry["rank"]) - int(player["overall_rank"])
        rows.append({
            "player_id": player.get("player_id"),
            "player_name": player.get("player_name"),
            "position": player.get("position"),
            "team": team,
            "model_rank": int(player["overall_rank"]),
            "consensus_rank": int(entry["rank"]),
            # Positivo = el modelo lo sube respecto al consenso.
            "gap": gap,
            "analysis": entry.get("analysis", ""),
            "consensus_risk": entry.get("risk", ""),
            "risk_label": player.get("risk_label"),
        })
    rows.sort(key=lambda row: -row["gap"])
    return rows


def ambiguous_names(consensus: list[dict]) -> list[list[str]]:
    """Grupos de jugadores que comparten clave y equipo, y por eso no se emparejan.

    Se publican por nombre: que el lector sepa exactamente a quién no se está
    comparando es mejor que un número que quizá sea de otro.
    """
    groups: dict[tuple[str, str], list[str]] = {}
    for entry in consensus:
        key = matching.player_key(entry.get("player", ""))
        if not key:
            continue
        groups.setdefault((key, entry.get("team", "")), []).append(entry.get("player", ""))
    return [sorted(names) for names in groups.values() if len(names) > 1]


def unranked_by_consensus(board: list[dict], consensus: list[dict], limit: int = 40) -> list[dict]:
    """Jugadores altos en el board que el consenso ni siquiera lista."""
    keys = {
        (matching.player_key(e.get("player", "")), e.get("team", "")) for e in consensus
    }
    out = []
    for player in board[:limit]:
        key = (matching.player_key(str(player.get("player_name", ""))), str(player.get("team", "")))
        if key not in keys:
            out.append(player)
    return out
