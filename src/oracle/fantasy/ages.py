"""Edad de cada jugador a la altura de la temporada que se proyecta.

## Por qué no vale la edad de hoy

La curva de edad se aplica a proyecciones de temporadas pasadas durante la
validación walk-forward. Usar la edad actual para proyectar 2019 le da a cada
jugador siete años de más: un error sistemático, en la misma dirección para
todos, con toda la pinta de un dato correcto.

La edad se calcula **a 1 de septiembre de la temporada proyectada**, que es
aproximadamente el arranque y es la convención que usa la literatura de fantasy
cuando habla de «un corredor de 27 años».

## Sobre la fuga

`birth_date` es un atributo estático: no cambia, y se conoce desde antes de que
el jugador existiera para la NFL. Leerlo del fichero de plantillas de cualquier
temporada no introduce información futura.

Lo que sí la introduciría es tomar de un fichero posterior **cualquier otra
columna** —el equipo, el puesto en el depth chart—, así que aquí se lee sólo esa
y se descarta el resto. La restricción está en el código, no en la buena voluntad
de quien lo llame.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd

# Fecha de referencia dentro de la temporada. El 1 de septiembre está a unos días
# del arranque y es la convención habitual.
REFERENCE_MONTH = 9
REFERENCE_DAY = 1


def birth_dates(raw_dir: Path) -> pd.Series:
    """`player_id` -> fecha de nacimiento, de todos los ficheros de plantilla.

    Se recorren todos porque un jugador retirado no aparece en los recientes y
    uno nuevo no aparece en los antiguos. Como el dato es estático, mezclar años
    no crea ningún problema de orden temporal — y una discrepancia entre
    ficheros sería un error de la fuente, así que se conserva la primera lectura
    y no la última.
    """
    frames = []
    for path in sorted(Path(raw_dir).glob("roster_*.parquet")):
        try:
            frame = pd.read_parquet(path, columns=["gsis_id", "birth_date"])
        except (ValueError, KeyError):
            continue
        frames.append(frame.dropna(subset=["gsis_id", "birth_date"]))

    if not frames:
        return pd.Series(dtype="datetime64[ns]")

    stacked = pd.concat(frames, ignore_index=True).drop_duplicates("gsis_id")
    stacked["birth_date"] = pd.to_datetime(stacked["birth_date"], errors="coerce")
    return stacked.dropna(subset=["birth_date"]).set_index("gsis_id")["birth_date"]


def ages_for_season(births: pd.Series, season: int) -> pd.Series:
    """Edad en años a 1 de septiembre de `season`.

    Devuelve `NaN` para quien no tenga fecha, y `_age_factor` ya trata eso como
    «sin corrección». Un jugador sin fecha no recibe una edad supuesta: recibe
    ninguna.
    """
    if births.empty:
        return pd.Series(dtype=float)
    reference = pd.Timestamp(date(season, REFERENCE_MONTH, REFERENCE_DAY))
    return ((reference - births).dt.days / 365.25).rename("age")
