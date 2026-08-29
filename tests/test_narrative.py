"""Tests del módulo de textos generados y del barrido de prensa.

**Ninguno necesita clave ni red.** Lo que se prueba aquí es precisamente la parte
que no depende de la API: el verificador de cifras, el emparejamiento de nombres,
el filtro que descarta fichas sin fuente y el archivo diario. Esos cuatro son los
que deciden si se publica una mentira, y son los que tienen que estar cubiertos.

Lo que la API devuelva no se puede fijar en un test — pero lo que hacemos con lo
que devuelva, sí.
"""

from __future__ import annotations

from datetime import date

from oracle.narrative import archive, matching, research
from oracle.narrative.client import available
from oracle.narrative.factcheck import (
    allowed_numbers,
    check_texts,
    readings,
    unsupported_numbers,
)

# --- verificación de cifras -------------------------------------------------


def test_invented_number_is_caught():
    """El caso que justifica todo el módulo.

    «21,7» suena igual de bien que «21,66» y es indistinguible a ojo. Si el dato
    real es otro, es una cifra falsa publicada bajo la firma del proyecto.
    """
    data = {"jugador": "P.Nacua", "projected_points": 21.663}
    allowed = allowed_numbers(data)

    assert unsupported_numbers("Proyecta 21,9 puntos.", allowed) == ["21,9"]
    assert unsupported_numbers("Proyecta 21,66 puntos.", allowed) == []
    # 21,7 sí pasa: es el redondeo correcto de 21,663, no una cifra inventada.
    assert unsupported_numbers("Proyecta 21,7 puntos.", allowed) == []


def test_rounding_the_data_is_allowed():
    """El texto redondea, y eso no es inventar."""
    allowed = allowed_numbers({"points": 15.237, "vor": 96.175})
    for text in ("15,2", "15.2", "15", "96,2", "96"):
        assert unsupported_numbers(f"Vale {text} puntos.", allowed) == [], text


def test_probability_can_be_written_as_percentage():
    """0,498 en los datos se escribe «49,8%» en el texto. Es el mismo número."""
    allowed = allowed_numbers({"win_rate": 0.498})
    assert unsupported_numbers("Un 49,8% contra el spread.", allowed) == []
    assert unsupported_numbers("Un 54,1% contra el spread.", allowed) == ["54,1"]


def test_thousands_separator_is_read_both_ways():
    """«3.829» puede ser 3829 o 3,829. Se aceptan las dos lecturas.

    Ser estricto con el formato convertiría el validador en un corrector de
    estilo que rechaza textos correctos — y un validador con falsos positivos
    acaba desactivado, que es peor que no tenerlo.
    """
    assert readings("3.829") == {3829.0, 3.829}
    assert readings("1.234,5") == {1234.5}
    assert readings("17") == {17.0}

    allowed = allowed_numbers({"games": 3829})
    assert unsupported_numbers("En 3.829 partidos fuera de muestra.", allowed) == []


def test_numbers_inside_strings_count_as_data():
    """Los rangos de calibración vienen como texto («[0.5, 0.6)»)."""
    allowed = allowed_numbers({"calibration": [{"bin": "[0.55, 0.65)", "games": 412}]})
    assert unsupported_numbers("En el tramo 0,55 a 0,65 hubo 412 partidos.", allowed) == []


def test_derived_numbers_are_rejected_unless_given():
    """La diferencia entre dos datos NO está en los datos.

    Por eso `export_web_data._with_delta` la calcula y la mete en el contexto:
    el modelo la va a mencionar seguro, y sin dársela el texto correcto se
    rechazaría por hacer bien la resta.
    """
    allowed = allowed_numbers({"projected": 15.2, "baseline": 20.1})
    assert unsupported_numbers("Cae 4,9 puntos.", allowed) == ["4,9"]

    allowed = allowed_numbers({"projected": 15.2, "baseline": 20.1, "delta": -4.9})
    assert unsupported_numbers("Cae 4,9 puntos.", allowed) == []


def test_structural_numbers_pass():
    """Años y cantidades muy pequeñas se aceptan sin estar en los datos.

    Es un agujero consciente: sin él no se puede escribir «la temporada 2026» ni
    «los 3 primeros». El prompt lo compensa pidiendo letras para cualquier
    cantidad que no salga de los datos.
    """
    allowed = allowed_numbers({})
    assert unsupported_numbers("En 2026, los 3 primeros.", allowed) == []
    assert unsupported_numbers("Doce recepciones fueron 12.", allowed) == ["12"]


def test_check_texts_reports_only_failures():
    allowed = allowed_numbers({"x": 10.0})
    problems = check_texts({"bien": "Son 10.", "mal": "Son 44.", "vacio": None}, allowed)
    assert problems == {"mal": ["44"]}


