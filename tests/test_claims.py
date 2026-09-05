"""Afirmaciones: normalizar, superseder sin borrar, contar orígenes y no enlaces."""
from __future__ import annotations

import glob
import json
from pathlib import Path

from oracle.narrative.claims import (
    CLAIM_TYPES,
    EVIDENCE_CLASSES,
    claim_from_item,
    claims_from_archive,
    contradictions,
    coverage,
    link,
    normalize_evidence,
    normalize_impact,
    normalize_type,
)

ROOT = Path(__file__).resolve().parents[1]


def _item(**over):
    base = {
        "beat": "Injuries", "team": "SEA", "players": ["Kenneth Walker"], "player_ids": ["00-0037746"],
        "kind": "lesion", "headline": "Walker limited in practice", "impact": "baja",
        "confidence": "informado", "evidence_type": "REPORTADO", "published_at": "2026-09-03",
        "first_seen_at": "2026-09-04T11:00:00Z",
        "sources": [{"outlet": "ESPN", "url": "https://www.espn.com/a", "author": "B. Henderson"},
                    {"outlet": "ESPN", "url": "https://espn.com/b"}],
    }
    base.update(over)
    return base


def test_spanish_and_english_tokens_are_one_class():
    assert normalize_evidence("OFICIAL") == normalize_evidence("OFFICIAL") == "OFFICIAL"
    assert normalize_evidence("REPORTADO") == normalize_evidence("REPORTED") == "REPORTED"
    assert normalize_impact("neutro") == normalize_impact("neutral") == "NEUTRAL"
    assert normalize_type("lesion") == normalize_type("injury") == "INJURY"


def test_unknown_stays_unknown_instead_of_the_first_that_appears():
    assert normalize_evidence(None, None) == "UNKNOWN"
    assert normalize_evidence("", "informado") == "REPORTED"
    assert normalize_impact("bullish") == "UNKNOWN"
    assert normalize_type("???") == "OTHER"
    assert set(EVIDENCE_CLASSES) >= {"OFFICIAL", "UNKNOWN"}
    assert "INJURY" in CLAIM_TYPES


def test_two_links_of_one_outlet_are_ONE_origin():
    c = claim_from_item(_item())
    assert c.supporting_sources == 1
    assert c.source_domains == ("espn.com",)
    assert c.source == "espn.com"
    assert c.author == "B. Henderson"


def test_observed_at_never_becomes_published_at():
    c = claim_from_item(_item(published_at=None, published=None))
    assert c.published_at is None
    assert c.observed_at == "2026-09-04"
    assert c.as_of is None


def test_newer_supersedes_older_and_the_older_is_kept():
    older = claim_from_item(_item(headline="Walker questionable", published_at="2026-09-02"))
    newer = claim_from_item(_item(headline="Walker active", impact="alza", published_at="2026-09-05"))
    linked = link([newer, older])
    assert len(linked) == 2
    assert newer.supersedes == older.claim_id
    # discrepan en impacto: las DOS quedan en disputa, ninguna se borra
    assert older.status == "DISPUTED" and newer.status == "DISPUTED"
    assert contradictions(linked) == [(older, newer)]


def test_same_direction_is_superseded_not_disputed():
    older = claim_from_item(_item(headline="Walker limited", published_at="2026-09-02"))
    newer = claim_from_item(_item(headline="Walker still limited", published_at="2026-09-03"))
    link([older, newer])
    assert older.status == "SUPERSEDED" and newer.status == "CURRENT"
    assert contradictions([older, newer]) == []


def test_without_a_publication_date_nothing_is_ordered_by_download_time():
    dated = claim_from_item(_item(published_at="2026-09-02"))
    undated = claim_from_item(_item(headline="Walker update", published_at=None, published=None,
                                    first_seen_at="2026-09-05T09:00:00Z"))
    link([dated, undated])
    assert undated.supersedes is None and undated.status == "CURRENT"
    assert dated.status == "CURRENT"


def test_coverage_counts_what_is_missing():
    claims = [claim_from_item(_item()), claim_from_item(_item(player_ids=[], evidence_type=None,
                                                             confidence="rumor", published_at=None))]
    cov = coverage(claims)
    assert cov["claims"] == 2 and cov["with_player_id"] == 1 and cov["with_published_at"] == 1
    assert cov["by_class"] == {"REPORTED": 1, "OPINION": 1}
    assert cov["single_origin"] == 2 and cov["multi_origin"] == 0


def test_the_real_archive_converts_and_reports_its_gaps():
    files = sorted(glob.glob(str(ROOT / "research" / "20*.json")))
    if not files:
        return
    days = [json.loads(Path(f).read_text(encoding="utf-8")) for f in files]
    claims = link(claims_from_archive(days))
    cov = coverage(claims)
    assert cov["claims"] > 0
    # Ninguna etiqueta del archivo se queda sin traducir a la escala canónica,
    # salvo las que de verdad no traen nada (UNKNOWN es la respuesta correcta).
    assert set(cov["by_class"]) <= set(EVIDENCE_CLASSES)
    assert set(cov["by_type"]) <= CLAIM_TYPES
    assert all(c.published_at is None or len(c.published_at) == 10 for c in claims)
