"""EL BARRIDO SIN MODELO: convertir feeds leídos en fichas del día.

    LO QUE UN FEED TRAE ES UN HECHO. LO QUE SIGNIFICA, NO.

Desde el 6 de septiembre de 2026 `feed_fetch.py` baja 2.100 entradas diarias
sin necesitar clave — y hasta hoy **ninguna pantalla las leía**. La sección de
Research de la web sale de `research/<fecha>.json`, que sólo sabía escribir
`research.py` con `ANTHROPIC_API_KEY`; sin secret, `research_build.py`
republicaba el archivo de días anteriores. Resultado medido el 13 de
septiembre: la web llevaba **nueve días** enseñando el barrido del 4 con 1,8 MB
de prensa de hoy en el repositorio, sin fallar nada. Es el «dato computado que
no llega a la pantalla», por quinta vez.

Este módulo cierra ese hueco SIN inventarse la parte que falta.

------------------------------------------------------------------------
QUÉ SE PUEDE RELLENAR Y QUÉ NO

Una ficha del barrido con modelo lleva `kind`, `impact`, `confidence`,
`evidence_type` y `fantasy_relevance`. Los cinco son JUICIOS: alguien leyó la
nota y decidió que era una lesión, que es mala para el jugador, que la fuente
es un insider con nombre y que mueve una alineación. Un feed no trae nada de
eso, y **derivarlo de palabras clave sería una convención de medición
disfrazada** — exactamente lo que la regla 6e prohíbe con el `needScore: 73`.

Así que aquí esos campos NO SE ESCRIBEN. No se ponen a un valor «neutro», que
es la trampa: un `confidence: "rumor"` por defecto afirma algo que nadie
comprobó, y la pantalla ya cometió ese error una vez con los anuncios
oficiales. Lo que se escribe es lo que el feed sostiene:

    headline, summary, outlet, url, published_at, first_seen_at, team

Y `players`, que NO se extrae con un buscador de nombres escrito aquí: se
reutiliza `press.mentions`, que ya existía y ya es conservador — sólo nombre
completo (mínimo 9 caracteres), un nombre compartido por dos filas se cae del
índice ENTERO, y además exige corroboración de equipo. Escribir un extractor
nuevo el día del partido es cómo se reintrodujo dos veces el fallo de los dos
«B.Robinson».

El artefacto declara `method: "DETERMINISTIC_FEEDS"` en vez de un nombre de
modelo. Quien lo lea sabe qué clase de barrido es sin tener que deducirlo de
los campos que faltan.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date, datetime, timezone

from . import press
from .timestamps import publication

#: El método, en el mismo campo donde el barrido con modelo pone su nombre.
#: Es una CADENA reconocible y no una bandera booleana: mañana puede haber un
#: tercer método y `model == "…"` seguiría siendo la pregunta equivocada.
METHOD = "DETERMINISTIC_FEEDS"

#: LAS MISMAS PALABRAS QUE `web/tools/audit-spanish.mjs`, y hay un test que
#: falla si las dos listas dejan de coincidir.
#:
#: La interfaz está en inglés y el barrido con modelo escribía SUS resúmenes,
#: así que las rutas de `headline`/`summary` están declaradas como COPY en esa
#: puerta — por una regresión real vista en producción. El barrido determinista
#: pasa el titular del medio TAL CUAL, y el feed oficial de Las Vegas publica
#: parte de sus notas en español: una sola de las 2.113 entradas del 13 de
#: septiembre, suficiente para poner CI en rojo con razón.
#:
#: Traducirla exigiría un modelo, que es justo lo que aquí no hay, e inventar
#: una traducción es peor que no publicarla. Se descarta y se CUENTA.
#:
#: Duplicar el detector es el fallo de los dos traductores, así que no se deja
#: silencioso: `tests/test_sweep.py::test_las_dos_listas_de_espanol_coinciden`
#: lee los dos ficheros y exige que la lista sea la misma.
FUNCIONALES_ES = frozenset("""el|la|los|las|un|una|unos|unas|del|de|al|que|con|para|en|por|como|pero|sin|sobre|entre|cuando|donde|porque|más|menos|muy|todo|toda|todos|cada|otro|otra|este|esta|estos|estas|ese|esa|aquí|allí|hay|son|está|están|fue|ser|tiene|tienen|puede|pueden|hace|hacen|desde|hasta|aunque|también|sólo|solo|así|ya|no se|se ha|lo que""".split("|"))

#: Nombres propios que dispararían el detector. Misma razón y mismo origen.
NO_ES_ESPANOL = ("Las Vegas", "Los Angeles", "La Crosse", "De La Cruz", "Del Rio")


def looks_spanish(text: str) -> bool:
    """DOS palabras funcionales, como la puerta de la web. Ni una, ni tres."""
    limpio = str(text or "")
    for propio in NO_ES_ESPANOL:
        limpio = limpio.replace(propio, " ")
    encontradas = {
        w for w in re.findall(r"[a-záéíóúñü]+", limpio.lower()) if w in FUNCIONALES_ES
    }
    return len(encontradas) >= 2


#: Cuántos días atrás se admite una entrada para el barrido de HOY. Una nota de
#: hace una semana es real y NO es del día: entra en el archivo por su propia
#: fecha, no por la de hoy. Dos días cubre el hueco de un fin de semana sin
#: barrido y no más.
WINDOW_DAYS = 2

#: Tope de fichas del día. El barrido con modelo publica ~40 y la pantalla
#: pinta de veinte en veinte; dos mil entradas crudas no son un barrido, son un
#: volcado. Se ordena por fecha de publicación y se corta.
MAX_ITEMS = 60


def _por_url(
    entries: list[dict], rows: list[dict] | None,
) -> tuple[dict[str, list[str]], dict[str, str]]:
    """(URL -> nombres que la nota cita, URL -> equipo derivado de ellos).

    Nombres y no ids, aunque `press.mentions` trabaje con ids: el campo
    `players` del esquema son nombres, y quien los convierte en `player_ids`
    es `matching.attach` cuando se consolida la ventana. Emitir ids aquí
    parecía más directo y dejaba el artefacto con **cero fichas enlazadas** —
    el consolidador buscaba nombres y encontraba identificadores. Un resolver,
    y este módulo no es él.

    `press.mentions` devuelve lo contrario (jugador -> menciones) porque ésa es
    la pregunta de la ficha del jugador. Aquí hace falta la vuelta, y se
    obtiene invirtiendo su salida en vez de repetir el emparejamiento: dos
    formas de cruzar nombres es exactamente cómo se cuelan dos coberturas
    distintas del mismo hecho.
    """
    if not rows:
        return {}, {}
    ficha = {
        str(r.get("player_id")): (r.get("player_full_name"), r.get("team"))
        for r in rows if r.get("player_id") and r.get("player_full_name")
    }
    salida: dict[str, list[str]] = {}
    equipos: dict[str, set[str]] = {}
    for pid, menciones in press.mentions(entries, rows).items():
        quien, equipo = ficha.get(str(pid), (None, None))
        if not quien:
            continue
        for m in menciones:
            url = str(m.get("url") or "")
            if not url:
                continue
            if quien not in salida.setdefault(url, []):
                salida[url].append(quien)
            if equipo:
                equipos.setdefault(url, set()).add(str(equipo))
    # El equipo de la nota, cuando el feed no lo trae. NO es una suposición:
    # `press.mentions` ya EXIGE corroboración de equipo para emparejar, así que
    # si nombra a alguien, coincide con su equipo. Sólo se deriva cuando todos
    # los nombrados son del MISMO — un repaso de la jornada que cita a cuatro
    # de cuatro equipos no es «una nota de Kansas City».
    derivado = {u: next(iter(t)) for u, t in equipos.items() if len(t) == 1}
    return salida, derivado


def _iso_day(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def _within(entry_day: str | None, today: date, window: int) -> bool:
    """Sin fecha de publicación NO se da por del día.

    La alternativa sería fecharla con `first_seen_at` —cuándo la vio el
    barrido— y eso es literalmente la regla 5 al revés: la hora de descarga
    convertida en actualidad. Una entrada sin fecha entra igual, pero se
    ordena la última y la pantalla la etiqueta «seen».
    """
    if entry_day is None:
        return True
    try:
        dias = (today - date.fromisoformat(entry_day)).days
    except ValueError:
        return False
    return 0 <= dias <= window


def from_feeds(
    entries: Iterable[dict],
    *,
    today: date,
    rows: list[dict] | None = None,
    window: int = WINDOW_DAYS,
    max_items: int = MAX_ITEMS,
    now: datetime | None = None,
) -> list[dict]:
    """Las fichas del día a partir de las entradas de `feeds_latest.json`.

    `rows` son las filas del ranking. Sin ellas no se nombra a nadie y
    `players` queda vacío — que es la respuesta correcta cuando no hay contra
    qué cruzar, no un motivo para adivinar por el nombre suelto.

    EL ORDEN ES UN HECHO, NO UNA NOTA. Primero las notas que NOMBRAN a alguien
    del board y luego las demás, y dentro de cada grupo la más reciente. Que
    una nota nombre a un jugador del board se comprueba abriendo el enlace;
    «esta noticia importa más» no. Es la misma distinción que `press.py` hace
    con `in_title`, y por eso el criterio se parece: sin ella el corte de 60 lo
    llenan los «How to watch» de los feeds oficiales, que son los que más
    publican.
    """
    reloj = now or datetime.now(timezone.utc)
    lista = list(entries)
    nombrados, del_mencionado = _por_url(lista, rows)
    candidatas: list[tuple[bool, str, dict]] = []
    for entry in lista:
        # `publication` es la MISMA puerta que usa el parser de prosa: rechaza
        # el futuro con la tolerancia declarada en un solo sitio. Dos
        # traductores del mismo concepto con distinta cobertura ya costó una
        # entrada fechada ocho días por delante.
        publicado = publication(entry.get("published_at"), now=reloj)
        dia = _iso_day(publicado)
        if not _within(dia, today, window):
            continue
        url = str(entry.get("url") or "")
        suyos = nombrados.get(url, [])
        # Sin equipo del feed NO se puede enlazar: `matching.build_index`
        # indexa por (clave, equipo) y con equipo vacío no casa nada. Medido
        # antes de derivarlo: 8 de 60 fichas enlazaban, y las 52 restantes eran
        # las de los medios que no publican por equipo — o sea justo las que
        # traen la noticia.
        equipo = entry.get("team") or del_mencionado.get(url) or None
        ficha = {
            "beat": entry.get("beat") or "Feeds",
            "team": equipo,
            # Sin índice no se empareja: `resolve` conservador o nada.
            "players": suyos,
            # Ya vienen sin entidades: las deshace `feeds.load_archive`, que
            # es el ÚNICO sitio donde se lee este fichero. Hacerlo también aquí
            # sería el segundo traductor.
            "headline": str(entry.get("title") or "").strip(),
            "summary": str(entry.get("summary") or "").strip(),
            "published": publicado,
            "published_at": publicado,
            "first_seen_at": entry.get("first_seen_at"),
            "source_type": entry.get("source_type") or "RSS",
            "method": METHOD,
            "schema_version": 2,
            "sources": [{
                "outlet": entry.get("outlet"),
                "title": entry.get("title"),
                "url": entry.get("url"),
            }],
        }
        # NO se escriben `kind`, `impact`, `confidence`, `evidence_type` ni
        # `fantasy_relevance`. Ver la cabecera: son juicios y el feed no los
        # trae. Un valor por defecto aquí es una afirmación que nadie hizo.
        if not ficha["headline"]:
            continue
        # La interfaz está en inglés y esto es el titular del medio, literal.
        if looks_spanish(f'{ficha["headline"]} {ficha["summary"]}'):
            continue
        candidatas.append((bool(suyos), publicado or "", ficha))

    # Se ordena por el INSTANTE completo, no por el día: la primera versión
    # cortaba por `dia` y dentro de una misma fecha dejaba el orden de lectura
    # del fichero, así que «lo más nuevo primero» —que es lo que dice este
    # comentario— era falso dentro del día, que es justo donde importa el día
    # de la jornada. Lo que no trae fecha cae al final, no en medio, donde se
    # leería como si tuviera la del vecino.
    candidatas.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [ficha for _, _, ficha in candidatas[:max_items]]


def meta(items: list[dict], feeds_summary: dict | None) -> dict:
    """La cabecera del artefacto, con el MÉTODO en el sitio del modelo."""
    resumen = feeds_summary or {}
    salidas = {s["outlet"] for i in items for s in i["sources"] if s.get("outlet")}
    return {
        "method": METHOD,
        # El campo histórico se conserva para no romper a quien lo lea, y dice
        # la verdad: no hubo modelo.
        "model": "deterministic feed ingest (no model)",
        "beats": ["Feeds"],
        "sources_unique": int(resumen.get("sources_ok") or 0),
        "outlets_unique": len(salidas),
        "feeds_generated_at": resumen.get("generated_at"),
        "schema_version": 2,
    }
