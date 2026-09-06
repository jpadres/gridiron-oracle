"""Aparecer en el fichero de plantillas no es tener equipo.

El fallo que estas pruebas existen para impedir: `mark_rostered` preguntaba
«¿tiene fila?» y el roster de nflverse trae también a los cortados y a los
retirados. En el board de 2026, 76 de ellos se leían como un jugador
normal la víspera de un draft.
"""
from __future__ import annotations

import pandas as pd
import pytest

from oracle.fantasy import roster_status


def _roster(rows, tmp_path, name="roster_2026.parquet"):
    base = {"season": 2026, "week": 1, "team": "KC", "status_description_abbr": "A01"}
    frame = pd.DataFrame([{**base, **r} for r in rows])
    path = tmp_path / name
    frame.to_parquet(path)
    return path


def test_cut_and_retired_have_no_team(tmp_path):
    path = _roster([
        {"gsis_id": "act", "status": "ACT"},
        {"gsis_id": "cut", "status": "CUT", "status_description_abbr": "W03"},
        {"gsis_id": "ret", "status": "RET"},
        {"gsis_id": "res", "status": "RES", "status_description_abbr": "R01"},
        {"gsis_id": "dev", "status": "DEV", "status_description_abbr": "P01"},
    ], tmp_path)
    e = roster_status.load(path)
    assert e["cut"].has_team is False and e["ret"].has_team is False
    # La reserva y el equipo de prácticas SÍ son equipo: el jugador está fichado.
    assert e["res"].has_team is True and e["dev"].has_team is True
    # Pero ninguno de los dos está en el 53 activo.
    assert e["act"].on_active_roster is True
    assert all(not e[k].on_active_roster for k in ("res", "dev", "cut", "ret"))


def test_an_unknown_status_raises_instead_of_passing_as_active(tmp_path):
    path = _roster([{"gsis_id": "x", "status": "ZZZ"}], tmp_path)
    with pytest.raises(roster_status.RosterStageUnknown):
        roster_status.load(path)


def test_a_missing_status_column_raises(tmp_path):
    frame = pd.DataFrame([{"gsis_id": "x", "team": "KC", "season": 2026, "week": 1,
                           "status_description_abbr": "A01"}])
    path = tmp_path / "roster_2026.parquet"
    frame.to_parquet(path)
    with pytest.raises((roster_status.RosterStageUnknown, KeyError, ValueError)):
        roster_status.load(path)


def test_only_the_newest_week_counts(tmp_path):
    path = _roster([
        {"gsis_id": "p", "status": "ACT", "week": 1},
        {"gsis_id": "p", "status": "CUT", "week": 3, "status_description_abbr": "W03"},
    ], tmp_path)
    e = roster_status.load(path)
    # Cortado en la semana 3: la semana 1 diría que sigue activo.
    assert e["p"].state == roster_status.NOT_ON_ROSTER and e["p"].week == 3


def test_attach_marks_absent_players_and_touches_no_number(tmp_path):
    path = _roster([{"gsis_id": "act", "status": "ACT"}], tmp_path)
    e = roster_status.load(path)
    filas = [
        {"player_id": "act", "vor": 100.0, "projected_points": 200.0},
        {"player_id": "fantasma", "vor": 50.0, "projected_points": 120.0},
    ]
    assert roster_status.attach(filas, e) == 2
    assert filas[0]["roster_state"] == roster_status.ACTIVE
    # Sin fila = sin equipo. Dejarlo sin marca lo devolvería a parecer normal.
    assert filas[1]["roster_state"] == roster_status.NOT_ON_ROSTER
    assert filas[1]["roster_basis"] == "SIN_FILA"
    # La regla 8, comprobable: ni un número se movió.
    assert filas[0]["vor"] == 100.0 and filas[0]["projected_points"] == 200.0
    assert filas[1]["vor"] == 50.0 and filas[1]["projected_points"] == 120.0
    assert all(k == "player_id" or k.startswith(("roster_", "vor", "projected"))
               for f in filas for k in f)


def test_without_a_file_nobody_is_marked(tmp_path):
    e = roster_status.load(tmp_path / "no_existe.parquet")
    filas = [{"player_id": "x"}]
    assert roster_status.attach(filas, e) == 0
    # Sin dato no se afirma «no tiene equipo» de nadie.
    assert "roster_state" not in filas[0]


def test_team_changes_are_reported_against_the_board_team(tmp_path):
    path = _roster([
        {"gsis_id": "movido", "status": "ACT", "team": "NYJ"},
        {"gsis_id": "quieto", "status": "ACT", "team": "KC"},
    ], tmp_path)
    e = roster_status.load(path)
    filas = [
        {"player_id": "movido", "team": "KC", "player_full_name": "A", "overall_rank": 5},
        {"player_id": "quieto", "team": "KC", "player_full_name": "B", "overall_rank": 6},
    ]
    cambios = roster_status.team_changes(filas, e)
    assert [c["player_id"] for c in cambios] == ["movido"]
    assert cambios[0]["board_team"] == "KC" and cambios[0]["roster_team"] == "NYJ"


