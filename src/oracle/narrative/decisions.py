"""Por qué cambió una recomendación. Registro de sólo añadir.

## El problema que resuelve

Un ranking que cambia sin explicación es un ranking en el que no se puede
confiar: si el lunes un jugador estaba el 28 y el martes el 17, la pregunta
inmediata es «¿por qué?», y si la respuesta es «el modelo lo recalculó» no es una
respuesta. Peor: hace imposible distinguir una mejora real de un bug.

Cada línea es un cambio con su causa: qué noticia lo provocó, qué se movió, y de
cuánto a cuánto.

## Por qué JSONL y no JSON

Un fichero JSON hay que leerlo entero, modificarlo y reescribirlo. Dos procesos
haciendo eso a la vez —el workflow diario y un script lanzado a mano— se pisan y
uno pierde su escritura, en silencio. Con JSONL cada evento es una línea que se
añade al final: se escribe con `a`, no hay lectura previa, y no hay carrera.

También hace que el fichero crezca sin volverse lento de escribir, que importa
cuando en game day pueden entrar cincuenta cambios en veinte minutos.

## Lo que NO es

No es un log de aplicación. Aquí sólo entra lo que cambia una **recomendación**
que el dueño podría haber leído. Un recálculo que deja todo igual no se registra:
un registro que se llena de no-eventos deja de leerse, que es la misma razón por
la que un aviso que sale en los 250 jugadores del board no informa de nada.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FILENAME = "decisions.jsonl"


def log_path(root: Path) -> Path:
    return Path(root) / "research" / FILENAME


def record(
    root: Path,
    *,
    event: str,
    surface: str,
    subject: str,
    changes: list[dict[str, Any]],
    source_url: str | None = None,
    at: datetime | None = None,
) -> None:
    """Añade un cambio al registro.

    - `event`: qué lo provocó. «RB1 OUT», «parte oficial», «recálculo semanal».
    - `surface`: qué sección cambió. «weekly_rankings», «start_sit», «survivor».
    - `subject`: sobre quién o qué. Un `player_id`, un equipo, un `game_id`.
    - `changes`: lista de `{"field", "before", "after"}`. Vacía = no se escribe.
    - `source_url`: el enlace que lo justifica, si lo hay.

    Sin `changes` no hay línea. Es deliberado: obliga a que quien registre haya
    calculado de verdad qué se movió, en vez de dejar constancia de que «algo
    pasó», que no sirve para responder «¿por qué cambió esto?».
    """
    if not changes:
        return

    path = log_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "at": (at or datetime.now(UTC)).isoformat(),
        "event": event,
        "surface": surface,
        "subject": subject,
        "changes": changes,
        "source_url": source_url,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read(root: Path, *, subject: str | None = None, limit: int = 200) -> list[dict]:
    """Los cambios más recientes primero, opcionalmente sobre un sujeto.

    Filtrar por sujeto es lo que permite responder «¿por qué subió este jugador?»
    sin leer el registro entero.
    """
    path = log_path(root)
    if not path.exists():
        return []

    entries = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            # Una línea corrupta —un proceso muerto a media escritura— no puede
            # llevarse por delante el resto del registro.
            continue
        if subject is None or entry.get("subject") == subject:
            entries.append(entry)

    entries.sort(key=lambda item: item.get("at", ""), reverse=True)
    return entries[:limit]
