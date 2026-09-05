"""Barrido diario de prensa, insiders y campamentos.

## Qué es y qué no es

Es un lector de prensa, no una fuente de datos. Recorre lo que se publica sobre
los 32 equipos —periódicos, ESPN, blogs de equipo, los insiders de la NFL— y
devuelve fichas con **su fuente al lado**. Nada de esto entra en el modelo.

Esa frontera es la regla dura del proyecto y aquí es donde más fácil sería
cruzarla. El modelo se construye con una pasada cronológica sobre nflverse y su
garantía es que ninguna fila ve el futuro; en el momento en que un titular de
agosto moviera un proyección, esa garantía dejaría de poder demostrarse. Las
noticias se publican **al lado** del ranking, con su fecha y su enlace, para que
el ojo humano haga el ajuste que el modelo no hace.

## Cómo se organiza

Un «beat» es una llamada: una división (4 equipos) o un tema transversal. Once
beats al día. Cada uno recibe los titulares de los últimos días para no volver a
contar lo mismo, y devuelve sólo lo nuevo.

## Lo que cuesta

Once llamadas con búsqueda web, a Opus 5, salen por unos 3-5 $ al día. Es el
gasto más grande del proyecto con diferencia — el resto es CPU gratis de GitHub
Actions. `--beats` y `--max-searches` existen para bajarlo, y
`ORACLE_NARRATIVE_MODEL=claude-sonnet-5` lo reduce a algo menos de la mitad.
"""

from __future__ import annotations

from urllib.parse import urlparse

from oracle.narrative.client import ask_json, web_tools

from ..data.ingest import normalize_team
from .feeds import SOURCE_TYPES
from .schema import EVIDENCE_TYPES, SCHEMA_VERSION

# Divisiones con los códigos de nflverse. Se barre por división y no equipo a
# equipo porque el reportaje de prensa es divisional (el mismo periodista cubre
# el rival) y porque 32 llamadas al día cuestan tres veces lo que 8.
DIVISIONS: dict[str, tuple[str, ...]] = {
    "AFC Este": ("BUF", "MIA", "NE", "NYJ"),
    "AFC Norte": ("BAL", "CIN", "CLE", "PIT"),
    "AFC Sur": ("HOU", "IND", "JAX", "TEN"),
    "AFC Oeste": ("DEN", "KC", "LV", "LAC"),
    "NFC Este": ("DAL", "NYG", "PHI", "WAS"),
    "NFC Norte": ("CHI", "DET", "GB", "MIN"),
    "NFC Sur": ("ATL", "CAR", "NO", "TB"),
    "NFC Oeste": ("ARI", "LAR", "SF", "SEA"),
}

