"""La fecha de un fichero descargado es la del DATO, no la de la descarga."""
from __future__ import annotations

import io
import os
import time
from datetime import datetime, timezone
from email.utils import format_datetime

from oracle.data import ingest


class _Resp(io.BytesIO):
    def __init__(self, body: bytes, last_modified: str | None):
        super().__init__(body)
        self.headers = {"Last-Modified": last_modified} if last_modified else {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def _serve(monkeypatch, body: bytes, last_modified: str | None = None):
    monkeypatch.setattr(ingest.urllib.request, "urlopen", lambda url: _Resp(body, last_modified))


def test_identical_content_keeps_the_old_mtime(tmp_path, monkeypatch):
    dest = tmp_path / "games.csv"
    dest.write_bytes(b"a,b\n1,2\n")
    old = time.time() - 7 * 86400
    os.utime(dest, (old, old))
    _serve(monkeypatch, b"a,b\n1,2\n")
    ingest._download("https://example/games.csv", dest, force=True)
    assert abs(dest.stat().st_mtime - old) < 2, "mismo contenido, misma fecha: la descarga no da frescura"


def test_new_content_takes_the_servers_last_modified(tmp_path, monkeypatch):
    dest = tmp_path / "games.csv"
    dest.write_bytes(b"old")
    published = datetime(2026, 8, 29, 12, 0, tzinfo=timezone.utc)
    _serve(monkeypatch, b"new", format_datetime(published))
    ingest._download("https://example/games.csv", dest, force=True)
    assert dest.read_bytes() == b"new"
    assert abs(dest.stat().st_mtime - published.timestamp()) < 2


def test_without_last_modified_a_changed_file_is_dated_now_and_says_so(tmp_path, monkeypatch):
    dest = tmp_path / "games.csv"
    _serve(monkeypatch, b"fresh", None)
    before = time.time()
    ingest._download("https://example/games.csv", dest, force=True)
    # Sin cabecera no hay mejor fecha que la de descarga para un contenido NUEVO.
    assert dest.stat().st_mtime >= before - 2


def test_a_garbage_last_modified_is_ignored(tmp_path, monkeypatch):
    dest = tmp_path / "x.csv"
    _serve(monkeypatch, b"data", "not a date")
    ingest._download("https://example/x.csv", dest, force=True)
    assert dest.exists()


def test_a_raw_github_file_takes_the_commit_date_when_there_is_no_last_modified(tmp_path, monkeypatch):
    # raw.githubusercontent.com no manda Last-Modified, y games.csv viene de ahí
    # con force=True: cada línea movida por nflverse fechaba el fichero con la
    # descarga. La fecha del último commit que lo tocó es la de publicación.
    dest = tmp_path / "games.csv"
    dest.write_bytes(b"old")
    published = datetime(2026, 8, 29, 12, 0, tzinfo=timezone.utc)
    _serve(monkeypatch, b"new", None)
    monkeypatch.setattr(ingest, "_github_commit_date",
                        lambda url: published.timestamp() if "raw.githubusercontent.com" in url else None)
    ingest._download("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", dest, force=True)
    assert abs(dest.stat().st_mtime - published.timestamp()) < 2


def test_identical_content_still_takes_a_known_origin_date(tmp_path, monkeypatch):
    # Un fichero bajado ayer sin fecha de origen quedó con el mtime de ayer; hoy
    # el origen sí contesta. Mismo contenido, pero la fecha buena es la del origen.
    dest = tmp_path / "games.csv"
    dest.write_bytes(b"same")
    published = datetime(2026, 8, 29, 12, 0, tzinfo=timezone.utc)
    _serve(monkeypatch, b"same", None)
    monkeypatch.setattr(ingest, "_github_commit_date", lambda url: published.timestamp())
    ingest._download("https://raw.githubusercontent.com/o/r/main/games.csv", dest, force=True)
    assert abs(dest.stat().st_mtime - published.timestamp()) < 2


def test_a_last_modified_from_the_future_is_ignored(tmp_path, monkeypatch):
    dest = tmp_path / "x.csv"
    future = datetime.now(timezone.utc).replace(microsecond=0)
    from datetime import timedelta

    _serve(monkeypatch, b"data", format_datetime(future + timedelta(days=30)))
    before = time.time()
    ingest._download("https://example/x.csv", dest, force=True)
    assert dest.stat().st_mtime <= time.time() + 5 and dest.stat().st_mtime >= before - 2


def test_github_commit_date_reads_the_api_and_never_guesses():
    import io
    import json

    class _Api(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    body = json.dumps([{"commit": {"committer": {"date": "2026-08-29T12:00:00Z"}}}]).encode()
    seen = {}

    def opener(request, timeout=0):
        seen["url"] = request.full_url
        return _Api(body)

    stamp = ingest._github_commit_date(
        "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", opener=opener)
    assert stamp == datetime(2026, 8, 29, 12, 0, tzinfo=timezone.utc).timestamp()
    assert "repos/nflverse/nfldata/commits?path=data/games.csv&sha=master" in seen["url"]
    assert ingest._github_commit_date("https://example/games.csv", opener=opener) is None
    assert ingest._github_commit_date(
        "https://raw.githubusercontent.com/o/r/m/f", opener=lambda *a, **k: (_ for _ in ()).throw(OSError())) is None
