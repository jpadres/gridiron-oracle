"""Estado actual = cronología + autoridad. Y la dirección NUNCA se lee del titular."""
from __future__ import annotations

import pytest

from oracle.narrative.claims import claim_from_item, current_state, normalize_impact


def _item(headline, impact, evidence, published, team="SEA", players=("Kenneth Walker",), ids=("00-0037746",)):
    return {"team": team, "players": list(players), "player_ids": list(ids), "kind": "injury",
            "headline": headline, "impact": impact, "evidence_type": evidence, "published_at": published, "sources": []}


def test_a_later_official_inactive_beats_an_earlier_reporter_expectation():
    reporter = claim_from_item(_item("Walker expected to play Sunday", "alza", "REPORTADO", "2026-09-04"))
    official = claim_from_item(_item("Walker inactive", "baja", "OFICIAL", "2026-09-06"))
    state = current_state([reporter, official])
    (_, st), = state.items()
    assert st.current is official and st.others == (reporter,) and st.disputed


def test_an_earlier_official_still_beats_a_later_reporter():
    official = claim_from_item(_item("Walker listed questionable", "baja", "OFICIAL", "2026-09-04"))
    reporter = claim_from_item(_item("Walker expected to play", "alza", "REPORTADO", "2026-09-05"))
    (_, st), = current_state([official, reporter]).items()
    assert st.current is official
    assert reporter in st.others and st.disputed
    assert st.basis == "OFFICIAL 2026-09-04"


def test_same_authority_the_newest_wins_and_nothing_is_erased():
    a = claim_from_item(_item("Walker limited Wednesday", "baja", "REPORTADO", "2026-09-02"))
    b = claim_from_item(_item("Walker full Friday", "alza", "REPORTADO", "2026-09-04"))
    (_, st), = current_state([a, b]).items()
    assert st.current is b and st.others == (a,)


def test_an_undated_claim_never_becomes_the_current_state():
    dated = claim_from_item(_item("Walker limited", "baja", "REPORTADO", "2026-09-02"))
    undated = claim_from_item(_item("Walker cleared", "alza", "OFICIAL", None))
    (_, st), = current_state([dated, undated]).items()
    assert st.current is dated and undated in st.others


@pytest.mark.parametrize("headline", [
    "Walker not expected to miss time",
    "Walker has not been ruled out",
    "Walker no longer on the injury report",
    "Walker not practicing Wednesday",
    "Walker could play Sunday",
    "Walker likely to play",
    "Walker ruled out",
])
def test_direction_comes_from_the_declared_field_never_from_the_headline(headline):
    # El barrido declara el impacto; el titular es texto. Con la misma frase
    # negada o afirmada, el impacto es el DECLARADO, y sin declaración es
    # UNKNOWN — nunca se deduce de «not», «no longer» o «could».
    assert claim_from_item(_item(headline, "alza", "REPORTADO", "2026-09-01")).impact == "UP"
    assert claim_from_item(_item(headline, "baja", "REPORTADO", "2026-09-01")).impact == "DOWN"
    assert claim_from_item(_item(headline, None, "REPORTADO", "2026-09-01")).impact == "UNKNOWN"
    assert normalize_impact(headline) == "UNKNOWN"