# Beats transversales. No se pueden repartir por división porque la noticia
# aparece antes en el hilo del insider que en la prensa local del equipo.
LEAGUE_BEATS: dict[str, str] = {
    "insiders": (
        "Reportes de los insiders de NFL con más recorrido — Adam Schefter, Ian Rapoport, "
        "Tom Pelissero, Mike Garafolo, Jeremy Fowler, Dianna Russini, Albert Breer. "
        "Traspasos, cortes, fichajes de agentes libres, contratos, suspensiones, "
        "designaciones de lesionados y todo lo que cambie una plantilla."
    ),
    "campamentos": (
        "Crónicas de los entrenamientos y de la pretemporada: quién la está rompiendo, "
        "quién ha subido o bajado en el depth chart, reparto de repeticiones con los "
        "titulares, novatos que se están ganando un puesto, veteranos que lo están perdiendo."
    ),
    "fantasy": (
        "Análisis de fantasy football de la semana en medios y podcasts con reputación: "
        "movimientos de ADP, jugadores infravalorados y sobrevalorados, reparto de "
        "cuotas de uso proyectado, avisos sobre trampas de volumen."
    ),
    # Desde el 2 de septiembre de 2026, a petición del dueño: el barrido pasa de
    # tres temas transversales a seis. Más fuentes con nombre, no más ruido: cada
    # ficha sigue exigiendo procedencia (`evidence_type`) y fecha del hecho, y
    # NADA de esto entra en un cálculo (regla 8).
    "analistas": (
        "Los rankings y análisis de los analistas de fantasy con más reputación y "
        "sus casas: FantasyPros (consenso ECR y sus expertos), ESPN (Mike Clay, "
        "Field Yates, Tristan Cockcroft, Eric Karabell), CBS Sports y SportsLine "
        "(Dave Richard, Jamey Eisenberg, Heath Cummings), Yahoo (Matt Harmon, Scott "
        "Pianowski, Andy Behrens), NBC/Rotoworld (Denny Carter, Kyle Dvorchak), "
        "The Athletic (Jake Ciely, Michael Salfino), PFF (Nathan Jahnke), "
        "FantasyPoints (Scott Barrett, Graham Barfield), 4for4 (John Paulsen), "
        "Footballguys, Establish The Run (Adam Levitan, Evan Silva), The Fantasy "
        "Footballers, Underdog (Josh Norris, Hayden Winks), Dynasty Nerds y JJ Zachariason. "
        "Lo que buscan: cambios de rank con motivo, cuotas de uso proyectadas, "
        "avisos concretos sobre un jugador. Cada ficha con el analista y el medio."
    ),
    "reporteros": (
        "Los reporteros de equipo (beat writers) de cada franquicia y los medios "
        "locales: quién entrena y quién no, repeticiones con los titulares, cambios "
        "en el depth chart oficial, lo que dice el entrenador jefe en rueda de "
        "prensa sobre el reparto de balones, novatos que suben, veteranos que "
        "pierden sitio. Nombrar siempre al reportero y al medio."
    ),
    "lesiones": (
        "Partes de lesiones y de práctica OFICIALES de la semana (DNP, limitado, "
        "completo), designaciones de partido (out, doubtful, questionable), "
        "jugadores que vuelven de IR/PUP, cirugías y plazos dados por el equipo. "
        "Distinguir siempre el parte oficial del equipo de lo que espera un "
        "reportero: no son la misma clase de evidencia."
    ),
}

# Esquema de salida. `additionalProperties: False` y `required` completo obligan
# al modelo a rellenar todos los campos: un `impact` ausente se convertiría en
# «neutro» silenciosamente y perderíamos la única señal ordenable de la ficha.
ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "team": {
            "type": "string",
            "description": "Código nflverse del equipo (KC, SF, LAR...) o LIGA si es transversal.",
        },
        "players": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Nombres completos de los jugadores implicados, como los escribe la fuente.",
        },
        "kind": {
            "type": "string",
            "enum": [
                "lesion",
                "transaccion",
                "depth_chart",
                "campamento",
                "contrato",
                "disciplina",
                "esquema",
                "otro",
            ],
        },
        "headline": {"type": "string", "description": "Titular en inglés, máximo 90 caracteres."},
        "summary": {
            "type": "string",
            "description": "Dos o tres frases en inglés. Qué pasó y qué cambia para el fantasy.",
        },
        "impact": {"type": "string", "enum": ["alza", "baja", "neutro"]},
        "confidence": {
            "type": "string",
            "enum": ["confirmado", "informado", "rumor"],
            "description": (
                "confirmado = anuncio oficial del equipo o de la liga. "
                "informado = un insider con nombre lo reporta. "
                "rumor = especulación, 'se espera que', fuentes sin identificar."
            ),
        },
        "evidence_type": {
            "type": "string",
            "enum": list(EVIDENCE_TYPES),
            "description": (
                "De dónde sale lo que afirma la ficha. Mide PROCEDENCIA, no "
                "certeza. HECHO = anuncio oficial o parte oficial. REPORTADO = "
                "un periodista con nombre lo da como información suya. "
                "OBSERVADO = un reportero describe lo que vio (repeticiones, "
                "quién entrenó). OPINION = un analista con nombre espera algo; "
                "es su juicio. MODELO = lo decimos nosotros con nuestros "
                "números. Si no encaja en ninguna, no inventes: es que la "
                "afirmación no tiene procedencia y la ficha no debería existir."
            ),
        },
        "published_at": {
            "type": "string",
            "description": (
                "Momento de publicación en ISO 8601 con huso, si la fuente lo "
                "da. Cadena vacía si sólo hay fecha o no hay nada. NO inventes "
                "una hora: una hora falsa arruina la medición de latencia, que "
                "es justo para lo que existe este campo."
            ),
        },
        "fantasy_relevance": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5,
            "description": "5 = cambia una alineación esta semana. 1 = contexto, no cambia nada.",
        },
        "published": {"type": "string", "description": "Fecha de publicación YYYY-MM-DD, o vacío."},
        "sources": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "outlet": {"type": "string"},
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                    "author": {
                        "type": "string",
                        "description": (
                            "Quién firma. Cadena vacía si el feed no lo dice — "
                            "que pasa a menudo. Sin este campo el reliability "
                            "score por analista es imposible, y no se puede "
                            "reconstruir hacia atrás: por eso se pide desde ya "
                            "aunque hoy no lo use nadie."
                        ),
                    },
                },
                "required": ["outlet", "title", "url", "author"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "team", "players", "kind", "headline", "summary", "impact",
        "confidence", "evidence_type", "fantasy_relevance", "published",
        "published_at", "sources",
    ],
    "additionalProperties": False,
}

