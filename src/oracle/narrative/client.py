"""Envoltorio de la API de Claude.

## Dónde vive la clave

En `ANTHROPIC_API_KEY`, y en ningún otro sitio. Concretamente:

- **No** en el repo. Gitleaks revisa el historial completo en cada push, así que
  una clave commiteada no se arregla borrándola: hay que rotarla.
- **No** en la web. El sitio es estático y se construye con los textos ya
  horneados; el navegador nunca ve una petición a la API ni una credencial.
- Sí en el secret de GitHub Actions, que es el único sitio donde se ejecuta esto
  de forma desatendida.

## Degradación

Sin clave, `available()` devuelve False y los scripts saltan la generación con un
aviso. Es el mismo contrato que tienen los artefactos de fantasy: la web se
construye igual, sólo que sin esa sección. Que falte el texto no puede tumbar la
publicación de los números, que son lo que importa.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Sequence
from typing import Any

# Opus 5 por defecto. La calidad importa más que el coste aquí: el volumen es de
# unas pocas llamadas al día, y el modo barato de equivocarse (un resumen que
# malinterpreta una cifra) cuesta más que la diferencia de precio.
DEFAULT_MODEL = "claude-opus-5"

# Se puede bajar de modelo con la variable de entorno sin tocar código, que es lo
# que quieres cuando estás iterando prompts y no te interesa pagar Opus por cada
# prueba.
MODEL_ENV = "ORACLE_NARRATIVE_MODEL"
KEY_ENV = "ANTHROPIC_API_KEY"

# La búsqueda web y la descarga de páginas corren en los servidores de Anthropic:
# no hay que implementar nada, sólo declararlas. Esta versión de las herramientas
# filtra los resultados con código antes de que entren en el contexto, que es
# justo lo que hace viable barrer 32 equipos sin quemar el presupuesto.
WEB_TOOLS = (
    {"type": "web_search_20260209", "name": "web_search"},
    {"type": "web_fetch_20260209", "name": "web_fetch"},
)


class NarrativeUnavailable(RuntimeError):
    """No se puede generar texto: falta la clave o falta el SDK."""


def available() -> bool:
    """¿Hay clave y SDK? Los scripts preguntan esto antes de intentar nada."""
    if not os.environ.get(KEY_ENV):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def resolve_model(override: str | None = None) -> str:
    return override or os.environ.get(MODEL_ENV) or DEFAULT_MODEL


def web_tools(max_searches: int = 8) -> list[dict]:
    """Herramientas de búsqueda con un tope de usos.

    El tope no es cosmético: sin él, una consulta ambigua puede encadenar
    veinte búsquedas y multiplicar el coste de un barrido por tres.
    """
    tools = [dict(tool) for tool in WEB_TOOLS]
    tools[0]["max_uses"] = max_searches
    tools[1]["max_uses"] = max_searches
    return tools


def _client():
    if not os.environ.get(KEY_ENV):
        raise NarrativeUnavailable(
            f"Falta {KEY_ENV}. En local: exportarla en la sesión. En CI: secret del repo. "
            "Nunca en un fichero del repo."
        )
    try:
        import anthropic
    except ImportError as error:  # pragma: no cover - depende del entorno
        raise NarrativeUnavailable(
            "Falta el SDK: pip install -e '.[narrative]'"
        ) from error
    # El constructor lee ANTHROPIC_API_KEY del entorno. Se deja así a propósito:
    # si la clave nunca se nombra en el código, no puede acabar en un log.
    return anthropic.Anthropic()


def ask_json(
    system: str,
    user: str,
    schema: dict,
    *,
    tools: Sequence[dict] = (),
    effort: str = "medium",
    max_tokens: int = 8000,
    model: str | None = None,
    max_retries: int = 4,
) -> Any:
    """Una llamada que devuelve JSON validado contra `schema`.

    Dos decisiones que no son evidentes:

    - **Streaming siempre.** No es por enseñar el texto mientras llega (esto
      corre desatendido); es porque una petición larga sin streaming se topa con
      el timeout de la API. Un barrido de prensa con quince búsquedas dentro
      tarda minutos.
    - **El JSON se busca desde el final.** Con herramientas de servidor la
      respuesta trae bloques intermedios (búsquedas, resultados, razonamiento);
      el objeto que interesa es el último bloque de texto que parsea.

    El pensamiento extendido va en adaptativo, que es el valor por defecto de
    Opus 5. `budget_tokens` no se pasa: en los modelos actuales devuelve un 400.
    """
    import anthropic

    client = _client()
    request: dict[str, Any] = {
        "model": resolve_model(model),
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {
            "effort": effort,
            "format": {"type": "json_schema", "schema": schema},
        },
    }
    if tools:
        request["tools"] = list(tools)

    last_error: Exception | None = None
    for attempt in range(max_retries):
        try:
            with client.messages.stream(**request) as stream:
                message = stream.get_final_message()
            return _extract_json(message)
        except (anthropic.RateLimitError, anthropic.APIConnectionError) as error:
            last_error = error
        except anthropic.APIStatusError as error:
            # Los 5xx son transitorios; los 4xx son culpa del prompt o del
            # esquema y reintentarlos sólo gasta dinero.
            if error.status_code < 500:
                raise
            last_error = error
        delay = 2 ** (attempt + 1)
        print(f"  reintento en {delay}s ({type(last_error).__name__})")
        time.sleep(delay)

    raise NarrativeUnavailable(f"La API no respondió tras {max_retries} intentos: {last_error}")


def _extract_json(message) -> Any:
    """Devuelve el último bloque de texto que sea JSON válido."""
    texts = [block.text for block in message.content if getattr(block, "type", None) == "text"]
    for text in reversed(texts):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            continue
    raise NarrativeUnavailable(
        "La respuesta no traía JSON parseable. "
        f"Bloques recibidos: {[getattr(b, 'type', '?') for b in message.content]}"
    )
