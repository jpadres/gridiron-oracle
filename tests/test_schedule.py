"""Semanas de descanso: un hecho comprobable, con sus tres estados distintos.

    DESCANSA ≠ ELIMINADO ≠ NO SE SABE.

Lo que este fichero protege es que ninguna de las tres se convierta en otra. Un
equipo eliminado en playoffs no «descansa», y un equipo del que faltan datos no
«juega» por defecto.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from oracle.fantasy.schedule import roster_byes, season_schedule


def _liga(season=2026, teams=("AAA", "BBB", "CCC", "DDD"), weeks=5, bye=None):
    """Un calendario sintético con descansos declarados.

    Cada semana empareja a los equipos que juegan. Con cuatro equipos y uno de
    descanso salen tres jugando, que es impar: se deja a uno fuera también, y
    ése sale como descanso ADICIONAL. Por eso los casos de prueba usan un
    número par de equipos jugando.
    """
    bye = bye or {}
    filas = []
    for week in range(1, weeks + 1):
        juegan = [t for t in teams if bye.get(t) != week]
        for i in range(0, len(juegan) - 1, 2):
            filas.append({
                "season": season, "week": week, "game_type": "REG",
                "home_team": juegan[i], "away_team": juegan[i + 1],
            })
    return pd.DataFrame(filas)


def test_deriva_el_descanso_por_ausencia():
    # TODOS descansan una vez: es lo que hace la NFL y lo que `complete` mide.
    # Con sólo dos de cuatro descansando, `complete` sale False con razón — los
    # otros dos juegan todas las semanas y no tienen descanso que derivar.
    games = _liga(bye={"AAA": 3, "BBB": 3, "CCC": 4, "DDD": 4})
    sc = season_schedule(games, 2026)
    assert sc.bye_week == {"AAA": 3, "BBB": 3, "CCC": 4, "DDD": 4}
    assert sc.complete is True
    assert sc.byes_in_week(3) == ("AAA", "BBB")
    assert sc.byes_in_week(1) == ()


def test_complete_es_falso_si_algun_equipo_no_tiene_descanso():
    """`complete` mide que CADA equipo tenga exactamente uno.

    Dos de cuatro descansando deja a los otros dos jugándolo todo. No es un
    error del calendario, pero tampoco es una temporada de la que se pueda
    afirmar el descanso de todos, y la diferencia se declara.
    """
    sc = season_schedule(_liga(bye={"AAA": 3, "BBB": 3}), 2026)
    assert sc.bye_week == {"AAA": 3, "BBB": 3}
    assert sc.complete is False
    assert sc.is_bye("CCC", 3) is None, "sin descanso derivable, no se afirma"


def test_is_bye_distingue_los_tres_estados():
    sc = season_schedule(_liga(bye={"AAA": 2, "BBB": 2, "CCC": 3, "DDD": 3}), 2026)
    assert sc.is_bye("AAA", 2) is True
    assert sc.is_bye("AAA", 1) is False
    # Equipo que no existe en el calendario: NO se sabe, no «no descansa».
    assert sc.is_bye("ZZZ", 2) is None
    # Semana fuera del calendario: tampoco se afirma.
    assert sc.is_bye("AAA", 99) is None


def test_los_playoffs_NO_producen_descansos():
    """Un equipo eliminado no descansa, y confundirlo daría un dato falso.

    Se construye una postemporada donde sólo dos de los cuatro equipos siguen.
    Los otros dos están ausentes de las semanas 19 y 20, y eso NO puede
    convertirse en dos descansos.
    """
    reg = _liga(weeks=4)
    post = pd.DataFrame([
        {"season": 2026, "week": 19, "game_type": "WC", "home_team": "AAA", "away_team": "BBB"},
        {"season": 2026, "week": 20, "game_type": "DIV", "home_team": "AAA", "away_team": "BBB"},
    ])
    sc = season_schedule(pd.concat([reg, post], ignore_index=True), 2026)
    assert 19 not in sc.weeks and 20 not in sc.weeks
    assert sc.bye_week == {}, "sin descansos: todos juegan las cuatro de regular"


def test_dos_semanas_libres_NO_se_afirman_como_descanso():
    """Si a un equipo le faltan dos semanas, el dato está incompleto.

    Elegir una de las dos sería inventar cuál es el descanso. Se declara
    incompleto y ese equipo se queda sin entrada.
    """
    games = _liga(weeks=6, bye={"AAA": 2})
    games = games[~((games.week == 5) & ((games.home_team == "AAA") | (games.away_team == "AAA")))]
    sc = season_schedule(games, 2026)
    assert "AAA" not in sc.bye_week
    assert sc.complete is False
    assert sc.is_bye("AAA", 2) is None, "sin descanso derivable, no se afirma"


def test_temporada_sin_datos_no_revienta_ni_inventa():
    sc = season_schedule(_liga(season=2026), 1999)
    assert sc.teams == () and sc.bye_week == {} and sc.complete is False
    assert sc.is_bye("AAA", 1) is None


def test_solo_mira_temporada_regular_aunque_falte_la_columna():
    """Sin `game_type` se usa todo, y eso es lo correcto para un fixture."""
    games = _liga(bye={"AAA": 2, "BBB": 2, "CCC": 3, "DDD": 3}).drop(columns=["game_type"])
    sc = season_schedule(games, 2026)
    assert sc.bye_week["AAA"] == 2


# --- plantilla ---------------------------------------------------------------

def _j(pid, team):
    return {"player_id": pid, "team": team, "position": "RB"}


def test_roster_byes_agrupa_por_semana_sin_opinar():
    sc = season_schedule(_liga(bye={"AAA": 3, "BBB": 3, "CCC": 4, "DDD": 4}), 2026)
    salida = roster_byes(sc, [_j("a", "AAA"), _j("b", "BBB"), _j("c", "CCC")], week=3)

    assert [p["player_id"] for p in salida["this_week"]] == ["a", "b"]
    assert sorted(p["player_id"] for p in salida["by_week"][3]) == ["a", "b"]
    assert salida["unknown"] == []
    # La salida son listas de jugadores. Nada de «ficha a alguien».
    assert set(salida) == {"this_week", "by_week", "unknown"}


def test_roster_byes_manda_a_UNKNOWN_lo_que_no_puede_establecer():
    sc = season_schedule(_liga(bye={"AAA": 3, "BBB": 3, "CCC": 4, "DDD": 4}), 2026)
    salida = roster_byes(sc, [_j("x", "ZZZ"), _j("y", ""), {"player_id": "z"}], week=3)
    assert [p["player_id"] for p in salida["unknown"]] == ["x", "y", "z"]
    assert salida["this_week"] == []


def test_roster_byes_sin_semana_devuelve_el_reparto_completo():
    sc = season_schedule(_liga(bye={"AAA": 3, "BBB": 3, "CCC": 4, "DDD": 4}), 2026)
    salida = roster_byes(sc, [_j("a", "AAA"), _j("b", "BBB")])
    assert salida["this_week"] == []
    assert sorted(p["player_id"] for p in salida["by_week"][3]) == ["a", "b"]


@pytest.mark.parametrize("season", [2025, 2026])
@pytest.mark.skipif(
    not Path("data/processed/games.parquet").exists(),
    # `data/processed` no se versiona y en CI no existe nunca (sin `oracle refresh`).
    # Se SALTA y se dice, en vez de ponerse rojo por un fichero que no es del test.
    reason="requiere data/processed/games.parquet (oracle refresh && oracle features)",
)
def test_el_calendario_real_da_32_descansos_de_32_equipos(season):
    """Sobre los datos de verdad, no sobre un fixture."""
    games = pd.read_parquet("data/processed/games.parquet")
    sc = season_schedule(games, season)
    assert len(sc.teams) == 32
    assert len(sc.bye_week) == 32
    assert sc.complete is True
    # Ningún descanso en la semana 1 ni en la última: la NFL no los pone ahí.
    assert all(2 <= w <= 15 for w in sc.bye_week.values()), sorted(set(sc.bye_week.values()))
