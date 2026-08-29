"""Lo que el sistema recomendó ANTES del kickoff, congelado.

## Por qué esto tiene que ser inmutable de verdad

El postmortem compara «lo que creíamos» con «lo que pasó». Si la snapshot se
puede regenerar después del partido, la comparación no vale nada: es demasiado
fácil, y demasiado humano, volver a generar «lo que creíamos» cuando ya sabes el
resultado. No hace falta mala fe — basta con relanzar un script.

Por eso `save` **falla** si la snapshot ya existe, en vez de sobrescribirla. Es
la única garantía técnica que separa un registro histórico de una opinión
retroactiva, y es la razón por la que este módulo existe en vez de ser dos líneas
dentro del script semanal.

Sobrescribir requiere borrar el fichero a mano. Que cueste es el punto.

## Qué se guarda

Todo lo que es una **recomendación** y por tanto se puede acertar o fallar:
rankings semanales, alineaciones sugeridas, waivers, pick de survivor, apuestas y
las proyecciones que las sostienen. No se guarda lo que es un hecho —el
calendario, las plantillas—, que se puede recuperar de la fuente.

`snapshots/` se versiona, igual que `research/` y por el mismo motivo: son
kilobytes que no se pueden reconstruir. Un backtest se recalcula; lo que
recomendaste el domingo a las 12:55, no.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DIRECTORY = "snapshots"


class SnapshotExists(RuntimeError):
    """Ya existe una snapshot para esa semana y ese tipo.

    No se sobrescribe. Si de verdad hay que rehacerla —un error de datos
    detectado antes del kickoff— hay que borrar el fichero explícitamente, y eso
    deja rastro en el historial de git.
    """


def snapshot_dir(root: Path, season: int, week: int) -> Path:
    return Path(root) / DIRECTORY / f"{season}-w{week:02d}"


def save(
    root: Path,
    season: int,
    week: int,
    kind: str,
    payload: Any,
    *,
    taken_at: datetime | None = None,
) -> Path:
    """Congela una recomendación. Falla si ya existe.

    `kind` es qué se está congelando: "rankings", "lineups", "survivor",
    "bets"... Un fichero por tipo, para poder añadir uno nuevo sin tocar los que
    ya están escritos.
    """
    directory = snapshot_dir(root, season, week)
    path = directory / f"{kind}.json"
    if path.exists():
        raise SnapshotExists(
            f"{path} ya existe. Una snapshot no se sobrescribe: es el registro de "
            f"lo que se recomendó antes del partido. Bórrala a mano si de verdad "
            f"hace falta rehacerla."
        )

    directory.mkdir(parents=True, exist_ok=True)
    stamp = (taken_at or datetime.now(UTC)).isoformat()
    document = {
        "season": season,
        "week": week,
        "kind": kind,
        # El instante SÍ va aquí, al revés que en el payload de la web.
        #
        # En `out/research.json` un reloj de pared hacía que el fichero
        # comprimido cambiase cada día aunque el contenido fuese idéntico, y se
        # quitó. Aquí es justo lo contrario: sin saber cuándo se tomó, la
        # snapshot no sirve para medir si se tomó antes o después del kickoff,
        # que es toda su razón de ser.
        "taken_at": stamp,
        "payload": payload,
    }
    path.write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def load(root: Path, season: int, week: int, kind: str) -> dict | None:
    path = snapshot_dir(root, season, week) / f"{kind}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def available(root: Path) -> list[tuple[int, int]]:
    """Las semanas con alguna snapshot, ordenadas."""
    base = Path(root) / DIRECTORY
    if not base.exists():
        return []
    weeks = []
    for entry in base.iterdir():
        if not entry.is_dir() or "-w" not in entry.name:
            continue
        season, _, week = entry.name.partition("-w")
        try:
            weeks.append((int(season), int(week)))
        except ValueError:
            continue
    return sorted(weeks)
