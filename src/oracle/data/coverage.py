"""Distinguir un cero que vale cero de un cero que significa «no medido».

## El problema, con su ejemplo

nflverse entrega `targets` como **0** en las temporadas 2003–2008, no como nulo.
No es que nadie recibiera un pase: es que esa marcación no está en la fuente de
esos años. El resultado son 20.657 filas con más recepciones que objetivos, que
es imposible en un partido de fútbol americano.

Un nulo se ve. Un cero no: pasa por `fillna(0)`, sobrevive a `dropna()`, suma en
un denominador y sale por el otro lado convertido en una cuota del 0%. Todo el
mecanismo de defensa del proyecto —tests, validaciones, preregistros— está
construido sobre datos que se suponen presentes o ausentes, y un cero falso no
es ninguna de las dos cosas.

## Por qué esto es un módulo y no un parche

Hoy ningún camino de producción llega a 2003. El más antiguo es
`fantasy_build.py`, que arranca en 2013. Así que el hueco **no está haciendo
daño ahora mismo**.

Está puesto como mina. El día que alguien amplíe una ventana con el
razonamiento perfectamente sensato de que más datos son mejores, se lleva seis
temporadas de ceros falsos y **nada se lo dice**: no falla ningún test, no salta
ninguna excepción, y las métricas salen algo peores sin motivo visible.

Por eso el hueco no se corrige a mano para esas seis temporadas. Se detecta con
una regla general —«filas donde esta columna tiene que ser positiva por
construcción y sale cero en toda la temporada»— y se convierte en nulo, que es
lo que era desde el principio.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

# Columnas cuyo cero es sospechoso, con la condición que las obliga a ser
# positivas. Si un jugador atrapó un pase, alguien se lo tiró: `receptions >= 1`
# implica `targets >= 1`. Esa implicación es la que convierte «todo cero» en
# «no medido» sin tener que saber de antemano qué años faltan.
IMPLICATIONS: dict[str, str] = {
    "targets": "receptions",
    "target_share": "receptions",
    "air_yards_share": "receptions",
    "wopr": "receptions",
    "racr": "receptions",
    "receiving_air_yards": "receptions",
    "receiving_yards_after_catch": "receptions",
}

# Por debajo de esto no se declara un hueco: una temporada con cuatro filas que
# den cero es una casualidad, no una laguna de la fuente.
MIN_ROWS = 200

# Fracción de ceros a partir de la cual la temporada se da por no medida. No es
# 1.0 porque una fuente puede traer un puñado de filas sueltas rescatadas de otro
# sitio, y un 99% de ceros sigue siendo un hueco.
ZERO_FRACTION = 0.98


@dataclass(frozen=True)
class Gap:
    """Una columna que no está medida en una temporada."""

    column: str
    season: int
    rows: int
    zero_fraction: float

    def __str__(self) -> str:
        return f"{self.column} en {self.season} ({self.rows} filas, {self.zero_fraction:.0%} a cero)"


def detect_gaps(frame: pd.DataFrame, implications: dict[str, str] | None = None) -> list[Gap]:
    """Temporadas donde una columna sale a cero pese a que no puede serlo.

    Devuelve una lista, no un booleano: saber **cuáles** son las temporadas es lo
    que permite excluirlas explícitamente en vez de encogerse de hombros.
    """
    implications = implications or IMPLICATIONS
    if "season" not in frame.columns:
        return []

    gaps: list[Gap] = []
    for column, requires in implications.items():
        if column not in frame.columns or requires not in frame.columns:
            continue
        # Sólo las filas donde la columna tiene que ser positiva por construcción.
        obliged = frame[frame[requires].fillna(0) >= 1]
        if obliged.empty:
            continue
        for season, group in obliged.groupby("season", observed=True):
            if len(group) < MIN_ROWS:
                continue
            fraction = float((group[column].fillna(0) == 0).mean())
            if fraction >= ZERO_FRACTION:
                gaps.append(Gap(column, int(season), len(group), fraction))
    return sorted(gaps, key=lambda g: (g.column, g.season))


def blank_gaps(frame: pd.DataFrame, gaps: list[Gap] | None = None) -> pd.DataFrame:
    """Convierte en nulo lo que nunca fue un cero.

    Es la única forma de que el resto del proyecto pueda tratarlo como lo que
    es. Un `fillna(0)` aguas abajo volverá a poner un cero, pero al menos será
    una decisión escrita en algún sitio en vez de un accidente de la fuente.
    """
    gaps = detect_gaps(frame) if gaps is None else gaps
    if not gaps:
        return frame

    out = frame.copy()
    for gap in gaps:
        mask = out["season"] == gap.season
        out.loc[mask, gap.column] = pd.NA if out[gap.column].dtype == "object" else float("nan")
    return out


def assert_measured(frame: pd.DataFrame, columns: list[str], seasons: range | list[int]) -> None:
    """Revienta si una ventana toca una temporada sin medir en esas columnas.

    Esto es lo que convierte la mina en un error. Llámalo desde cualquier script
    que amplíe su ventana hacia atrás: es una línea, y evita seis temporadas de
    ceros silenciosos que no se manifiestan como un fallo sino como un modelo
    algo peor sin explicación.
    """
    wanted = set(int(s) for s in seasons)
    offending = [
        gap for gap in detect_gaps(frame)
        if gap.column in columns and gap.season in wanted
    ]
    if offending:
        detalle = "; ".join(str(gap) for gap in offending)
        raise ValueError(
            f"La ventana pedida incluye temporadas sin medir: {detalle}. "
            "No son ceros: es que la fuente no trae ese dato esos años. "
            "Recorta la ventana o excluye esas temporadas explícitamente."
        )
