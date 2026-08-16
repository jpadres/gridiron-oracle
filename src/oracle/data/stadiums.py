"""Geografía de las sedes: coordenadas, huso horario, altitud y tipo de techo.

Por qué está esto aquí y no en un CSV: son 40 filas que no cambian de una
temporada a otra y que necesita tanto la construcción de features como la web.
Un import es más barato y más difícil de romper que un fichero suelto.

Tres efectos reales, medibles y confundidos entre sí si no se separan:

1. **Distancia.** El viaje cansa, pero mucho menos de lo que se cuenta. El
   coeficiente que sale de los datos es de décimas de punto para un vuelo
   costa a costa, no de puntos enteros.
2. **Huso horario.** Esto sí pesa, y de forma asimétrica: viajar hacia el este
   (jugar a las 13:00 locales cuando tu cuerpo cree que son las 10:00) es peor
   que viajar hacia el oeste. Por eso `tz_shift` va con signo, no en valor
   absoluto.
3. **Altitud.** Denver (1610 m) y Ciudad de México (2240 m) son los dos únicos
   sitios donde el desnivel importa. Se modela como desnivel respecto a la sede
   del visitante, no como altitud absoluta: los Broncos no tienen ventaja por
   jugar alto, la tienen por jugar *más alto que el rival*.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_RADIUS_MILES = 3958.8


@dataclass(frozen=True)
class Stadium:
    """Una sede.

    `utc_offset` es la hora estándar respecto a UTC. No se ajusta por horario de
    verano a propósito: lo que se usa es la *diferencia* entre dos sedes, y salvo
    Arizona (que no cambia la hora) todas las sedes de EE. UU. saltan el mismo
    día, así que la diferencia se conserva. Para los partidos en Europa el
    desfase real varía una hora entre septiembre y noviembre; es ruido menor
    frente a las 5-9 horas de salto que ya captura.
    """

    name: str
    team: str | None
    lat: float
    lon: float
    utc_offset: float
    altitude_m: float
    roof: str  # "outdoor" | "dome" | "retractable"

    @property
    def indoors(self) -> bool:
        """Un techo retráctil cuenta como interior: se cierra cuando hace malo,
        que es justo cuando el clima habría importado."""
        return self.roof in ("dome", "retractable")


# Sedes de los 32 equipos. LAR/LAC y NYG/NYJ comparten estadio: son la misma
# sede física, pero se listan por equipo porque el visitante viaja al mismo
# sitio y el local no viaja en ninguno de los dos casos.
TEAM_STADIUMS: dict[str, Stadium] = {
    "ARI": Stadium("State Farm Stadium", "ARI", 33.5276, -112.2626, -7.0, 331, "retractable"),
    "ATL": Stadium("Mercedes-Benz Stadium", "ATL", 33.7554, -84.4008, -5.0, 291, "retractable"),
    "BAL": Stadium("M&T Bank Stadium", "BAL", 39.2780, -76.6227, -5.0, 10, "outdoor"),
    "BUF": Stadium("Highmark Stadium", "BUF", 42.7738, -78.7870, -5.0, 183, "outdoor"),
    "CAR": Stadium("Bank of America Stadium", "CAR", 35.2258, -80.8528, -5.0, 227, "outdoor"),
    "CHI": Stadium("Soldier Field", "CHI", 41.8623, -87.6167, -6.0, 181, "outdoor"),
    "CIN": Stadium("Paycor Stadium", "CIN", 39.0955, -84.5161, -5.0, 149, "outdoor"),
    "CLE": Stadium("Huntington Bank Field", "CLE", 41.5061, -81.6995, -5.0, 176, "outdoor"),
    "DAL": Stadium("AT&T Stadium", "DAL", 32.7473, -97.0945, -6.0, 171, "retractable"),
    "DEN": Stadium("Empower Field at Mile High", "DEN", 39.7439, -105.0201, -7.0, 1610, "outdoor"),
    "DET": Stadium("Ford Field", "DET", 42.3400, -83.0456, -5.0, 189, "dome"),
    "GB": Stadium("Lambeau Field", "GB", 44.5013, -88.0622, -6.0, 195, "outdoor"),
    "HOU": Stadium("NRG Stadium", "HOU", 29.6847, -95.4107, -6.0, 12, "retractable"),
    "IND": Stadium("Lucas Oil Stadium", "IND", 39.7601, -86.1639, -5.0, 218, "retractable"),
    "JAX": Stadium("EverBank Stadium", "JAX", 30.3239, -81.6373, -5.0, 5, "outdoor"),
    "KC": Stadium("GEHA Field at Arrowhead", "KC", 39.0489, -94.4839, -6.0, 231, "outdoor"),
    "LAC": Stadium("SoFi Stadium", "LAC", 33.9535, -118.3392, -8.0, 30, "dome"),
    "LAR": Stadium("SoFi Stadium", "LAR", 33.9535, -118.3392, -8.0, 30, "dome"),
    "LV": Stadium("Allegiant Stadium", "LV", 36.0909, -115.1833, -8.0, 640, "dome"),
    "MIA": Stadium("Hard Rock Stadium", "MIA", 25.9580, -80.2389, -5.0, 3, "outdoor"),
    "MIN": Stadium("U.S. Bank Stadium", "MIN", 44.9736, -93.2578, -6.0, 254, "dome"),
    "NE": Stadium("Gillette Stadium", "NE", 42.0909, -71.2643, -5.0, 88, "outdoor"),
    "NO": Stadium("Caesars Superdome", "NO", 29.9511, -90.0812, -6.0, 3, "dome"),
    "NYG": Stadium("MetLife Stadium", "NYG", 40.8135, -74.0745, -5.0, 5, "outdoor"),
    "NYJ": Stadium("MetLife Stadium", "NYJ", 40.8135, -74.0745, -5.0, 5, "outdoor"),
    "PHI": Stadium("Lincoln Financial Field", "PHI", 39.9008, -75.1675, -5.0, 12, "outdoor"),
    "PIT": Stadium("Acrisure Stadium", "PIT", 40.4468, -80.0158, -5.0, 223, "outdoor"),
    "SEA": Stadium("Lumen Field", "SEA", 47.5952, -122.3316, -8.0, 3, "outdoor"),
    "SF": Stadium("Levi's Stadium", "SF", 37.4033, -121.9694, -8.0, 8, "outdoor"),
    "TB": Stadium("Raymond James Stadium", "TB", 27.9759, -82.5033, -5.0, 12, "outdoor"),
    "TEN": Stadium("Nissan Stadium", "TEN", 36.1665, -86.7713, -6.0, 118, "outdoor"),
    "WAS": Stadium("Northwest Stadium", "WAS", 38.9077, -76.8645, -5.0, 61, "outdoor"),
}

# Sedes neutrales e internacionales. La clave es el `game_id`/`location` que
# publica nflverse cuando el partido no se juega en casa del "local" nominal.
NEUTRAL_STADIUMS: dict[str, Stadium] = {
    "LON_WEMBLEY": Stadium("Wembley Stadium", None, 51.5560, -0.2795, 0.0, 25, "outdoor"),
    "LON_TOTTENHAM": Stadium("Tottenham Hotspur Stadium", None, 51.6043, -0.0665, 0.0, 40, "outdoor"),
    "MEX_AZTECA": Stadium("Estadio Azteca", None, 19.3029, -99.1505, -6.0, 2240, "outdoor"),
    "MUN_ALLIANZ": Stadium("Allianz Arena", None, 48.2188, 11.6247, 1.0, 511, "outdoor"),
    "SAO_CORINTHIANS": Stadium("Neo Química Arena", None, -23.5453, -46.4742, -3.0, 760, "outdoor"),
    "DUB_CROKE": Stadium("Croke Park", None, 53.3607, -6.2511, 0.0, 20, "outdoor"),
    "MAD_BERNABEU": Stadium("Santiago Bernabéu", None, 40.4531, -3.6883, 1.0, 700, "outdoor"),
    "MEL_MCG": Stadium("Melbourne Cricket Ground", None, -37.8200, 144.9834, 10.0, 20, "outdoor"),
    "BER_OLYMPIA": Stadium("Olympiastadion Berlin", None, 52.5147, 13.2395, 1.0, 50, "outdoor"),
}

ALL_STADIUMS: dict[str, Stadium] = {**TEAM_STADIUMS, **NEUTRAL_STADIUMS}


def get_stadium(key: str) -> Stadium | None:
    """Sede por abreviatura de equipo o por clave de sede neutral."""
    return ALL_STADIUMS.get(key)


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia sobre la esfera en millas.

    Haversine y no una aproximación plana porque los vuelos que importan
    (Seattle-Miami, ~2700 millas) son justo donde una aproximación plana se
    desvía más.
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class TravelProfile:
    """Lo que cada equipo "gasta" para llegar a un partido concreto."""

    home_travel_miles: float
    away_travel_miles: float
    # Positivo = el visitante viaja hacia el este (pierde horas). Ese es el
    # sentido que penaliza; hacia el oeste el efecto es mucho menor.
    away_tz_shift: float
    home_tz_shift: float
    # Desnivel en metros del visitante respecto a su propia sede. Positivo =
    # juega más alto de lo que acostumbra.
    away_altitude_delta: float
    home_altitude_delta: float
    neutral_site: bool
    indoors: bool


def travel_profile(home_team: str, away_team: str, venue: str | None = None) -> TravelProfile:
    """Perfil de viaje de un partido.

    `venue` sólo se pasa en sede neutral (Londres, México, Múnich...). En sede
    neutral el local también viaja, y ese es justo el motivo por el que la
    ventaja local casi desaparece en esos partidos: no es el ambiente, es que
    los dos equipos llegan igual de lejos.
    """
    home_base = TEAM_STADIUMS.get(home_team)
    away_base = TEAM_STADIUMS.get(away_team)
    if home_base is None or away_base is None:
        # Equipo desconocido (reubicaciones antiguas: STL, SD, OAK). Devolver
        # ceros es preferible a inventar coordenadas: el modelo trata el viaje
        # como "sin información" en vez de como "sin viaje relevante".
        return TravelProfile(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, venue is not None, False)

    site = NEUTRAL_STADIUMS.get(venue) if venue else None
    neutral = site is not None
    site = site or home_base

    return TravelProfile(
        home_travel_miles=haversine_miles(home_base.lat, home_base.lon, site.lat, site.lon),
        away_travel_miles=haversine_miles(away_base.lat, away_base.lon, site.lat, site.lon),
        away_tz_shift=site.utc_offset - away_base.utc_offset,
        home_tz_shift=site.utc_offset - home_base.utc_offset,
        away_altitude_delta=site.altitude_m - away_base.altitude_m,
        home_altitude_delta=site.altitude_m - home_base.altitude_m,
        neutral_site=neutral,
        indoors=site.indoors,
    )
