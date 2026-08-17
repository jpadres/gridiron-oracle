"""Verificación de que el texto no se inventa cifras.

## Por qué existe

Un modelo de lenguaje redactando sobre una tabla escribe frases correctas con
números plausibles. «Nacua promedió 21,7 puntos» suena igual de bien si el dato
real es 21,663 que si es 18,2, y el segundo caso es una mentira publicada bajo la
firma del proyecto. Este módulo es la red: extrae **todos** los números del texto
generado y rechaza el texto si alguno no está en los datos que se le pasaron.

No es un detector de alucinaciones — no puede juzgar afirmaciones cualitativas
(«el emparejamiento le favorece»). Es un detector de la única clase de error que
sí se puede comprobar mecánicamente, que resulta ser también la más dañina,
porque una cifra falsa es indistinguible de una verdadera a ojo.

## Cómo se resuelven las ambigüedades

Siempre a favor del texto. «3.829» puede leerse como 3829 (millares a la
española) o como 3,829; se aceptan las dos lecturas y basta con que **una** esté
en los datos. La alternativa —ser estricto con el formato— convertiría el
validador en un corrector de estilo que rechaza textos correctos, y un validador
que da falsos positivos acaba desactivado.

Lo que **no** se perdona es un número que no está en los datos bajo ninguna
lectura. Ahí el texto se descarta.

## El agujero conocido

`STRUCTURAL` deja pasar 0, 1, 2, 3 y los años. Hacen falta para escribir («los 3
primeros», «la temporada 2026») y no se pueden derivar de los datos. Es un
agujero real y consciente: alguien podría colar «3 recepciones» inventadas. Se
compensa desde el prompt, que pide escribir con letras cualquier cantidad que no
salga de los datos.
"""

from __future__ import annotations

import math
import re

# Captura números con separadores de millares y decimales de cualquier estilo:
# 12, 12,5, 12.5, 1.234,5, 3.829. El signo se captura para no dar por buenas
# diferencias con el sentido invertido.
_NUMBER = re.compile(r"[+-]?\d+(?:[.,]\d+)*")

# Números que se aceptan sin estar en los datos. Ver el agujero conocido arriba.
STRUCTURAL: frozenset[float] = frozenset(
    {0.0, 1.0, 2.0, 3.0} | {float(year) for year in range(1999, 2036)}
)

# Tolerancia de comparación. Es diminuta a propósito: el margen de redondeo ya
# está cubierto porque al conjunto permitido se le añaden las versiones
# redondeadas de cada valor, no ensanchando la comparación.
_EPSILON = 1e-6


def readings(token: str) -> set[float]:
    """Todas las lecturas plausibles de un número escrito.

    «1.234,5» sólo tiene una lectura sensata (1234.5). «3.829» tiene dos, y las
    dos se devuelven.
    """
    sign = -1.0 if token.startswith("-") else 1.0
    body = token.lstrip("+-")
    if not any(separator in body for separator in ".,"):
        return {sign * float(body)}

    parts = body.split(".")
    parts = [piece for chunk in parts for piece in chunk.split(",")]
    if any(not part for part in parts):  # «1.» o «,5»: no es un número entero válido
        return set()

    out: set[float] = set()
    head_ok = len(parts[0]) <= 3
    # Lectura A: todos los separadores son de millares.
    if head_ok and all(len(part) == 3 for part in parts[1:]):
        out.add(sign * float("".join(parts)))
    # Lectura B: el último separador es decimal, los anteriores de millares.
    if head_ok and all(len(part) == 3 for part in parts[1:-1]):
        out.add(sign * float(f"{''.join(parts[:-1])}.{parts[-1]}"))
    return out


def allowed_numbers(data: object) -> set[float]:
    """Recorre los datos que se le dieron al modelo y saca lo que puede citar.

    De cada valor se admiten además sus redondeos (el texto dirá «15,2» donde el
    dato es 15,237) y, si está entre 0 y 1, su forma en porcentaje (0,498 ->
    49,8%), que es como se escriben las probabilidades.
    """
    values: set[float] = set(STRUCTURAL)
    _walk(data, values)
    return values


def _walk(node: object, out: set[float]) -> None:
    if isinstance(node, dict):
        for value in node.values():
            _walk(value, out)
    elif isinstance(node, (list, tuple, set)):
        for value in node:
            _walk(value, out)
    elif isinstance(node, bool):
        pass  # True/False no son 1/0 aquí
    elif isinstance(node, (int, float)):
        if math.isfinite(node):
            _expand(float(node), out)
    elif isinstance(node, str):
        # Los datos llevan números dentro de cadenas (rangos de calibración
        # «[0.5, 0.6)», fechas). Si el modelo los cita, son suyos.
        for token in _NUMBER.findall(node):
            for value in readings(token):
                _expand(value, out)


def _expand(value: float, out: set[float]) -> None:
    for signed in (value, abs(value)):
        out.add(signed)
        for digits in (0, 1, 2, 3):
            out.add(round(signed, digits))
    if abs(value) <= 1.0:
        percent = abs(value) * 100.0
        out.add(percent)
        out.add(round(percent, 1))
        out.add(round(percent, 0))
        out.add(-percent)


# Nota sobre el valor absoluto de arriba: se admite «cae 4,9 puntos» donde el
# dato es -4.9, porque en prosa el signo lo lleva el verbo y no la cifra.
# Obligar a escribir «−4,9» dentro de una frase rechazaría textos correctos, y
# ya se sabe cómo acaba un validador con falsos positivos. El precio es que no
# se detecta un signo invertido — pero eso es un error de sentido, que se lee, y
# no un error de cifra, que no se ve.


def unsupported_numbers(text: str, allowed: set[float]) -> list[str]:
    """Los números del texto que no están en los datos, tal como se escribieron.

    Devuelve la lista para poder decírselos al modelo en el reintento: «estos
    números no salen de ningún sitio» es una corrección accionable, «rehazlo» no.
    """
    offenders: list[str] = []
    for token in _NUMBER.findall(text):
        candidates = readings(token)
        if not candidates:
            continue
        if not any(_matches(value, allowed) for value in candidates):
            offenders.append(token)
    return offenders


def _matches(value: float, allowed: set[float]) -> bool:
    if value in allowed:
        return True
    return any(abs(value - candidate) <= _EPSILON for candidate in allowed)


def check_texts(texts: dict[str, str], allowed: set[float]) -> dict[str, list[str]]:
    """`unsupported_numbers` sobre varios campos a la vez.

    Devuelve sólo los que fallan, para que un `if not problems` baste.
    """
    problems = {}
    for name, text in texts.items():
        if not isinstance(text, str):
            continue
        offenders = unsupported_numbers(text, allowed)
        if offenders:
            problems[name] = offenders
    return problems
