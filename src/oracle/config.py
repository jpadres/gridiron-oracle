"""Rutas y constantes globales del proyecto.

Todo lo que dependa del disco pasa por aquí para que los scripts, la CLI y los
tests no repitan `Path(__file__).parents[...]` con distinto número de saltos.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# La primera temporada con play-by-play fiable en nflverse es 1999, pero las
# features necesitan historial previo para que los ratings estén asentados. El
# backtest arranca por defecto en 2012: para entonces hay 13 temporadas de
# rodaje y el mercado ya publica spread y total en todos los partidos.
FIRST_PBP_SEASON = 1999
DEFAULT_BACKTEST_START = 2012

# Semanas de temporada regular desde 2021 (antes eran 17). Se usa sólo para
# validar entradas de la CLI, no para filtrar datos.
MAX_REGULAR_SEASON_WEEK = 18


def _find_root(start: Path) -> Path:
    """Sube directorios hasta encontrar la raíz del repo (la que tiene pyproject)."""
    for candidate in [start, *start.parents]:
        if (candidate / "pyproject.toml").exists():
            return candidate
    return start


@dataclass(frozen=True)
class Paths:
    """Rutas del proyecto derivadas de una raíz.

    `Oracle.train(".")` y la CLI construyen esto con el cwd; los tests lo
    construyen con un tmp_path para no tocar los datos reales.
    """

    root: Path

    @property
    def data(self) -> Path:
        return self.root / "data"

    @property
    def raw(self) -> Path:
        return self.data / "raw"

    @property
    def processed(self) -> Path:
        return self.data / "processed"

    @property
    def team_games(self) -> Path:
        return self.processed / "team_games.parquet"

    @property
    def games(self) -> Path:
        return self.processed / "games.parquet"

    @property
    def features(self) -> Path:
        return self.processed / "features.parquet"

    @property
    def player_weeks(self) -> Path:
        return self.processed / "player_weeks.parquet"

    @property
    def out(self) -> Path:
        return self.root / "out"

    @property
    def web_data(self) -> Path:
        return self.root / "web" / "data"

    def ensure(self) -> Paths:
        """Crea los directorios de escritura. Idempotente."""
        for directory in (self.raw, self.processed, self.out):
            directory.mkdir(parents=True, exist_ok=True)
        return self


def paths(root: str | os.PathLike[str] | None = None) -> Paths:
    """Devuelve las rutas del proyecto.

    Sin argumento busca la raíz hacia arriba desde el cwd, para que `oracle`
    funcione desde cualquier subdirectorio del repo.
    """
    if root is None:
        return Paths(_find_root(Path.cwd()))
    return Paths(Path(root).expanduser().resolve())
