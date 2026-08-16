"""Validación walk-forward por temporada.

**No hay validación cruzada aleatoria en este proyecto, y no la habrá.**

Barajar partidos de 2015 y 2023 en el mismo fold parece inofensivo porque cada
partido es una fila independiente. No lo es: las filas comparten estado. El
rating de un equipo en la semana 4 de 2015 se construyó con partidos que, en un
fold aleatorio, están en el conjunto de test. El futuro se filtra a través de los
ratings, no a través de las columnas, y por eso no se ve inspeccionando la tabla.

El efecto no es sutil. Sobreestima el rendimiento de forma masiva y produce
justo la clase de resultado que hace pensar "he batido a Las Vegas".

Para predecir la temporada S sólo se usan temporadas < S. **Todo**: el modelo,
la distribución de márgenes, la calibración y los pesos del ensamblado se
reajustan en cada paso.
"""

from __future__ import annotations

from collections.abc import Callable

import pandas as pd

from ..config import DEFAULT_BACKTEST_START
from ..models.predictor import MarketAwareModel
from .metrics import Metrics, evaluate


def walk_forward(
    features: pd.DataFrame,
    first_season: int = DEFAULT_BACKTEST_START,
    last_season: int | None = None,
    min_train_seasons: int = 8,
    on_season: Callable[[int, Metrics], None] | None = None,
) -> tuple[pd.DataFrame, dict[int, Metrics]]:
    """Ejecuta el walk-forward y devuelve (predicciones, métricas por temporada).

    `min_train_seasons` no es un capricho: los ratings de eficiencia necesitan
    varias temporadas para dejar de estar dominados por el encogimiento inicial,
    y un modelo ajustado con dos años produce pesos de ensamblado inestables que
    contaminan la media de todo el backtest.
    """
    played = features[features["played"].astype(bool) & features["margin"].notna()].copy()
    seasons = sorted(played["season"].unique())
    last_season = last_season if last_season is not None else int(seasons[-1])

    predictions: list[pd.DataFrame] = []
    metrics: dict[int, Metrics] = {}

    for season in seasons:
        if season < first_season or season > last_season:
            continue
        train = played[played["season"] < season]
        if train["season"].nunique() < min_train_seasons:
            continue
        test = played[played["season"] == season]
        if test.empty:
            continue

        model = MarketAwareModel().fit(train)
        predicted = model.predict(test)
        predictions.append(predicted)

        season_metrics = evaluate(predicted)
        metrics[int(season)] = season_metrics
        if on_season is not None:
            on_season(int(season), season_metrics)

    if not predictions:
        raise ValueError(
            "El walk-forward no produjo ninguna temporada. ¿Hay suficiente historial "
            f"antes de {first_season} (se necesitan {min_train_seasons} temporadas)?"
        )

    return pd.concat(predictions, ignore_index=True), metrics


def season_table(metrics: dict[int, Metrics]) -> pd.DataFrame:
    """Métricas por temporada en tabla, para el informe y la web."""
    return pd.DataFrame(
        [{"season": season, **value.to_dict()} for season, value in sorted(metrics.items())]
    )
