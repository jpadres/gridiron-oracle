"""Archivo diario de las notas de research.

Un fichero por día en `research/`, y **sí se versiona** — al revés que los datos
del modelo, que son 490 MB regenerables. Aquí son unos kilobytes de texto que no
se pueden reconstruir: si mañana se cae el enlace o el medio reescribe la nota,
lo que se publicó hoy sólo existe si se guardó hoy.

Tener el histórico también es lo que hace posible que el barrido diario sepa qué
ya contó. Sin memoria, el trabajo de cada día empieza repitiendo el del anterior.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from .schema import SCHEMA_VERSION, migrate_item

DIRECTORY = "research"


def archive_dir(root: Path) -> Path:
    return Path(root) / DIRECTORY


def day_file(root: Path, day: date) -> Path:
    return archive_dir(root) / f"{day.isoformat()}.json"


def save_day(root: Path, day: date, items: list[dict], meta: dict | None = None) -> Path:
    """Escribe el barrido del día. Sobrescribe si ya existe.

    Que sea idempotente importa: si el workflow falla a mitad y se relanza, el
    resultado es el mismo fichero, no dos.
    """
    directory = archive_dir(root)
    directory.mkdir(parents=True, exist_ok=True)
    path = day_file(root, day)
    payload = {
        "date": day.isoformat(),
        "schema_version": SCHEMA_VERSION,
        "items": items,
        **(meta or {}),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def load_day(root: Path, day: date) -> list[dict]:
    path = day_file(root, day)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    items = payload.get("items", [])
    for item in items:
        item.setdefault("date", payload.get("date", day.isoformat()))
    # La migración ocurre al LEER, nunca al guardar.
    #
    # Los ficheros de `research/` no se reescriben: lo que se publicó el 17 de
    # agosto se queda en disco tal como se publicó. Son unos kilobytes que no se
    # pueden reconstruir, y una migración que reescribe es irreversible si está
    # mal; ésta se corrige cambiando una función.
    return [migrate_item(item) for item in items]


def load_window(root: Path, days: int, today: date | None = None) -> list[dict]:
    """Los ítems de los últimos `days` días, del más reciente al más antiguo.

    Se recorren fechas y no el listado del directorio a propósito: así una
    ventana de 7 días son 7 días de calendario aunque falten ficheros, y no «los
    7 últimos ficheros que haya», que en un repo con huecos significa otra cosa.
    """
    today = today or date.today()
    out: list[dict] = []
    for offset in range(days):
        out.extend(load_day(root, today - timedelta(days=offset)))
    return out


def known_headlines(root: Path, days: int, today: date | None = None) -> list[str]:
    """Titulares recientes, para que el barrido de hoy no los repita."""
    return [item.get("headline", "") for item in load_window(root, days, today) if item.get("headline")]


def consolidate(
    root: Path,
    *,
    days: int,
    today: date | None = None,
    players: list[dict] | None = None,
    limit: int = 60,
) -> dict | None:
    """La ventana lista para publicar: ordenada, enlazada a los jugadores y recortada.

    Vive aquí y no en el script del barrido porque hacen falta dos: el barrido
    diario la escribe, y la regeneración semanal del payload la reconstruye
    desde el archivo. Sin esta segunda vía, cada miércoles la sección de prensa
    desaparecería de la web hasta el barrido del día siguiente — `out/` no se
    versiona, así que en un checkout limpio no hay nada que leer.
    """
    from oracle.narrative import matching

    items = load_window(root, days, today)
    if not items:
        return None
    matching.attach(items, players or [])
    items.sort(
        key=lambda item: (item.get("date", ""), item.get("fantasy_relevance", 1)), reverse=True
    )
    publicados, cobertura = _con_cobertura_por_equipo(items, limit)
    return {
        "window_days": days,
        "total": len(items),
        "items": publicados,
        # Los DOS números, porque no son el mismo: cuántos clubes nombra lo que
        # se publica y cuántos nombra la ventana entera. Si no coinciden, la
        # pantalla puede decirlo en vez de dejar creer que son los 32.
        "teams_covered": len(cobertura["publicados"]),
        "teams_in_window": len(cobertura["ventana"]),
        "primary_limit": limit,
    }


def _equipos_de(item: dict) -> set[str]:
    """Los clubes que una ficha nombra, NORMALIZADOS. Una ficha puede nombrar varios.

    Por `normalize_team` por lo de siempre: el dossier curado escribe `LA` donde
    los feeds escriben `LAR`, así que la primera versión de este conteo publicó
    «33 de 33» con 32 clubes en la liga — los Rams contados dos veces, y una
    ficha de ellos añadida como si fuera de un club sin cubrir. Es el `AZ`/`ARI`
    de la tabla de errores, otra vez, y otra vez comparando dos fuentes que uno
    creía iguales.
    """
    from oracle.data.ingest import normalize_team

    v = item.get("team")
    crudos = [v] if isinstance(v, str) else (v if isinstance(v, list) else [])
    return {
        normalize_team(x) for x in crudos
        if isinstance(x, str) and x and normalize_team(x)
    }


def _con_cobertura_por_equipo(items: list[dict], limit: int) -> tuple[list[dict], dict]:
    """Los `limit` primeros por el orden de siempre, MÁS un hueco por club que falte.

        LA INGESTA CUBRÍA LOS 32 CLUBES Y LA PANTALLA ENSEÑABA 23.

    El recorte a 60 por (fecha, relevancia) es correcto para «lo último» y
    pierde a los clubes de los que no se ha publicado nada reciente: medido el
    7 de octubre de 2026, los feeds traían 2.112 entradas con 32 de 32 equipos
    y la sección publicada nombraba 23. Es el dato computado que no llega a la
    pantalla, por sexta vez en este repositorio.

    No se reordena nada ni se cambia el criterio: los `limit` primeros son
    exactamente los de antes —así que nada de lo que se publicaba deja de
    publicarse— y detrás se añade la ficha MÁS NUEVA de cada club que no
    aparezca ya. El orden sigue siendo un hecho (fecha), no un juicio: un feed
    no sabe lo que significa su nota (regla 8) y aquí no se le inventa ninguna.
    """
    principales = items[:limit]
    ya = set()
    for item in principales:
        ya |= _equipos_de(item)
    extra = []
    for item in items[limit:]:
        nuevos = _equipos_de(item) - ya
        if not nuevos:
            continue
        # `items` ya viene ordenado por fecha, así que la primera que aparece de
        # un club es la más nueva que hay de él.
        extra.append(item)
        ya |= nuevos
    ventana = set()
    for item in items:
        ventana |= _equipos_de(item)
    return principales + extra, {"publicados": ya, "ventana": ventana}