SWEEP_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": ITEM_SCHEMA}},
    "required": ["items"],
    "additionalProperties": False,
}

SYSTEM = """Eres el documentalista de un proyecto de modelos de NFL. Tu trabajo es
leer prensa y devolver fichas verificables, no escribir columnas de opinión.

Reglas que no se negocian:

1. **Cada ficha necesita al menos una fuente con URL real** de las que has
   encontrado buscando. Si no tienes el enlace, la ficha no existe. No inventes
   URLs ni las reconstruyas de memoria.
2. **No repitas una cifra que no hayas leído.** Si la fuente no da el número, la
   ficha va sin número.
3. **Distingue lo confirmado de lo reportado y de lo rumoreado**, y sé duro con
   esa clasificación. «Se espera que» es un rumor aunque lo escriba Schefter.
   Un anuncio oficial del equipo es lo único que es «confirmado».
4. **Nada de contenido antiguo.** Si la noticia tiene más de una semana, no vale
   salvo que haya novedad hoy.
5. **Escribe en inglés de Estados Unidos**, con la terminología de fantasy que
   usaría un lector norteamericano (depth chart, snap share, target share).
   Toda la interfaz del sitio está en inglés y este texto se publica dentro de
   ella: un resumen en otro idioma rompe la página, no la enriquece.
6. **Prefiere lo que cambia una decisión** a lo que sólo llena espacio. Un
   corredor que pasa a titular vale más que quince declaraciones de un
   entrenador.

Si no encuentras nada que cumpla esto, devuelve la lista vacía. Es una respuesta
perfectamente válida y mucho mejor que rellenar."""


def sweep(
    beat: str,
    focus: str,
    *,
    today: str,
    known_headlines: list[str],
    reporters: list[dict] | None = None,
    max_items: int = 8,
    max_searches: int = 8,
    effort: str = "medium",
    model: str | None = None,
) -> list[dict]:
    """Un beat: busca, filtra y devuelve fichas ya limpias."""
    seen = "\n".join(f"- {headline}" for headline in known_headlines[:60]) or "- (nada todavía)"
    beat_writers = _reporter_block(reporters, beat)
    user = f"""Hoy es {today}.

Busca en internet lo publicado en los últimos dos días sobre: {focus}

Fuentes que valen: ESPN, NFL.com, The Athletic, Yahoo Sports, CBS Sports, Pro
Football Talk, los diarios locales de cada ciudad, los blogs de la red SB Nation,
las cuentas de los insiders y las notas oficiales de los equipos.
{beat_writers}

Ya hemos publicado estos titulares en los últimos días. **No los repitas**; sólo
tráelos de vuelta si hay una novedad real encima:

{seen}

Devuelve como mucho {max_items} fichas, ordenadas de más a menos relevante para
fantasy. Menos fichas buenas es mejor que más fichas de relleno."""

    payload = ask_json(
        SYSTEM,
        user,
        SWEEP_SCHEMA,
        tools=web_tools(max_searches),
        effort=effort,
        max_tokens=12000,
        model=model,
    )
    items = payload.get("items", []) if isinstance(payload, dict) else []
    return [item for item in (_clean(item, beat) for item in items) if item]


