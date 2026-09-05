"""ORIGEN E INDEPENDENCIA: quién lo contó primero y quién lo repite.

`freshness.py::resolve` cruza afirmaciones y conserva el desacuerdo, que es
correcto — pero **no sabe de dónde vienen**. Si un informante nacional publica
algo y catorce sitios lo reescriben, `resolve` ve quince afirmaciones. Un
producto que cuente eso como «confirmado por quince fuentes» está inventando
corroboración a partir de un solo informe.

    MÚLTIPLES ARTÍCULOS != MÚLTIPLES FUENTES INDEPENDIENTES.

Este módulo es la pieza que faltaba, y es deliberadamente pequeña: resuelve el
ORIGEN de cada afirmación y cuenta orígenes DISTINTOS, no artículos.

## La decisión que define el módulo

Cuando el linaje no se puede establecer, la afirmación **no cuenta como
independiente**. Es tentador tratar «no sé de dónde viene» como «viene de otro
sitio», porque infla el número de confirmaciones y el número queda bonito. Es la
misma familia de error que `Number(null) === 0`: un hueco colado como dato.

Por eso `corroboration()` devuelve TRES cifras y no una:

    independent_origins   orígenes distintos y CONOCIDOS
    unknown_origin        afirmaciones cuyo linaje no se pudo establecer
    total_claims          artículos, que es lo que NO hay que publicar

Quien pinte «confirmado por N fuentes» sólo puede usar la primera.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Attributed:
    """Una afirmación con su atribución de origen.

    `origin_claim_id` apunta a la afirmación que ORIGINA ésta. `None` significa
    una de dos cosas MUY distintas, y por eso hay un campo aparte:

      · `originates=True`  -> esta fuente lo cuenta de primera mano;
      · `originates=False` -> repite algo cuyo origen no se pudo resolver.

    Sin esa distinción, «yo lo destapé» y «no sé quién lo destapó» acabarían
    contando lo mismo, que es exactamente la corroboración inventada.
    """

    claim_id: str
    source_id: str
    origin_claim_id: str | None = None
    origin_source_id: str | None = None
    originates: bool = False


@dataclass(frozen=True)
class Corroboration:
    """Cuántas fuentes INDEPENDIENTES sostienen algo, y cuántas no se sabe."""

    independent_origins: int
    unknown_origin: int
    total_claims: int
    origins: tuple[str, ...] = field(default=())

    @property
    def can_claim_multiple_sources(self) -> bool:
        """¿Se puede escribir «confirmado por varias fuentes»?

        Sólo con dos orígenes conocidos y distintos. Un origen conocido más
        cinco de linaje desconocido sigue siendo UN informe con cinco ecos.
        """
        return self.independent_origins >= 2


def _norm(valor: str | None) -> str:
    """Un id de fuente canónico. `ESPN`, `espn` y `espn ` son la MISMA fuente.

    Sin esto, dos formas de escribir el mismo medio producen dos «orígenes
    independientes» — el número inflado, otra vez, por un espacio."""
    return (valor or "").strip().casefold()


def _raiz(claim_id: str, index: dict[str, Attributed], seen: frozenset[str]) -> str | None:
    if claim_id in seen:
        return None                       # ciclo: nada demostrado
    seen = seen | {claim_id}
    nodo = index.get(claim_id)
    if nodo is None:
        return None

    # NODO INCOHERENTE: dice originar Y a la vez citar a otro. Es un dato roto,
    # y de las dos lecturas posibles la que suma un origen es justo la que
    # infla. Un dato incoherente no aporta corroboración.
    if nodo.originates and nodo.origin_claim_id:
        return None

    if nodo.originates:
        # La raíz es QUIÉN origina, no qué artículo: el mismo reportero en dos
        # medios son dos artículos y un originador. Sin fuente identificable no
        # hay raíz — `source:` vacío contaba como origen conocido.
        sid = _norm(nodo.source_id)
        return f"source:{sid}" if sid else None

    if nodo.origin_claim_id:
        if nodo.origin_claim_id in index:
            return _raiz(nodo.origin_claim_id, index, seen)
        return _por_fuente(nodo, index, seen)

    if nodo.origin_source_id:
        return _por_fuente(nodo, index, seen)
    return None


def _por_fuente(nodo: Attributed, index: dict[str, Attributed], seen: frozenset[str]) -> str | None:
    """«Según X», sin identificar el artículo.

    X sólo es raíz si X no aparece en el índice REPITIENDO a otro. Un podcast
    que dice «según ESPN», con el artículo de ESPN citando al insider, tiene el
    mismo origen que el insider: contarlo como `source:espn` fabricaba un
    segundo origen a partir de un solo informe. Si X está en el índice, se sigue
    SU cadena; si su cadena tampoco resuelve, es desconocido.
    """
    sid = _norm(nodo.origin_source_id)
    if not sid:
        return None
    suyos = [n for n in index.values() if _norm(n.source_id) == sid and n.claim_id not in seen]
    if not suyos:
        return f"source:{sid}"            # X no está en el índice: es la raíz utilizable
    for n in suyos:
        raiz = _raiz(n.claim_id, index, seen)
        if raiz is not None:
            return raiz
    return None                            # X está, pero su propio origen no se resuelve


def resolve_origin(claim_id: str, index: dict[str, Attributed]) -> str | None:
    """La raíz de la cadena de citas, o `None` si no se puede establecer."""
    return _raiz(claim_id, index, frozenset())


def corroboration(claims: list[Attributed]) -> Corroboration:
    """Cuenta ORÍGENES distintos, nunca artículos."""
    # IDS REPETIDOS: el índice es un dict y se queda con el ÚLTIMO, así que un
    # eco cuyo id coincida con el de un originador se resolvía COMO ese
    # originador y el eco desaparecía sin ruido. Un id ambiguo no puede producir
    # una respuesta segura: sus afirmaciones cuentan como desconocidas.
    vistos: dict[str, int] = {}
    for c in claims:
        vistos[c.claim_id] = vistos.get(c.claim_id, 0) + 1
    ambiguos = {k for k, n in vistos.items() if n > 1}

    index = {c.claim_id: c for c in claims if c.claim_id not in ambiguos}
    origins: set[str] = set()
    desconocidos = 0
    for c in claims:
        raiz = None if c.claim_id in ambiguos else resolve_origin(c.claim_id, index)
        if raiz is None:
            desconocidos += 1
        else:
            origins.add(raiz)
    return Corroboration(
        independent_origins=len(origins),
        unknown_origin=desconocidos,
        total_claims=len(claims),
        origins=tuple(sorted(origins)),
    )
