"""Resumen de la jornada y explicación de por qué el modelo prefiere a un jugador.

## El contrato

Estos textos se redactan **sólo** con los números que produce el modelo, sin
búsqueda web y sin conocimiento externo. Todo número que aparezca en el resultado
pasa por `factcheck` antes de publicarse; si alguno no sale de los datos que se
le pasaron, se le devuelve la corrección al modelo y, si vuelve a fallar, el
texto se descarta.

Descartar es la parte importante. Un resumen ausente se nota y se arregla; un
resumen con una cifra inventada se lee, se cree y no se distingue de uno bueno.

## Por qué explicar hace falta

El ranking dice que el modelo proyecta a un receptor 3 puntos por encima de su
media reciente. El motivo está en dos columnas —el guion de juego proyectado y el
multiplicador de emparejamiento— y en una tercera que no se enseña, la cuota de
uso. La explicación es la traducción de esas tres a una frase, no información
nueva: si el texto dice algo que no está en los números, es un error, no un
extra.
"""

from __future__ import annotations

from oracle.narrative.client import ask_json
from oracle.narrative.factcheck import allowed_numbers, check_texts

SYSTEM = """Escribes para un proyecto de modelos de NFL que publica sus resultados
sin maquillarlos, incluidos los malos. Tu tono es el de un analista que respeta al
lector: directo, concreto, sin épica y sin adjetivos de relleno.

Reglas que no se negocian:

1. **Sólo puedes citar números que estén en los datos que te doy.** Ninguno más.
   Ni medias que calcules tú, ni diferencias, ni porcentajes derivados. Si
   necesitas una cantidad que no está, escríbela con letras («casi cinco puntos
   por debajo») o no la escribas.
2. **No sabes nada que no esté en los datos.** No hay lesiones, ni noticias, ni
   traspasos, ni lo que dijo el entrenador. El modelo tampoco lo sabe, y fingir
   que sí es la forma más rápida de que el texto sea falso.
3. **Di lo que el modelo no sabe** cuando venga a cuento. Es una característica
   del proyecto, no una disculpa.
4. **Nada de consejos de apuesta ni de órdenes.** Se describe lo que el modelo
   proyecta y por qué; la decisión es del lector.
5. Español de España, con los términos de la NFL en inglés (target share, snap,
   game script). Frases cortas. Cero exclamaciones."""

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string", "description": "Una frase, máximo 90 caracteres."},
        "paragraphs": {
            "type": "array",
            "minItems": 2,
            "maxItems": 4,
            "items": {"type": "string"},
            "description": "Dos a cuatro párrafos de tres o cuatro frases.",
        },
        "watch": {
            "type": "array",
            "maxItems": 4,
            "items": {"type": "string"},
            "description": "Frases sueltas: en qué fijarse esta jornada. Una línea cada una.",
        },
    },
    "required": ["headline", "paragraphs", "watch"],
    "additionalProperties": False,
}

NOTES_SCHEMA = {
    "type": "object",
    "properties": {
        "notes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "player_id": {"type": "string"},
                    "text": {
                        "type": "string",
                        "description": "Una o dos frases. Por qué el modelo lo pone donde lo pone.",
                    },
                },
                "required": ["player_id", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["notes"],
    "additionalProperties": False,
}


def week_summary(context: dict, *, model: str | None = None, effort: str = "high") -> dict | None:
    """Resumen de la jornada. `None` si no supera la verificación de cifras."""
    user = f"""Estos son los números del modelo para esta jornada. Escribe el resumen.

{_dump(context)}

Cubre: qué partidos separan más al modelo del mercado y en qué dirección, qué
dice la distribución de márgenes, y qué está pasando en el ranking de fantasy de
la semana. Recuerda que el modelo iguala a la línea de cierre pero no la bate: si
el texto sugiere lo contrario, está mal."""

    return _generate(
        user,
        SUMMARY_SCHEMA,
        context,
        fields=lambda data: {
            "headline": data.get("headline", ""),
            **{f"p{i}": text for i, text in enumerate(data.get("paragraphs", []))},
            **{f"w{i}": text for i, text in enumerate(data.get("watch", []))},
        },
        model=model,
        effort=effort,
    )


def player_notes(
    players: list[dict], context: dict, *, model: str | None = None, effort: str = "medium"
) -> list[dict]:
    """Una nota por jugador explicando su sitio en el ranking.

    Se piden en un solo lote y no una llamada por jugador: además de costar
    quince veces menos, el modelo ve a los demás y puede escribir en
    comparación, que es como se lee un ranking.
    """
    payload = {"players": players, "contexto": context}
    user = f"""Explica, para cada jugador, por qué el modelo lo proyecta donde lo
proyecta esta jornada.

{_dump(payload)}

Una o dos frases por jugador. Lo que hay que explicar es la diferencia entre la
proyección y su media de los últimos seis partidos (`baseline_points`), y de
dónde sale: el margen y el total proyectados del partido —que determinan cuántas
jugadas y de qué tipo tendrá el equipo— y el multiplicador de emparejamiento, que
es el ajuste por la defensa rival amortiguado y suele mover poco.

Devuelve el `player_id` tal cual te lo doy. No escribas notas de jugadores que no
estén en la lista."""

    result = _generate(
        user,
        NOTES_SCHEMA,
        payload,
        fields=lambda data: {
            note.get("player_id", str(i)): note.get("text", "")
            for i, note in enumerate(data.get("notes", []))
        },
        model=model,
        effort=effort,
    )
    if not result:
        return []
    valid = {str(player["player_id"]) for player in players}
    return [note for note in result.get("notes", []) if str(note.get("player_id")) in valid]


def _generate(user: str, schema: dict, data: object, *, fields, model, effort) -> dict | None:
    """Genera, verifica las cifras, reintenta una vez, y si no, descarta.

    Un solo reintento. Si con los números señalados uno por uno el modelo vuelve
    a inventarse otro, el problema no es de suerte y otra vuelta más sólo gasta
    dinero.
    """
    allowed = allowed_numbers(data)
    message = user
    for attempt in (1, 2):
        result = ask_json(SYSTEM, message, schema, effort=effort, max_tokens=8000, model=model)
        if not isinstance(result, dict):
            return None
        problems = check_texts(fields(result), allowed)
        if not problems:
            return result
        offenders = sorted({token for tokens in problems.values() for token in tokens})
        print(f"  cifras sin respaldo (intento {attempt}): {', '.join(offenders)}")
        message = (
            f"{user}\n\nTu versión anterior citaba estos números, que **no están** en los "
            f"datos: {', '.join(offenders)}. Reescríbelo usando sólo los números de arriba, "
            "o expresa esas cantidades con letras."
        )
    print("  descartado: el texto sigue citando cifras que no salen de los datos.")
    return None


def _dump(data: object) -> str:
    import json

    return json.dumps(data, ensure_ascii=False, indent=1, default=str)
