"""Observaciones de mercado con hora, y la decisión sólo ve lo anterior a ella."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from oracle.betting.market_snapshot import (
    DecisionSnapshot,
    MarketObservation,
    MarketType,
    at_decision_time,
    closing,
    closing_line_value,
    opening,
)

T0 = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)


def obs(hours, line, book="pinnacle", odds=1.9091, mtype=MarketType.SPREAD):
    return MarketObservation(game_id="g", market_type=mtype, book=book, line=line, odds_decimal=odds,
                             side="HOME", observed_at=T0 + timedelta(hours=hours), source="test")


def test_an_observation_without_a_timestamp_or_zone_cannot_exist():
    with pytest.raises(ValueError):
        MarketObservation("g", MarketType.SPREAD, "pinnacle", -3.0, 1.9, "HOME", datetime(2026, 9, 6, 12, 0), "t")
    with pytest.raises(TypeError):
        MarketObservation("g", MarketType.SPREAD, "pinnacle", -3.0, 1.9, "HOME", "2026-09-06", "t")


def test_book_source_and_odds_are_mandatory():
    with pytest.raises(ValueError):
        obs(0, -3.0, book="")
    with pytest.raises(ValueError):
        obs(0, -3.0, odds=0.9)
    with pytest.raises(ValueError):
        MarketObservation("g", MarketType.MONEYLINE, "b", -3.0, 1.9, "HOME", T0, "t")


def test_the_decision_only_sees_lines_that_existed_at_that_moment():
    lines = [obs(0, -3.0), obs(2, -3.5), obs(5, -4.0)]
    picked = at_decision_time(lines, T0 + timedelta(hours=3))
    assert picked.line == -3.5, "la de las 17:00 no existía a las 15:00"
    assert at_decision_time(lines, T0 - timedelta(minutes=1)) is None, "sin observación anterior: UNKNOWN, no el cierre"


def test_open_decision_and_close_are_three_different_things():
    lines = [obs(0, -3.0), obs(2, -3.5), obs(5, -4.0)]
    kickoff = T0 + timedelta(hours=6)
    assert opening(lines).line == -3.0
    assert closing(lines, kickoff).line == -4.0
    assert at_decision_time(lines, T0 + timedelta(hours=1)).line == -3.0


def test_books_are_not_mixed_unless_asked():
    lines = [obs(0, -3.0, book="pinnacle"), obs(1, -2.5, book="draftkings")]
    assert at_decision_time(lines, T0 + timedelta(hours=2), book="pinnacle").line == -3.0
    assert at_decision_time(lines, T0 + timedelta(hours=2)).line == -2.5


def test_a_snapshot_refuses_a_market_observed_after_the_decision():
    later = obs(3, -3.5)
    with pytest.raises(ValueError):
        DecisionSnapshot("g", MarketType.SPREAD, "HOME", "m@abc", 0.55, -4.1, later, T0 + timedelta(hours=1))
    ok = DecisionSnapshot("g", MarketType.SPREAD, "HOME", "m@abc", 0.55, -4.1, obs(0, -3.0), T0 + timedelta(hours=1))
    assert ok.market.line == -3.0 and ok.model_version == "m@abc"


def test_clv_is_the_raw_line_move_and_none_across_market_types():
    decision = DecisionSnapshot("g", MarketType.SPREAD, "HOME", "m", 0.55, None, obs(0, -3.0), T0)
    assert closing_line_value(decision, obs(5, -4.0)) == -1.0
    assert closing_line_value(decision, obs(5, 44.5, mtype=MarketType.TOTAL)) is None
