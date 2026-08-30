"""Migración de una sola vez: el archivo de research y el dossier, a inglés.

## Por qué esto es una migración y no un diccionario en tiempo de ejecución

La regla del producto es que **la interfaz está en inglés**. Traducir al pintar
sería un parche: el dato seguiría siendo español, cualquier consumidor nuevo
volvería a enseñarlo en español, y el diccionario crecería para siempre. Esto
reescribe la fuente **una vez** y desaparece.

## Qué NO se toca, y es la parte importante

Ni una URL, ni un medio, ni una fecha, ni un nombre de jugador o de equipo. Lo
que se traduce es exclusivamente **prosa que generó este proyecto** (los
resúmenes del barrido diario) o que se importó de una hoja curada (el dossier).

Los títulos de los artículos ajenos sí se traducen, y merece explicación: el
barrido los guardó **ya traducidos al español** por el propio modelo. El
original era inglés, así que devolverlos al inglés los acerca a la fuente, no
los aleja. La URL sigue al lado para poder comprobarlo.

## Falla ruidosamente

Si queda una cadena en español sin traducción, el script **avisa y sale con
error** en vez de escribir a medias. Una migración que deja la mitad del archivo
en un idioma y la mitad en otro es peor que no haberla hecho.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
I18N = ROOT / "scripts" / "i18n"

# Palabras funcionales del español. No sirven «no», «error» ni «total», que son
# iguales en inglés, ni los nombres propios («Los Angeles», «Las Vegas»).
SPANISH = re.compile(
    r"[áéíóúñ¿¡«»]|\b(el|la|los|las|del|que|una|unos|unas|por|para|más|está|están|"
    r"sin|como|pero|cuando|donde|porque|también|sólo|así|ya|tras|hacia|desde|hasta|"
    r"aunque|mientras|según|segun|entre|sobre|cada|otro|otra|este|esta|estos|estas|"
    r"ese|esa|hay|son|fue|ser|tiene|tienen|puede|pueden|hace|hacen|lesion|lesión|"
    r"rodilla|tobillo|practica|práctica|temporada|campamento|jugador|equipo|semana)\b",
    re.IGNORECASE,
)

# «Los Angeles Times», «Las Vegas Raiders»: el patrón dispara con «Los»/«Las» y
# son nombres propios. Se excluyen por prefijo, que es exacto y no heurístico.
PROPER = ("Los Angeles", "Las Vegas", "Las Vegas Raiders")


def looks_spanish(text: str) -> bool:
    if not isinstance(text, str) or len(text.strip()) < 4:
        return False
    cleaned = text
    for name in PROPER:
        cleaned = cleaned.replace(name, "")
    return bool(SPANISH.search(cleaned))


def load_maps() -> dict[str, str]:
    table: dict[str, str] = {}
    for path in sorted(I18N.glob("*.json")):
        table.update(json.loads(path.read_text(encoding="utf-8")))
    return table


def translate(value, table, missing: list[str]):
    """Traduce en profundidad. Lo que no está en la tabla se anota y se conserva."""
    if isinstance(value, dict):
        return {k: translate(v, table, missing) for k, v in value.items()}
    if isinstance(value, list):
        return [translate(v, table, missing) for v in value]
    if isinstance(value, str):
        if value in table:
            return table[value]
        if looks_spanish(value):
            missing.append(value)
        return value
    return value


# Campos que NUNCA se traducen aunque el detector se dispare: son datos.
SKIP_KEYS = frozenset({
    "url", "player", "players", "team", "player_id", "date", "published",
    "outlet", "publisher", "source", "name", "handle", "position", "beat",
})


def translate_document(doc, table, missing, key=None):
    if isinstance(doc, dict):
        return {
            k: (v if k in SKIP_KEYS and not isinstance(v, dict | list)
                else translate_document(v, table, missing, k))
            for k, v in doc.items()
        }
    if isinstance(doc, list):
        return [translate_document(v, table, missing, key) for v in doc]
    return translate(doc, table, missing)


def main() -> int:
    table = load_maps()
    print(f"{len(table)} traducciones cargadas de {I18N}\n")
    missing: list[str] = []
    changed = 0

    targets = sorted((ROOT / "research").glob("*.json"))
    for path in targets:
        original = json.loads(path.read_text(encoding="utf-8"))
        migrated = translate_document(original, table, missing)
        if migrated != original:
            path.write_text(
                json.dumps(migrated, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
            )
            changed += 1
            print(f"  reescrito  {path.relative_to(ROOT)}")
        else:
            print(f"  sin cambio {path.relative_to(ROOT)}")

    if missing:
        unique = sorted(set(missing))
        print(f"\n{len(unique)} cadenas en español SIN traducción:")
        for text in unique[:40]:
            print(f"  - {text[:110]}")
        if len(unique) > 40:
            print(f"  … y {len(unique) - 40} más")
        print("\nFALLA: se añaden a scripts/i18n/ y se vuelve a ejecutar.")
        return 1

    print(f"\n{changed} ficheros reescritos. Sin español pendiente.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
