#!/usr/bin/env python
"""Le devuelve a un fichero descargado la fecha de su ORIGEN.

    LA HORA DE DESCARGA NO ES LA FECHA DEL DATO — Y CUANDO NO SE SABE, SE DICE.

`ingest._download` fecha cada fichero con el `Last-Modified` del servidor. Los
parquet de nflverse lo mandan; `raw.githubusercontent.com` **no**, y de ahí sale
`games.csv`, que es el fichero de las líneas de mercado y el que más rápido
caduca. Sin cabecera, el descargador deja la hora de descarga y avisa por
stderr — honesto, pero el aviso no arregla la fecha.

Medido el 2026-09-06: el calendario se había publicado el **5 de septiembre a
las 23:05 UTC** y el fichero decía «6 de septiembre». Un día inventado sobre el
dato que caduca en minutos.

## De dónde sale la fecha buena

Del historial del repositorio: el último commit que tocó ESE fichero. La API de
GitHub está cerrada para repos ajenos desde este contenedor, pero la lectura git
anónima de un repositorio público no, así que se usa un clon **sin blobs**
(`--filter=blob:none`), que trae el historial sin los CSV.

## Qué NO hace

No toca un fichero cuya fecha ya venga del servidor, no adivina cuando el
historial no alcanza (devuelve `None` y el fichero se queda como estaba, con su
aviso), y **nunca** escribe la fecha de hoy. UNKNOWN antes que inventado.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.data.ingest import SCHEDULE_URL  # noqa: E402

_RAW = re.compile(r"^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$")


def commit_date(url: str, clone_dir: Path | None = None, depth: int = 60) -> datetime | None:
    """Fecha del último commit que tocó el fichero que sirve `url`.

    `clone_dir` reutiliza un clon ya hecho; sin él se clona en un temporal.
    Cualquier fallo —sin red, historial corto, otro host— devuelve `None`: quien
    llama decide qué hacer con el «no sé», y lo que no puede es recibir una
    fecha fabricada.
    """
    match = _RAW.match(url)
    if not match:
        return None
    owner, repo, ref, path = match.groups()

    def _log(repo_dir: Path) -> datetime | None:
        try:
            out = subprocess.run(
                ["git", "-C", str(repo_dir), "log", "-1", "--format=%cI", "--", path],
                capture_output=True, text=True, timeout=120, check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        stamp = (out.stdout or "").strip()
        if not stamp:
            return None
        try:
            return datetime.fromisoformat(stamp)
        except ValueError:
            return None

    if clone_dir and (clone_dir / ".git").exists():
        found = _log(clone_dir)
        if found is not None:
            return found
    with tempfile.TemporaryDirectory() as tmp:
        destino = Path(tmp) / repo
        try:
            subprocess.run(
                ["git", "clone", "--filter=blob:none", "--no-checkout",
                 "--depth", str(depth), "--branch", ref,
                 f"https://github.com/{owner}/{repo}", str(destino)],
                capture_output=True, text=True, timeout=600, check=True,
                env={**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"},
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return _log(destino)


def repair(path: Path, url: str, clone_dir: Path | None = None) -> str:
    """Pone en `path` la fecha de publicación de su origen. Dice qué hizo."""
    if not path.exists():
        return f"AUSENTE   {path.name}"
    published = commit_date(url, clone_dir)
    if published is None:
        return (f"SIN FECHA {path.name}: el origen no la da y el historial no se pudo "
                "leer. Se queda con la hora de descarga, que NO es la del dato")
    stamp = published.timestamp()
    antes = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    if abs(path.stat().st_mtime - stamp) < 1:
        return f"YA CORRECTA {path.name}: {published.date().isoformat()}"
    os.utime(path, (stamp, stamp))
    return (f"CORREGIDA {path.name}: {antes.date().isoformat()} (descarga) -> "
            f"{published.date().isoformat()} (publicación del origen)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=None)
    parser.add_argument("--clone", default=None,
                        help="Clon ya hecho del repo de origen, para no volver a clonar.")
    args = parser.parse_args()
    paths = resolve_paths(args.root)
    clone = Path(args.clone) if args.clone else None
    # Sólo los ficheros cuyo origen NO manda `Last-Modified`. Los parquet de
    # nflverse sí lo mandan y ya llegan bien fechados.
    print(repair(paths.raw / "games.csv", SCHEDULE_URL, clone))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
