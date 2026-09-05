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


def resolve_origin(claim_id: str, index: dict[str, Attributed]) -> str | None:
    """La raíz de la cadena de citas, o `None` si no se puede establecer.

    Se camina hacia atrás por `origin_claim_id` hasta llegar a quien origina. La
    raíz es QUIÉN origina y no QUÉ artículo: un reportero que publica lo mismo
    en su medio y en un podcast produce dos artículos y UN originador, y con la
    clave por artículo salían dos «fuentes independientes».

    Tres finales, y los tres importan:

      · alguien ORIGINA          -> `source:<quien>`;
      · la cadena cita a una fuente sin identificar el artículo («según X»)
                                 -> `source:X`, raíz más débil pero suficiente
                                    para no contar dos ecos de X como dos;
      · CICLO o cadena rota      -> `None`, desconocido.

    El ciclo es real —dos medios que se citan mutuamente— y la primera versión
    de esto devolvía a cada uno el otro como raíz: DOS orígenes distintos para
    una sola noticia sin origen demostrable. Un ciclo no demuestra nada.
    """
    seen: set[str] = set()
    actual = claim_id
    while True:
        if actual in seen:
            return None
        seen.add(actual)
        nodo = index.get(actual)
        if nodo is None:
            return None
        if nodo.originates:
            return f"source:{nodo.source_id}"
        if nodo.origin_claim_id:
            if nodo.origin_claim_id not in index:
                # El artículo citado no está en el índice. Si se sabe a qué
                # fuente se atribuye, esa fuente sirve de raíz; si no, no.
                return f"source:{nodo.origin_source_id}" if nodo.origin_source_id else None
            actual = nodo.origin_claim_id
            continue
        if nodo.origin_source_id:
            return f"source:{nodo.origin_source_id}"
        return None


def corroboration(claims: list[Attributed]) -> Corroboration:
    """Cuenta ORÍGENES distintos, nunca artículos."""
    index = {c.claim_id: c for c in claims}
    origins: set[str] = set()
    desconocidos = 0
    for c in claims:
        raiz = resolve_origin(c.claim_id, index)
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
