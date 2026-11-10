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


def test_una_afirmacion_de_marzo_no_describe_una_plantilla_de_septiembre():
    """El conflicto entre la prensa y el registro, resuelto por QUIÉN VIO DESPUÉS.

    Caso real del 6 de septiembre de 2026: Stefon Diggs, receptor 72 del board,
    marcado `NO NFL TEAM` con severidad OUT por un hecho del 11 de marzo, y
    ACTIVO en Washington según el registro de plantillas del 5 de septiembre.
    Un OUT lo sacaba de la lista corta entera.
    """
    filas = [{
        "player_id": "00-0031588", "player_full_name": "Stefon Diggs",
        "status_label": "NO NFL TEAM", "status_severity": "OUT",
        "status_effective_at": "2026-03-11", "status_verified_at": "2026-09-03",
        "roster_state": roster_status.ACTIVE, "roster_team": "WAS",
        "roster_source_as_of": "2026-09-05",
        "projected_points": 180.0, "vor": 48.0,
    }]
    antes = dict(filas[0])
    tocadas = roster_status.reconcile(filas)
    assert len(tocadas) == 1
    assert filas[0]["status_disputed"] is True
    assert "2026-03-11" in filas[0]["status_dispute"]
    assert "2026-09-05" in filas[0]["status_dispute"]
    # NO SE BORRA NADA: el desacuerdo es información, y los números tampoco.
    assert filas[0]["status_label"] == "NO NFL TEAM"
    assert filas[0]["projected_points"] == antes["projected_points"]
    assert filas[0]["vor"] == antes["vor"]


def test_si_la_prensa_vio_DESPUES_no_se_toca():
    """A quien cortan hoy con un fichero de plantillas de la semana pasada, la
    prensa es la que vio después. La regla no es «el registro siempre gana»."""
    filas = [{
        "player_id": "x", "status_label": "NO NFL TEAM", "status_severity": "OUT",
        "status_effective_at": "2026-09-06",
        "roster_state": roster_status.ACTIVE, "roster_team": "WAS",
        "roster_source_as_of": "2026-09-01",
    }]
    assert roster_status.reconcile(filas) == []
    assert "status_disputed" not in filas[0]


def test_sin_las_dos_fechas_NO_se_desactiva_un_aviso():
    """Sin saber quién vio después no se decide: UNKNOWN no es «adelante»."""
    filas = [{
        "player_id": "x", "status_label": "NO NFL TEAM", "status_severity": "OUT",
        "roster_state": roster_status.ACTIVE, "roster_team": "WAS",
        "roster_source_as_of": "2026-09-05",
    }]
    assert roster_status.reconcile(filas) == []
    filas[0]["status_effective_at"] = "2026-03-11"
    filas[0]["roster_source_as_of"] = None
    assert roster_status.reconcile(filas) == []


def test_un_OUT_que_el_registro_CONFIRMA_sigue_siendo_un_OUT():
    """Tyreek Hill: la prensa dice sin equipo y el registro tampoco lo tiene."""
    filas = [{
        "player_id": "y", "status_label": "NO NFL TEAM", "status_severity": "OUT",
        "status_effective_at": "2026-02-01",
        "roster_state": roster_status.NOT_ON_ROSTER, "roster_team": None,
        "roster_source_as_of": "2026-09-05",
    }]
    assert roster_status.reconcile(filas) == []
    assert "status_disputed" not in filas[0]


