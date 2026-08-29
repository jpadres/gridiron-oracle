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

import pandas as pd

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



@dataclass(frozen=True)
class Venue:
    """Una sede física, sin techo.

    El techo es del partido y no de la sede: un estadio retráctil está abierto o
    cerrado según el día, y nflverse publica cuál de las dos cosas fue. Meterlo
    aquí sería fijar como constante algo que varía, que es exactamente el
    defecto que este módulo vino a corregir.
    """

    name: str
    lat: float
    lon: float
    utc_offset: float
    altitude_m: float


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

def get_stadium(key: str) -> Stadium | None:
    """Sede actual de un equipo, por abreviatura."""
    return TEAM_STADIUMS.get(key)


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
    # ¿Se supo situar las tres sedes? Un viaje de 0 millas porque el equipo
    # juega en casa y un 0 porque no se encontró el estadio son cosas distintas,
    # y sin este campo el modelo no puede distinguirlas.
    known: bool = True


def travel_profile(home_team: str, away_team: str) -> TravelProfile:
    """Respaldo: viaje con la sede de HOY de cada equipo.

    Sólo se usa cuando el partido no trae un `stadium_id` que se sepa situar —en
    la práctica, una jornada futura cuyo calendario internacional aún no está
    publicado—. Para eso es correcto: la sede de hoy es la de mañana.

    Para el histórico era el defecto que motivó `STADIUMS_BY_ID`, y por eso ya
    no acepta una sede neutral: la ruta que la manejaba (`NEUTRAL_STADIUMS` y el
    parámetro `venue`) nunca se llegó a ejecutar en cinco años de código, porque
    `_venue_key` leía una columna inexistente. Un parámetro que nadie puede
    alcanzar no es una capacidad, es una promesa. Las sedes neutrales las
    resuelve `venue_travel`, que es lo que usa la pasada de features.
    """
    home_base = TEAM_STADIUMS.get(home_team)
    away_base = TEAM_STADIUMS.get(away_team)
    if home_base is None or away_base is None:
        # Antes este comentario decía que atendía a las reubicaciones antiguas
        # (STL, SD, OAK). Era falso: `normalize_team` las traduce ANTES, así que
        # la rama nunca se alcanzaba por ese motivo. Se alcanza sólo con un
        # equipo que no está en `VALID_TEAMS`, y entonces `known=False` deja
        # constancia de que el cero es "no lo sé" y no "no viajó".
        return TravelProfile(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, False, False, known=False)

    site = home_base

    return TravelProfile(
        home_travel_miles=haversine_miles(home_base.lat, home_base.lon, site.lat, site.lon),
        away_travel_miles=haversine_miles(away_base.lat, away_base.lon, site.lat, site.lon),
        away_tz_shift=site.utc_offset - away_base.utc_offset,
        home_tz_shift=site.utc_offset - home_base.utc_offset,
        away_altitude_delta=site.altitude_m - away_base.altitude_m,
        home_altitude_delta=site.altitude_m - home_base.altitude_m,
        neutral_site=False,
        indoors=site.indoors,
    )

