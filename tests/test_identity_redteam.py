"""IDENTIDAD ADVERSARIA: nombres que se parecen y no son la misma persona.

Colgar la noticia de la lesión de un receptor de OTRO receptor es peor que no
colgar nada. `matching.resolve` sólo empareja con equipo, pero dentro de un
equipo hay colisiones reales —Bijan y Brian Robinson en ATL, dos «J.Jones» en
MIN— y la clave `inicial.apellido` de nflverse no las distingue. Ante la duda
NO se empareja: eso es lo que se exige aquí, con los casos que ya han dolido y
los que todavía no.
"""

from __future__ import annotations

from oracle.narrative.matching import build_index, full_name_key, player_key, resolve

ATL = [
    {"player_id": "BIJAN", "player_name": "B.Robinson", "player_full_name": "Bijan Robinson", "team": "ATL"},
    {"player_id": "BRIAN", "player_name": "B.Robinson", "player_full_name": "Brian Robinson Jr.", "team": "ATL"},
    {"player_id": "LONDON", "player_name": "D.London", "player_full_name": "Drake London", "team": "ATL"},
]


def test_dos_jugadores_con_la_misma_clave_en_el_mismo_equipo_NO_se_emparejan_por_inicial():
    index = build_index(ATL)
    # «B.Robinson» a secas es ambiguo en ATL: nadie puede llevárselo.
    assert resolve(["B.Robinson"], "ATL", index) == []


def test_pero_el_nombre_completo_si_distingue_a_bijan_de_brian():
    index = build_index(ATL)
    assert resolve(["Bijan Robinson"], "ATL", index) == ["BIJAN"]
    assert resolve(["Brian Robinson Jr."], "ATL", index) == ["BRIAN"]
    assert resolve(["Brian Robinson"], "ATL", index) == ["BRIAN"], "el sufijo no forma parte del apellido"


def test_un_nombre_sin_colision_sigue_resolviendo_por_inicial():
    index = build_index(ATL)
    assert resolve(["D.London"], "ATL", index) == ["LONDON"]
    assert resolve(["Drake London"], "ATL", index) == ["LONDON"]


def test_mismo_apellido_en_equipos_distintos_no_se_cruza():
    players = ATL + [{"player_id": "OTRO", "player_name": "B.Robinson", "player_full_name": "Bob Robinson", "team": "WAS"}]
    index = build_index(players)
    assert resolve(["B.Robinson"], "WAS", index) == ["OTRO"]
    assert resolve(["Bijan Robinson"], "WAS", index) == [], "el equipo de la nota manda: Bijan no está en WAS"


def test_jugador_traspasado_la_nota_con_el_equipo_viejo_no_se_cuelga():
    # El board lleva el equipo ACTUAL. Una nota que hable de «los Falcons» sobre
    # alguien que ya no está allí no puede colgarse de su fila nueva.
    players = [{"player_id": "X", "player_name": "S.Diggs", "player_full_name": "Stefon Diggs", "team": "NE"}]
    index = build_index(players)
    assert resolve(["Stefon Diggs"], "BUF", index) == []
    assert resolve(["Stefon Diggs"], "NE", index) == ["X"]


def test_guiones_acentos_y_sufijos():
    assert player_key("Amon-Ra St. Brown") == player_key("A.St. Brown")
    assert player_key("José Ramírez") == player_key("J.Ramirez")
    assert player_key("Marvin Harrison Jr.") == player_key("M.Harrison")
    assert player_key("Kenneth Walker III") == player_key("K.Walker")
    assert full_name_key("Brian Robinson Jr.") == full_name_key("Brian Robinson")
    assert full_name_key("Bijan Robinson") != full_name_key("Brian Robinson")


def test_novato_dst_y_equipo_ausente_no_revientan_ni_inventan():
    index = build_index(ATL)
    assert resolve(["Falcons D/ST"], "ATL", index) == []
    assert resolve(["Nadie Nuevo"], "ATL", index) == []
    assert resolve(["Bijan Robinson"], "", index) == []
    assert resolve(["Bijan Robinson"], None, index) == []


def test_una_nota_con_los_dos_robinson_resuelve_a_los_dos_sin_mezclarlos():
    index = build_index(ATL)
    assert sorted(resolve(["Bijan Robinson", "Brian Robinson Jr."], "ATL", index)) == ["BIJAN", "BRIAN"]
