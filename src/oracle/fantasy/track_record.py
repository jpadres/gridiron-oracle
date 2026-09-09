"""Cómo le ha ido a ESTE modelo con ESTE jugador, temporada a temporada.

    EL NÚMERO DE LA FILA NO CAMBIA. LO QUE CAMBIA ES QUE SE DICE.

Misma frontera que la capa de prensa (regla 8): esto MARCA, no calcula. Ningún
campo de aquí entra en `projected_points`, en el VOR ni en el orden.

## Por qué existe

El board publica una proyección y no dice nada sobre su propio historial. Y el
historial no es uniforme: la curva de edad está bien calibrada para el corredor
de 30+ MEDIO —55 casos, proyectados 94 y realizados 57, con 22 en cero— y aun
así falló con Derrick Henry por 201 puntos en 2024 y por 145 en 2025. Las dos
cosas son ciertas a la vez, y quien draftea necesita ver la segunda al lado del
número, no enterarse en enero.

Un promedio no puede avisar de esto: por construcción, el caso que el promedio
aplasta es invisible EN el promedio. Sólo se ve mirando al jugador.

## Por qué no es fuga

Cada temporada se proyecta con el MISMO walk-forward de la validación: para la
temporada S sólo entran partidos de temporadas anteriores a S. Lo realizado es
de S, ya jugada y cerrada. Al construir el board de 2026 se leen 2024 y 2025,
que son pasado observado — no hay ni un dato futuro en la proyección de ninguna
de las dos.

## Qué NO se hace con esto

No se corrige la proyección. Un multiplicador «Henry rinde más de lo que digo»
ajustado sobre dos observaciones es exactamente el sobreajuste que este
repositorio rechaza; y el candidato preregistrado para cambiar la FORMA de la
curva ya se midió y salió RECHAZADO (`docs/PREREGISTRO_edad_forma.md`). Lo que
sí se puede hacer sin inventar nada es enseñar el registro.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

# Cuántas temporadas pasadas se enseñan. Dos es lo que cabe en una fila y es la
# ventana en la que un jugador sigue siendo el mismo jugador; con cinco, el de
# hace cinco años estaba en otro equipo, con otro rol y en otra edad.
SEASONS_SHOWN = 2

# Por debajo de esta proyección no se publica el historial: un jugador al que el
# modelo proyectó 20 puntos y realizó 60 «falló por el 200%» y no significa
# nada. El umbral es el mismo `MIN_PROJECTED` de la validación de la curva.
MIN_PROJECTED = 50.0

# Qué error merece llamarse GRANDE.
#
#     EL LISTÓN NO ES UNA CONSTANTE: ES EL ERROR TÍPICO DEL MODELO
#     EN ESE NIVEL DE PROYECCIÓN, MEDIDO EN LOS MISMOS BOARDS.
#
# Esto costó dos intentos y los dos fallos merecen quedar escritos.
#
# El primero fue un 60 a ojo. Salía en el 18% del board — y 60 está por DEBAJO
# del MAE global del modelo (85,5), así que «se equivocó mucho» significaba «se
# equivocó como siempre». Es el fallo de «un aviso que sale en los 250
# jugadores», con otro nombre.
#
# El segundo fue usar ese MAE global. Mejor, pero seguía mintiendo por otro
# lado: el modelo ENCOGE hacia la media, así que se queda corto con casi todo
# el que acaba siendo élite. Con el listón global, la marca salía en nueve de
# los doce primeros —Bijan −176, Gibbs −181, Chase −149— y no distinguía a
# nadie de nadie. Un número que describe una propiedad GLOBAL del modelo no es
# un hecho sobre ESE jugador.
#
# Lo que sí lo es: equivocarse más que de costumbre PARA SU NIVEL. Un fallo de
# 170 puntos sobre una proyección de 230 es lo normal arriba; sobre una de 118
# no lo es. El listón se mide por banda de proyección en los mismos boards
# walk-forward, así que no hay ninguna constante que ajustar y si el modelo
# mejora el listón baja solo.
#
# `BANDS` son los cortes de proyección, los mismos que ya usa la validación por
# banda de rank. `BAND_FLOOR` evita que una banda con pocos casos produzca un
# listón absurdamente bajo.
BANDS: tuple[float, ...] = (50.0, 100.0, 150.0, 200.0, 250.0)
BAND_FLOOR = 40.0


def _band(projected: float) -> int:
    """En qué banda de proyección cae un número. Los cortes son los de la validación."""
    for i, corte in enumerate(BANDS):
        if projected < corte:
            return i
    return len(BANDS)


def typical_error(records: dict[str, list[SeasonRecord]]) -> dict[int, float]:
    """El error absoluto MEDIO del modelo en cada banda, de estos mismos datos.

    Es el listón contra el que se juzga a cada jugador. Se calcula aquí y no se
    escribe a mano precisamente para que no se pueda ajustar: sale de los boards
    walk-forward que ya se han construido.
    """
    por_banda: dict[int, list[float]] = {}
    for registros in records.values():
        for r in registros:
            por_banda.setdefault(_band(r.projected), []).append(abs(r.error))
    return {
        b: max(float(np.mean(v)), BAND_FLOOR) for b, v in por_banda.items() if v
    }


@dataclass(frozen=True)
class SeasonRecord:
    """Lo que el modelo dijo y lo que pasó, en una temporada ya cerrada."""

    season: int
    projected: float
    realized: float

    @property
    def error(self) -> float:
        """Positivo = el modelo proyectó de MÁS. Negativo = se quedó corto."""
        return self.projected - self.realized

    def as_payload(self) -> dict:
        return {
            "season": self.season,
            "projected": round(self.projected, 1),
            "realized": round(self.realized, 1),
            "error": round(self.error, 1),
        }


def build(
    boards: dict[int, pd.DataFrame],
    realized: dict[int, pd.Series],
    *,
    seasons_shown: int = SEASONS_SHOWN,
    min_projected: float = MIN_PROJECTED,
) -> dict[str, list[SeasonRecord]]:
    """El historial por jugador a partir de boards walk-forward ya calculados.

    `boards[S]` es el board proyectado PARA la temporada S usando sólo
    temporadas anteriores; `realized[S]` son los puntos que cada jugador hizo en
    S. Que el board sea walk-forward es responsabilidad de quien lo construye —
    aquí se comprueba lo único comprobable desde dentro: que no se pida una
    temporada sin su realizado.
    """
    out: dict[str, list[SeasonRecord]] = {}
    for season in sorted(boards)[-seasons_shown:]:
        if season not in realized:
            raise ValueError(
                f"board de {season} sin puntos realizados: no se puede publicar "
                "un historial de una temporada que aún no ha terminado"
            )
        board, real = boards[season], realized[season]
        for pid, proj in zip(board["player_id"], board["projected_points"], strict=True):
            if not np.isfinite(proj) or proj < min_projected:
                continue
            out.setdefault(str(pid), []).append(
                SeasonRecord(season, float(proj), float(real.get(pid, 0.0)))
            )
    for registros in out.values():
        registros.sort(key=lambda r: r.season)
    return out


def attach(
    rows: list[dict],
    record: dict[str, list[SeasonRecord]],
    typical: dict[int, float] | None = None,
) -> int:
    """Cuelga el historial de las filas del board. Devuelve cuántas se marcaron.

    Escribe SÓLO campos con prefijo `track_`, para que la frontera se pueda
    comprobar leyendo la lista de campos — misma disciplina que `status_` en la
    capa de prensa.
    """
    # Sin listón explícito se mide de los mismos datos: nunca una constante.
    typical = typical if typical is not None else typical_error(record)
    marcadas = 0
    for row in rows:
        registros = record.get(str(row.get("player_id")))
        if not registros:
            continue
        row["track_seasons"] = [r.as_payload() for r in registros]
        # El error de la temporada más reciente es el que se lee de un vistazo.
        ultimo = registros[-1]
        row["track_last_error"] = round(ultimo.error, 1)
        # «Se quedó corto en las dos últimas y por mucho» es el aviso que la
        # media no puede dar. Se exige en TODAS las temporadas mostradas: un
        # fallo aislado es ruido, dos seguidos en la misma dirección no.
        grandes = [
            r for r in registros
            if abs(r.error) >= typical.get(_band(r.projected), BAND_FLOOR)
        ]
        if len(grandes) == len(registros) and len(registros) >= 2:
            signos = {r.error > 0 for r in grandes}
            if len(signos) == 1:
                row["track_bias"] = "OVER" if grandes[0].error > 0 else "UNDER"
                row["track_bias_points"] = round(
                    float(np.mean([abs(r.error) for r in grandes])), 1
                )
                # CUÁNTAS VECES su error típico. Es lo que separa a Henry
                # —173 sobre una proyección de 118— de Bijan, cuyo −176 sobre
                # 230 es el comportamiento normal del modelo arriba.
                row["track_bias_ratio"] = round(
                    float(np.mean([
                        abs(r.error) / typical.get(_band(r.projected), BAND_FLOOR)
                        for r in grandes
                    ])), 2
                )
        marcadas += 1
    return marcadas