def test_booleans_are_not_numbers():
    """`True` no autoriza a escribir «1»."""
    allowed = allowed_numbers({"significant": False, "extra": True})
    assert unsupported_numbers("Hubo 7 casos.", allowed) == ["7"]


# --- emparejamiento de nombres ----------------------------------------------


def test_press_name_matches_nflverse_name():
    assert matching.player_key("Joe Burrow") == matching.player_key("J.Burrow")
    assert matching.player_key("Ja'Marr Chase") == matching.player_key("J.Chase")


def test_compound_surnames_survive():
    """«Amon-Ra St. Brown» rompe la versión ingenua de quedarse con la última palabra."""
    assert matching.player_key("Amon-Ra St. Brown") == matching.player_key("A.St. Brown")
    assert matching.player_key("Amon-Ra St. Brown") == "a.stbrown"


def test_generational_suffix_is_dropped():
    assert matching.player_key("Marvin Harrison Jr.") == matching.player_key("M.Harrison")
    assert matching.player_key("Odell Beckham III") == matching.player_key("O.Beckham")


def test_same_key_different_team_never_collides():
    """Hay varios «M.Williams» en la liga.

    Colgarle a un receptor la lesión de otro es peor que no colgar nada, así que
    sin equipo no se asigna y con equipo distinto tampoco.
    """
    players = [
        {"player_id": "00-1", "player_name": "M.Williams", "team": "NYJ"},
        {"player_id": "00-2", "player_name": "M.Williams", "team": "LAC"},
    ]
    index = matching.build_index(players)
    assert matching.resolve(["Mike Williams"], "NYJ", index) == ["00-1"]
    assert matching.resolve(["Mike Williams"], "LAC", index) == ["00-2"]
    assert matching.resolve(["Mike Williams"], "", index) == []
    assert matching.resolve(["Mike Williams"], "KC", index) == []


def test_attach_ignores_players_outside_the_ranking():
    """La mayoría de las noticias hablan de gente que el modelo no clasifica."""
    notes = [{"team": "KC", "players": ["Patrick Mahomes", "Un Liniero Cualquiera"]}]
    matching.attach(notes, [{"player_id": "00-9", "player_name": "P.Mahomes", "team": "KC"}])
    assert notes[0]["player_ids"] == ["00-9"]


# --- filtrado de fichas de prensa -------------------------------------------


def _item(**overrides) -> dict:
    base = {
        "team": "kc",
        "players": ["Rashee Rice"],
        "kind": "lesion",
        "headline": "Rice limitado en el entrenamiento",
        "summary": "No participó en las repeticiones de equipo completo.",
        "impact": "baja",
        "confidence": "informado",
        "fantasy_relevance": 4,
        "published": "2026-08-17",
        "sources": [{"outlet": "ESPN", "title": "Nota", "url": "https://espn.com/nota"}],
    }
    base.update(overrides)
    return base


def test_item_without_a_usable_source_is_dropped():
    """El esquema garantiza que el campo existe, no que la URL sea real.

    Sin enlace comprobable la ficha no vale nada: es una afirmación de un modelo
    de lenguaje sobre la NFL, que es exactamente lo que este proyecto no publica.
    """
    assert research._clean(_item(sources=[]), "beat") is None
    assert research._clean(_item(sources=[{"outlet": "X", "title": "t", "url": ""}]), "b") is None
    assert research._clean(_item(sources=[{"outlet": "X", "title": "t",
                                           "url": "javascript:alert(1)"}]), "b") is None


def test_clean_normalises_and_clamps():
    item = research._clean(_item(fantasy_relevance=99, impact="altísimo"), "AFC Oeste")
    assert item["team"] == "KC"
    assert item["fantasy_relevance"] == 5
    assert item["impact"] == "neutro"  # valor fuera del enum: no se inventa una señal
    assert item["beat"] == "AFC Oeste"


def test_unknown_confidence_defaults_to_rumour():
    """Ante la duda, lo menos fiable. Al revés sería vender un rumor como confirmado."""
    assert research._clean(_item(confidence="segurísimo"), "b")["confidence"] == "rumor"


def test_dedupe_collapses_the_same_story_from_two_beats():
    """La noticia de un equipo llega por su división y por el beat de insiders."""
    same_url = _item()
    other_outlet = _item(
        headline="Rice limitado en el entrenamiento del martes",
        sources=[{"outlet": "NFL.com", "title": "Otra", "url": "https://nfl.com/otra"}],
    )
    different = _item(
        team="SF", headline="Purdy vuelve a lanzar sin limitaciones", players=["Brock Purdy"],
        sources=[{"outlet": "The Athletic", "title": "t", "url": "https://theathletic.com/x"}],
    )
    items = [research._clean(row, "b") for row in (same_url, other_outlet, different)]
    assert len(research.dedupe(items)) == 2


