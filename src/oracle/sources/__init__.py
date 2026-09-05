"""Inteligencia de fuentes: quién lo cuenta, quién lo repite y qué se puede afirmar.

Se construye SOBRE `freshness.py`, que ya aporta las cuatro marcas de tiempo,
la clasificación de frescura y `resolve()`. Lo que faltaba —y es lo que vive
aquí— es el ORIGEN: `resolve()` cruza afirmaciones sin saber de dónde vienen,
así que quince ecos de un mismo informe le parecen quince evidencias.
"""

from oracle.sources.lineage import Attributed, Corroboration, corroboration, resolve_origin

__all__ = ["Attributed", "Corroboration", "corroboration", "resolve_origin"]