# ---------------------------------------------------------------------------
# Sedes por identificador de nflverse
# ---------------------------------------------------------------------------
#
# `TEAM_STADIUMS` (arriba) dice dónde juega HOY cada equipo. Eso vale para una
# jornada futura y no vale para el histórico, por tres motivos que se
# comprobaron sobre los datos, no supuestos:
#
#   1. `normalize_team` traduce STL -> LAR, SD -> LAC y OAK -> LV para que la
#      continuidad de franquicia funcione en Elo. Efecto colateral: 463 partidos
#      de local salían situados en la ciudad a la que el equipo se mudó DESPUÉS.
#      Los Rams de 1999-2015 jugaban en San Luis, a 1.594 millas de SoFi y con
#      dos husos horarios de diferencia.
#   2. 713 de 7.276 partidos tenían mal el `indoors`, porque salía de un campo
#      fijo por equipo en vez del techo real de ese día. Un partido en Dallas con
#      el techo abierto no es el mismo entorno que otro con el techo cerrado.
#   3. `NEUTRAL_STADIUMS` era código muerto: `_venue_key` leía una columna
#      `venue_key` que **no existe** en `games.parquet`, así que siempre devolvía
#      None. Los 102 partidos en sede neutral —Londres, Azteca, Múnich— se
#      calculaban como si los dos equipos estuvieran en casa del local nominal,
#      que es justo lo contrario de lo que el docstring decía que hacía.
#
# nflverse publica `stadium_id` en TODOS los partidos —cero nulos en 7.548— y es
# estable frente a los cambios de patrocinador que renombran el estadio cinco
# veces. Es el identificador correcto: la identidad de la sede la pone la fuente,
# no una reconstrucción a mano de la historia de las franquicias.
#
# El techo NO está aquí: viene del campo `roof` de cada partido, que es el dato
# real de ese día. Poner un techo fijo por sede es el error 2 otra vez.
STADIUMS_BY_ID: dict[str, Venue] = {
    # --- sedes actuales -----------------------------------------------------
    "NYC01": Venue("MetLife Stadium", 40.8135, -74.0745, -5.0, 5),
    "KAN00": Venue("Arrowhead", 39.0489, -94.4839, -6.0, 231),
    "GNB00": Venue("Lambeau Field", 44.5013, -88.0622, -6.0, 195),
    "BAL00": Venue("M&T Bank Stadium", 39.2780, -76.6227, -5.0, 10),
    "TAM00": Venue("Raymond James Stadium", 27.9759, -82.5033, -5.0, 12),
    "CAR00": Venue("Bank of America Stadium", 35.2258, -80.8528, -5.0, 227),
    "NAS00": Venue("Nissan Stadium", 36.1665, -86.7713, -6.0, 118),
    "MIA00": Venue("Hard Rock Stadium", 25.9580, -80.2389, -5.0, 3),
    "WAS00": Venue("Northwest Stadium", 38.9077, -76.8645, -5.0, 61),
    "NOR00": Venue("Caesars Superdome", 29.9511, -90.0812, -6.0, 3),
    "BUF00": Venue("Highmark Stadium", 42.7738, -78.7870, -5.0, 183),
    "CHI98": Venue("Soldier Field", 41.8623, -87.6167, -6.0, 181),
    "BOS00": Venue("Gillette Stadium", 42.0909, -71.2643, -5.0, 88),
    "CLE00": Venue("Huntington Bank Field", 41.5061, -81.6995, -5.0, 176),
    "PIT00": Venue("Acrisure Stadium", 40.4468, -80.0158, -5.0, 223),
    "CIN00": Venue("Paycor Stadium", 39.0955, -84.5161, -5.0, 149),
    "DEN00": Venue("Empower Field at Mile High", 39.7439, -105.0201, -7.0, 1610),
    "JAX00": Venue("EverBank Stadium", 30.3239, -81.6373, -5.0, 5),
    "SEA00": Venue("Lumen Field", 47.5952, -122.3316, -8.0, 3),
    "HOU00": Venue("NRG Stadium", 29.6847, -95.4107, -6.0, 12),
    "PHI00": Venue("Lincoln Financial Field", 39.9008, -75.1675, -5.0, 12),
    "DET00": Venue("Ford Field", 42.3400, -83.0456, -5.0, 189),
    "PHO00": Venue("State Farm Stadium", 33.5276, -112.2626, -7.0, 331),
    "IND00": Venue("Lucas Oil Stadium", 39.7601, -86.1639, -5.0, 218),
    "DAL00": Venue("AT&T Stadium", 32.7473, -97.0945, -6.0, 171),
    "ATL97": Venue("Mercedes-Benz Stadium", 33.7554, -84.4008, -5.0, 291),
    "SFO01": Venue("Levi's Stadium", 37.4033, -121.9694, -8.0, 8),
    "MIN01": Venue("U.S. Bank Stadium", 44.9736, -93.2578, -6.0, 254),
    "LAX01": Venue("SoFi Stadium", 33.9535, -118.3392, -8.0, 30),
    "VEG00": Venue("Allegiant Stadium", 36.0909, -115.1833, -8.0, 640),

    # --- sedes anteriores ---------------------------------------------------
    # Éstas son las que arreglan el defecto 1. Sin ellas, veinte años de
    # partidos se sitúan en la ciudad equivocada.
    "STL00": Venue("Edward Jones Dome (San Luis)", 38.6328, -90.1885, -6.0, 141),
    "SDG00": Venue("Qualcomm Stadium (San Diego)", 32.7831, -117.1196, -8.0, 30),
    "OAK00": Venue("Oakland Coliseum", 37.7516, -122.2005, -8.0, 13),
    "LAX99": Venue("Los Angeles Memorial Coliseum", 34.0141, -118.2879, -8.0, 55),
    "LAX97": Venue("Dignity Health Sports Park (Carson)", 33.8644, -118.2611, -8.0, 20),
    "NYC00": Venue("Giants Stadium", 40.8121, -74.0769, -5.0, 5),
    "ATL00": Venue("Georgia Dome", 33.7576, -84.4008, -5.0, 291),
    "SFO00": Venue("Candlestick Park", 37.7136, -122.3861, -8.0, 3),
    "MIN00": Venue("Metrodome", 44.9738, -93.2578, -6.0, 254),
    "MIN98": Venue("TCF Bank Stadium", 44.9764, -93.2247, -6.0, 262),
    "DAL99": Venue("Texas Stadium (Irving)", 32.8410, -96.9145, -6.0, 132),
    "IND99": Venue("RCA Dome", 39.7639, -86.1638, -5.0, 218),
    "PHO99": Venue("Sun Devil Stadium (Tempe)", 33.4265, -111.9325, -7.0, 359),
    "PHI99": Venue("Veterans Stadium", 39.9061, -75.1714, -5.0, 12),
    "BOS99": Venue("Foxboro Stadium", 42.0925, -71.2646, -5.0, 88),
    "DET99": Venue("Pontiac Silverdome", 42.6459, -83.2549, -5.0, 296),
    "SEA99": Venue("Husky Stadium", 47.6503, -122.3016, -8.0, 10),
    "SEA98": Venue("Kingdome", 47.5952, -122.3320, -8.0, 3),
    "DEN99": Venue("Mile High Stadium", 39.7355, -105.0201, -7.0, 1609),
    "PIT99": Venue("Three Rivers Stadium", 40.4467, -80.0100, -5.0, 220),
    "CIN99": Venue("Cinergy Field", 39.0975, -84.5064, -5.0, 149),

    # --- sedes de circunstancias -------------------------------------------
    # Chicago jugó en Champaign la temporada de la reforma de Soldier Field;
    # Nueva Orleans repartió la temporada del Katrina entre Baton Rouge y San
    # Antonio; Buffalo llevó partidos a Toronto. Son pocos partidos, pero situar
    # a un equipo a 800 millas de donde jugó no es un redondeo.
    "CHI99": Venue("Memorial Stadium (Champaign)", 40.0995, -88.2359, -6.0, 224),
    "BRG00": Venue("Tiger Stadium (Baton Rouge)", 30.4119, -91.1836, -6.0, 17),
    "SAN00": Venue("Alamodome (San Antonio)", 29.4169, -98.4787, -6.0, 198),
    "BUF01": Venue("Rogers Centre (Toronto)", 43.6414, -79.3894, -5.0, 91),

    # --- internacionales ----------------------------------------------------
    # Éstas son las que arreglan el defecto 3. El motivo por el que la ventaja
    # local casi desaparece en Londres no es el ambiente: es que los dos equipos
    # han volado cinco husos horarios.
    "LON00": Venue("Wembley Stadium", 51.5560, -0.2795, 0.0, 25),
    "LON01": Venue("Twickenham Stadium", 51.4560, -0.3416, 0.0, 12),
    "LON02": Venue("Tottenham Hotspur Stadium", 51.6043, -0.0665, 0.0, 40),
    "MEX00": Venue("Estadio Azteca", 19.3029, -99.1505, -6.0, 2240),
    "GER00": Venue("Allianz Arena (Múnich)", 48.2188, 11.6247, 1.0, 511),
    # Mismo estadio que GER00 con otro identificador en la fuente.
    "MUN01": Venue("Allianz Arena (Múnich)", 48.2188, 11.6247, 1.0, 511),
    "FRA00": Venue("Deutsche Bank Park (Fráncfort)", 50.0685, 8.6455, 1.0, 102),
    "MAD01": Venue("Santiago Bernabéu", 40.4531, -3.6883, 1.0, 700),
    "PAR00": Venue("Stade de France", 48.9245, 2.3601, 1.0, 30),
    "MEL00": Venue("Melbourne Cricket Ground", -37.8200, 144.9834, 10.0, 20),
    "SAO00": Venue("Neo Química Arena (São Paulo)", -23.5453, -46.4742, -3.0, 760),
    "RIO00": Venue("Maracaná", -22.9121, -43.2302, -3.0, 9),
}


