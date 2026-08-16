"""Métricas de evaluación, incluidas las que dejan mal al modelo.

Regla del proyecto: el umbral de aceptación se fija **antes** de ver el
resultado, y el resultado se publica aunque sea negativo. Por eso aquí conviven
el Brier del modelo y el del mercado en la misma función: no se puede reportar
uno sin el otro.

El registro contra el spread (`summarize_ats`) viene con su intervalo de
confianza siempre, y nunca sin él. Un 52,4% en 200 partidos no significa nada —
el error estándar es de 3,5 puntos porcentuales — y presentarlo pelado es la
forma más común de vender ruido como edge.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

# Punto de equilibrio a -110 (la cuota estándar de un spread): hay que acertar
# el 52,38% para no perder dinero. Es la única cifra contra la que tiene sentido
# comparar un porcentaje de aciertos ATS.
BREAKEVEN_ATS = 110 / 210


@dataclass
class Metrics:
    """Métricas de un conjunto de predicciones."""

    games: int
    brier: float
    log_loss: float
    ece: float
    accuracy: float
    margin_mae: float
    margin_rmse: float
    total_mae: float | None
    market_brier: float | None
    market_margin_mae: float | None

    def to_dict(self) -> dict:
        return asdict(self)


def brier_score(probs: np.ndarray, outcomes: np.ndarray) -> float:
    return float(np.mean((probs - outcomes) ** 2))


def log_loss(probs: np.ndarray, outcomes: np.ndarray) -> float:
    p = np.clip(probs, 1e-9, 1 - 1e-9)
    return float(-np.mean(outcomes * np.log(p) + (1 - outcomes) * np.log(1 - p)))


def expected_calibration_error(
    probs: np.ndarray, outcomes: np.ndarray, bins: int = 10
) -> float:
    """ECE con bins de anchura fija.

    Mide algo distinto del Brier: un modelo puede tener buen Brier y estar mal
    calibrado (decir 70% cuando gana el 60% de las veces) si compensa acertando
    el orden. Para apostar, la calibración importa más que el Brier: el precio
    sale de la probabilidad, no del ranking.
    """
    edges = np.linspace(0.0, 1.0, bins + 1)
    error, n = 0.0, probs.size
    for low, high in zip(edges[:-1], edges[1:], strict=True):
        mask = (probs > low) & (probs <= high) if low > 0 else (probs >= low) & (probs <= high)
        if not mask.any():
            continue
        error += mask.sum() / n * abs(probs[mask].mean() - outcomes[mask].mean())
    return float(error)


def evaluate(frame: pd.DataFrame) -> Metrics:
    """Métricas del modelo y, cuando hay línea, también las del mercado."""
    data = frame[frame["margin"].notna() & frame["home_win_prob"].notna()].copy()
    outcomes = (data["margin"] > 0).astype(float).to_numpy()
    probs = data["home_win_prob"].to_numpy(dtype=float)

    market_brier = None
    market_mae = None
    with_line = data[data["spread_line"].notna()]
    if len(with_line) > 50:
        # La probabilidad implícita del mercado se deriva de su propia línea con
        # la misma distribución que usa el modelo. Es la comparación justa:
        # cualquier otra cosa mide la diferencia de conversión, no de pronóstico.
        market_probs = _implied_from_line(with_line["spread_line"].to_numpy(dtype=float))
        market_outcomes = (with_line["margin"] > 0).astype(float).to_numpy()
        market_brier = brier_score(market_probs, market_outcomes)
        market_mae = float(
            np.mean(np.abs(with_line["margin"] - with_line["spread_line"]))
        )

    total_mae = None
    totals = data[data["total"].notna() & data["pred_total"].notna()]
    if len(totals) > 50:
        total_mae = float(np.mean(np.abs(totals["total"] - totals["pred_total"])))

    errors = (data["margin"] - data["pred_margin"]).to_numpy(dtype=float)
    return Metrics(
        games=int(len(data)),
        brier=brier_score(probs, outcomes),
        log_loss=log_loss(probs, outcomes),
        ece=expected_calibration_error(probs, outcomes),
        accuracy=float(np.mean((probs > 0.5) == (outcomes > 0.5))),
        margin_mae=float(np.mean(np.abs(errors))),
        margin_rmse=float(np.sqrt(np.mean(errors**2))),
        total_mae=total_mae,
        market_brier=market_brier,
        market_margin_mae=market_mae,
    )


def _implied_from_line(line: np.ndarray, sigma: float = 13.5) -> np.ndarray:
    """Probabilidad de victoria implícita en un spread, vía normal.

    Aquí sí se usa una normal y no la distribución con números clave, y es
    deliberado: se está midiendo al mercado con la herramienta más neutral
    posible, no dándole la ventaja de nuestro propio modelo de distribución.
    """
    from scipy.stats import norm

    return norm.cdf(line / sigma)


@dataclass
class ATSRecord:
    """Registro contra el spread, con su incertidumbre.

    `significant` compara el intervalo con el punto de equilibrio a -110, no con
    el 50%. Batir al 50% contra el spread no gana dinero: la comisión se lo come.
    """

    bets: int
    wins: int
    losses: int
    pushes: int
    win_rate: float
    standard_error: float
    ci_low: float
    ci_high: float
    significant: bool

    def to_dict(self) -> dict:
        return asdict(self)


def summarize_ats(frame: pd.DataFrame, edge_threshold: float = 0.0) -> ATSRecord:
    """Resultado de apostar el lado que el modelo prefiere.

    `edge_threshold` filtra por diferencia mínima entre modelo y línea, en
    puntos. Cuidado al barrerlo: probar veinte umbrales y quedarse con el mejor
    es sobreajuste con otro nombre, y el intervalo de confianza que sale ya no
    es válido.
    """
    data = frame[
        frame["margin"].notna() & frame["spread_line"].notna() & frame["pred_margin"].notna()
    ].copy()
    edge = data["pred_margin"] - data["spread_line"]
    data = data[edge.abs() >= edge_threshold]
    if data.empty:
        return ATSRecord(0, 0, 0, 0, float("nan"), float("nan"), float("nan"), float("nan"), False)

    pick_home = (data["pred_margin"] > data["spread_line"]).to_numpy()
    result = (data["margin"] - data["spread_line"]).to_numpy(dtype=float)
    pushes = int(np.sum(result == 0))
    wins = int(np.sum(np.where(pick_home, result > 0, result < 0)))
    decided = int(len(data)) - pushes
    losses = decided - wins

    if decided == 0:
        return ATSRecord(0, 0, 0, pushes, float("nan"), float("nan"), float("nan"),
                         float("nan"), False)

    rate = wins / decided
    se = math.sqrt(rate * (1 - rate) / decided)
    return ATSRecord(
        bets=decided,
        wins=wins,
        losses=losses,
        pushes=pushes,
        win_rate=rate,
        standard_error=se,
        ci_low=rate - 1.96 * se,
        ci_high=rate + 1.96 * se,
        significant=bool(rate - 1.96 * se > BREAKEVEN_ATS),
    )


def calibration_table(frame: pd.DataFrame, bins: int = 10) -> pd.DataFrame:
    """Probabilidad predicha frente a frecuencia observada, por bin.

    Es lo que se publica en la web: una tabla de calibración enseña de un
    vistazo si el modelo miente, y un Brier agregado no.
    """
    data = frame[frame["margin"].notna() & frame["home_win_prob"].notna()].copy()
    data["bin"] = pd.cut(data["home_win_prob"], np.linspace(0, 1, bins + 1), include_lowest=True)
    grouped = data.groupby("bin", observed=True)
    return pd.DataFrame(
        {
            "predicted": grouped["home_win_prob"].mean(),
            "observed": grouped.apply(lambda g: float((g["margin"] > 0).mean()), include_groups=False),
            "games": grouped.size(),
        }
    ).reset_index()