def _reporter_block(reporters: list[dict] | None, beat: str) -> str:
    """Los periodistas de cobertura diaria de los equipos de este beat.

    El beat local va por delante del nacional en lo que pasa dentro de un
    entrenamiento: está allí todos los días. Nombrarlos cambia la búsqueda de
    «noticias de los Chiefs» a «qué publicó hoy quien cubre a los Chiefs», que
    es una consulta mucho mejor.
    """
    if not reporters:
        return ""
    teams = set(DIVISIONS.get(beat, ()))
    chosen = [r for r in reporters if not teams or r.get("team") in teams]
    if not chosen:
        return ""
    lines = "\n".join(
        f"- {r['name']} ({r.get('outlet', '')}{', ' + r['handle'] if r.get('handle') else ''})"
        f" — {r['team']}"
        for r in chosen[:40]
    )
    return (
        "\nEstos son los periodistas de cobertura diaria de estos equipos. "
        "Busca lo que han publicado ellos antes que lo agregado:\n" + lines
    )


def beats(selection: list[str] | None = None) -> dict[str, str]:
    """Los beats a barrer hoy. Sin selección, los catorce."""
    everything = {
        f"{name}": (
            f"los equipos de la {name} de la NFL ({', '.join(teams)}): "
            "lesiones, movimientos de plantilla, depth chart y crónicas del campamento"
        )
        for name, teams in DIVISIONS.items()
    }
    everything.update(LEAGUE_BEATS)
    if not selection:
        return everything
    return {name: focus for name, focus in everything.items() if name in selection}


def _clean(item: object, beat: str) -> dict | None:
    """Descarta lo que no cumple el contrato. Silencioso a propósito.

    El modelo puede devolver una ficha sin fuente utilizable pese a que el
    esquema pida una: el esquema garantiza que el campo existe, no que la URL
    sea real. Aquí es donde se cae esa ficha, y es mejor perderla que publicarla
    sin poder comprobarla.
    """
    if not isinstance(item, dict):
        return None
    # Se guarda lo que DEVUELVE `_valid_source`, no el dict original.
    #
    # Antes se usaba como predicado —`if _valid_source(source)`— y se conservaba
    # la fuente tal cual venía. O sea que ni el recorte de longitud ni el
    # `outlet` deducido del dominio se aplicaban nunca: la función limpiaba una
    # copia que se tiraba. Se descubrió al añadir el autor, que tampoco llegaba.
    sources = [
        cleaned
        for cleaned in (_valid_source(source) for source in item.get("sources", []))
        if cleaned
    ]
    if not sources:
        return None
    headline = str(item.get("headline", "")).strip()
    summary = str(item.get("summary", "")).strip()
    if not headline or not summary:
        return None
    return {
        "beat": beat,
        # `or "LIGA"` sobre el valor, no un default de `.get`.
        #
        # `.get("team", "LIGA")` sólo aplica el defecto si **falta** la clave. Si
        # el modelo devuelve `"team": null` —que el esquema permite para una
        # noticia de liga— `str(None)` da la cadena "NONE", y entonces el equipo
        # de esa ficha es un código de cuatro letras que no existe. No falla
        # nada: simplemente no empareja con ningún equipo, en silencio.
        # Pasa por `normalize_team`, como todo código de equipo del proyecto.
        #
        # Sin esto, una ficha que llega con "LA" se guarda como "LA" y no
        # empareja NUNCA con los jugadores de LAR — sin fallar y sin avisar. Es
        # el mismo fallo silencioso que ya costó una iteración en el importador
        # del dossier, y reaparece en cada sitio nuevo que escribe un equipo.
        #
        # "LIGA" no es un equipo: es el centinela de las noticias transversales,
        # así que se preserva antes de normalizar.
        "team": _team_code(item.get("team")),
        "players": [str(name).strip() for name in item.get("players", []) if str(name).strip()],
        "kind": str(item.get("kind", "otro")),
        "headline": headline[:140],
        "summary": summary[:600],
        "impact": item.get("impact") if item.get("impact") in ("alza", "baja", "neutro") else "neutro",
        "confidence": (
            item.get("confidence")
            if item.get("confidence") in ("confirmado", "informado", "rumor")
            else "rumor"
        ),
        # Procedencia. A diferencia de `confidence`, un valor no reconocido NO
        # se degrada a un valor por defecto: se deja en None.
        #
        # Degradar en silencio es lo que hace la línea de arriba con
        # `confidence`, y es la razón por la que las 61 fichas históricas no se
        # pueden pasar por esta función: convertiría sus "confirmado" en
        # "rumor" sin que nada avisara. UNKNOWN > INVENTED.
        "evidence_type": (
            item.get("evidence_type")
            if item.get("evidence_type") in EVIDENCE_TYPES
            else None
        ),
        "fantasy_relevance": _clamp(item.get("fantasy_relevance", 1)),
        "published": str(item.get("published", ""))[:10],
        # Momento exacto de publicación, para medir latencia. Vacío se guarda
        # como None y no como cadena: un `""` acaba comparándose como fecha
        # válida en cuanto alguien escribe un `if item["published_at"]:` mal.
        "published_at": _not_from_the_future(str(item.get("published_at") or "").strip() or None),
        # Cuándo lo vimos nosotros por primera vez. Lo rellena la ingesta, no el
        # modelo: el modelo no sabe cuándo lo leímos.
        "first_seen_at": item.get("first_seen_at"),
        "confirmed_at": item.get("confirmed_at"),
        # Qué pasó al final. Se rellena en el postmortem, después del partido.
        # Nace a None y así se queda hasta que haya un resultado que comprobar.
        "resolution": item.get("resolution"),
        "source_type": (
            item.get("source_type") if item.get("source_type") in SOURCE_TYPES else None
        ),
        "schema_version": SCHEMA_VERSION,
        "sources": sources[:3],
    }