def test_INA_es_la_lista_de_inactivos_de_un_partido_no_una_situacion(tmp_path):
    """Un inactivo de jornada sigue en el 53, y el fichero lo dice con A01.

    `INA` apareció el 13 de septiembre de 2026 y el módulo falló cerrado, que
    es lo correcto. Lo que decide la traducción es el propio fichero: las 25
    filas eran los cuatro equipos que ya habían jugado y las 25 llevaban el
    MISMO código fino `A01` que las 1.672 filas `ACT`. Traducirlo a reserva
    habría sacado del board a gente que sí tiene equipo.
    """
    ruta = tmp_path / "roster_2026.parquet"
    pd.DataFrame([
        {"gsis_id": "00-0000001", "status": "ACT", "team": "SEA",
         "status_description_abbr": "A01", "season": 2026, "week": 1},
        {"gsis_id": "00-0000002", "status": "INA", "team": "NE",
         "status_description_abbr": "A01", "season": 2026, "week": 1},
        {"gsis_id": "00-0000003", "status": "RES", "team": "SF",
         "status_description_abbr": "R01", "season": 2026, "week": 1},
    ]).to_parquet(ruta)

    entries = roster_status.load(ruta)
    inactivo = entries["00-0000002"]
    assert inactivo.state == roster_status.ACTIVE
    assert inactivo.on_active_roster, "un inactivo de jornada sigue en el 53"
    assert inactivo.has_team
    # Y no se confunde con quien de verdad está fuera del 53.
    assert entries["00-0000003"].state == roster_status.RESERVE
    assert not entries["00-0000003"].on_active_roster


def test_una_etiqueta_de_plantilla_NUEVA_sigue_levantando(tmp_path):
    """La puerta que cazó `INA` tiene que seguir cerrada para la siguiente.

    Conocer siete códigos no es conocerlos todos: el fichero puede añadir otro
    mañana igual que añadió éste, y traducirlo a «activo» por defecto es el
    fallo que dejó 444 cortados y retirados leyéndose como jugadores normales.
    """
    ruta = tmp_path / "roster_2026.parquet"
    pd.DataFrame([
        {"gsis_id": "00-0000001", "status": "ZZZ", "team": "SEA",
         "status_description_abbr": "A01", "season": 2026, "week": 1},
    ]).to_parquet(ruta)
    with pytest.raises(roster_status.RosterStageUnknown, match="ZZZ"):
        roster_status.load(ruta)


# === EL LISTADO MÁS RECIENTE ES POR CLUB ====================================
#
# El 14 de octubre de 2026, con cuatro clubes en descanso, 16 de los 150
# primeros del board salían «NO NFL TEAM»: `load` se quedaba con la semana más
# alta del fichero y el club que descansa no publica listado esa semana.


def _dos_clubes(tmp_path, extra=()):
    """KC juega la 5 y la 6. CIN descansa en la 6: su último listado es la 5."""
    return _roster([
        {"gsis_id": "kc-qb", "status": "ACT", "team": "KC", "week": 5},
        {"gsis_id": "kc-qb", "status": "ACT", "team": "KC", "week": 6},
        {"gsis_id": "cin-wr", "status": "ACT", "team": "CIN", "week": 5},
        {"gsis_id": "cin-ir", "status": "RES", "team": "CIN", "week": 5,
         "status_description_abbr": "R01"},
        *extra,
    ], tmp_path)


def test_un_club_en_descanso_conserva_su_ultimo_listado(tmp_path):
    e = roster_status.load(_dos_clubes(tmp_path))
    assert "cin-wr" in e, "la plantilla del club que descansa desapareció del registro"
    assert e["cin-wr"].state == roster_status.ACTIVE
    assert e["cin-wr"].has_team is True
    assert e["cin-ir"].state == roster_status.RESERVE
    # Y la semana que lleva es la de SU fila, no la del fichero.
    assert e["cin-wr"].week == 5 and e["kc-qb"].week == 6


def test_y_attach_no_lo_marca_sin_equipo(tmp_path):
    # La consecuencia que se vio: «NO NFL TEAM» junto a Ja'Marr Chase.
    filas = [{"player_id": "cin-wr", "vor": 90.0}, {"player_id": "kc-qb", "vor": 80.0}]
    roster_status.attach(filas, roster_status.load(_dos_clubes(tmp_path)))
    assert [f["roster_state"] for f in filas] == [roster_status.ACTIVE, roster_status.ACTIVE]
    assert [f["vor"] for f in filas] == [90.0, 80.0], "marca, no calcula"


