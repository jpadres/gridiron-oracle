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
