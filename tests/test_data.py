"""Tests de ingesta y geografía.

El bloque de `normalize_team` es el que evita el error más silencioso de todo el
proyecto: un join que no falla, sólo pierde filas.
"""

from __future__ import annotations

import pandas as pd
import pytest

from oracle.data.ingest import TEAM_ALIASES, VALID_TEAMS, normalize_team, normalize_team_series
from oracle.data.stadiums import (
    STADIUMS_BY_ID,
    TEAM_STADIUMS,
    haversine_miles,
    home_venue_map,
    travel_profile,
    venue_travel,
)

# ---------------------------------------------------------------------------
# Normalización de equipos
# ---------------------------------------------------------------------------

def test_known_inconsistencies_are_collapsed():
    """nflverse no es consistente entre datasets. Todo pasa por aquí.

    `AZ` vs `ARI` es el caso clásico: un dataset usa uno y otro el otro, y el
    join no falla — simplemente pierde las filas en silencio, que es peor.
    """
    assert normalize_team("AZ") == "ARI"
    assert normalize_team("ARI") == "ARI"
    assert normalize_team("JAC") == normalize_team("JAX") == "JAX"
    assert normalize_team("WSH") == normalize_team("WFT") == "WAS"


def test_relocations_keep_the_franchise_identity():
    """Los ratings siguen a la organización, no a la ciudad.

    STL y LAR son el mismo equipo con la misma plantilla: separarlos reiniciaría
    el rating en 2016 sin ningún motivo deportivo.
    """
    assert normalize_team("STL") == normalize_team("LA") == "LAR"
    assert normalize_team("SD") == "LAC"
    assert normalize_team("OAK") == "LV"


def test_unknown_teams_become_none_not_garbage():
    """Devolver None permite contar y avisar; propagar la basura, no."""
    assert normalize_team("XYZ") is None
    assert normalize_team(None) is None
    assert normalize_team(float("nan")) is None
    assert normalize_team("") is None


def test_normalization_is_idempotent_and_case_insensitive():
    for team in VALID_TEAMS:
        assert normalize_team(team) == team
        assert normalize_team(team.lower()) == team
        assert normalize_team(f"  {team} ") == team


def test_every_alias_resolves_to_a_valid_team():
    for alias, target in TEAM_ALIASES.items():
        assert target in VALID_TEAMS, f"El alias {alias} apunta a un equipo inexistente."


def test_series_normalization_preserves_length():
    """La versión vectorizada no puede colar ni perder filas.

    Los desconocidos salen como nulos (`Series.map` los convierte a NaN, no a
    None; para el `dropna` de aguas abajo es lo mismo), y lo que importa es que
    la longitud se conserve: si esta función filtrase, el join posterior
    quedaría desalineado sin dar ningún error.
    """
    series = pd.Series(["AZ", "LA", "XYZ", None, "KC"])
    normalized = normalize_team_series(series)

    assert len(normalized) == len(series)
    assert list(normalized[[0, 1, 4]]) == ["ARI", "LAR", "KC"]
    assert normalized[[2, 3]].isna().all()
    assert normalized.dropna().tolist() == ["ARI", "LAR", "KC"]


# ---------------------------------------------------------------------------
# Geografía
# ---------------------------------------------------------------------------

def test_all_teams_have_a_stadium():
    assert set(TEAM_STADIUMS) == set(VALID_TEAMS)


def test_shared_stadiums_are_identical():
    """LAR/LAC y NYG/NYJ comparten sede física."""
    assert TEAM_STADIUMS["LAR"].lat == TEAM_STADIUMS["LAC"].lat
    assert TEAM_STADIUMS["NYG"].lon == TEAM_STADIUMS["NYJ"].lon


def test_haversine_against_known_distances():
    # Seattle - Miami: ~2.700 millas, el vuelo más largo de la liga.
    distance = haversine_miles(
        TEAM_STADIUMS["SEA"].lat, TEAM_STADIUMS["SEA"].lon,
        TEAM_STADIUMS["MIA"].lat, TEAM_STADIUMS["MIA"].lon,
    )
    assert 2600 < distance < 2900
    # Y la sede consigo misma es cero.
    assert haversine_miles(40.0, -80.0, 40.0, -80.0) == pytest.approx(0.0)


def test_home_team_does_not_travel_at_home():
    profile = travel_profile("KC", "BUF")
    assert profile.home_travel_miles == pytest.approx(0.0)
    assert profile.away_travel_miles > 800
    assert profile.neutral_site is False



def test_timezone_shift_has_a_direction():
    """Viajar al este (perder horas) y al oeste no son lo mismo."""
    east = travel_profile("NYJ", "SEA")   # el visitante viaja de Seattle a Nueva York
    west = travel_profile("SEA", "NYJ")   # y al revés
    assert east.away_tz_shift > 0
    assert west.away_tz_shift < 0
    assert east.away_tz_shift == pytest.approx(-west.away_tz_shift)