def test_quien_sale_del_ultimo_listado_de_SU_club_se_queda_sin_fila(tmp_path):
    # La otra mitad: «la última foto de cada club» no es «la última fila de cada
    # jugador». Uno que KC listaba en la 5 y ya no en la 6 NO sigue activo.
    path = _dos_clubes(tmp_path, extra=[
        {"gsis_id": "kc-ex", "status": "ACT", "team": "KC", "week": 5},
    ])
    assert "kc-ex" not in roster_status.load(path)


def test_si_otro_club_lo_lista_despues_manda_la_fila_mas_nueva(tmp_path):
    # Activo en CIN (descansa, foto de la 5) y en el equipo de prácticas de KC
    # en la 6: lo último que se sabe de él es lo de KC.
    path = _dos_clubes(tmp_path, extra=[
        {"gsis_id": "cin-wr", "status": "DEV", "team": "KC", "week": 6,
         "status_description_abbr": "P01"},
    ])
    e = roster_status.load(path)
    assert e["cin-wr"].team == "KC" and e["cin-wr"].state == roster_status.PRACTICE_SQUAD


def test_dos_jornadas_sin_listado_no_son_un_descanso(tmp_path):
    path = _roster([
        {"gsis_id": "a", "status": "ACT", "team": "KC", "week": 7},
        {"gsis_id": "b", "status": "ACT", "team": "CIN", "week": 5},
    ], tmp_path)
    with pytest.raises(roster_status.RosterStageUnknown, match="CIN"):
        roster_status.load(path)


def test_el_fichero_real_de_descansos_no_deja_a_nadie_fuera(tmp_path):
    # La forma medida en 2026: 32 clubes, cuatro de ellos sin la última semana.
    clubes = [f"T{i:02d}" for i in range(32)]
    filas = []
    for i, club in enumerate(clubes):
        filas.append({"gsis_id": f"p{i}", "status": "ACT", "team": club, "week": 5})
        if i >= 4:   # los cuatro primeros descansan en la 6
            filas.append({"gsis_id": f"p{i}", "status": "ACT", "team": club, "week": 6})
    e = roster_status.load(_roster(filas, tmp_path))
    assert len(e) == 32
    assert all(x.state == roster_status.ACTIVE for x in e.values())


# === TRC / TRD / TRT ========================================================


@pytest.mark.parametrize("etiqueta", ["TRC", "TRD", "TRT"])
def test_una_transaccion_es_el_club_soltandolo(tmp_path, etiqueta):
    """38 de las 40 filas de 2023-2026 son lo último que ese club dice de él."""
    path = _roster([
        {"gsis_id": "ps", "status": etiqueta, "status_description_abbr": "P01"},
        {"gsis_id": "k", "status": etiqueta, "status_description_abbr": "A01"},
        {"gsis_id": "ok", "status": "ACT"},
    ], tmp_path)
    e = roster_status.load(path)
    assert e["ps"].state == roster_status.NOT_ON_ROSTER
    assert e["k"].has_team is False and e["k"].on_active_roster is False
    # El código fino viaja crudo: lo que no se traduce no se pierde.
    assert e["ps"].roster_code == "P01"
    assert e["ok"].state == roster_status.ACTIVE


def test_una_etiqueta_desconocida_en_una_semana_VIEJA_no_bloquea(tmp_path):
    # Lo que se publica es el último listado; una etiqueta rara de septiembre
    # que ya no describe a nadie no puede parar la exportación de noviembre.
    path = _roster([
        {"gsis_id": "p", "status": "ZZZ", "week": 2},
        {"gsis_id": "p", "status": "ACT", "week": 3},
    ], tmp_path)
    assert roster_status.load(path)["p"].state == roster_status.ACTIVE


def test_pero_en_el_listado_que_se_publica_sigue_levantando(tmp_path):
    path = _roster([
        {"gsis_id": "p", "status": "ACT", "week": 2},
        {"gsis_id": "p", "status": "ZZZ", "week": 3},
    ], tmp_path)
    with pytest.raises(roster_status.RosterStageUnknown, match="ZZZ"):
        roster_status.load(path)
