"""Clima de partido: el dato por un lado, la lectura por otro.

## La separación, que es el punto de este módulo

`Conditions` son **hechos**: viento sostenido de 24 mph, nieve, dos grados. Salen
del Servicio Meteorológico Nacional y no opinan.

`interpret()` devuelve **juicio nuestro**: que ese viento puede estropear el juego
aéreo y los goles de campo. Es una hipótesis razonable y no está validada contra
resultados en este proyecto, así que sale etiquetada como MODELO y con esas
palabras. Mezclar las dos cosas es como publicar una probabilidad de bust sin
haberla calibrado.

## Por qué casi nunca hay que decir nada

Llover no es noticia. Un partido bajo lluvia ligera se juega igual, y avisar de
cada chubasco es exactamente el ruido que esta sección existe para no generar —
el mismo defecto que tenía «muestra corta» apareciendo en los 250 jugadores del
board.

Dos filtros, en este orden:

1. **El techo.** `data/stadiums.py` ya sabe cuáles son cerrados. En un domo no se
   mira el tiempo: no hay tiempo que mirar. Sale gratis y quita un tercio de los
   partidos.
2. **Umbrales**, y altos. Sólo se menciona lo que la literatura de apuestas
   relaciona con un efecto medible.

## La fuente

`api.weather.gov`: oficial, sin clave, sin coste, unas 5.000 peticiones por hora
y sólo Estados Unidos — que cubre todos los estadios salvo los partidos
internacionales, donde simplemente no habrá dato.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..data.stadiums import TEAM_STADIUMS

BASE = "https://api.weather.gov"

# Umbrales. Ya no salen de la literatura de apuestas: están MEDIDOS sobre 5.008
# partidos a cielo abierto de 2000-2025 (bloque 44 del espec adversarial).
#
#   viento <= 10 mph ... 44,05 puntos por partido   (referencia)
#   viento > 15 mph .... 40,58   diferencia -3,47   IC95% [-4,78, -2,16]
#   viento > 20 mph .... 38,34   diferencia -5,71   IC95% [-8,37, -3,04]
#   viento > 26 mph .... 30,65   (n=26, tramo pequeño pero brutal)
#
# El corte de 15 era folclore y ha resultado ser correcto. Eso no siempre pasa y
# por eso se mide.
#
# DOS ADVERTENCIAS QUE NO SE PUEDEN SEPARAR DE ESOS NÚMEROS:
#
# 1. Están medidos con viento OBSERVADO. Este módulo consume un PRONÓSTICO, que
#    tiene su propio error, y ese error nunca se ha medido aquí. El efecto real
#    sobre una predicción hecha con pronóstico es necesariamente menor que -3,47.
#
# 2. El clima de nflverse sólo existe para partidos ya jugados —cero de los 272
#    partidos de 2026 lo traen—, así que NO se puede usar para predecir nada del
#    modelo de partidos. Contra el total de cierre, los partidos con viento >15
#    llegan 2,22 puntos por debajo (IC95% [-3,47, -0,97]), lo que parece una
#    ventaja contra el mercado y no lo es: es exactamente la fuga de usar el
#    dato observado como si se hubiera conocido antes.
#
# Por debajo, el
# partido se juega igual y mencionarlo es ruido.
#
# Si se cambian, hay que decir por qué: bajarlos hasta que "salgan avisos" es el
# equivalente meteorológico de bajar el umbral de una apuesta hasta que aparezca
# valor.
WIND_SUSTAINED_MPH = 15.0      # a partir de aquí el pase largo y el kick sufren
WIND_GUST_MPH = 25.0           # rachas: afectan aunque el sostenido sea menor
PRECIP_PROBABILITY = 0.60      # menos que esto es "puede que llueva"
SNOW_ANY = True                # la nieve sí cambia el partido desde el primer copo
TEMP_COLD_F = 20.0
TEMP_HOT_F = 95.0

# Techos que no protegen del tiempo. Un retráctil puede estar abierto, así que se
# mira igual; un domo fijo, no.
OPEN_ROOFS = frozenset({"outdoor", "open", "retractable"})


@dataclass(frozen=True)
class Conditions:
    """Hechos observados o pronosticados. Sin interpretación."""

    team: str
    stadium: str
    roof: str
    wind_mph: float | None = None
    gust_mph: float | None = None
    precip_probability: float | None = None
    snow: bool = False
    temperature_f: float | None = None
    short_forecast: str = ""

    @property
    def sheltered(self) -> bool:
        return self.roof.lower() not in OPEN_ROOFS


def forecast_url(team: str) -> str | None:
    """El punto de entrada de la API para el estadio de un equipo.

    `api.weather.gov` obliga a resolver primero el punto de rejilla desde las
    coordenadas; eso es una segunda llamada que hace el cliente. Aquí sólo se
    construye la primera, que es la que depende de datos que ya tenemos.
    """
    stadium = TEAM_STADIUMS.get(team)
    if stadium is None:
        return None
    return f"{BASE}/points/{stadium.lat:.4f},{stadium.lon:.4f}"


def relevant(conditions: Conditions) -> bool:
    """¿Merece mencionarse?

    Un estadio cerrado nunca. Fuera de eso, sólo si cruza un umbral.
    """
    if conditions.sheltered:
        return False
    return bool(_reasons(conditions))


def _reasons(conditions: Conditions) -> list[str]:
    """Los hechos que cruzan umbral, redactados como hechos."""
    out: list[str] = []
    if conditions.wind_mph is not None and conditions.wind_mph >= WIND_SUSTAINED_MPH:
        out.append(f"viento sostenido de {conditions.wind_mph:.0f} mph")
    if conditions.gust_mph is not None and conditions.gust_mph >= WIND_GUST_MPH:
        out.append(f"rachas de {conditions.gust_mph:.0f} mph")
    if conditions.snow and SNOW_ANY:
        out.append("nieve")
    if (conditions.precip_probability is not None
            and conditions.precip_probability >= PRECIP_PROBABILITY):
        out.append(f"{conditions.precip_probability:.0%} de probabilidad de precipitación")
    if conditions.temperature_f is not None:
        if conditions.temperature_f <= TEMP_COLD_F:
            out.append(f"{conditions.temperature_f:.0f} °F")
        elif conditions.temperature_f >= TEMP_HOT_F:
            out.append(f"{conditions.temperature_f:.0f} °F")
    return out


def describe(conditions: Conditions) -> dict | None:
    """El dato y la lectura, separados y etiquetados.

    Devuelve `None` cuando no hay nada que decir, que es la mayoría de las veces
    y es el comportamiento correcto.
    """
    if not relevant(conditions):
        return None

    reasons = _reasons(conditions)
    fact = f"{conditions.stadium}: " + ", ".join(reasons) + "."

    # La lectura va aparte, en su propia clave y con su etiqueta. No es un hecho
    # y no se escribe como si lo fuera.
    effects = []
    windy = (
        (conditions.wind_mph or 0) >= WIND_SUSTAINED_MPH
        or (conditions.gust_mph or 0) >= WIND_GUST_MPH
    )
    if windy:
        effects.append("el juego aéreo y los goles de campo pueden verse afectados")
    if conditions.snow:
        effects.append("la nieve suele bajar los totales y subir el volumen de carrera")
    if conditions.temperature_f is not None and conditions.temperature_f <= TEMP_COLD_F:
        effects.append("el frío extremo se asocia con menos anotación")

    return {
        "team": conditions.team,
        "fact": fact,
        "evidence_type": "HECHO",
        "source_type": "STRUCTURED_API",
        # Y esto, explícitamente, no lo es.
        "interpretation": (
            "; ".join(effects).capitalize() + "." if effects else None
        ),
        "interpretation_evidence_type": "MODELO",
        # Aviso honesto: es una hipótesis razonable, no una relación medida en
        # este proyecto. Quien lo lea tiene que saberlo.
        "interpretation_caveat": (
            "Lectura nuestra, no validada contra resultados en este proyecto."
        ),
    }
