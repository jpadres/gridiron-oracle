"""Detección de apuestas con valor a partir de las predicciones.

El flujo, en orden, y el orden importa:

1. Probabilidad del modelo (de la distribución con números clave).
2. Probabilidad de la casa **sin margen**, por Shin.
3. Edge = (1) − (2). Nunca contra la implícita bruta.
4. Dimensionamiento con los frenos de `kelly.py`.

Una apuesta sólo aparece si supera los cuatro filtros. En la práctica, contra
líneas de cierre, eso significa que **la mayoría de las jornadas no produce
ninguna apuesta**. Ese es el resultado correcto y esperado, no un fallo: si un
modelo que empata con el mercado encontrase valor en diez partidos por jornada,
lo que habría que revisar es el modelo.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..models.distribution import MarginDistribution
from .devig import devig_shin
from .kelly import KellyConfig, expected_value, stake_fraction
from .odds import american_to_decimal

# Precio estándar de un spread cuando no hay cuota publicada. -110 en los dos
# lados es la convención del mercado americano.
DEFAULT_SPREAD_ODDS = -110.0


def value_bets(
    predictions: pd.DataFrame,
    bankroll: float = 1000.0,
    config: KellyConfig | None = None,
    distribution: MarginDistribution | None = None,
) -> pd.DataFrame:
    """Apuestas con valor de una jornada, ordenadas por EV descendente.

    `distribution` es la del modelo ya ajustada. Sin ella no se evalúan spreads:
    la probabilidad de push de una línea entera sale de los números clave, y
    calcularla con una normal produce precios mal en -3 y -7, que son la mitad
    del mercado.
    """
    config = config or KellyConfig()
    rows: list[dict] = []

    for _, game in predictions.iterrows():
        rows.extend(_moneyline_candidates(game))
        if distribution is not None and pd.notna(game.get("spread_line")):
            rows.extend(_spread_candidates(game, distribution))

    if not rows:
        return _empty_frame()

    frame = pd.DataFrame(rows)
    frame["edge"] = frame["model_prob"] - frame["market_prob"]
    frame["ev"] = [
        expected_value(p, o) for p, o in zip(frame["model_prob"], frame["decimal_odds"], strict=True)
    ]
    frame["stake_fraction"] = [
        stake_fraction(p, o, m, config)
        for p, o, m in zip(
            frame["model_prob"], frame["decimal_odds"], frame["market_prob"], strict=True
        )
    ]
    frame["stake"] = (frame["stake_fraction"] * bankroll).round(2)

    frame = frame[frame["stake"] > 0].copy()
    if frame.empty:
        return _empty_frame()
    return frame.sort_values("ev", ascending=False).reset_index(drop=True)


def _moneyline_candidates(game: pd.Series) -> list[dict]:
    home_ml, away_ml = game.get("home_moneyline"), game.get("away_moneyline")
    if pd.isna(home_ml) or pd.isna(away_ml):
        return []

    decimals = american_to_decimal(np.array([float(home_ml), float(away_ml)]))
    fair = devig_shin(decimals)
    home_prob = float(game["home_win_prob"])

    return [
        _candidate(game, "moneyline", game["home_team"], home_prob, decimals[0], fair[0]),
        _candidate(game, "moneyline", game["away_team"], 1.0 - home_prob, decimals[1], fair[1]),
    ]


def _spread_candidates(game: pd.Series, distribution: MarginDistribution) -> list[dict]:
    """Probabilidades de cubrir, con el push repartido correctamente.

    El push no se ignora ni se cuenta como derrota: en una línea entera se
    devuelve la apuesta. Se renormaliza sobre los casos con resultado, que es
    justo lo que hace la casa al liquidar.
    """
    line = float(game["spread_line"])
    total = float(game.get("pred_total", 44.0) or 44.0)
    home, push, away = distribution.cover_probability(float(game["pred_margin"]), line, total)
    decided = home + away
    if decided <= 0:
        return []
    home_prob, away_prob = home / decided, away / decided

    decimal = float(american_to_decimal(DEFAULT_SPREAD_ODDS))
    fair = devig_shin(np.array([decimal, decimal]))

    return [
        _candidate(game, f"spread {_es(line)}", game["home_team"], home_prob, decimal, fair[0],
                   push=push),
        _candidate(game, f"spread {_es(-line)}", game["away_team"], away_prob, decimal, fair[1],
                   push=push),
    ]


def _es(line: float) -> str:
    """Handicap con coma decimal. El sitio está en español y esto se publica tal cual."""
    return f"{line:+.1f}".replace(".", ",")


def _candidate(
    game: pd.Series,
    market: str,
    selection: str,
    model_prob: float,
    decimal_odds: float,
    market_prob: float,
    push: float = 0.0,
) -> dict:
    return {
        "game_id": game.get("game_id"),
        "season": game.get("season"),
        "week": game.get("week"),
        "matchup": f"{game.get('away_team')} @ {game.get('home_team')}",
        "market": market,
        "selection": selection,
        "model_prob": float(model_prob),
        "market_prob": float(market_prob),
        "decimal_odds": float(decimal_odds),
        "push_prob": float(push),
    }


def _empty_frame() -> pd.DataFrame:
    """Un DataFrame vacío pero con las columnas correctas.

    Devolver `pd.DataFrame()` a secas obliga a quien llama a comprobar si está
    vacío antes de tocar ninguna columna, y ese `if` se olvida siempre.
    """
    columns = [
        "game_id", "season", "week", "matchup", "market", "selection", "model_prob",
        "market_prob", "decimal_odds", "push_prob", "edge", "ev", "stake_fraction", "stake",
    ]
    return pd.DataFrame(columns=columns)
