"""EL BARRIDO SIN MODELO.

Los fallos que existen para cazar, todos de la misma familia: **rellenar con
algo plausible lo que no se sabe**.

  1. Inventar el juicio. Un feed trae el hecho, no lo que significa. Poner
     `confidence: "rumor"` o `impact: "neutro"` por defecto es afirmar algo
     que nadie comprobó — y la pantalla ya lo hacía con su `?? rumor`.
  2. Fechar con la descarga. `first_seen_at` es cuándo lo vio el barrido y no
     puede convertirse en «publicado hoy».
  3. Emparejar por el nombre suelto. Dos «B.Robinson» en ATL ya costaron dos
     iteraciones en dos módulos distintos.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from oracle.narrative import sweep

HOY = date(2026, 9, 13)
RELOJ = datetime(2026, 9, 13, 12, 0, tzinfo=timezone.utc)

BOARD = [
    {"player_id": "1", "player_name": "P.Mahomes", "player_full_name": "Patrick Mahomes", "team": "KC"},
    {"player_id": "2", "player_name": "B.Robinson", "player_full_name": "Bijan Robinson", "team": "ATL"},
    {"player_id": "3", "player_name": "B.Robinson", "player_full_name": "Brian Robinson", "team": "ATL"},
]


def _entrada(**kw):
    base = {
        "title": "Chiefs notes", "summary": "", "outlet": "ESPN", "url": "https://x/1",
        "published_at": "2026-09-13T10:00:00Z", "first_seen_at": "2026-09-13T11:00:00Z",
        "source_type": "RSS", "team": None,
    }
    base.update(kw)
    return base


def test_no_se_inventa_ningun_juicio():
    """NI UN SOLO campo de juicio, ni siquiera puesto a un valor «neutro»."""
    items = sweep.from_feeds([_entrada()], today=HOY, rows=BOARD, now=RELOJ)
    assert items
    prohibidos = {"kind", "impact", "confidence", "evidence_type", "fantasy_relevance"}
    for item in items:
        assert not (prohibidos & set(item)), (
            f"el barrido determinista está afirmando {prohibidos & set(item)}: "
            "un feed trae el hecho, no lo que significa"
        )
        assert item["method"] == sweep.METHOD


def test_la_hora_de_descarga_no_fecha_la_ficha():
    """Sin `published_at` la ficha entra, pero NO se fecha con `first_seen_at`."""
    items = sweep.from_feeds(
        [_entrada(published_at=None)], today=HOY, rows=BOARD, now=RELOJ)
    assert len(items) == 1
    assert items[0]["published_at"] is None, (
        "se está fechando la publicación con la hora del barrido: la regla 5 exacta"
    )
    assert items[0]["first_seen_at"] == "2026-09-13T11:00:00Z"


def test_una_fecha_del_futuro_no_se_publica_como_fecha():
    """La misma puerta que el parser de prosa, no una copia con otra cobertura."""
    items = sweep.from_feeds(
        [_entrada(published_at="2026-09-20T10:00:00Z")], today=HOY, rows=BOARD, now=RELOJ)
    assert items[0]["published_at"] is None


def test_ante_dos_robinson_no_se_empareja():
    """Bijan y Brian comparten clave abreviada y equipo. Ninguno se cuelga."""
    items = sweep.from_feeds(
        [_entrada(title="B.Robinson runs for 100", team="ATL")],
        today=HOY, rows=BOARD, now=RELOJ)
    assert items[0]["players"] == [], (
        "se ha emparejado un nombre ambiguo: ante la duda no se empareja"
    )


def test_el_nombre_completo_si_se_cuelga_y_trae_su_equipo():
    items = sweep.from_feeds(
        [_entrada(title="Patrick Mahomes throws four for the Chiefs")],
        today=HOY, rows=BOARD, now=RELOJ)
    assert items[0]["players"] == ["Patrick Mahomes"]
    # El equipo se DERIVA del mencionado, que ya venía corroborado. Sin él la
    # ficha no puede enlazarse: el índice de `matching` va por (clave, equipo).
    assert items[0]["team"] == "KC"


def test_lo_viejo_no_entra_en_el_barrido_de_hoy():
    viejo = _entrada(published_at="2026-09-01T10:00:00Z")
    assert sweep.from_feeds([viejo], today=HOY, rows=BOARD, now=RELOJ) == []


def test_lo_mas_nuevo_va_primero_DENTRO_del_mismo_dia():
    """La primera versión ordenaba por DÍA y dejaba el orden del fichero dentro.

    «Lo más nuevo primero» era falso justo el día de la jornada, que es cuando
    se mira. Se eligen dos horas del MISMO día para que las dos respuestas
    caigan en posiciones distintas.
    """
    pronto = _entrada(url="https://x/a", title="Patrick Mahomes early",
                      published_at="2026-09-13T02:00:00Z")
    tarde = _entrada(url="https://x/b", title="Patrick Mahomes late",
                     published_at="2026-09-13T11:00:00Z")
    items = sweep.from_feeds([pronto, tarde], today=HOY, rows=BOARD, now=RELOJ)
    assert [i["headline"] for i in items] == ["Patrick Mahomes late", "Patrick Mahomes early"]


def test_quien_nombra_a_alguien_del_board_va_antes():
    """El orden es un HECHO comprobable, no una nota de importancia."""
    generica = _entrada(url="https://x/a", title="How to watch every Week 1 game",
                        published_at="2026-09-13T11:00:00Z")
    # El titular NOMBRA al equipo a propósito: `press.mentions` exige
    # corroboración —nombre completo Y equipo— y un doble sin el equipo no
    # empareja nada, así que probaría otra cosa. Es «un doble que miente en un
    # campo prueba otra cosa», que en este repositorio ya costó seis veces.
    concreta = _entrada(url="https://x/b", title="Chiefs rule out Patrick Mahomes",
                        published_at="2026-09-13T02:00:00Z")
    items = sweep.from_feeds([generica, concreta], today=HOY, rows=BOARD, now=RELOJ)
    assert items[0]["headline"] == "Chiefs rule out Patrick Mahomes", (
        "una nota que nombra a un jugador del board se ha quedado detrás de un "
        "«how to watch» más nuevo: el corte de 60 lo llenan los feeds oficiales"
    )


def test_sin_board_no_se_nombra_a_nadie():
    items = sweep.from_feeds([_entrada(title="Patrick Mahomes throws")],
                             today=HOY, rows=None, now=RELOJ)
    assert items[0]["players"] == []


def test_una_nota_de_dos_equipos_no_se_atribuye_a_uno():
    """Derivar el equipo sólo vale si todos los nombrados coinciden.

    LOS DOS APODOS VAN EN EL TEXTO A PROPÓSITO. La primera versión decía
    «Patrick Mahomes and Bijan Robinson headline the slate» y pasaba con el
    fallo inyectado (`sorted(t)[0]` en vez de exigir uno solo): sin «Chiefs» ni
    «Falcons», `press.mentions` no corrobora NINGUNO de los dos, no hay
    equipos que reconciliar y el guardián se cumplía en vacío. Es el
    `conAjuste.length > 0` otra vez — y la comprobación de abajo, que exige que
    los DOS estén nombrados, es lo que impide que vuelva a pasar.
    """
    items = sweep.from_feeds(
        [_entrada(title="Chiefs and Falcons: Patrick Mahomes and Bijan Robinson headline the slate")],
        today=HOY, rows=BOARD, now=RELOJ)
    assert sorted(items[0]["players"]) == ["Bijan Robinson", "Patrick Mahomes"], (
        "el doble no nombra a los dos: la propiedad se comprobaría en vacío"
    )
    assert items[0]["team"] is None, (
        "un repaso que cita a dos equipos se está publicando como nota de uno"
    )


def test_la_cabecera_dice_el_metodo_y_no_un_modelo():
    items = sweep.from_feeds([_entrada()], today=HOY, rows=BOARD, now=RELOJ)
    meta = sweep.meta(items, {"sources_ok": 48, "generated_at": "2026-09-13T05:00:00+00:00"})
    assert meta["method"] == "DETERMINISTIC_FEEDS"
    assert "model" in meta and "no model" in meta["model"].lower(), (
        "el campo histórico `model` tiene que decir que no hubo modelo"
    )


def test_una_ficha_en_espanol_no_se_publica_en_una_interfaz_en_ingles():
    """El feed oficial de Las Vegas publica parte de sus notas en español."""
    es = _entrada(title="Los Raiders están listos para debutar con Jeanty de regreso")
    assert sweep.from_feeds([es], today=HOY, rows=BOARD, now=RELOJ) == []
    # Y un titular inglés que EMPIEZA por un nombre propio con partícula sigue
    # entrando: «Las Vegas» disparaba el detector y por eso se quita por nombre.
    en = _entrada(title="Las Vegas rebuilds the offensive line for the Chiefs game")
    assert len(sweep.from_feeds([en], today=HOY, rows=BOARD, now=RELOJ)) == 1


def test_las_dos_listas_de_espanol_coinciden():
    """UN detector, en dos lenguajes. La divergencia es ROJA, no silenciosa.

    Duplicar una regla en JS y en Python es el fallo que este repositorio ha
    cometido doce veces. Aquí hacía falta —la puerta corre en Node y el barrido
    en Python— así que lo que se impide es que se separen sin que nadie lo vea.
    """
    import re
    from pathlib import Path

    js = Path(__file__).resolve().parents[1] / "web" / "tools" / "audit-spanish.mjs"
    crudo = re.search(r"const FUNCIONALES = /\\b\(([^)]*)\)\\b/gi;", js.read_text(encoding="utf-8"))
    assert crudo, "la puerta cambió de forma: este guardián no puede leerla, y eso es ROJO"
    assert set(crudo.group(1).split("|")) == set(sweep.FUNCIONALES_ES), (
        "las dos listas de palabras funcionales se han separado: la web rechazaría "
        "algo que el barrido publica, o al revés"
    )

