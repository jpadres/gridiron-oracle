"""Today's Intelligence: sólo lo que puede cambiar una decisión.

## El criterio

Esto no es un feed de noticias. Un feed enseña todo lo que pasó; esto enseña lo
que **cambia algo que tú harías distinto**. Son objetivos opuestos: cuanto más
completo sea un feed, mejor cumple; cuanto más completo sea esto, peor.

El filtro por defecto es duro a propósito. Si un día no hay nada, se dice que no
hay nada — igual que la página de apuestas dice que ninguna supera el umbral en
vez de bajar el umbral hasta que salga algo.

## La ordenación, y el hueco que deja preparada

El orden es una tupla de cuatro claves, en este orden de prioridad:

1. **user_impact** — si el jugador es tuyo, si está libre en tu liga, si es tu
   pick de survivor. Todavía no existe: hace falta la sincronización multi-liga.
2. **actionability** — si el insight cambia una alineación o sólo da contexto.
3. **recency** — lo de hoy antes que lo de anteayer.
4. **source confidence** — un hecho oficial antes que una opinión.

Las dos primeras devuelven `None` hoy y la tupla las trata como neutras. Eso es
deliberado: **cuando existan, se rellenan dos funciones y el orden cambia solo**,
sin tocar el componente ni la página. Diseñar el orden completo desde el
principio cuesta unas líneas; añadirlo después obliga a rehacer el criterio.
"""

from __future__ import annotations

from typing import Any

# Las categorías que se enseñan, derivadas de lo que la ficha ya trae. Las
# claves son las del esquema (datos); las etiquetas se pintan, así que van en
# inglés como el resto de la interfaz. No se
# añade un campo nuevo: `kind` e `impact` juntos ya distinguen estos casos, y un
# campo más sería otra cosa que el modelo puede rellenar mal.
CATEGORIES: dict[str, dict[str, str]] = {
    "lesion_baja": {"icon": "🚨", "label": "Injury"},
    "lesion_alza": {"icon": "🏥", "label": "Returning"},
    "rol_alza": {"icon": "📈", "label": "Bigger role"},
    "rol_baja": {"icon": "📉", "label": "Smaller role"},
    "depth_chart": {"icon": "🔄", "label": "Depth chart"},
    "breakout": {"icon": "🔥", "label": "Breakout"},
    "uso": {"icon": "⚠️", "label": "Usage risk"},
    "waiver": {"icon": "🎯", "label": "Waiver"},
    "apuestas": {"icon": "💰", "label": "Betting"},
    "survivor": {"icon": "🏆", "label": "Survivor"},
    "otro": {"icon": "•", "label": "Context"},
}

# Por debajo de esto no se enseña. 4 sobre 5 es «cambia una alineación esta
# semana», que es literalmente la definición del campo en el esquema.
MIN_RELEVANCE = 4

# Cuánta procedencia pesa al desempatar. Un hecho oficial gana a una opinión
# cuando todo lo demás es igual.
EVIDENCE_WEIGHT = {
    "HECHO": 4, "REPORTADO": 3, "OBSERVADO": 2, "OPINION": 1, "MODELO": 1,
}


def categorise(item: dict[str, Any]) -> str:
    """La categoría visible de una ficha, a partir de lo que ya tiene."""
    kind = item.get("kind", "otro")
    impact = item.get("impact", "neutro")

    if kind == "lesion":
        return "lesion_alza" if impact == "alza" else "lesion_baja"
    if kind == "depth_chart":
        return "rol_alza" if impact == "alza" else "rol_baja" if impact == "baja" \
            else "depth_chart"
    if kind == "campamento":
        return "breakout" if impact == "alza" else "uso"
    # "roster" y "transaccion" son el mismo suceso con dos nombres: el esquema
    # declara "transaccion" y el barrido manual escribió "roster". Se aceptan los
    # dos en vez de normalizar el archivo, que es inmutable — y quedarse sólo con
    # el del esquema mandaba los siete traspasos de agosto a "Contexto", que es
    # justo donde no se miran.
    if kind in ("transaccion", "roster"):
        return "waiver"
    return "otro"


def user_impact(item: dict[str, Any]) -> int | None:
    """Cuánto te afecta A TI. Todavía no se puede saber.

    Necesita las plantillas de tus ligas, que llegan con la sincronización
    multi-liga. Devolver `None` en vez de `0` importa: un cero ordenaría como
    «no te afecta», y lo cierto es «no lo sabemos».
    """
    return None


def actionability(item: dict[str, Any]) -> int | None:
    """Cuánto se puede hacer con esto. Versión provisional.

    Hoy se apoya en `fantasy_relevance`, que ya mide algo parecido y hoy no se
    usa para nada. La versión completa mirará si el insight cruza alineación,
    waiver, ranking, trade, apuesta o survivor — y puede que entonces resulte que
    esto era lo mismo con otro nombre, en cuyo caso no habrá campo nuevo.
    """
    relevance = item.get("fantasy_relevance")
    return int(relevance) if isinstance(relevance, int) else None


def sort_key(item: dict[str, Any]) -> tuple:
    """La clave de orden completa, con los huecos futuros ya colocados.

    Se usa `-1` para lo desconocido, no `0`: así una ficha sin dato queda por
    debajo de una con dato bajo, en vez de empatar con ella.

    **Las claves NO se niegan.** La primera versión las negaba y además ordenaba
    con `reverse=True`, o sea dos veces: el resultado era que una relevancia de 4
    salía por encima de una de 5. El orden se lee mal sólo si te fijas, que es
    la peor clase de bug en una pantalla cuyo trabajo es poner lo importante
    arriba.
    """
    known_impact = user_impact(item)
    known_action = actionability(item)
    return (
        known_impact if known_impact is not None else -1,
        known_action if known_action is not None else -1,
        item.get("date", ""),
        EVIDENCE_WEIGHT.get(item.get("evidence_type"), 0),
    )


def todays(items: list[dict], *, limit: int = 12) -> list[dict]:
    """Lo que merece que mires hoy. Puede estar vacío, y eso es correcto."""
    relevant = [
        item for item in items
        if (item.get("fantasy_relevance") or 0) >= MIN_RELEVANCE
    ]
    ordered = sorted(relevant, key=sort_key, reverse=True)
    out = []
    for item in ordered[:limit]:
        category = categorise(item)
        out.append({**item, "category": category, **CATEGORIES[category]})
    return out
