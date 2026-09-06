"""La fecha de un fichero descargado es la de su publicación, no la de la descarga."""
from __future__ import annotations

import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def _script(nombre):
    """Carga un script de `scripts/` POR RUTA, sin depender de `sys.path`.

    `from scripts import ...` funciona con `python -m pytest` —que mete el
    directorio actual en `sys.path`— y **no** con `pytest` a secas, que es lo
    que ejecuta CI. La suite entera se quedó sin recolectar por eso, con los
    589 tests en verde en local. Cargar por ruta no depende de cómo se invoque.
    """
    import importlib.util
    from pathlib import Path

    ruta = Path(__file__).resolve().parents[1] / "scripts" / f"{nombre}.py"
    spec = importlib.util.spec_from_file_location(f"_scripts_{nombre}", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


repair = _script("source_date_repair")


def _repo(tmp_path: Path) -> Path:
    """Un repositorio de verdad, para no probar contra un doble que miente."""
    d = tmp_path / "origen"
    (d / "data").mkdir(parents=True)
    def run(*a, when=None):
        env = dict(os.environ)
        if when:
            # `--date` sólo fija la fecha del AUTOR y aquí se lee la del
            # COMMITTER: sin esto el doble no se parece al original.
            env["GIT_COMMITTER_DATE"] = when
            env["GIT_AUTHOR_DATE"] = when
        subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True, env=env)

    subprocess.run(["git", "init", "-q", "-b", "master", str(d)], check=True, capture_output=True)
    run("config", "user.email", "t@t"); run("config", "user.name", "t")
    (d / "data" / "games.csv").write_text("a,b\n1,2\n")
    (d / "otro.txt").write_text("x")
    run("add", "-A")
    run("commit", "-q", "-m", "primero", when="2026-08-01T10:00:00+00:00")
    # Un commit posterior que NO toca games.csv: la fecha del fichero no es la
    # del repositorio, y confundirlas es fechar el dato con otra cosa.
    (d / "otro.txt").write_text("y")
    run("add", "-A")
    run("commit", "-q", "-m", "segundo", when="2026-09-04T10:00:00+00:00")
    return d


def test_the_date_is_the_files_last_commit_not_the_repos(tmp_path, monkeypatch):
    d = _repo(tmp_path)
    url = "https://raw.githubusercontent.com/quien/sea/master/data/games.csv"
    found = repair.commit_date(url, clone_dir=d)
    assert found is not None
    assert found.date().isoformat() == "2026-08-01", "tomó la fecha de un commit que no tocó el fichero"


def test_repair_moves_the_mtime_off_the_download_time(tmp_path):
    d = _repo(tmp_path)
    destino = tmp_path / "games.csv"
    destino.write_text("a,b\n1,2\n")
    ahora = time.time()
    os.utime(destino, (ahora, ahora))
    url = "https://raw.githubusercontent.com/quien/sea/master/data/games.csv"
    mensaje = repair.repair(destino, url, clone_dir=d)
    assert "CORREGIDA" in mensaje
    fecha = datetime.fromtimestamp(destino.stat().st_mtime, timezone.utc).date().isoformat()
    assert fecha == "2026-08-01"


def test_an_unreadable_history_never_invents_a_date(tmp_path):
    destino = tmp_path / "games.csv"
    destino.write_text("x")
    antes = 1_600_000_000.0
    os.utime(destino, (antes, antes))
    # Un directorio que no es un repositorio: no hay historial que leer.
    mensaje = repair.repair(destino, "https://raw.githubusercontent.com/a/b/master/data/games.csv",
                            clone_dir=tmp_path / "no_es_repo")
    assert "SIN FECHA" in mensaje
    # Y sobre todo: NO se puso la de hoy.
    assert abs(destino.stat().st_mtime - antes) < 2


def test_a_url_that_is_not_raw_github_is_not_guessed(tmp_path):
    assert repair.commit_date("https://example.com/games.csv", clone_dir=tmp_path) is None
