"""La fecha de publicación se lee en los formatos de la prensa, y nunca se inventa."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from oracle.narrative.research import parse_publication_date

NOW = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("stamp, day", [
    ("2026-09-04", "2026-09-04"),
    ("2026-09-04T10:15:00Z", "2026-09-04"),
    ("2026-09-04T10:15:00+00:00", "2026-09-04"),
    ("2026-09-04T22:15:00-04:00", "2026-09-04"),  # la zona se conserva, no se convierte
    ("Sep 4, 2026", "2026-09-04"),
    ("Sept 4, 2026", "2026-09-04"),
    ("Sept. 4, 2026", "2026-09-04"),
    ("September 4, 2026", "2026-09-04"),
    ("4 Sep 2026", "2026-09-04"),
    ("4 September 2026", "2026-09-04"),
    ("Thu, 04 Sep 2026 10:15:00 GMT", "2026-09-04"),  # RFC 2822 de un feed
    ("Thursday, September 4, 2026", "2026-09-04"),
    ("2026-03-14", "2026-03-14"),  # una fecha vieja sigue siendo una fecha
])
def test_common_press_formats_are_read(stamp, day):
    out = parse_publication_date(stamp, now=NOW)
    assert out is not None and out.startswith(day), (stamp, out)


@pytest.mark.parametrize("stamp", [
    "2026-09-07", "Sep 9, 2026", "2027-01-01T00:00:00Z", "Mon, 14 Sep 2026 10:00:00 GMT",
])
def test_a_future_date_is_unknown(stamp):
    assert parse_publication_date(stamp, now=NOW) is None


def test_one_day_of_tolerance_for_clocks_and_zones():
    assert parse_publication_date("2026-09-06", now=NOW) is not None


@pytest.mark.parametrize("stamp", [
    None, "", "   ", "garbage", "Sunday", "14", "2026", "0.5", "week 1", "4/9/2026", "09/04/2026",
    "1899-12-31", "not a date 2026", "20260904", True, [],
])
def test_unparseable_is_unknown_and_never_today(stamp):
    out = parse_publication_date(stamp, now=NOW)
    assert out is None, (stamp, out)


def test_never_returns_the_reference_clock_for_garbage():
    for stamp in ("garbage", "", None):
        assert parse_publication_date(stamp, now=NOW) != NOW.isoformat()
