"""Tests de la sincronización con Sleeper.

Sin red: se prueban contra respuestas construidas con la forma que documenta
Sleeper. Lo que se valida aquí es **la traducción**, que es donde esto puede
fallar del peor modo posible — en silencio, produciendo un board entero y
correcto de otra liga.
"""

from __future__ import annotations

import pytest

from oracle.leagues import sleeper


def _league(**overrides) -> dict:
    base = {
        "league_id": "1389751577354461184",
        "name": "Liga de prueba",
        "season": "2026",
        "total_rosters": 12,
        "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX",
                             "BN", "BN", "BN", "BN", "BN"],
        "scoring_settings": {
            "pass_yd": 0.04, "pass_td": 4.0, "pass_int": -2.0,
            "rush_yd": 0.1, "rush_td": 6.0,
            "rec_yd": 0.1, "rec_td": 6.0, "rec": 1.0,
            "fum_lost": -2.0,
        },
    }
    base.update(overrides)
    return base


# --- puntuación --------------------------------------------------------------

def test_full_ppr_maps_to_one_point_per_reception():
    rules = sleeper.scoring_from(_league())
    assert rules.reception == 1.0
    assert rules.passing_td == 4.0
    assert rules.rushing_td == 6.0


def test_half_ppr_and_standard_come_through():
    settings = _league()["scoring_settings"]
    half = sleeper.scoring_from(_league(scoring_settings={**settings, "rec": 0.5}))
    standard = sleeper.scoring_from(_league(scoring_settings={**settings, "rec": 0.0}))
    assert half.reception == 0.5
    assert standard.reception == 0.0


def test_six_point_passing_touchdown_is_respected():
    """Una liga a 6 puntos por TD de pase sube al quarterback varias rondas.

    Si esto se ignorase, el board saldría entero y con los QB en el sitio
    equivocado — el fallo silencioso que este módulo existe para evitar.
    """
    settings = {**_league()["scoring_settings"], "pass_td": 6.0}
    assert sleeper.scoring_from(_league(scoring_settings=settings)).passing_td == 6.0


def test_unknown_offensive_scoring_raises_instead_of_being_ignored():
    """El caso importante: una regla que no sabemos traducir **para**.

    Una prima por recepción de ala cerrada cambia el valor de la posición
    entera. Aplicar un valor por defecto y seguir produciría un board de otra
    liga sin que nada fallase.
    """
    settings = {**_league()["scoring_settings"], "bonus_rec_te": 0.5}
    with pytest.raises(sleeper.UnmappedScoring) as error:
        sleeper.scoring_from(_league(scoring_settings=settings))
    assert "bonus_rec_te" in error.value.keys
    assert "0.5" in str(error.value)


def test_defensive_and_kicker_scoring_is_ignored_on_purpose():
    """Ignorar defensas y pateadores no distorsiona nada.

    Este proyecto sólo clasifica QB, RB, WR y TE: los puntos de un pateador no
    entran en ninguna comparación del board. Por eso van en `IGNORED` y no
    levantan error.
    """
    settings = {**_league()["scoring_settings"],
                "fgm_40_49": 4.0, "def_td": 6.0, "pts_allow_0": 10.0, "sack": 1.0}
    rules = sleeper.scoring_from(_league(scoring_settings=settings))
    assert rules.reception == 1.0


def test_conflicting_two_point_values_are_reported():
    """Los tres «2pt» de Sleeper caben en un solo atributo aquí.

    Si una liga los puntúa distinto no se puede representar, y promediarlos
    sería inventarse una regla que nadie escribió.
    """
    settings = {**_league()["scoring_settings"], "pass_2pt": 2.0, "rush_2pt": 3.0}
    with pytest.raises(sleeper.SleeperError, match="dos valores distintos"):
        sleeper.scoring_from(_league(scoring_settings=settings))


def test_missing_scoring_settings_is_a_clear_error():
    with pytest.raises(sleeper.SleeperError, match="scoring_settings"):
        sleeper.scoring_from({"total_rosters": 12})


# --- configuración de la liga ------------------------------------------------

def test_flex_is_split_between_running_backs_and_receivers():
    """Sin repartir el flex, el nivel de reemplazo de RB y WR sale demasiado alto.

    Y con él sale el VOR de todos ellos demasiado bajo, que es un sesgo que
    recorre el board entero.
    """
    settings = sleeper.league_settings_from(_league())
    starters = dict(settings.starters)
    assert starters["RB"] == 2.5
    assert starters["WR"] == 2.5
    assert starters["QB"] == 1.0


def test_superflex_changes_what_a_quarterback_is_worth():
    """En superflex deja de haber un quarterback titular por equipo.

    Es el cambio de reglas que más mueve un board, y por eso tiene test propio.
    """
    positions = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"]
    settings = sleeper.league_settings_from(_league(roster_positions=positions))
    assert dict(settings.starters)["QB"] == 2.0
    assert settings.replacement_rank("QB") == 24


def test_league_size_drives_the_replacement_level():
    small = sleeper.league_settings_from(_league(total_rosters=8))
    large = sleeper.league_settings_from(_league(total_rosters=14))
    assert small.replacement_rank("QB") == 8
    assert large.replacement_rank("QB") == 14


def test_broken_league_payloads_are_rejected():
    with pytest.raises(sleeper.SleeperError, match="total_rosters"):
        sleeper.league_settings_from({"roster_positions": ["QB"]})
    with pytest.raises(sleeper.SleeperError, match="roster_positions"):
        sleeper.league_settings_from({"total_rosters": 12})
    with pytest.raises(sleeper.SleeperError, match="reconocible"):
        sleeper.league_settings_from(_league(roster_positions=["BN", "IR"]))
