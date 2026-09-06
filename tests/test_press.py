"""Menciones de prensa: qué se cuelga de un jugador y qué NO.

Los casos son los que ya costaron una iteración en este repositorio: dos
jugadores con el mismo nombre, un universitario que se llama igual que un
profesional, y una fecha de descarga haciéndose pasar por fecha de publicación.
"""

from __future__ import annotations

from oracle.narrative import press

BIJAN = {"player_id": "1", "player_full_name": "Bijan Robinson", "team": "ATL"}
BRIAN = {"player_id": "2", "player_full_name": "Brian Robinson", "team": "ATL"}
NACUA = {"player_id": "3", "player_full_name": "Puka Nacua", "team": "LAR"}
# Dos filas con el MISMO nombre completo, que es lo que el índice tiene que
# negarse a resolver.
GEMELO_A = {"player_id": "4", "player_full_name": "Josh Allen", "team": "BUF"}
GEMELO_B = {"player_id": "5", "player_full_name": "Josh Allen", "team": "JAX"}


def entrada(**kw):
    base = {"title": "", "summary": "", "outlet": "X", "url": "u",
            "published_at": "2026-09-06T12:00:00Z", "team": None}
    base.update(kw)
    return base


def test_cuelga_la_mencion_del_jugador_cuyo_equipo_corrobora():
    e = entrada(title="Puka Nacua leads Rams receivers", team="LAR")
    out = press.mentions([e], [NACUA])
    assert list(out) == ["3"]
    assert out["3"][0]["published_at"] == "2026-09-06T12:00:00Z"


def test_dos_nombres_completos_IGUALES_no_emparejan_a_ninguno():
    """Ante la duda no se empareja, tampoco «el primero»."""
    e = entrada(title="Josh Allen was dominant", team="BUF")
    assert press.mentions([e], [GEMELO_A, GEMELO_B]) == {}


def test_los_dos_Robinson_se_distinguen_por_el_nombre_COMPLETO():
    e = entrada(title="Bijan Robinson carried it 20 times", team="ATL")
    assert list(press.mentions([e], [BIJAN, BRIAN])) == ["1"]


def test_un_universitario_que_se_llama_igual_NO_cuenta_como_su_tocayo():
    """El feed trae fútbol universitario: sin corroboración de equipo, fuera."""
    e = entrada(title="Puka Nacua of Idaho State impresses in Week 1", team=None)
    assert press.mentions([e], [NACUA]) == {}


def test_el_apodo_del_equipo_en_el_texto_TAMBIEN_corrobora():
    e = entrada(title="Nacua", summary="Puka Nacua and the Rams open at home", team=None)
    assert list(press.mentions([e], [NACUA])) == ["3"]


def test_una_entrada_SIN_fecha_de_publicacion_no_se_cuelga_de_nadie():
    """La hora de descarga no da frescura: `first_seen_at` no es publicación."""
    e = entrada(title="Puka Nacua and the Rams", team="LAR",
                published_at=None, first_seen_at="2026-09-06T17:49:00Z")
    assert press.mentions([e], [NACUA]) == {}
    assert press.resumen([e], {})["undated"] == 1


def test_el_resumen_se_fecha_con_la_publicacion_mas_NUEVA_no_con_el_barrido():
    entradas = [entrada(published_at="2026-09-01T00:00:00Z"),
                entrada(published_at="2026-09-06T17:34:00Z")]
    assert press.resumen(entradas, {})["as_of"] == "2026-09-06T17:34:00Z"


def test_las_menciones_salen_de_la_mas_nueva_a_la_mas_vieja():
    vieja = entrada(title="Puka Nacua Rams", team="LAR", published_at="2026-09-01T00:00:00Z")
    nueva = entrada(title="Puka Nacua Rams", team="LAR", published_at="2026-09-06T09:00:00Z")
    out = press.mentions([vieja, nueva], [NACUA])
    assert [m["published_at"] for m in out["3"]] == ["2026-09-06T09:00:00Z",
                                                     "2026-09-01T00:00:00Z"]


def test_no_lanza_con_filas_y_entradas_basura():
    assert press.mentions(None, None) == {}
    assert press.mentions([None, entrada()], [None, NACUA]) == {}
    assert press.resumen(None, {})["as_of"] is None


def test_el_titular_manda_sobre_la_fecha_cuando_solo_caben_tres():
    """Un repaso que le cita de pasada no puede enterrar lo que habla DE ÉL.

    Es el caso real del 6 de septiembre: el «suspension watch» de Puka Nacua
    caía al tercer puesto —y sólo se publican tres— por detrás de un artículo
    cuyo titular era de otro jugador. No se puntúa importancia: se mira si el
    nombre está en el TITULAR, que es comprobable.
    """
    de_pasada = entrada(title="Someone else tabbed the biggest gamewrecker",
                        summary="Puka Nacua and the Rams also feature",
                        published_at="2026-09-05T11:15:00Z")
    sobre_el = entrada(title="Puka Nacua suspension watch", team="LAR",
                       published_at="2026-09-04T00:43:00Z")
    out = press.mentions([de_pasada, sobre_el], [NACUA])
    assert out["3"][0]["title"] == "Puka Nacua suspension watch"
    assert out["3"][0]["in_title"] is True
    assert out["3"][1]["in_title"] is False
