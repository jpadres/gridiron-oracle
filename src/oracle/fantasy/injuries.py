"""El parte de lesiones OFICIAL, tal y como lo publica la liga.

    ESTO MARCA. NO CALCULA. Y NO CONVIERTE UNA PROGRESIÓN EN UNA PROBABILIDAD.

Misma frontera que `narrative/status.py` y `fantasy/roster_status.py` (regla 8):
`attach()` escribe **sólo** campos con prefijo `injury_`, y el número de la fila
—proyección, VOR, puesto— es idéntico con marca y sin ella.

## Por qué esto es una fuente distinta de las que ya había

Había DOS capas hablando de disponibilidad y ninguna era el parte oficial:

  * `research/player_status.json` — curado a mano desde la PRENSA. Trae lo que
    los datos no tienen (suspensiones, exentos, IR de temporada) y es
    insustituible para eso, pero son 47 entradas y las escribe una persona.
  * `roster_status.py` — la situación de plantilla (activo, reserva, cortado).
    Dice si tiene equipo, no si juega el domingo.

El parte de lesiones es lo que el club ENTREGA a la liga cada semana, con su
designación de partido y su participación en el entrenamiento. Es evidencia
primaria y llega por nflverse, que lo republica tal cual. 182 filas para la
jornada 1 de 2026, 32 equipos.

## Las dos columnas son dos cosas distintas, y no se colapsan

    DESIGNACIÓN DE PARTIDO   Out · Doubtful · Questionable · (sin designar)
    PARTICIPACIÓN            DNP · Limited · Full

Un jugador puede entrenar COMPLETO y estar OUT —pasa: Michael Penix Jr. figura
así en la jornada 1— y puede entrenar LIMITADO y no llevar designación. Meterlas
en un solo campo «lesionado» borra justo lo que decide una alineación.

## Lo que este módulo NO hace

**No estima probabilidad de jugar.** «DNP → LP → FP» es una progresión
descriptiva y convertirla en un 75% sería inventar una medición que este
repositorio no tiene. QUESTIONABLE sigue siendo QUESTIONABLE hasta que exista el
parte de inactivos oficial, que sale 90 minutos antes del saque.

**No decide quién es el sustituto.** Eso es rol y depth chart, no lesión.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from ..data.ingest import normalize_team

#: Designación de partido, con la severidad que ya usa el resto del producto.
#: `narrative/status.py` habla en OUT / RISK, y aquí se traduce a lo mismo para
#: que una pantalla no tenga que conocer dos vocabularios.
OUT = "OUT"
DOUBTFUL = "DOUBTFUL"
QUESTIONABLE = "QUESTIONABLE"

#: La designación tal y como la escribe el parte. Cualquier otra LEVANTA: una
#: etiqueta nueva traducida a «juega» por defecto es el fallo que
#: `roster_status.py` ya documenta con `INA`.
FROM_REPORT = {
    "Out": OUT,
    "Doubtful": DOUBTFUL,
    "Questionable": QUESTIONABLE,
}

#: Severidad para las pantallas. DOUBTFUL no es OUT —el jugador puede jugar— y
#: por eso no se le aplica la exclusión de la lista corta que sí tiene un OUT.
SEVERITY = {OUT: "OUT", DOUBTFUL: "RISK", QUESTIONABLE: "RISK"}

#: Participación en el entrenamiento, con las tres formas que trae el fichero.
DNP = "DNP"
LIMITED = "LIMITED"
FULL = "FULL"
FROM_PRACTICE = {
    "Did Not Participate In Practice": DNP,
    "Limited Participation in Practice": LIMITED,
    "Full Participation in Practice": FULL,
}


class InjuryReportUnknown(ValueError):
    """El parte trae una etiqueta que este módulo no conoce.

    Falla cerrado por lo mismo que `regular_season()` y `roster_status.load()`:
    ante un cambio de vocabulario, seguir adelante convertiría un fallo en un
    board que afirma que alguien designado juega.
    """


@dataclass(frozen=True)
class InjuryEntry:
    """Una fila del parte, con sus dos hechos separados."""

    player_id: str
    team: str | None
    position: str | None
    full_name: str | None
    #: `None` cuando el jugador aparece en el parte SIN designación de partido:
    #: es el caso de quien entrenó limitado y el club no le puso etiqueta.
    designation: str | None
    practice: str | None
    injury: str | None
    season: int
    week: int
    source_as_of: str | None

    @property
    def severity(self) -> str | None:
        return SEVERITY.get(self.designation) if self.designation else None

    @property
    def excludes_from_lineup(self) -> bool:
        """Sólo un OUT. Un DOUBTFUL puede jugar, y decidirlo aquí sería
        convertir una designación en una predicción."""
        return self.designation == OUT


def _source_date(path: Path) -> str | None:
    try:
        return date.fromtimestamp(path.stat().st_mtime).isoformat()
    except OSError:
        return None


def load(path: Path, *, season: int, week: int) -> dict[str, InjuryEntry]:
    """El parte de UNA jornada, por `gsis_id`.

    Se acota a `(season, week)` a propósito: el fichero acumula la temporada y
    el parte de la jornada 3 no dice nada de la 7. Es el mismo recorte que
    `_estado_de_los_partidos` necesitó cuando `(visitante, local)` resultó no
    ser una clave única.
    """
    if not path.exists():
        return {}
    frame = pd.read_parquet(path)
    for column in ("gsis_id", "team", "season", "week"):
        if column not in frame.columns:
            raise InjuryReportUnknown(
                f"el parte no trae la columna «{column}»: sin ella no se puede "
                "saber de quién ni de qué jornada habla"
            )
    frame = frame[(frame["season"] == season) & (frame["week"] == week)]
    frame = frame[frame["gsis_id"].notna()]
    if frame.empty:
        return {}

    def _conocidas(serie: pd.Series, catalogo: dict, que: str) -> None:
        vistas = {v for v in serie.dropna().unique() if str(v).strip()}
        raras = sorted(vistas - set(catalogo))
        if raras:
            raise InjuryReportUnknown(
                f"{que} que este módulo no conoce: {raras}. Traducirlas a "
                "«juega» por defecto es inventar el dato que decide la alineación"
            )

    _conocidas(frame.get("report_status", pd.Series(dtype=str)), FROM_REPORT,
               "designaciones de partido")
    _conocidas(frame.get("practice_status", pd.Series(dtype=str)), FROM_PRACTICE,
               "estados de entrenamiento")

    as_of = _source_date(path)
    salida: dict[str, InjuryEntry] = {}
    for row in frame.to_dict(orient="records"):
        designacion = row.get("report_status")
        practica = row.get("practice_status")
        salida[str(row["gsis_id"])] = InjuryEntry(
            player_id=str(row["gsis_id"]),
            # NORMALIZADO AQUÍ: el parte escribe «LA» y el board «LAR». Es el
            # `AZ`/`ARI` de siempre, y comparar en crudo fabricaría traspasos.
            team=normalize_team(str(row["team"])) if row.get("team") else None,
            position=str(row["position"]) if row.get("position") else None,
            full_name=str(row["full_name"]) if row.get("full_name") else None,
            designation=FROM_REPORT.get(designacion) if designacion else None,
            practice=FROM_PRACTICE.get(practica) if practica else None,
            injury=str(row["report_primary_injury"])
            if row.get("report_primary_injury") else None,
            season=int(row["season"]),
            week=int(row["week"]),
            source_as_of=as_of,
        )
    return salida


def attach(rows: list[dict], entries: dict[str, InjuryEntry]) -> int:
    """Cuelga el parte en las filas. Devuelve cuántas marcó.

    Sólo campos con prefijo `injury_`, para que la frontera se pueda comprobar
    leyendo la lista de campos. Con el diccionario VACÍO no se marca a nadie:
    sin parte no se sabe, y «ninguno está lesionado» es una afirmación que este
    módulo no puede hacer.
    """
    if not entries:
        return 0
    marcadas = 0
    for row in rows:
        entrada = entries.get(str(row.get("player_id")))
        if entrada is None:
            continue
        row["injury_designation"] = entrada.designation
        row["injury_severity"] = entrada.severity
        row["injury_practice"] = entrada.practice
        row["injury_detail"] = entrada.injury
        row["injury_source_as_of"] = entrada.source_as_of
        marcadas += 1
    return marcadas
