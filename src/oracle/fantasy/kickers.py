"""Pateadores: separar la oportunidad de la conversión.

## Lo que hay que saber antes de leer una línea de código

Medido sobre 359 pares de temporadas consecutivas del mismo pateador (2010–2025):

    % de acierto en FG, año N -> año N+1 ..................... r = 0,024
    intentos de FG por partido, año N -> N+1 (equipo) ........ r = 0,086
    intentos de PAT por partido, año N -> N+1 (equipo) ....... r = 0,376

Y la dispersión del % de acierto lo remata: la observada es 0,071 y la que
produce el **puro azar binomial** con 30 intentos es 0,066. Restando varianzas,
la habilidad tiene una desviación típica de unos 0,026 — **alrededor del 13% de
la varianza es habilidad y el 87% es azar**, y eso siendo generoso, porque
atribuye a habilidad todo lo que no es binomial: la distancia media, el clima y
el estadio incluidos.

**Consecuencia de diseño, no opinión:** este módulo no estima la habilidad de un
pateador. Proyecta su OPORTUNIDAD a partir del ataque de su equipo y aplica una
tasa de conversión encogida con fuerza hacia la de la liga. Un número de
«habilidad» por pateador con 30 intentos al año sería ruido con tres decimales.

Un ranking de pateadores es, casi por completo, un ranking de ataques. Este
módulo está escrito para decir eso en voz alta en vez de disimularlo.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# Tramos de distancia tal y como los publica nflverse. El pateador cobra más
# desde lejos en casi todas las ligas, y ésa es la única parte de su puntuación
# que depende de algo distinto del volumen.
DISTANCE_BUCKETS: tuple[tuple[str, str], ...] = (
    ("fg_made_0_19", "fg_missed_0_19"),
    ("fg_made_20_29", "fg_missed_20_29"),
    ("fg_made_30_39", "fg_missed_30_39"),
    ("fg_made_40_49", "fg_missed_40_49"),
    ("fg_made_50_59", "fg_missed_50_59"),
    ("fg_made_60_", "fg_missed_60_"),
)


@dataclass(frozen=True)
class KickerScoring:
    """Puntos por acierto, por tramo, y por fallo.

    Los valores por defecto son los del formato más extendido (3 puntos hasta
    39 yardas, 4 de 40 a 49, 5 desde 50). **No salen de la API de Sleeper**: no
    es alcanzable desde este entorno y no se inventa cómo llama a sus campos.
    Son las reglas de este proyecto, configurables, y quien sincronice una liga
    tendrá que mapearlas cuando la API esté disponible.
    """

    by_bucket: tuple[float, ...] = (3.0, 3.0, 3.0, 4.0, 5.0, 5.0)
    pat_made: float = 1.0
    fg_missed: float = -1.0
    pat_missed: float = -1.0


@dataclass(frozen=True)
class Opportunity:
    """Intentos esperados de un pateador en un partido."""

    pat_attempts: float
    fg_attempts: float


# Coeficientes de oportunidad. Se ajustan con `fit_opportunity` sobre temporadas
# anteriores; estos valores sólo existen para que el módulo sea utilizable sin
# ajuste previo, y `fit_opportunity` los reemplaza.
@dataclass(frozen=True)
class OpportunityModel:
    """Intentos esperados en función de los puntos proyectados del equipo.

    Es una regresión sobre los puntos del equipo y nada más. Se probó que la
    identidad del pateador no aporta —r = 0,086 año contra año en intentos de
    campo—, así que meterlo sería ajustar ruido.
    """

    pat_intercept: float = 0.0
    pat_slope: float = 0.0
    fg_intercept: float = 0.0
    fg_slope: float = 0.0
    # Término cuadrático en los puntos del equipo. E8d (2026-09-05,
    # docs/PREREGISTRO_kicker_bias.md): los intentos de campo NO crecen
    # linealmente con los puntos —un equipo que marca 35 anota touchdowns, no
    # patea más— y la recta subestimaba en el centro del rango. Con el término
    # cuadrático el sesgo global fuera de muestra pasa de −0,42 a −0,11 y bajo
    # techo de −1,00 a −0,68, con MAE 3,715 frente a 3,710 (dentro del margen
    # de 0,02 fijado antes de mirar). A cero, el modelo es el lineal de antes.
    pat_quad: float = 0.0
    fg_quad: float = 0.0
    conversion: dict[str, float] = field(default_factory=dict)
    pat_rate: float = 0.95

    def expected(self, team_points: float) -> Opportunity:
        points = float(team_points) if np.isfinite(team_points) else 21.0
        return Opportunity(
            pat_attempts=self._curve(self.pat_intercept, self.pat_slope, self.pat_quad, points),
            fg_attempts=self._curve(self.fg_intercept, self.fg_slope, self.fg_quad, points),
        )

    @staticmethod
    def _curve(intercept: float, slope: float, quad: float, points: float) -> float:
        """Parábola con MESETA: más puntos nunca dan menos intentos.

        Una parábola cóncava baja después de su vértice, y «más puntos del
        equipo, menos oportunidad» contradice lo que el modelo es. Pasado el
        vértice la oportunidad se queda plana. Es la variante que se envía y
        la que E8d volvió a evaluar fuera de muestra (C2m).
        """
        if quad < 0.0:
            vertex = -slope / (2.0 * quad)
            points = min(points, vertex)
        return max(intercept + slope * points + quad * points**2, 0.0)


def fit_opportunity(kicker_weeks: pd.DataFrame, team_points: pd.DataFrame) -> OpportunityModel:
    """Ajusta intentos esperados y tasas de conversión de la liga.

    `kicker_weeks` son filas de pateador-semana; `team_points` trae los puntos
    reales de cada equipo-semana. Sólo se le pasan temporadas **anteriores** a
    la que se proyecta: es la misma regla walk-forward de todo el proyecto.
    """
    merged = kicker_weeks.merge(team_points, on=["season", "week", "team"], how="inner")
    if merged.empty:
        return OpportunityModel()

    points = merged["points_for"].to_numpy(dtype=float)
    # Grado 2 (E8d). Con menos de 200 partidos-pateador de calibración un
    # cuadrático puede curvarse por ruido: ahí se queda la recta.
    degree = 2 if len(points) >= 200 else 1
    pat_coef = np.polyfit(points, merged["pat_att"].fillna(0).to_numpy(float), degree)
    fg_coef = np.polyfit(points, merged["fg_att"].fillna(0).to_numpy(float), degree)
    if degree == 1:
        pat_coef = np.concatenate([[0.0], pat_coef])
        fg_coef = np.concatenate([[0.0], fg_coef])
    pat_quad, pat_slope, pat_intercept = (float(v) for v in pat_coef)
    fg_quad, fg_slope, fg_intercept = (float(v) for v in fg_coef)

    # Tasa de acierto de la LIGA por tramo. No por pateador: con 30 intentos al
    # año repartidos en seis tramos, una tasa individual por tramo se apoya en
    # cuatro o cinco intentos. Eso no es una tasa, es una anécdota.
    conversion: dict[str, float] = {}
    for made_col, missed_col in DISTANCE_BUCKETS:
        made = merged.get(made_col, pd.Series(dtype=float)).fillna(0).sum()
        missed = merged.get(missed_col, pd.Series(dtype=float)).fillna(0).sum()
        attempts = made + missed
        conversion[made_col] = float(made / attempts) if attempts >= 50 else float("nan")

    pat_made = merged["pat_made"].fillna(0).sum()
    pat_att = merged["pat_att"].fillna(0).sum()
    return OpportunityModel(
        pat_intercept=float(pat_intercept), pat_slope=float(pat_slope),
        fg_intercept=float(fg_intercept), fg_slope=float(fg_slope),
        pat_quad=pat_quad, fg_quad=fg_quad,
        conversion=conversion,
        pat_rate=float(pat_made / pat_att) if pat_att > 0 else 0.95,
    )


def distance_mix(kicker_weeks: pd.DataFrame) -> dict[str, float]:
    """Reparto de intentos de campo entre tramos, para toda la liga.

    También es de liga y no de pateador, y por el mismo motivo: el reparto de
    distancias de un pateador depende de dónde se atascan las series de su
    ataque, no de él.
    """
    totals = {}
    for made_col, missed_col in DISTANCE_BUCKETS:
        made = kicker_weeks.get(made_col, pd.Series(dtype=float)).fillna(0).sum()
        missed = kicker_weeks.get(missed_col, pd.Series(dtype=float)).fillna(0).sum()
        totals[made_col] = float(made + missed)
    grand = sum(totals.values())
    if grand <= 0:
        return dict.fromkeys(totals, 1.0 / len(totals))
    return {key: value / grand for key, value in totals.items()}


def project(
    team_points: float,
    model: OpportunityModel,
    mix: dict[str, float],
    scoring: KickerScoring = KickerScoring(),
) -> float:
    """Puntos de fantasy esperados de un pateador en un partido.

    Todo lo que entra aquí es del EQUIPO: sus puntos proyectados, el reparto de
    distancias de la liga y las tasas de conversión de la liga. El pateador no
    aporta ni un parámetro, y ése es el hallazgo, no una simplificación.
    """
    opportunity = model.expected(team_points)

    points = opportunity.pat_attempts * (
        model.pat_rate * scoring.pat_made + (1 - model.pat_rate) * scoring.pat_missed
    )
    for index, (made_col, _missed) in enumerate(DISTANCE_BUCKETS):
        attempts = opportunity.fg_attempts * mix.get(made_col, 0.0)
        rate = model.conversion.get(made_col, float("nan"))
        if not np.isfinite(rate):
            # Tramo sin muestra suficiente. No se inventa una tasa: se deja
            # fuera y el proyectado sale algo más bajo, que es honesto.
            continue
        points += attempts * (rate * scoring.by_bucket[index] + (1 - rate) * scoring.fg_missed)
    return float(points)
