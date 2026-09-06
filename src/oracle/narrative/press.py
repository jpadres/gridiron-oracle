"""Menciones de prensa por jugador, DETERMINISTAS y sin modelo.

    CONTAR UNA MENCIÓN NO ES JUZGARLA.

`research.py` clasifica, resume y puntúa relevancia, y para eso necesita
`ANTHROPIC_API_KEY`. Este módulo no hace nada de eso: coge las entradas que el
barrido determinista ya leyó (`research/feeds_latest.json`, que produce
`feed_harvest.py` donde sí hay salida a los medios) y dice qué jugadores del
board aparecen NOMBRADOS en ellas. Nada más.

Lo que publica es comprobable abriendo el enlace: medio, titular, URL y fecha
de PUBLICACIÓN. No inventa `fantasy_relevance`, ni `confidence`, ni una
categoría — eso son juicios, y un juicio fabricado con aritmética es
exactamente lo que la regla 9 prohíbe.

## Las dos reglas de identidad

1. **Nombre completo y único.** El board escribe el nombre abreviado de
   nflverse (`B.Robinson`), que no distingue a Bijan de Brian: por ahí no se
   empareja nunca. Se usa `player_full_name`, y si dos filas comparten nombre
   completo no se empareja NINGUNA — ante la duda no se empareja, que es la
   regla que ya costó «el modelo sube a Bijan 139 puestos».

2. **El equipo corrobora.** Un titular puede nombrar a un universitario que se
   llama igual; los feeds traen fútbol universitario. Así que la entrada tiene
   que venir del feed oficial de SU equipo o nombrar al equipo en el texto. Es
   un hecho comprobable, no una estimación de a quién se refiere.

## Frescura

Sólo entran entradas con `published_at`. `first_seen_at` es cuándo lo vio el
barrido y convertirlo en actualidad es la regla 5 rota — el fallo que este
repositorio ya cometió en `Briefs.jsx`, en `data_dates`, en `ingest.py` y en
`research.py`. Las entradas sin fecha se CUENTAN aparte y no se publican como
si fueran de hoy.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

from ..data.ingest import normalize_team

# Apodo del equipo tal y como lo escribe la prensa. Sirve para corroborar una
# mención cuando la entrada no viene de un feed de equipo. `SF` es «49ers» y el
# normalizador se come los dígitos, así que la clave que queda es «ers».
APODO = {
    "ARI": "cardinals", "ATL": "falcons", "BAL": "ravens", "BUF": "bills",
    "CAR": "panthers", "CHI": "bears", "CIN": "bengals", "CLE": "browns",
    "DAL": "cowboys", "DEN": "broncos", "DET": "lions", "GB": "packers",
    "HOU": "texans", "IND": "colts", "JAX": "jaguars", "KC": "chiefs",
    "LAC": "chargers", "LAR": "rams", "LV": "raiders", "MIA": "dolphins",
    "MIN": "vikings", "NE": "patriots", "NO": "saints", "NYG": "giants",
    "NYJ": "jets", "PHI": "eagles", "PIT": "steelers", "SEA": "seahawks",
    "SF": "ers", "TB": "buccaneers", "TEN": "titans", "WAS": "commanders",
}

# Por debajo de esto un «nombre» casa con cualquier cosa. «Ty Simpson» son 10
# caracteres ya normalizados; nadie del board baja de 9 con nombre y apellido.
MIN_NOMBRE = 9


def _clave(texto: object) -> str:
    plano = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", plano.lower())).strip()


def indice(rows: Iterable[dict]) -> dict[str, dict]:
    """Nombre completo normalizado -> fila, **sólo si es único**.

    Un nombre compartido por dos filas se cae del índice entero: no se queda
    con una ni se reparte entre las dos.
    """
    vistos: dict[str, list[dict]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        clave = _clave(row.get("player_full_name"))
        if len(clave) < MIN_NOMBRE or not row.get("player_id"):
            continue
        vistos.setdefault(clave, []).append(row)
    return {k: v[0] for k, v in vistos.items() if len(v) == 1}


def _corrobora(entrada: dict, equipo: str | None, texto: str) -> bool:
    """¿La entrada habla de ESE equipo? Feed oficial del equipo, o su apodo."""
    if not equipo:
        return False
    del_feed = normalize_team(entrada.get("team")) if entrada.get("team") else None
    if del_feed and del_feed == equipo:
        return True
    apodo = APODO.get(equipo)
    return bool(apodo and f" {apodo} " in texto)


def mentions(entries: Iterable[dict], rows: Iterable[dict]) -> dict[str, list[dict]]:
    """`player_id` -> menciones, de la más nueva a la más vieja.

    Cada mención es lo que se puede comprobar abriendo el enlace y nada más.
    """
    idx = indice(rows)
    salida: dict[str, list[dict]] = {}
    for entrada in entries or []:
        if not isinstance(entrada, dict):
            continue
        publicado = entrada.get("published_at")
        if not publicado:
            # Sin fecha de publicación no se afirma actualidad. Se cuenta en
            # `resumen()` y no se cuelga de nadie.
            continue
        titular = f" {_clave(entrada.get('title'))} "
        texto = f" {_clave((entrada.get('title') or '') + ' ' + (entrada.get('summary') or ''))} "
        for clave, row in idx.items():
            if f" {clave} " not in texto:
                continue
            equipo = normalize_team(row.get("team")) if row.get("team") else None
            if not _corrobora(entrada, equipo, texto):
                continue
            salida.setdefault(str(row["player_id"]), []).append({
                "outlet": entrada.get("outlet"),
                "title": entrada.get("title"),
                "url": entrada.get("url"),
                "published_at": publicado,
                # ¿Le nombra el TITULAR, o sólo aparece en el cuerpo? Es un
                # hecho de dónde está el nombre, no un juicio de importancia.
                "in_title": f" {clave} " in titular,
            })
    # Primero las que le nombran en el titular, y dentro de cada grupo la más
    # nueva. Ordenar sólo por fecha enterraba lo que habla DE ÉL debajo de un
    # repaso que le cita de pasada: el «suspension watch» de Puka Nacua caía al
    # tercer puesto —y sólo se publican tres— por detrás de un artículo cuyo
    # titular es de otro jugador. No se puntúa la importancia; se mira dónde
    # está el nombre, que sí se puede comprobar.
    for lista in salida.values():
        lista.sort(key=lambda m: (m["in_title"], str(m["published_at"])), reverse=True)
    return salida


def resumen(entries: Iterable[dict], enlazadas: dict[str, list[dict]]) -> dict:
    """Lo que se puede afirmar del barrido, con su CUÁNDO.

    `as_of` es la publicación más nueva que se ha leído, **no** la hora del
    barrido: es la misma regla que `fecha_del_research`.
    """
    entradas = [e for e in (entries or []) if isinstance(e, dict)]
    fechas = [str(e["published_at"]) for e in entradas if e.get("published_at")]
    return {
        "entries": len(entradas),
        "undated": sum(1 for e in entradas if not e.get("published_at")),
        "players": len(enlazadas),
        "mentions": sum(len(v) for v in enlazadas.values()),
        "as_of": max(fechas) if fechas else None,
    }