# Un día de tolerancia: husos horarios y un reloj un poco adelantado caben;
# una ficha «publicada» la semana que viene no es una fecha, es un error.
FUTURE_TOLERANCE_DAYS = 1


def _not_from_the_future(stamp: str | None, now: object | None = None) -> str | None:
    """Una fecha de publicación posterior a hoy no puede ser cierta.

    Un modelo que extrae `published_at` de un artículo puede leer mal un año,
    confundir el día con el mes, o copiar la fecha del evento futuro del que
    habla («el partido del domingo 14»). Guardarla tal cual la convierte en la
    ficha más «reciente» del archivo y la pone la primera en cada orden por
    fecha. Se deja en None: UNKNOWN antes que una frescura imposible.
    """
    if not stamp:
        return None
    from datetime import datetime, timedelta, timezone
    try:
        parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    if parsed > reference + timedelta(days=FUTURE_TOLERANCE_DAYS):
        return None
    return stamp


def _team_code(value: object) -> str:
    """Código canónico, o "LIGA" para lo que no es de un equipo."""
    raw = str(value or "").strip().upper()
    if not raw or raw == "LIGA":
        return "LIGA"
    # Si no se reconoce, se deja el original recortado en vez de tirarlo: una
    # ficha con un código raro sigue siendo legible, y perderla por eso sería
    # peor. Lo que no puede pasar es que un alias conocido no se traduzca.
    return normalize_team(raw) or raw[:4]


def _valid_source(source: object) -> dict | None:
    """Una fuente utilizable, con su autor si la hay.

    El autor es opcional a propósito: muchos feeds RSS no lo traen, y exigirlo
    tiraría fichas buenas. Lo que no es opcional es **guardar el hueco**, para
    que el día que la fuente sí lo dé haya dónde ponerlo.
    """
    if not isinstance(source, dict):
        return None
    url = str(source.get("url", "")).strip()
    parsed = urlparse(url)
    # Sólo http(s) y con dominio: sin esto, un `javascript:` generado acabaría de
    # href en la web. No hay usuarios que atacar aquí, pero el enlace tiene que
    # llevar a algún sitio comprobable para que la ficha sirva de algo.
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return {
        "outlet": str(source.get("outlet", parsed.netloc)).strip()[:60] or parsed.netloc,
        "title": str(source.get("title", "")).strip()[:160],
        "url": url[:400],
        # None y no "" cuando no se sabe: es la diferencia entre «este feed no
        # firma» y «alguien firmó con la cadena vacía», y el reliability score
        # tiene que poder distinguirlas para no crear un autor fantasma.
        "author": (str(source.get("author") or "").strip()[:80] or None),
    }


def _clamp(value: object) -> int:
    try:
        return max(1, min(5, int(value)))
    except (TypeError, ValueError):
        return 1


