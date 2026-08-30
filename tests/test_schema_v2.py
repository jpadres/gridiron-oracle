"""Migración al esquema v2: que lo desconocido se quede desconocido.

La regla del proyecto para esto es UNKNOWN > INVENTED. Estos tests existen
porque la forma natural de escribir la migración —rellenar huecos con algo
razonable— produce datos que en noviembre no se distinguen de los reales.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pytest

from oracle.narrative import archive, decisions, research, snapshots
from oracle.narrative.schema import (
    SCHEMA_VERSION,
    has_latency_data,
    is_classified,
    migrate_item,
)


def _v1_item(**overrides) -> dict:
    item = {
        "team": "KC",
        "players": ["P.Mahomes"],
        "kind": "lesion",
        "headline": "Mahomes limitado el miércoles",
        "summary": "Apareció limitado en el parte.",
        "impact": "baja",
        "confidence": "confirmado",
        "fantasy_relevance": 4,
        "published": "2026-08-17",
        "sources": [{"outlet": "NFL.com", "title": "t", "url": "https://nfl.com/x"}],
    }
    item.update(overrides)
    return item


def test_legacy_evidence_stays_unknown_instead_of_being_guessed():
    """`rumor` NO se traduce a OPINION.

    El esquema v1 no distinguía entre reportado, observado y opinión, así que
    cualquier traducción inventaría una clasificación que nadie hizo. Es la
    decisión explícita del dueño y el caso central de UNKNOWN > INVENTED.
    """
    for confidence in ("confirmado", "informado", "rumor"):
        migrated = migrate_item(_v1_item(confidence=confidence))
        assert migrated["evidence_type"] is None
        # Y el valor original no se pierde: sigue ahí para contexto.
        assert migrated["confidence"] == confidence


def test_legacy_timestamps_stay_null_not_synthetic():
    """Nada de mediodía UTC.

    Una hora sintética no se distingue de una real al leerla, y contamina justo
    la métrica —cuánto se adelantó una fuente— para la que existe el campo.
    """
    migrated = migrate_item(_v1_item())
    for field in ("published_at", "first_seen_at", "confirmed_at"):
        assert migrated[field] is None
    assert migrated["published"] == "2026-08-17"  # la fecha de día sí se conserva


def test_legacy_items_are_excluded_from_metrics_but_still_readable():
    """Visibles como contexto, fuera de las métricas. No son un error de datos."""
    migrated = migrate_item(_v1_item())
    assert not is_classified(migrated)
    assert not has_latency_data(migrated)
    # Siguen siendo perfectamente legibles.
    assert migrated["headline"] and migrated["sources"]


def test_clean_does_not_downgrade_an_unknown_evidence_type():
    """La mina que había que desactivar.

    `_clean` degrada un `confidence` desconocido a "rumor". Si `evidence_type`
    hiciera lo mismo, cualquier valor nuevo se convertiría en silencio en el
    valor por defecto — exactamente el fallo que la migración evita.
    """
    item = _v1_item(evidence_type="INVENTADO", published_at="")
    cleaned = research._clean(item, "AFC Oeste")
    assert cleaned["evidence_type"] is None
    assert cleaned["published_at"] is None


def test_author_survives_cleaning_and_is_none_when_absent():
    with_author = _v1_item(
        evidence_type="REPORTADO",
        sources=[{"outlet": "NFL", "title": "t", "url": "https://nfl.com/a",
                  "author": "Ian Rapoport"}],
    )
    assert research._clean(with_author, "b")["sources"][0]["author"] == "Ian Rapoport"
    # Sin autor: None y no "", para distinguir «el feed no firma» de un autor vacío.
    assert research._clean(_v1_item(), "b")["sources"][0]["author"] is None


def test_dedupe_keeps_the_earliest_first_seen():
    """Fundir, no descartar.

    Si el duplicado es el que vimos ANTES, descartarlo deja en la ficha el
    instante de la segunda vez. La latencia medida sobre eso tiene pinta de
    correcta y no significa nada.
    """
    early = research._clean(
        _v1_item(evidence_type="REPORTADO", fantasy_relevance=2), "AFC Oeste")
    early["first_seen_at"] = "2026-09-07T15:00:00+00:00"
    late = research._clean(
        _v1_item(evidence_type="REPORTADO", fantasy_relevance=5), "insiders")
    late["first_seen_at"] = "2026-09-07T15:40:00+00:00"
    late["sources"] = [{"outlet": "ESPN", "title": "t2",
                        "url": "https://espn.com/y", "author": None}]

    merged = research.dedupe([early, late])
    assert len(merged) == 1
    # Sobrevive la de más relevancia...
    assert merged[0]["fantasy_relevance"] == 5
    # ...pero con el instante más antiguo y las fuentes de las dos.
    assert merged[0]["first_seen_at"] == "2026-09-07T15:00:00+00:00"
    assert len(merged[0]["sources"]) == 2


def test_load_day_migrates_without_touching_the_file(tmp_path):
    """El fichero en disco no se reescribe nunca."""
    directory = tmp_path / "research"
    directory.mkdir()
    original = {"date": "2026-08-17", "items": [_v1_item()]}
    path = directory / "2026-08-17.json"
    path.write_text(json.dumps(original), encoding="utf-8")
    before = path.read_bytes()

    items = archive.load_day(tmp_path, date(2026, 8, 17))
    assert items[0]["schema_version"] == SCHEMA_VERSION
    assert items[0]["evidence_type"] is None
    assert path.read_bytes() == before


def test_a_snapshot_refuses_to_overwrite_itself(tmp_path):
    """La garantía que separa un registro histórico de una opinión retroactiva.

    Si se pudiera regenerar después del partido, comparar «lo que creíamos» con
    «lo que pasó» no mediría nada. No hace falta mala fe: basta con relanzar un
    script.
    """
    taken = datetime(2026, 9, 7, 16, 55, tzinfo=UTC)
    snapshots.save(tmp_path, 2026, 1, "rankings", [{"player": "A"}], taken_at=taken)

    with pytest.raises(snapshots.SnapshotExists):
        snapshots.save(tmp_path, 2026, 1, "rankings", [{"player": "B"}])

    stored = snapshots.load(tmp_path, 2026, 1, "rankings")
    assert stored["payload"] == [{"player": "A"}]
    assert stored["taken_at"] == taken.isoformat()


def test_decision_log_appends_and_ignores_empty_changes(tmp_path):
    decisions.record(
        tmp_path, event="RB1 OUT", surface="weekly_rankings", subject="00-0000001",
        changes=[{"field": "position_rank", "before": 28, "after": 17}],
        source_url="https://nfl.com/x",
    )
    # Sin cambios no hay línea: un registro lleno de no-eventos deja de leerse.
    decisions.record(tmp_path, event="recálculo", surface="weekly_rankings",
                     subject="00-0000001", changes=[])

    entries = decisions.read(tmp_path, subject="00-0000001")
    assert len(entries) == 1
    assert entries[0]["changes"][0]["after"] == 17


def test_decision_log_survives_a_corrupt_line(tmp_path):
    """Un proceso muerto a media escritura no puede llevarse el registro entero."""
    decisions.record(tmp_path, event="e", surface="s", subject="x",
                     changes=[{"field": "f", "before": 1, "after": 2}])
    with decisions.log_path(tmp_path).open("a", encoding="utf-8") as handle:
        handle.write('{"at": "roto"\n')

    assert len(decisions.read(tmp_path)) == 1