def home_venue_map(games: pd.DataFrame) -> dict[tuple[str, int], str]:
    """`(equipo, temporada)` -> `stadium_id` donde jugó de local esa temporada.

    Se deriva de los propios partidos en vez de mantener a mano la historia de
    las franquicias: la identidad de la sede la pone la fuente, y el mapa se
    corrige solo el día que un equipo se mude otra vez.

    **Esto no es información del futuro.** Sólo lee `season`, `home_team`,
    `location` y `stadium_id` — metadatos del calendario, que la NFL publica en
    mayo para toda la temporada. Ni un resultado, ni una estadística, ni nada
    que dependa de que el partido se haya jugado. El test
    `test_home_venue_map_solo_usa_calendario` lo fija.

    Los partidos en sede neutral se excluyen del recuento: un partido de los
    Jaguars en Londres no dice dónde está su casa. Si un equipo jugase TODOS sus
    partidos de local fuera de casa en una temporada, se queda sin entrada y el
    viaje sale como «sin información» en vez de inventado.
    """
    at_home = games[games["location"].astype(str).str.lower() == "home"]
    counts: dict[tuple[str, int], dict[str, int]] = {}
    for team, season, venue in at_home[["home_team", "season", "stadium_id"]].itertuples(index=False):
        if not isinstance(venue, str) or not venue:
            continue
        counts.setdefault((str(team), int(season)), {}).setdefault(venue, 0)
        counts[(str(team), int(season))][venue] += 1
    # La sede de la temporada es la más frecuente. La temporada del Katrina,
    # Nueva Orleans repartió sus partidos entre tres estadios y ninguno es «su
    # casa»; quedarse con el mayoritario es lo menos malo, y el partido concreto
    # usa su propio `stadium_id` de todas formas.
    return {key: max(venues.items(), key=lambda kv: kv[1])[0] for key, venues in counts.items()}