def test_liveblog_url_does_not_collapse_unrelated_news():
    """Un tracker cubre veinte historias bajo una sola URL.

    Encontrado publicando: dos noticias de Chicago sin nada que ver salían del
    mismo liveblog de Bleacher Report y el deduplicador se comió una. Compartir
    enlace es indicio de duplicado, no prueba.
    """
    liveblog = [{"outlet": "B/R", "title": "Live", "url": "https://br.com/liveblog"}]
    first = _item(team="CHI", headline="Burden III se pierde la pretemporada por la ingle",
                  players=["Luther Burden III"], sources=liveblog)
    second = _item(team="CHI", headline="Bryant fuera diez semanas por la rodilla",
                   players=["Coby Bryant"], sources=liveblog)
    items = [research._clean(row, "b") for row in (first, second)]
    assert len(research.dedupe(items)) == 2


def test_same_url_and_same_story_still_collapses():
    """El caso que la URL sí resuelve: mismo enlace y titular reformulado."""
    source = [{"outlet": "ESPN", "title": "t", "url": "https://espn.com/nota"}]
    first = _item(team="CHI", headline="Burden III se pierde la pretemporada por la ingle",
                  sources=source)
    second = _item(team="CHI", headline="Burden III se pierde la pretemporada entera",
                   sources=source)
    items = [research._clean(row, "b") for row in (first, second)]
    assert len(research.dedupe(items)) == 1


def test_every_division_is_covered():
    """32 equipos, sin repetir ni faltar. Un equipo fuera es un equipo sin cubrir."""
    teams = [team for group in research.DIVISIONS.values() for team in group]
    assert len(teams) == 32
    assert len(set(teams)) == 32
    assert len(research.beats()) == len(research.DIVISIONS) + len(research.LEAGUE_BEATS)
    assert set(research.beats(["insiders"])) == {"insiders"}


# --- archivo diario ----------------------------------------------------------


def test_archive_round_trip(tmp_path):
    archive.save_day(tmp_path, date(2026, 8, 17), [_item()], meta={"model": "x"})
    assert archive.load_day(tmp_path, date(2026, 8, 17))[0]["date"] == "2026-08-17"
    assert archive.load_day(tmp_path, date(2026, 8, 16)) == []


def test_saving_twice_does_not_duplicate(tmp_path):
    """Si el workflow falla a mitad y se relanza, el resultado es un fichero, no dos."""
    for _ in range(2):
        archive.save_day(tmp_path, date(2026, 8, 17), [_item()])
    assert len(archive.load_day(tmp_path, date(2026, 8, 17))) == 1


def test_window_is_calendar_days_not_files(tmp_path):
    """Con huecos en el archivo, «7 días» siguen siendo 7 días de calendario."""
    archive.save_day(tmp_path, date(2026, 8, 17), [_item()])
    archive.save_day(tmp_path, date(2026, 8, 10), [_item(headline="Vieja")])

    window = archive.load_window(tmp_path, 3, today=date(2026, 8, 17))
    assert [item["headline"] for item in window] == ["Rice limitado en el entrenamiento"]
    assert len(archive.load_window(tmp_path, 10, today=date(2026, 8, 17))) == 2


def test_consolidate_links_players_and_sorts(tmp_path):
    archive.save_day(tmp_path, date(2026, 8, 16), [_item(fantasy_relevance=2)])
    archive.save_day(tmp_path, date(2026, 8, 17), [_item(fantasy_relevance=5)])

    section = archive.consolidate(
        tmp_path,
        days=5,
        today=date(2026, 8, 17),
        players=[{"player_id": "00-7", "player_name": "R.Rice", "team": "KC"}],
    )
    assert section["total"] == 2
    assert section["items"][0]["date"] == "2026-08-17"
    assert section["items"][0]["player_ids"] == ["00-7"]


def test_consolidate_without_archive_is_none(tmp_path):
    """Sin archivo, la sección no existe — y la web se construye igual."""
    assert archive.consolidate(tmp_path, days=7, today=date(2026, 8, 17)) is None


def test_corrupt_day_file_does_not_break_the_window(tmp_path):
    """Un JSON roto se salta; no tumba el barrido de los otros días."""
    archive.save_day(tmp_path, date(2026, 8, 17), [_item()])
    archive.day_file(tmp_path, date(2026, 8, 16)).write_text("{roto", encoding="utf-8")
    assert len(archive.load_window(tmp_path, 3, today=date(2026, 8, 17))) == 1


# --- degradación -------------------------------------------------------------


def test_no_key_means_no_narrative(monkeypatch):
    """Sin clave, `available()` es False y los scripts siguen adelante.

    Es el mismo contrato que los artefactos de fantasy: que falte el texto no
    puede impedir que se publiquen los números, que son lo que importa.
    """
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert available() is False


