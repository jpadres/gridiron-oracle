"""Ensamblado con cross-fitting temporal.

# Las dos ideas que hacen que esto funcione

## 1. Parametrizar sobre el residuo del mercado

El modelo de producción **no** predice el margen con la línea como una feature
más. Predice `margen − línea`: en qué se equivoca el mercado.

La diferencia parece cosmética y no lo es. El objetivo `margen − línea` tiene
media casi cero, así que la regularización empuja por defecto hacia "el mercado
tiene razón" y el modelo sólo se separa de la línea cuando hay evidencia que lo
justifique. Con la línea como una feature más, la regularización empuja hacia
cero *el coeficiente de la línea*, es decir, hacia ignorarla: exactamente lo
contrario de lo que se quiere. Es la diferencia entre un modelo que respeta al
mercado y uno que se pelea con él por ruido.

Se mantiene además un modelo **libre** (`pred_margin_free`) que no mira la línea
en absoluto. No es el de producción; existe para poder responder a la única
pregunta que importa de verdad — ¿aporta algo la señal deportiva por sí sola? —
sin que la respuesta venga contaminada por la línea.

## 2. Cross-fitting temporal para los pesos del ensamblado

**Este es el error que ya se cometió una vez.** Los pesos del ensamblado se
ajustaban con las predicciones de los componentes *dentro de muestra*. Es la
fuga de stacking clásica: un componente que sobreajusta parece excelente en sus
propios datos de entrenamiento, se lleva todo el peso, y en producción rinde
mucho peor. Costaba 0,6 puntos de MAE y hacía que el modelo combinado fuese
**peor que cualquiera de sus partes**, que es la señal de alarma más clara que
existe de que hay fuga.

La corrección está en `MarketAwareModel.fit`: las predicciones con las que se
ajustan los pesos se generan por bloques temporales disjuntos y en ventana
expansiva — el bloque i se predice con componentes ajustados sólo con bloques
anteriores. Nunca en muestra, y nunca con futuro.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ..data.features import FEATURE_COLUMNS
from .distribution import MarginDistribution

# Bloques del cross-fitting. Con menos de 3 bloques el primero se queda sin
# datos con los que ajustar; con muchos más, cada bloque es tan pequeño que los
# pesos se ajustan sobre ruido.
CV_BLOCKS = 5

# Regularización. Alta a propósito en el modelo de residuo: el objetivo es casi
# ruido puro (el mercado acierta), y un alpha bajo encuentra "señal" en
# cualquier sitio. El modelo libre necesita mucha menos porque su objetivo (el
# margen) sí tiene estructura de sobra.
RIDGE_ALPHA_RESIDUAL = 30.0
RIDGE_ALPHA_FREE = 3.0
RIDGE_ALPHA_TOTAL = 10.0


def _ridge(alpha: float) -> Pipeline:
    """Ridge con estandarización.

    Sin escalar, `elo_diff` (centenares) y `off_epa_diff` (centésimas) reciben
    penalizaciones incomparables y el ridge se convierte en un modelo de Elo con
    adornos.
    """
    return Pipeline(
        [("scale", StandardScaler()), ("ridge", Ridge(alpha=alpha, fit_intercept=True))]
    )


def _design(frame: pd.DataFrame) -> np.ndarray:
    """Matriz de features en orden fijo, con los huecos a 0.

    El orden lo fija `FEATURE_COLUMNS`, no el orden de las columnas del
    DataFrame: si la tabla llega con las columnas barajadas, un modelo ajustado
    en otro orden produciría predicciones sin sentido sin lanzar ningún error.
    """
    missing = [c for c in FEATURE_COLUMNS if c not in frame.columns]
    if missing:
        raise KeyError(f"Faltan features: {missing}")
    return frame[FEATURE_COLUMNS].astype(float).fillna(0.0).to_numpy()


@dataclass
class MarketAwareModel:
    """Ensamblado de modelo-residuo + modelo-libre, calibrado."""

    residual_model: Pipeline = field(default_factory=lambda: _ridge(RIDGE_ALPHA_RESIDUAL))
    free_model: Pipeline = field(default_factory=lambda: _ridge(RIDGE_ALPHA_FREE))
    total_model: Pipeline = field(default_factory=lambda: _ridge(RIDGE_ALPHA_TOTAL))
    distribution: MarginDistribution = field(default_factory=MarginDistribution)

    # Pesos del ensamblado (línea+residuo, libre) y sesgo. Se ajustan fuera de
    # muestra; el valor por defecto es "confía sólo en el modelo de mercado",
    # que es el prior correcto si no hay datos para decidir otra cosa.
    blend_weights: np.ndarray = field(default_factory=lambda: np.array([1.0, 0.0]))
    blend_intercept: float = 0.0

    # Calibración de la probabilidad: p_cal = sigmoide(a · logit(p) + b).
    calibration: tuple[float, float] = (1.0, 0.0)

    fitted: bool = False

    # -- ajuste -----------------------------------------------------------
    def fit(self, frame: pd.DataFrame) -> MarketAwareModel:
        """Ajusta con partidos jugados que tengan línea de mercado.

        `frame` debe contener sólo temporadas anteriores a la que se va a
        predecir. Esta función no comprueba eso — no puede — así que el
        walk-forward de `backtest/` es quien tiene la responsabilidad.
        """
        data = frame[
            frame["played"].astype(bool)
            & frame["margin"].notna()
            & frame["spread_line"].notna()
        ].copy()
        if len(data) < 200:
            raise ValueError(
                f"Muy pocos partidos para ajustar ({len(data)}). "
                "El walk-forward necesita al menos una temporada de historial."
            )
        data = data.sort_values(["gameday", "game_id"], kind="mergesort").reset_index(drop=True)

        X = _design(data)
        margin = data["margin"].to_numpy(dtype=float)
        line = data["spread_line"].to_numpy(dtype=float)
        residual_target = margin - line

        self.residual_model.fit(X, residual_target)
        self.free_model.fit(X, margin)

        total_mask = data["total"].notna() & data["total_line"].notna()
        if total_mask.sum() >= 200:
            total_line = data.loc[total_mask, "total_line"].to_numpy(dtype=float)
            self.total_model.fit(
                X[total_mask.to_numpy()],
                data.loc[total_mask, "total"].to_numpy(dtype=float) - total_line,
            )
            self._total_fitted = True
        else:
            self._total_fitted = False

        # --- cross-fitting temporal: predicciones FUERA DE MUESTRA ---------
        oof_market, oof_free, oof_mask = self._out_of_fold(X, margin, line, residual_target)

        if oof_mask.sum() >= 200:
            self.blend_weights, self.blend_intercept = _nnls_blend(
                np.column_stack([oof_market[oof_mask], oof_free[oof_mask]]),
                margin[oof_mask],
            )
        # Si no hay suficientes predicciones fuera de muestra se deja el prior
        # (todo el peso al modelo de mercado). Ajustar los pesos en muestra
        # "porque hay pocos datos" es exactamente el error que costó 0,6 MAE.

        blended = self._blend(oof_market, oof_free)
        blended = np.where(oof_mask, blended, line)

        totals = data["total_line"].to_numpy(dtype=float)
        self.distribution.fit(margin, blended, totals)

        raw_probs = np.array(
            [
                self.distribution.win_probability(pred, total)
                for pred, total in zip(blended, totals, strict=True)
            ]
        )
        self.calibration = _fit_calibration(raw_probs, (margin > 0).astype(float))

        self.fitted = True
        return self

    def _out_of_fold(
        self, X: np.ndarray, margin: np.ndarray, line: np.ndarray, residual_target: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Predicciones por bloques temporales en ventana expansiva.

        El bloque i se predice con modelos ajustados **sólo** con los bloques
        anteriores. El primer bloque se queda sin predicción (no hay pasado con
        el que ajustarlo) y por eso se devuelve la máscara: ajustar los pesos
        con un valor inventado para ese bloque sería reintroducir el sesgo por
        otra puerta.
        """
        n = X.shape[0]
        market = np.zeros(n)
        free = np.zeros(n)
        mask = np.zeros(n, dtype=bool)

        bounds = np.linspace(0, n, CV_BLOCKS + 1).astype(int)
        for i in range(1, CV_BLOCKS):
            train_end = bounds[i]
            start, stop = bounds[i], bounds[i + 1]
            if stop - start == 0 or train_end < 100:
                continue
            residual_fold = _ridge(RIDGE_ALPHA_RESIDUAL).fit(
                X[:train_end], residual_target[:train_end]
            )
            free_fold = _ridge(RIDGE_ALPHA_FREE).fit(X[:train_end], margin[:train_end])
            market[start:stop] = line[start:stop] + residual_fold.predict(X[start:stop])
            free[start:stop] = free_fold.predict(X[start:stop])
            mask[start:stop] = True

        return market, free, mask

    def _blend(self, market: np.ndarray, free: np.ndarray) -> np.ndarray:
        return (
            self.blend_weights[0] * market + self.blend_weights[1] * free + self.blend_intercept
        )

    # -- predicción --------------------------------------------------------
    def predict(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Añade las columnas de predicción a la tabla de features."""
        if not self.fitted:
            raise RuntimeError("El modelo no está ajustado. Llama a fit() primero.")

        X = _design(frame)
        line = frame["spread_line"].to_numpy(dtype=float)
        total_line = frame["total_line"].to_numpy(dtype=float)

        free = self.free_model.predict(X)
        residual = self.residual_model.predict(X)
        market = np.where(np.isfinite(line), line + residual, free)
        blended = self._blend(market, free)
        # Sin línea publicada (jornada futura, partido sin mercado) el
        # ensamblado no tiene sentido: se cae al modelo libre en vez de
        # propagar un NaN.
        pred_margin = np.where(np.isfinite(line), blended, free)

        if getattr(self, "_total_fitted", False):
            pred_total = np.where(
                np.isfinite(total_line), total_line + self.total_model.predict(X), np.nan
            )
        else:
            pred_total = total_line.copy()

        totals_for_sigma = np.where(np.isfinite(pred_total), pred_total, 44.0)
        raw_probs = np.array(
            [
                self.distribution.win_probability(pred, total)
                for pred, total in zip(pred_margin, totals_for_sigma, strict=True)
            ]
        )
        win_prob = _apply_calibration(raw_probs, self.calibration)

        out = frame.copy()
        out["pred_margin"] = pred_margin
        out["pred_margin_free"] = free
        out["pred_margin_market"] = market
        out["pred_total"] = pred_total
        out["home_win_prob"] = win_prob
        out["away_win_prob"] = 1.0 - win_prob
        out["edge_vs_line"] = np.where(np.isfinite(line), pred_margin - line, np.nan)
        return out

    def cover_probabilities(self, row: pd.Series) -> tuple[float, float, float]:
        """(local cubre, push, visitante cubre) para el spread publicado."""
        return self.distribution.cover_probability(
            float(row["pred_margin"]), float(row["spread_line"]), float(row.get("pred_total", 44.0))
        )


def _nnls_blend(predictors: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, float]:
    """Pesos no negativos + sesgo, ajustados sobre predicciones fuera de muestra.

    No negativos porque un peso negativo sobre un componente significa "apuesta
    a que este modelo se equivoca", que en un ensamblado de dos modelos
    correlacionados es siempre sobreajuste, nunca una relación real.
    """
    from scipy.optimize import nnls

    center = predictors.mean(axis=0)
    target_center = target.mean()
    weights, _ = nnls(predictors - center, target - target_center)
    if not np.isfinite(weights).all() or weights.sum() <= 0:
        return np.array([1.0, 0.0]), 0.0
    intercept = float(target_center - weights @ center)
    return weights, intercept


def _fit_calibration(probs: np.ndarray, outcomes: np.ndarray) -> tuple[float, float]:
    """Escalado de Platt sobre el logit.

    Se recalibra aunque la distribución ya esté bien ajustada porque el
    ensamblado y el encogimiento hacia el mercado comprimen ligeramente las
    predicciones, y esa compresión se ve en el ECE mucho antes que en el Brier.
    """
    from sklearn.linear_model import LogisticRegression

    mask = np.isfinite(probs) & np.isfinite(outcomes)
    if mask.sum() < 200:
        return (1.0, 0.0)
    logits = _logit(probs[mask]).reshape(-1, 1)
    model = LogisticRegression(C=1e6, solver="lbfgs")
    model.fit(logits, outcomes[mask])
    return (float(model.coef_[0][0]), float(model.intercept_[0]))


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _apply_calibration(probs: np.ndarray, calibration: tuple[float, float]) -> np.ndarray:
    slope, intercept = calibration
    return 1.0 / (1.0 + np.exp(-(slope * _logit(probs) + intercept)))
