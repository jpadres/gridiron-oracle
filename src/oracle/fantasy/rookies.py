"""Previa de rookie a partir del capital de draft.

## Por qué existe

Los rookies no aparecían en el board. `project_season` se apoya en el historial
NFL del jugador y un rookie no tiene ninguno; no es que salieran mal, es que no
salían. En una liga de doce equipos eso deja fuera a seis u ocho de las primeras
cien elecciones.

## Lo que se midió antes de escribir esto

Spearman entre número de draft y puntos PPR del año rookie, 2006–2025:

    QB -0,629 (n=205)   RB -0,618 (n=368)
    WR -0,579 (n=544)   TE -0,586 (n=252)

Es la señal más fuerte de todo el proyecto — la proyección semanal llega a
0,21–0,55, el streaming de defensas a 0,04 — y **no puede tener fuga**: el
número de draft se conoce en abril, meses antes de que se juegue nada.

## Por qué se publica un intervalo y no un número

El quarterback de segunda ronda promedia **63,4 puntos** con **mediana 15,9**.
Eso no es una asimetría suave: o se hace titular y suma doscientos, o se sienta
y suma cero. Publicar «63» sería el peor número posible, porque no describe a
casi ninguno de ellos.

Por eso `RookiePrior` lleva percentiles y no una media, y por eso lleva el
tamaño de muestra: una previa apoyada en diecinueve alas cerradas de primera
ronda y otra apoyada en ochocientos no drafteados no merecen la misma confianza,
y quien lea el board tiene que poder verlo.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

FANTASY_POSITIONS = ("QB", "RB", "WR", "TE")
PICKS_PER_ROUND = 32
MAX_ROUND = 7
# Cubo de los no drafteados. No es «la ronda 8»: es una categoría distinta, y se
# le da un número sólo para poder agrupar.
UDFA_ROUND = 8

# Encogimiento hacia la media de la posición. Con 19 alas cerradas de primera
# ronda en veinte años, la media de ese grupo es tan ruidosa como informativa.
SHRINK_PRIOR_N = 15.0


@dataclass(frozen=True)
class RookiePrior:
    """Lo que cabe esperar de un rookie de esa posición y esa ronda.

    `p25`, `p50` y `p75` son percentiles **observados**, no un intervalo
    paramétrico: la distribución es bimodal en varias celdas y ajustarle una
    normal produciría un intervalo que no contiene a nadie.
    """

    position: str
    draft_round: int
    sample: int
    p25: float
    p50: float
    p75: float
    mean: float
    shrunk_mean: float

    @property
    def is_udfa(self) -> bool:
        return self.draft_round == UDFA_ROUND

    @property
    def bimodal_warning(self) -> bool:
        """La mediana no llega a la mitad de la media: o juega o no juega.

        Cuando esto es cierto, enseñar la media sola es engañar. Es el caso del
        quarterback de segunda ronda: media 63,4 y mediana 15,9.

        La condición se escribió primero como `p50 > 0 and mean > 2 * p50`, y un
        test la tumbó: con mediana **cero** —el caso más bimodal que existe, la
        mayoría no juega y unos pocos suman doscientos— el aviso no saltaba
        justo donde más falta hace. Comparar contra la media en vez de contra la
        mediana lo cubre sin casos especiales.
        """
        return self.mean > 0.0 and self.p50 <= 0.5 * self.mean


def draft_round(draft_number: object) -> int:
    """Ronda a partir del número global de elección. Sin número, UDFA.

    No drafteado se codifica aparte y no como «una ronda peor que la séptima»:
    son 1.942 jugadores de la muestra y su distribución es distinta, no una
    continuación de la del final del draft.
    """
    value = pd.to_numeric(draft_number, errors="coerce")
    if value is None or not np.isfinite(value) or value <= 0:
        return UDFA_ROUND
    return int(min(np.ceil(value / PICKS_PER_ROUND), MAX_ROUND))


def fit(rookie_seasons: pd.DataFrame, through_season: int) -> dict[tuple[str, int], RookiePrior]:
    """Previas por posición y ronda, con **sólo** temporadas anteriores.

    `through_season` es exclusivo: para proyectar 2026 se pasan los rookies de
    2025 hacia atrás. Es la misma regla walk-forward del resto del proyecto, y
    aquí importa igual: un rookie de 2020 no puede aprender de 2023.
    """
    past = rookie_seasons[rookie_seasons["season"] < through_season]
    if past.empty:
        return {}

    priors: dict[tuple[str, int], RookiePrior] = {}
    for position in FANTASY_POSITIONS:
        by_position = past[past["position"] == position]
        if by_position.empty:
            continue
        position_mean = float(by_position["points"].mean())

        for round_number, group in by_position.groupby("draft_round", observed=True):
            points = group["points"].to_numpy(dtype=float)
            n = len(points)
            weight = n / (n + SHRINK_PRIOR_N)
            priors[(position, int(round_number))] = RookiePrior(
                position=position,
                draft_round=int(round_number),
                sample=n,
                p25=float(np.percentile(points, 25)),
                p50=float(np.percentile(points, 50)),
                p75=float(np.percentile(points, 75)),
                mean=float(points.mean()),
                shrunk_mean=float(weight * points.mean() + (1 - weight) * position_mean),
            )
    return priors


def predict(
    priors: dict[tuple[str, int], RookiePrior], position: str, draft_number: object
) -> RookiePrior | None:
    """La previa de un rookie concreto, o `None` si no hay ninguna que aplique.

    Devolver `None` es deliberado y el llamador tiene que tratarlo: un rookie sin
    previa **no entra en el board**. Es preferible un board sin rookies —lo que
    había— a un board con rookies inventados.
    """
    if position not in FANTASY_POSITIONS:
        return None
    return priors.get((position, draft_round(draft_number)))