def test_LA_and_LAR_are_the_same_team_and_not_a_change(tmp_path):
    """El fichero de plantillas escribe «LA» y el board «LAR».

    Comparar en crudo publicaba a Puka Nacua como cambio de equipo la víspera de
    un draft. Es el `AZ`/`ARI` de la tabla de errores: todo código pasa por
    `normalize_team`.
    """
    path = _roster([
        {"gsis_id": "nacua", "status": "ACT", "team": "LA"},
        {"gsis_id": "real", "status": "ACT", "team": "DET"},
    ], tmp_path)
    e = roster_status.load(path)
    filas = [
        {"player_id": "nacua", "team": "LAR", "player_full_name": "Puka", "overall_rank": 2},
        {"player_id": "real", "team": "KC", "player_full_name": "Otro", "overall_rank": 3},
    ]
    cambios = roster_status.team_changes(filas, e)
    assert [c["player_id"] for c in cambios] == ["real"], "LA y LAR no son equipos distintos"
    assert cambios[0]["board_team"] == "KC" and cambios[0]["roster_team"] == "DET"


def test_the_roster_team_is_normalized_at_load_not_by_each_consumer(tmp_path):
    """«LA» y «LAR» son el mismo equipo también cuando el campo se PINTA.

    `team_changes` ya comparaba normalizado, pero `roster_team` viajaba crudo a
    la interfaz: el pateador de los Rams salía «on LA» junto a una fila que dice
    LAR. Se normaliza una vez, al leer.
    """
    path = _roster([{"gsis_id": "x", "status": "ACT", "team": "LA"}], tmp_path)
    e = roster_status.load(path)
    assert e["x"].team == "LAR"
    filas = [{"player_id": "x"}]
    roster_status.attach(filas, e)
    assert filas[0]["roster_team"] == "LAR"


def test_specialists_are_checked_against_the_roster_too(tmp_path, monkeypatch):
    """Los pateadores y las defensas pasan por la MISMA capa que el board.

    Cubría las 552 filas del board y CERO de los 64 especialistas, que salen de
    quien más pateó la temporada PASADA: diez de los 32 pateadores publicados
    estaban mal — cuatro sin equipo, tres activos en otro equipo, dos en el
    equipo de prácticas. Es el pick de última ronda, donde nadie mira dos veces.
    """
    import importlib.util
    from pathlib import Path

    # Por RUTA, no por `sys.path`: CI ejecuta `pytest` a secas y ése no mete el
    # directorio actual en la ruta de módulos.
    ruta = Path(__file__).resolve().parents[1] / "scripts" / "fantasy_build.py"
    spec = importlib.util.spec_from_file_location("_scripts_fantasy_build", ruta)
    fantasy_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fantasy_build)

    _roster([
        {"gsis_id": "activo", "status": "ACT", "team": "KC"},
        {"gsis_id": "cortado", "status": "CUT", "team": "ATL",
         "status_description_abbr": "W03"},
    ], tmp_path)

    kickers = [{"player_id": "activo", "team": "KC", "position": "K"},
               {"player_id": "cortado", "team": "ATL", "position": "K"}]
    defenses = [{"player_id": "DST_KC", "team": "KC", "position": "DST"}]

    def fake_specialists(players, team_games, season, raw_dir=None):
        entries = roster_status.load(raw_dir / f"roster_{season}.parquet") if raw_dir else {}
        if entries:
            roster_status.attach(kickers, entries)
            roster_status.attach(defenses, entries)
        return {"kickers": kickers, "defenses": defenses}

    # Se comprueba el CONTRATO que `_specialists` tiene que cumplir: que la
    # función real llame a `attach`. Si alguien la quita, esto cae.
    fuente = Path(fantasy_build.__file__).read_text(encoding="utf-8")
    assert "roster_status.attach(kickers, entries)" in fuente, (
        "los pateadores publicados no se comprueban contra la plantilla")
    assert "roster_status.attach(defenses, entries)" in fuente

    fake_specialists(None, None, 2026, raw_dir=tmp_path)
    assert kickers[0]["roster_state"] == roster_status.ACTIVE
    assert kickers[1]["roster_state"] == roster_status.NOT_ON_ROSTER
    # Y LA DEFENSA NO ES UNA PERSONA. La versión anterior de esta prueba exigía
    # `NOT_ON_ROSTER` para ella —«no está en ningún roster»— y con eso el
    # payload publicaba las 32 defensas como si no tuvieran equipo NFL: un
    # hecho inventado, a un `rosterMark` de distancia de pintarse «NO NFL
    # TEAM» junto a la defensa de Kansas City. Marcarla es correcto; marcarla
    # con una de las cinco respuestas de un jugador, no.
    assert defenses[0]["roster_state"] == roster_status.TEAM_UNIT
    assert defenses[0]["roster_team"] == "KC"
    assert defenses[0]["roster_state"] not in roster_status.NO_TEAM, (
        "una defensa nunca puede contar como «sin equipo NFL»")


def test_la_ausencia_de_fila_se_fecha_con_el_fichero(tmp_path):
    """«No aparece en el roster» es una afirmación SOBRE EL FICHERO.

    Sin fecha, la pantalla escribía «not on any NFL roster as of an unknown
    date» en 66 filas del board teniendo la fecha del fichero delante. La
    afirmación era cierta y la presentación rompía la regla 5: una afirmación
    de actualidad sin su fecha.
    """
    _roster([{"gsis_id": "activo", "status": "ACT", "team": "KC"}], tmp_path)
    entries = roster_status.load(tmp_path / "roster_2026.parquet")
    fecha = next(iter(entries.values())).source_as_of
    filas = [{"player_id": "fantasma", "team": "KC", "position": "WR"}]
    roster_status.attach(filas, entries)
    assert filas[0]["roster_state"] == roster_status.NOT_ON_ROSTER
    assert filas[0]["roster_basis"] == "SIN_FILA"
    assert filas[0]["roster_source_as_of"] == fecha