def test_altitude_is_relative_to_the_visitor_not_absolute():
    """Denver no tiene ventaja por jugar alto: la tiene por jugar MÁS alto."""
    at_denver = travel_profile("DEN", "MIA")
    assert at_denver.away_altitude_delta > 1500
    assert at_denver.home_altitude_delta == pytest.approx(0.0)

    # Y en Ciudad de México sube para los dos, incluido el "local".


def test_retractable_roofs_count_as_indoors():
    """Un techo retráctil se cierra cuando hace malo: justo cuando importaba."""
    assert TEAM_STADIUMS["DAL"].indoors is True   # retráctil
    assert TEAM_STADIUMS["NO"].indoors is True    # cúpula
    assert TEAM_STADIUMS["GB"].indoors is False   # a la intemperie


def test_unknown_team_yields_no_information_not_zero_travel():
    """Una franquicia desconocida no puede parecer "sin viaje relevante"."""
    profile = travel_profile("XXX", "KC")
    assert profile.away_travel_miles == 0.0
    assert profile.home_travel_miles == 0.0
    assert profile.known is False


def test_todas_las_sedes_tienen_coordenadas_plausibles():
    """Una coordenada intercambiada convierte Londres en el Atlántico sur.

    No es paranoia: el error de teclear la latitud en el lugar de la longitud no
    revienta nada, sólo produce un viaje absurdo que nadie mira.
    """
    for key, venue in STADIUMS_BY_ID.items():
        assert -90 <= venue.lat <= 90, key
        assert -180 <= venue.lon <= 180, key
        assert -12 <= venue.utc_offset <= 14, key
        assert -100 <= venue.altitude_m <= 3000, key


def test_sedes_internacionales_fuera_de_husos_americanos():
    """Las europeas y la australiana no pueden estar en horario americano."""
    for key in ("LON00", "LON01", "LON02", "GER00", "MUN01", "FRA00", "MAD01", "PAR00", "MEL00"):
        assert STADIUMS_BY_ID[key].utc_offset >= 0, key
    # Y las americanas al contrario, incluidas las sudamericanas.
    for key in ("KAN00", "SEA00", "MEX00", "SAO00", "RIO00"):
        assert STADIUMS_BY_ID[key].utc_offset < 0, key


# ---------------------------------------------------------------------------
# Sedes por identificador de nflverse
# ---------------------------------------------------------------------------

def test_home_venue_map_solo_usa_calendario():
    """El mapa de sedes no puede tocar nada que dependa del resultado.

    Es la afirmación que permite construirlo de una vez sobre toda la temporada
    en vez de ir acumulándolo partido a partido. Si alguien añadiese ahí una
    columna de marcador, la garantía anti-fuga del proyecto dejaría de valer y
    este test es lo que lo impide.
    """
    calendario = pd.DataFrame({
        "season": [2024, 2024], "home_team": ["LAR", "LAR"],
        "location": ["Home", "Home"], "stadium_id": ["LAX01", "LAX01"],
    })
    # Sin marcador, sin margen, sin `played`: si `home_venue_map` los necesitara,
    # esto reventaría.
    assert home_venue_map(calendario) == {("LAR", 2024): "LAX01"}


def test_sedes_anteriores_a_la_mudanza():
    """El defecto que motivó el módulo: San Luis no es Los Ángeles.

    `normalize_team` traduce STL -> LAR para la continuidad de Elo, y eso está
    bien. Lo que no puede pasar es que un partido de 2010 se sitúe en SoFi.
    """
    stl = STADIUMS_BY_ID["STL00"]
    sofi = STADIUMS_BY_ID["LAX01"]
    assert haversine_miles(stl.lat, stl.lon, sofi.lat, sofi.lon) > 1500
    assert stl.utc_offset - sofi.utc_offset == pytest.approx(2.0)

    perfil = venue_travel("STL00", "STL00", "SEA00", roof="dome")
    assert perfil.home_travel_miles == pytest.approx(0.0)   # jugaba en su casa
    assert 1500 < perfil.away_travel_miles < 2000           # y Seattle viajaba a San Luis



def test_techo_sale_del_partido_y_no_de_la_sede():
    """Un techo retráctil abierto deja el clima dentro.

    713 partidos tenían mal este campo porque salía de una constante por equipo.
    """
    cerrado = venue_travel("DAL00", "DAL00", "NYC01", roof="closed")
    abierto = venue_travel("DAL00", "DAL00", "NYC01", roof="open")
    assert cerrado.indoors is True
    assert abierto.indoors is False


def test_sede_desconocida_se_marca_como_desconocida():
    """Cero millas porque juega en casa y cero porque no lo sé no son lo mismo."""
    perfil = venue_travel("NO_EXISTE", "DAL00", "NYC01")
    assert perfil.known is False
    assert perfil.away_travel_miles == pytest.approx(0.0)
    assert venue_travel("DAL00", "DAL00", "NYC01").known is True
