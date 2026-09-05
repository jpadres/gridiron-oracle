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
