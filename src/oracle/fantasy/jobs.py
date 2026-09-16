"""¿TIENE ESTE JUGADOR EL TRABAJO? — el orden que declara el club, con su fecha.

    PRIMERO SI TIENE EL PUESTO. DESPUÉS EL RANKING.
    UN PATEADOR PEGADO AL EQUIPO EQUIVOCADO NO ES UNA RECOMENDACIÓN FLOJA:
    NO ES UNA RECOMENDACIÓN.

## Por qué hacía falta

Los especialistas del board salen de quién más pateó la temporada PASADA, que es
una respuesta a otra pregunta. Medido el 15 de septiembre de 2026 contra el
depth chart de registro: **NUEVE de los 32 pateadores publicados no eran el
pateador de su equipo.** Zane Gonzalez por ATL cuando es Nick Folk; Matt Prater
por BUF cuando es Tyler Bass; Younghoe Koo por NYG cuando es Dominic Zvada. La
capa de plantilla marcaba a varios —`NOT_ON_ROSTER`, `PRACTICE_SQUAD`, activo en
OTRO equipo— pero marcar «este no está» no es lo mismo que saber quién SÍ está, y
la fila seguía publicándose bajo el equipo equivocado.

Es la tercera vez que este repositorio se equivoca con la identidad de un
pateador, y las dos anteriores se arreglaron por el lado de la MARCA. Esto lo
arregla por el lado de la PREGUNTA.

## Qué es y qué no

Esto **marca, no calcula** — la misma frontera que `injuries.py` y
`narrative/status.py`. No toca una proyección: escribe campos con prefijo
`job_` para que la regla se pueda comprobar leyendo la lista de campos.

Y no decide desempates: si un club lista DOS en el mismo puesto, eso es
`COMPETITION` y se dice. Elegir uno sería inventar la respuesta que la fuente no
da — «ante la duda no se empareja», aplicado al puesto en vez de al nombre.

## La fecha es del DATO, no de la descarga

`depth_charts` trae `dt`, el instante de la instantánea (179 entre marzo y
septiembre de 2026). Ése es el `effective_at`, y viaja con la respuesta. El mtime
del fichero es la hora de DESCARGA y no da frescura — regla 5, y en este
repositorio ya se fabricaron 26 días con esa confusión.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from ..data.ingest import normalize_team

#: Las posiciones del depth chart que este módulo sabe leer, por su `pos_abb`.
#: `PK` es el pateador ("Place kicker"). Se acota a propósito: una posición que
#: no está aquí devuelve vacío en vez de una respuesta inventada.
PUESTOS = {"PK": "KICKER"}


class DepthChartUnavailable(RuntimeError):
    """No hay depth chart con el que contestar.

    Se LEVANTA en vez de devolver un diccionario vacío: «no sé quién tiene el
    trabajo» y «nadie tiene el trabajo» son respuestas distintas, y la segunda
    borraría a los 32 pateadores de la pantalla sin decir por qué.
    """


@dataclass(frozen=True)
class JobRecord:
    """Quién tiene un puesto en un equipo, según el club, y en qué instante."""

    team: str
    position: str
    player_id: str | None
    player_name: str
    rank: int
    effective_at: str
    competition: tuple[str, ...] = field(default=())

    @property
    def contested(self) -> bool:
        return len(self.competition) > 0


def latest_snapshot(depth_charts: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    """La instantánea más reciente del depth chart, y su instante.

    Se coge UNA instantánea entera y no el máximo por equipo: mezclar la fila de
    un club de septiembre con la de otro de marzo publicaría un orden que nunca
    existió a la vez.
    """
    if depth_charts is None or len(depth_charts) == 0:
        raise DepthChartUnavailable("el depth chart llegó vacío")
    if "dt" not in depth_charts.columns:
        raise DepthChartUnavailable("el depth chart no trae `dt`: sin instante no hay frescura")
    instante = str(depth_charts["dt"].max())
    return depth_charts[depth_charts["dt"] == depth_charts["dt"].max()].copy(), instante


def jobs_of_record(depth_charts: pd.DataFrame, pos_abb: str = "PK") -> dict[str, JobRecord]:
    """El titular declarado de `pos_abb` en cada equipo, por código normalizado.

    El código de equipo pasa por `normalize_team` porque el depth chart escribe
    «LA» donde el board escribe «LAR». Comparar en crudo fabricó cinco traspasos
    falsos la noche antes de un draft, y esa lección está anotada dos veces.
    """
    if pos_abb not in PUESTOS:
        return {}
    ult, instante = latest_snapshot(depth_charts)
    filas = ult[ult["pos_abb"] == pos_abb].copy()
    if filas.empty:
        raise DepthChartUnavailable(f"la instantánea {instante} no lista ningún {pos_abb}")
    filas["team"] = filas["team"].map(normalize_team)
    filas["pos_rank"] = pd.to_numeric(filas["pos_rank"], errors="coerce")

    salida: dict[str, JobRecord] = {}
    for equipo, grupo in filas.groupby("team"):
        grupo = grupo.sort_values("pos_rank")
        primero = grupo.iloc[0]
        # Competencia es «hay más de uno listado», no «el segundo es bueno».
        # Se nombran los demás para que la pantalla pueda decirlo sin elegir.
        resto = tuple(str(n) for n in grupo["player_name"].iloc[1:].tolist())
        salida[str(equipo)] = JobRecord(
            team=str(equipo),
            position=PUESTOS[pos_abb],
            player_id=(str(primero["gsis_id"]) if pd.notna(primero.get("gsis_id")) else None),
            player_name=str(primero["player_name"]),
            rank=int(primero["pos_rank"]) if pd.notna(primero["pos_rank"]) else 1,
            effective_at=instante,
            competition=resto,
        )
    return salida


#: Los tres veredictos, y ninguno es un número.
HAS_JOB = "HAS_JOB"            # es el titular declarado de su equipo
NOT_THE_JOB = "NOT_THE_JOB"    # su equipo declara a OTRO en ese puesto
UNKNOWN_JOB = "UNKNOWN_JOB"    # su equipo no aparece en la instantánea


def attach(rows: list[dict], jobs: dict[str, JobRecord]) -> list[dict]:
    """Marca cada fila con su situación de puesto. SÓLO campos con prefijo `job_`.

    La frontera es comprobable leyendo veinte líneas, como en `status.py`: aquí
    no se escribe ni se toca `projected_points`. El número de la fila es el mismo
    con marca y sin ella; lo que cambia es que se dice.
    """
    for row in rows:
        equipo = normalize_team(str(row.get("team") or ""))
        registro = jobs.get(equipo)
        if registro is None:
            row["job_status"] = UNKNOWN_JOB
            row["job_holder"] = None
            row["job_effective_at"] = None
            row["job_contested"] = False
            continue
        mismo = (
            registro.player_id is not None
            and str(row.get("player_id") or "") == registro.player_id
        )
        row["job_status"] = HAS_JOB if mismo else NOT_THE_JOB
        row["job_holder"] = registro.player_name
        row["job_effective_at"] = registro.effective_at
        # Sólo se le atribuye competencia a quien TIENE el puesto: decir
        # «disputado» de alguien que no lo tiene mezcla dos hechos distintos.
        row["job_contested"] = bool(mismo and registro.contested)
        row["job_competition"] = list(registro.competition) if mismo else []
    return rows
