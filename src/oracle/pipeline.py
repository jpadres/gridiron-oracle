"""Fachada del proyecto: `Oracle.train() -> predict() -> value_bets()`.

Existe para que el uso normal no requiera saber en qué orden se ajustan las
piezas. Todo lo interesante está en los módulos; aquí sólo se encadenan en el
orden correcto, que es la parte fácil de equivocar.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import pandas as pd

from .backtest.metrics import Metrics, evaluate, summarize_ats
from .backtest.walkforward import walk_forward
from .betting.kelly import KellyConfig
from .betting.value import value_bets as compute_value_bets
from .config import DEFAULT_BACKTEST_START, Paths
from .config import paths as resolve_paths
from .data.features import FeatureBuilder, build_features
from .models.predictor import MarketAwareModel


@dataclass
class Oracle:
    """Modelo entrenado y listo para predecir."""

    paths: Paths
    features: pd.DataFrame
    model: MarketAwareModel
    builder: FeatureBuilder = field(default_factory=FeatureBuilder)

    # -- construcción ------------------------------------------------------
    @classmethod
    def build_features(cls, root: str | os.PathLike[str] | None = None) -> pd.DataFrame:
        """Reconstruye la tabla de features desde los datos procesados.

        Es la pasada cronológica de `data/features.py`. Se guarda en disco
        porque tarda ~1 minuto y la usan el backtest, la predicción y los
        scripts de fantasy.
        """
        paths = resolve_paths(root).ensure()
        games = pd.read_parquet(paths.games)
        team_games = pd.read_parquet(paths.team_games)
        features, _ = build_features(games, team_games)
        features.to_parquet(paths.features, index=False)
        return features

    @classmethod
    def train(cls, root: str | os.PathLike[str] | None = None) -> Oracle:
        """Carga las features y ajusta el modelo con todo el historial jugado.

        Este modelo es el de **producción**, no el de evaluación: está ajustado
        con todo, incluida la temporada más reciente. Para medir rendimiento
        está `backtest()`, que reajusta temporada a temporada. Confundir los dos
        es la forma más directa de publicar métricas infladas.
        """
        paths = resolve_paths(root).ensure()

        # La pasada cronológica se rehace siempre, aunque haya caché. Devuelve
        # dos cosas inseparables: la tabla y el estado final del builder, que es
        # lo que `predict_week` necesita para una jornada futura. Leer la tabla
        # de disco y reconstruir el estado por otro camino sería dar dos
        # oportunidades a que entrenamiento y producción se desincronicen.
        games = pd.read_parquet(paths.games)
        team_games = pd.read_parquet(paths.team_games)
        features, builder = build_features(games, team_games)
        features.to_parquet(paths.features, index=False)

        model = MarketAwareModel().fit(features)
        return cls(paths=paths, features=features, model=model, builder=builder)

    # -- predicción --------------------------------------------------------
    def week_features(self, season: int, week: int) -> pd.DataFrame:
        """Features de una jornada concreta, jugada o no."""
        selected = self.features[
            (self.features["season"] == season) & (self.features["week"] == week)
        ]
        if selected.empty:
            raise ValueError(
                f"No hay partidos para {season} semana {week}. "
                "¿Está el calendario descargado? Prueba `oracle refresh`."
            )
        return selected.copy()

    # Alias corto que usa el README.
    predict_week = week_features

    def predict(self, frame: pd.DataFrame) -> pd.DataFrame:
        return self.model.predict(frame)

    def value_bets(
        self, predictions: pd.DataFrame, bankroll: float = 1000.0,
        config: KellyConfig | None = None
    ) -> pd.DataFrame:
        """Apuestas con valor, con la distribución del modelo ya enganchada."""
        return compute_value_bets(
            predictions,
            bankroll=bankroll,
            config=config,
            distribution=self.model.distribution,
        )

    # -- evaluación --------------------------------------------------------
    def backtest(
        self, first_season: int = DEFAULT_BACKTEST_START, last_season: int | None = None
    ) -> tuple[pd.DataFrame, dict[int, Metrics]]:
        """Walk-forward completo. Reajusta el modelo en cada temporada."""
        return walk_forward(self.features, first_season, last_season)

    def team_ratings(self) -> pd.DataFrame:
        """Ratings actuales por equipo, tal como quedaron tras el último partido."""
        snapshot = self.builder.snapshot()
        frame = pd.DataFrame(snapshot).T.reset_index().rename(columns={"index": "team"})
        return frame.sort_values("elo", ascending=False).reset_index(drop=True)


def evaluate_predictions(predictions: pd.DataFrame) -> dict:
    """Métricas + registro ATS en un diccionario, para informes y para la web."""
    metrics = evaluate(predictions)
    ats = summarize_ats(predictions)
    return {"metrics": metrics.to_dict(), "ats": ats.to_dict()}
