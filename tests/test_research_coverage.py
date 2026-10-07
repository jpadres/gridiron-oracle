"""LA PRENSA CUBRE 32 CLUBES Y LA PANTALLA ENSEÑABA 23.

El recorte a los 60 más recientes es correcto para «lo último» y pierde a los
clubes de los que no se ha publicado nada reciente. Medido el 7 de octubre de
2026: 2.112 entradas con 32 de 32 equipos en la ingesta, 23 en la sección
publicada, y nada lo decía — el dato computado que no llega a la pantalla.
"""

from __future__ import annotations

import json

from oracle.narrative import archive
from oracle.narrative.archive import _con_cobertura_por_equipo, _equipos_de


def _ficha(fecha, equipo, relevancia=1):
    return {"date": fecha, "team": equipo, "fantasy_relevance": relevancia}


def test_todo_club_de_la_ventana_entra_en_lo_publicado():
    # Tres huecos de límite y cinco clubes: dos quedarían fuera del recorte.
    items = [
        _ficha("2026-10-07", "KC"), _ficha("2026-10-07", "KC"),
        _ficha("2026-10-06", "KC"), _ficha("2026-10-05", "BUF"),
        _ficha("2026-10-04", "NYJ"),
    ]
    publicados, cobertura = _con_cobertura_por_equipo(items, 3)
    assert cobertura["publicados"] == cobertura["ventana"] == {"KC", "BUF", "NYJ"}
    assert len(publicados) == 5


def test_los_primeros_son_EXACTAMENTE_los_de_antes():
    # Nada de lo que se publicaba deja de publicarse, y el orden del principio
    # no se toca: el criterio de «lo último» sigue siendo el criterio.
    items = [_ficha(f"2026-10-{d:02d}", t) for d, t in
             [(7, "KC"), (6, "BUF"), (5, "NYJ"), (4, "LAR"), (3, "SF")]]
    publicados, _ = _con_cobertura_por_equipo(items, 3)
    assert publicados[:3] == items[:3]


def test_de_un_club_que_falta_se_añade_la_MAS_NUEVA():
    items = [
        _ficha("2026-10-07", "KC"),
        _ficha("2026-10-05", "BUF"),   # la más nueva de BUF
        _ficha("2026-10-01", "BUF"),   # una vieja que no debe entrar
    ]
    publicados, _ = _con_cobertura_por_equipo(items, 1)
    assert len(publicados) == 2
    assert publicados[1]["date"] == "2026-10-05"


def test_no_se_añade_nada_si_el_recorte_ya_cubre_todo():
    items = [_ficha("2026-10-07", "KC"), _ficha("2026-10-06", "BUF")]
    publicados, _ = _con_cobertura_por_equipo(items, 2)
    assert publicados == items


def test_una_ficha_que_nombra_varios_clubes_cubre_a_los_dos():
    items = [_ficha("2026-10-07", ["KC", "BUF"]), _ficha("2026-10-06", "NYJ")]
    publicados, cobertura = _con_cobertura_por_equipo(items, 1)
    assert cobertura["publicados"] == {"KC", "BUF", "NYJ"}
    assert len(publicados) == 2


def test_LA_y_LAR_son_EL_MISMO_club():
    """El `AZ`/`ARI` de la tabla de errores, en el conteo de cobertura.

    La primera versión publicó «33 de 33» con 32 clubes en la liga: el dossier
    curado escribe `LA` y los feeds `LAR`, así que los Rams se contaban dos
    veces Y se añadía una ficha suya como si fuera de un club sin cubrir.
    """
    assert _equipos_de({"team": "LA"}) == _equipos_de({"team": "LAR"}) == {"LAR"}
    items = [_ficha("2026-10-07", "LAR"), _ficha("2026-10-06", "LA")]
    publicados, cobertura = _con_cobertura_por_equipo(items, 1)
    assert cobertura["ventana"] == {"LAR"}, "un club con dos códigos no son dos clubes"
    assert len(publicados) == 1, "no se añade un hueco para un club ya cubierto"


def test_una_ficha_sin_club_no_inventa_cobertura():
    assert _equipos_de({"team": None}) == set()
    assert _equipos_de({"team": ""}) == set()
    assert _equipos_de({}) == set()
    assert _equipos_de({"team": ["", None]}) == set()


def test_la_cobertura_publicada_sale_de_consolidate_y_no_se_recuenta():
    """Un solo contador.

    `scripts/export_web_data.py` recontaba los clubes por su cuenta: dos
    traductores del mismo hecho, y el que decide el recorte es `consolidate`.
    """
    from pathlib import Path
    fuente = Path("scripts/export_web_data.py").read_text(encoding="utf-8")
    assert "_equipos_del_research" not in fuente, (
        "el exportador ha vuelto a contar los clubes por su cuenta"
    )
    assert 'research.get("teams_covered")' in fuente


# --- y que la ruta de publicación lo USE ------------------------------------
#
# La primera versión de estos tests llamaba al helper directamente, así que al
# inyectar el fallo en `consolidate` —devolver `items[:limit]` a secas, que es
# el fallo ORIGINAL— los ocho siguieron VERDES. Un guardián sobre una función
# que la ruta de publicación no llama vigila una función, no un producto: ya ha
# costado una iteración en `Briefs.jsx` y otra en `rosterMark`.


def _archivo(root, dias):
    """Un archivo de prensa de verdad en disco, como el que lee CI."""
    carpeta = root / "research"
    carpeta.mkdir(parents=True, exist_ok=True)
    for dia, fichas in dias.items():
        (carpeta / f"{dia}.json").write_text(
            json.dumps({"date": dia, "items": fichas}), encoding="utf-8"
        )


def test_consolidate_publica_todo_club_de_la_ventana(tmp_path):
    import datetime as dt

    hoy = dt.date(2026, 10, 7)
    _archivo(tmp_path, {
        "2026-10-07": [{"headline": f"kc {i}", "team": "KC"} for i in range(3)],
        "2026-10-05": [{"headline": "buf", "team": "BUF"}],
        "2026-10-04": [{"headline": "jets", "team": "NYJ"}],
    })
    section = archive.consolidate(tmp_path, days=10, today=hoy, limit=3)
    equipos = {it.get("team") for it in section["items"]}
    assert {"KC", "BUF", "NYJ"} <= equipos, (
        "la sección publicada se deja clubes que la ventana sí trae"
    )
    assert section["teams_covered"] == section["teams_in_window"] == 3
    assert section["primary_limit"] == 3


def test_consolidate_no_afirma_una_cobertura_que_no_midio(tmp_path):
    import datetime as dt

    # Sin fichas no hay sección: `None`, y la pantalla dice que no hay nada
    # dentro de la ventana en vez de publicar un cero.
    assert archive.consolidate(tmp_path, days=10, today=dt.date(2026, 10, 7)) is None
