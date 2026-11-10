"""La capa de RED que le faltaba a `adp.py`, y sólo eso.

    UN ADP NO ES CALIDAD: ES CONDUCTA. Y SIN SU CONTEXTO NO ES NADA.

`adp.py` define la instantánea, el emparejamiento estricto y la tendencia —la
parte difícil, la que se puede validar sin red— y dice explícitamente que no
descarga nada porque desde el contenedor de desarrollo la política de egreso
devuelve 403 al CONNECT para todas las fuentes públicas de ADP.

Eso sigue siendo cierto AQUÍ. No lo es en GitHub Actions, que es donde ya se
demostró que sí hay salida (`research-feeds.yml`, 6 de septiembre). Así que la
parte que faltaba se escribe aparte, igual que `feed_fetch.py` se escribió
aparte de `feeds.py`: una capa de red delgada que **no reimplementa** el
emparejamiento ni la instantánea, sólo los rellena.

## La fuente

Fantasy Football Calculator publica una API JSON pública y sin clave con el ADP
de sus propios mock drafts, y publica el tamaño de muestra y la ventana. Se
elige por eso: sin `sample_size` ni `window` un ADP no se puede fechar, y
`AdpSnapshot` los exige.

Es UNA fuente y se dice cuál. No se mezcla con otra: dos ADP de fuentes
distintas no son comparables y restarlos produce una tendencia inventada — la
regla ya está escrita en `adp.py` y aquí no se relaja.

## Falla cerrado

Sin respuesta utilizable no se devuelve una instantánea a medias: se levanta.
Un ADP vacío con la fecha de hoy es la rotura que parece que funcionó.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

from .adp import AdpEntry, AdpSnapshot

#: Quién soy y para qué. Un endpoint público leído por un cliente que se
#: identifica es una relación normal.
USER_AGENT = (
    "gridiron-oracle/1.0 (personal fantasy football research; "
    "contact via github.com/jpadres/gridiron-oracle)"
)
TIMEOUT = 20
SOURCE = "fantasyfootballcalculator"
BASE = "https://fantasyfootballcalculator.com/api/v1/adp"

#: Los formatos que la fuente publica, con el nombre que usa este proyecto.
FORMATS = {"ppr": "ppr", "half-ppr": "half_ppr", "standard": "standard",
           "2qb": "superflex"}


#: CUÁNTAS RONDAS TIENE QUE CUBRIR UNA INSTANTÁNEA PARA SER UN ADP.
#:
#: Es una CONVENCIÓN declarada, no una medición: ocho rondas de las quince de
#: un draft. El ADP contesta «¿puedo esperar a mi siguiente pick?», y esa
#: pregunta se hace sobre todo en la mitad del draft donde aún se eligen
#: titulares; una instantánea que no llega ahí no la puede contestar.
#:
#: Existe por lo que pasó al acabar la temporada de drafts de 2026. La fuente
#: agrega mock drafts, y en octubre ya casi nadie los juega: la respuesta seguía
#: siendo un 200 con jugadores dentro, pero CADA VEZ MENOS —131, 54, 29, y el 10
#: de noviembre UNO—, y `require_rows` con su mínimo de una fila daba cada una
#: por buena y la escribía encima de la anterior. El artefacto de septiembre,
#: que era el ADP de verdad, se fue sustituyendo por sus restos. No es un fallo
#: de red ni un vacío: es una fuente fuera de temporada, y lo que parece es que
#: funcionó.
MIN_ROUNDS_COVERED = 8


def minimum_entries(league_size: int) -> int:
    """Los jugadores que tiene que traer un ADP de `league_size` equipos."""
    return MIN_ROUNDS_COVERED * int(league_size)


class AdpUnavailable(RuntimeError):
    """No se pudo obtener un ADP utilizable. NO se devuelve uno a medias."""


def fetch(scoring: str = "ppr", teams: int = 12, year: int | None = None,
          opener=None, now: datetime | None = None) -> AdpSnapshot:
    """Una instantánea de ADP de la fuente pública, o `AdpUnavailable`.

    `opener` existe para poder probar esto sin red: se le pasa un doble que
    devuelva el JSON de la fuente. La forma del JSON está fijada en los tests
    con una respuesta real recortada — un doble que mienta en un campo prueba
    otra cosa, que ya costó una iteración con los fixtures de Sleeper.
    """
    if scoring not in FORMATS:
        raise AdpUnavailable(f"formato desconocido: {scoring}")
    momento = now or datetime.now(timezone.utc)
    year = year or momento.year
    url = f"{BASE}/{scoring}?teams={int(teams)}&year={int(year)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with (opener or urllib.request.urlopen)(request, timeout=TIMEOUT) as response:
            crudo = response.read()
    except urllib.error.HTTPError as error:
        raise AdpUnavailable(f"HTTP {error.code} en {url}") from error
    except Exception as error:  # noqa: BLE001 — en red, cualquier fallo es «no hay dato»
        raise AdpUnavailable(f"{type(error).__name__} en {url}") from error

    try:
        datos = json.loads(crudo.decode("utf-8", errors="replace")
                           if isinstance(crudo, bytes) else str(crudo))
    except ValueError as error:
        raise AdpUnavailable(f"respuesta ilegible de {url}") from error

    filas = datos.get("players") if isinstance(datos, dict) else None
    if not filas:
        raise AdpUnavailable(f"{url} respondió sin jugadores")

    entradas = []
    for fila in filas:
        try:
            adp = float(fila["adp"])
        except (KeyError, TypeError, ValueError):
            continue
        nombre = str(fila.get("name") or "").strip()
        posicion = str(fila.get("position") or "").strip().upper()
        if not nombre or not posicion:
            continue
        entradas.append(AdpEntry(name=nombre, position=posicion,
                                 team=(fila.get("team") or None), adp=adp))
    if not entradas:
        raise AdpUnavailable(f"{url} no trajo ninguna fila utilizable")

    return AdpSnapshot(
        entries=tuple(entradas),
        source=SOURCE,
        scoring=FORMATS[scoring],
        league_size=int(teams),
        # LA FECHA DE DESCARGA ES LA DE DESCARGA. La fuente no publica cuándo
        # calculó el agregado, así que esto es `fetched_at` y se llama así: no
        # se convierte en «el ADP es de hoy».
        fetched_at=momento.isoformat(timespec="seconds").replace("+00:00", "Z"),
        sample_size=int(datos.get("meta", {}).get("total_drafts") or 0),
        window=str(datos.get("meta", {}).get("start_date") or "unknown"),
    )