# Solape de palabras a partir del cual dos titulares del mismo equipo se
# consideran la misma noticia. 0.6 sale de la forma en que se repiten de verdad:
# «Rice limitado en el entrenamiento» y «Rice limitado en el entrenamiento del
# martes» comparten todo menos una palabra. Comparar el titular exacto no sirve
# —nunca coinciden— y bajar de 0.5 empieza a fundir noticias distintas del mismo
# jugador, que es el error caro: perder la segunda.
SIMILARITY = 0.6

# Umbral más laxo cuando además comparten URL. Compartir enlace es indicio de
# duplicado, pero **no es prueba**: los liveblogs y los trackers de lesiones
# cubren veinte historias distintas bajo una sola dirección. Esto se descubrió
# publicando: dos noticias de Chicago sin nada que ver —un receptor con una
# lesión de ingle y un safety fuera diez semanas— salían de la misma página de
# Bleacher Report y el deduplicador se comió una.
URL_SIMILARITY = 0.3


def dedupe(items: list[dict]) -> list[dict]:
    """Quita repetidos entre beats.

    La misma noticia llega por dos caminos: la división del equipo y el beat de
    insiders. Se colapsa por parecido del titular dentro del mismo equipo, con
    el umbral más bajo si además comparten enlace.

    Se conserva la de mayor relevancia, por eso se ordena antes.

    ## El duplicado no se tira: se funde

    Antes se descartaba con un `continue`, y eso rompía la medición de latencia
    de la peor manera posible: si la copia descartada era la que vimos **antes**,
    el `first_seen_at` que sobrevive es el de la segunda vez que la vimos. Medir
    «este reportero se adelanta treinta y cuatro minutos» sobre eso da un número
    con pinta de correcto y sin ningún significado.

    Así que al fundir se conserva **el instante más antiguo de los dos**, y las
    fuentes de las dos copias. Que dos caminos independientes traigan la misma
    noticia no es ruido a eliminar: es exactamente la confirmación múltiple que
    sube la confianza de una ficha.
    """
    kept: list[tuple[str, frozenset[str], set[str]]] = []
    out: list[dict] = []
    for item in sorted(items, key=lambda row: -row.get("fantasy_relevance", 1)):
        urls = {source["url"] for source in item["sources"]}
        words = _content_words(item["headline"])
        match = next(
            (index for index, other in enumerate(kept)
             if _is_duplicate(item["team"], words, urls, other)),
            None,
        )
        if match is not None:
            _merge_duplicate(out[match], item)
            kept[match] = (kept[match][0], kept[match][1], kept[match][2] | urls)
            continue
        kept.append((item["team"], words, urls))
        out.append(item)
    return out


def _merge_duplicate(survivor: dict, duplicate: dict) -> None:
    """Funde lo que aporta el duplicado en la ficha que se queda.

    Sólo se toca lo que se puede perder al descartar: el instante más antiguo y
    las fuentes que la superviviente no tenía. El texto no se mezcla — dos
    resúmenes concatenados no se leen, y el de mayor relevancia ya ganó.
    """
    for field in ("first_seen_at", "published_at"):
        theirs, ours = duplicate.get(field), survivor.get(field)
        # `min` sobre cadenas ISO 8601 con el mismo huso ordena bien. Con husos
        # distintos no, pero la alternativa —parsear aquí— mete una dependencia
        # de fechas en una función de deduplicado. Se normaliza en la ingesta.
        if theirs and (not ours or theirs < ours):
            survivor[field] = theirs

    known = {source["url"] for source in survivor["sources"]}
    for source in duplicate.get("sources", []):
        if source["url"] not in known and len(survivor["sources"]) < 4:
            survivor["sources"].append(source)
            known.add(source["url"])


def _is_duplicate(team, words, urls, other) -> bool:
    other_team, other_words, other_urls = other
    if team != other_team:
        return False
    overlap = _jaccard(words, other_words)
    if overlap >= SIMILARITY:
        return True
    return bool(urls & other_urls) and overlap >= URL_SIMILARITY


def _content_words(headline: str) -> frozenset[str]:
    """Palabras con carga del titular. Se caen artículos y preposiciones."""
    return frozenset(word.strip(".,;:«»\"'") for word in headline.lower().split() if len(word) > 3)


def _jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)
