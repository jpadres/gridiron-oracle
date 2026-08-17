"""Textos generados por Claude sobre los números del modelo.

Tres cosas distintas viven aquí, y **conviene no confundirlas** porque tienen
niveles de fiabilidad muy diferentes:

1. `weekly.week_summary` — resumen de la jornada. Se redacta **sólo** con los
   números que produce el modelo, y todo número que aparezca en el texto se
   verifica contra esos datos antes de publicarlo (`factcheck`).
2. `weekly.player_notes` — por qué el modelo prefiere a un jugador. Mismo
   contrato: sólo cifras del modelo, verificadas.
3. `research` — barrido diario de prensa, insiders y campamentos. Esto **no**
   sale del modelo: son afirmaciones de terceros con su fuente al lado, y no
   entran en ningún cálculo. Se publican en una sección aparte y etiquetadas.

La separación entre (1)-(2) y (3) es la regla dura de este módulo. El modelo se
entrena con una única pasada cronológica sobre datos de nflverse; si una noticia
de agosto pudiera mover un número, la garantía anti-fuga dejaría de valer. Las
noticias se muestran **al lado** de los rankings, nunca dentro de ellos.

Nada de esto es obligatorio para que el proyecto funcione: sin
`ANTHROPIC_API_KEY` los scripts avisan y siguen, y la web se construye sin las
secciones de texto igual que se construye sin los artefactos de fantasy.
"""

from oracle.narrative.client import (
    NarrativeUnavailable,
    ask_json,
    available,
    resolve_model,
)
from oracle.narrative.factcheck import allowed_numbers, unsupported_numbers

__all__ = [
    "NarrativeUnavailable",
    "allowed_numbers",
    "ask_json",
    "available",
    "resolve_model",
    "unsupported_numbers",
]