# --- dossier curado ----------------------------------------------------------

def test_worst_medical_situation_wins_not_the_most_recent():
    """Si un jugador arrastra dos avisos, para alinear manda el peor.

    Con el criterio «el más reciente» un FUERA del lunes quedaría tapado por un
    SEGUIR del martes, y la fila del ranking diría que se puede alinear a
    alguien descartado.
    """
    from oracle.narrative import dossier

    data = {"medical": [
        {"player_id": "00-1", "level": "SEGUIR", "date": "2026-08-17"},
        {"player_id": "00-1", "level": "FUERA", "date": "2026-08-10"},
        {"player_id": "00-2", "level": "DUDA", "date": "2026-08-16"},
    ]}
    worst = dossier.availability_by_player(data)
    assert worst["00-1"]["level"] == "FUERA"
    assert worst["00-2"]["level"] == "DUDA"


def test_unknown_labels_fall_back_to_the_least_alarming():
    """Una etiqueta desconocida no puede inventarse una alarma.

    Al revés sí sería grave: convertir un valor raro en FUERA sacaría del
    ranking a alguien que juega.
    """
    from oracle.narrative import dossier

    assert dossier.normalise_level("cuestionable") == "SEGUIR"
    assert dossier.normalise_level("FUERA") == "FUERA"
    assert dossier.normalise_substance("altísima") == "baja"
    assert dossier.normalise_substance("alta") == "alta"


def test_dossier_entries_without_a_ranked_player_are_left_unlinked():
    """El parte médico cubre los 32 equipos enteros; el board sólo QB/RB/WR/TE."""
    from oracle.narrative import dossier

    entries = [
        {"player": "Patrick Mahomes", "team": "KC"},
        {"player": "Un Liniero Defensivo", "team": "KC"},
    ]
    dossier.attach_players(entries, [{"player_id": "00-9", "player_name": "P.Mahomes", "team": "KC"}])
    assert entries[0]["player_id"] == "00-9"
    assert entries[1]["player_id"] is None


def test_ambiguous_names_are_never_matched_against_the_consensus():
    """Bijan Robinson y Brian Robinson Jr. son los dos «B.Robinson» de Atlanta.

    El formato abreviado de nflverse no los distingue, así que el modelo tampoco.
    Quedarse con el último de la lista producía «el modelo sube a Bijan 139
    puestos sobre el consenso»: una afirmación fuerte, llamativa y posiblemente
    sobre el jugador equivocado. Ante la duda no se empareja.
    """
    from oracle.narrative import dossier

    consensus = [
        {"rank": 4, "player": "Bijan Robinson", "team": "ATL"},
        {"rank": 142, "player": "Brian Robinson Jr.", "team": "ATL"},
        {"rank": 10, "player": "Ja'Marr Chase", "team": "CIN"},
    ]
    board = [
        {"player_id": "1", "player_name": "B.Robinson", "team": "ATL",
         "position": "RB", "overall_rank": 3},
        {"player_id": "2", "player_name": "J.Chase", "team": "CIN",
         "position": "WR", "overall_rank": 5},
    ]
    gap = dossier.consensus_gap(board, consensus)

    assert [row["player_name"] for row in gap] == ["J.Chase"]
    assert dossier.ambiguous_names(consensus) == [["Bijan Robinson", "Brian Robinson Jr."]]


def test_consensus_gap_sign_says_who_is_higher():
    """Positivo = el modelo lo sube. Un signo invertido aquí invierte el consejo."""
    from oracle.narrative import dossier

    gap = dossier.consensus_gap(
        [{"player_id": "1", "player_name": "T.Kelce", "team": "KC",
          "position": "TE", "overall_rank": 29}],
        [{"rank": 104, "player": "Travis Kelce", "team": "KC"}],
    )
    assert gap[0]["gap"] == 75


def test_a_league_wide_item_keeps_its_team_as_liga():
    """`"team": null` no puede convertirse en el código de equipo «NONE».

    `.get("team", "LIGA")` sólo aplica el defecto cuando falta la clave. Con la
    clave presente y a nulo —que es lo que devuelve el modelo para una noticia
    de liga— salía la cadena "NONE": un código de cuatro letras que no existe y
    que no empareja con nada, sin fallar.
    """
    item = {
        "team": None,
        "headline": "El corte a 53 es el domingo",
        "summary": "Hasta que pase, cualquier depth chart es provisional.",
        "sources": [{"outlet": "Yahoo", "title": "Cuts tracker",
                     "url": "https://sports.yahoo.com/x"}],
    }
    cleaned = research._clean(item, "Liga")
    assert cleaned is not None
    assert cleaned["team"] == "LIGA"