# Techos que cuentan como interior. `closed` y `open` son el mismo estadio
# retráctil en dos días distintos, y ahí está justo el valor de usar el dato del
# partido: un techo abierto deja el clima dentro.
INDOOR_ROOFS = frozenset({"dome", "closed"})
OUTDOOR_ROOFS = frozenset({"outdoors", "open"})


def venue_travel(
    site_id: str | None,
    home_venue_id: str | None,
    away_venue_id: str | None,
    roof: object = None,
) -> TravelProfile:
    """Perfil de viaje a partir de identificadores de sede de nflverse.

    `site_id` es dónde se juega **ese** partido; los otros dos son la casa de
    cada equipo esa temporada. En sede neutral el local también viaja, y ése es
    el motivo por el que la ventaja local casi desaparece en Londres: no es el
    ambiente, es que los dos equipos han cruzado cinco husos horarios.

    Cualquier sede sin coordenadas devuelve el perfil vacío con `known=False`.
    Es deliberado: un cero que significa «no viajó» y un cero que significa «no
    lo sé» tienen que poder distinguirse aguas arriba, o el modelo aprende que
    lo desconocido es lo mismo que lo cercano.
    """
    site = STADIUMS_BY_ID.get(site_id) if site_id else None
    home = STADIUMS_BY_ID.get(home_venue_id) if home_venue_id else None
    away = STADIUMS_BY_ID.get(away_venue_id) if away_venue_id else None

    indoors = _roof_is_indoor(roof)
    if site is None or home is None or away is None:
        return TravelProfile(0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                             neutral_site=False, indoors=bool(indoors), known=False)

    return TravelProfile(
        home_travel_miles=haversine_miles(home.lat, home.lon, site.lat, site.lon),
        away_travel_miles=haversine_miles(away.lat, away.lon, site.lat, site.lon),
        away_tz_shift=site.utc_offset - away.utc_offset,
        home_tz_shift=site.utc_offset - home.utc_offset,
        away_altitude_delta=site.altitude_m - away.altitude_m,
        home_altitude_delta=site.altitude_m - home.altitude_m,
        neutral_site=site_id != home_venue_id,
        indoors=bool(indoors),
        known=True,
    )


def _roof_is_indoor(roof: object) -> bool:
    """El techo real del partido. Desconocido cuenta como exterior.

    Un partido futuro todavía no tiene `roof` publicado. Tratar lo desconocido
    como exterior es la opción conservadora: la mayoría de estadios lo son, y
    equivocarse hacia «hay clima» no borra una señal, sólo la diluye.
    """
    if roof is None:
        return False
    key = str(roof).strip().lower()
    return key in INDOOR_ROOFS
