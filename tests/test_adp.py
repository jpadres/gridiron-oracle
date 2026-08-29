"""Instantáneas de ADP y emparejamiento estricto."""

from __future__ import annotations

import pytest

from oracle.fantasy.adp import AdpEntry, AdpSnapshot, match_to_players, trend


def _snapshot(entries, **kwargs) -> AdpSnapshot:
    base = dict(source="ffc", scoring="ppr", league_size=12,
                fetched_at="2026-08-29T12:00:00Z", sample_size=1500, window="7d")
    base.update(kwargs)
    return AdpSnapshot(entries=tuple(entries), **base)


PLAYERS = {
    "00-0038542": ("Bijan Robinson", "RB", "ATL"),
    "00-0037746": ("Brian Robinson", "RB", "ATL"),
    "00-0036442": ("Joe Burrow", "QB", "CIN"),
    "00-0036322": ("Amon-Ra St. Brown", "WR", "DET"),
}


def test_dos_robinson_de_atlanta_no_se_emparejan_con_ninguno():
    """El fallo que ya costó una iteración: «el modelo sube a Bijan 139 puestos».

    La clave inicial+apellido no distingue a Bijan de Brian, los dos son RB y
    los dos están en ATL. Ante la duda **no se empareja**, y la fila se cuenta
    como ambigua en vez de desaparecer.
    """
    informe = match_to_players(
        _snapshot([AdpEntry("B. Robinson", "RB", "ATL", 4.2)]), PLAYERS
    )
    assert informe.matched == {}
    assert len(informe.ambiguous) == 1
    entrada, candidatos = informe.ambiguous[0]
    assert entrada.name == "B. Robinson"
    assert set(candidatos) == {"00-0038542", "00-0037746"}


def test_nombre_completo_desambigua():
    """Con el nombre entero sí hay una única identidad posible."""
    informe = match_to_players(
        _snapshot([AdpEntry("Bijan Robinson", "RB", "ATL", 4.2)]), PLAYERS
    )
    assert informe.matched == {"00-0038542": 4.2}
    assert not informe.ambiguous


def test_codigos_de_equipo_pasan_por_normalize_team():
    """Un «LA» que debía ser «LAR» no emparejaba con nada, en silencio.

    Aquí se comprueba con los alias que sí conviven en las fuentes: JAC/JAX.
    """
    jugadores = {"00-0000001": ("Trevor Lawrence", "QB", "JAX")}
    informe = match_to_players(
        _snapshot([AdpEntry("Trevor Lawrence", "QB", "JAC", 90.0)]), jugadores
    )
    assert informe.matched == {"00-0000001": 90.0}


def test_puntuacion_y_sufijos_no_rompen_el_emparejamiento():
    informe = match_to_players(
        _snapshot([AdpEntry("Amon-Ra St. Brown", "WR", "DET", 15.0)]), PLAYERS
    )
    assert informe.matched == {"00-0036322": 15.0}


def test_lo_que_no_empareja_se_cuenta_no_se_descarta():
    """Un board que parece completo y le falta gente es peor que uno con huecos."""
    informe = match_to_players(
        _snapshot([AdpEntry("Jugador Inexistente", "WR", "SEA", 200.0)]), PLAYERS
    )
    assert informe.matched == {}
    assert len(informe.unmatched) == 1
    assert "1 sin emparejar" in informe.summary


def test_no_se_restan_dos_adp_incomparables():
    """Restar el PPR de una fuente al estándar de otra inventa una tendencia."""
    a = _snapshot([AdpEntry("Joe Burrow", "QB", "CIN", 60.0)])
    b = _snapshot([AdpEntry("Joe Burrow", "QB", "CIN", 45.0)], scoring="standard")
    with pytest.raises(ValueError, match="comparables"):
        trend(a, b)
    otra_liga = _snapshot([AdpEntry("Joe Burrow", "QB", "CIN", 45.0)], league_size=10)
    with pytest.raises(ValueError, match="comparables"):
        trend(a, otra_liga)


def test_la_tendencia_es_positiva_cuando_sube():
    a = _snapshot([AdpEntry("Joe Burrow", "QB", "CIN", 60.0)])
    b = _snapshot([AdpEntry("Joe Burrow", "QB", "CIN", 45.0)],
                  fetched_at="2026-08-30T12:00:00Z")
    assert trend(a, b) == {"Joe Burrow": 15.0}
