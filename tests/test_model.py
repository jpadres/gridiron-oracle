"""Tests del modelo de partidos.

El primero de este fichero es el más importante del proyecto.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from oracle.backtest.metrics import evaluate, expected_calibration_error, summarize_ats
from oracle.backtest.walkforward import walk_forward
from oracle.data.features import FEATURE_COLUMNS, build_features
from oracle.models.distribution import MarginDistribution
from oracle.models.elo import BASE_RATING, EloModel
from oracle.models.predictor import MarketAwareModel
from oracle.models.ratings import EfficiencyRatings, QBRatings

# ---------------------------------------------------------------------------
# LA RED: garantía anti-fuga
# ---------------------------------------------------------------------------

def test_features_have_no_future_information(synthetic_data, features):
    """Truncar el historial no puede cambiar ninguna fila anterior al corte.

    Este es **el** test del proyecto. Si las features de la semana 3 de 2015
    cambian según lo que pase en 2020, hay fuga de futuro, y todas las métricas
    del README son papel mojado.

    La comprobación es directa: se recalculan las features usando sólo los
    primeros N partidos y se exige que las N filas resultantes sean idénticas,
    columna a columna, a las N primeras del cálculo completo.

    Si este test falla tras un cambio en `features.py`, el cambio está mal. No
    el test.
    """
    games, team_games = synthetic_data
    ordered = games.sort_values(["gameday", "game_id"], kind="mergesort").reset_index(drop=True)

    cutoff = 1500
    truncated_games = ordered.iloc[:cutoff].copy()
    truncated_team_games = team_games[team_games["game_id"].isin(truncated_games["game_id"])]
    truncated_features, _ = build_features(truncated_games, truncated_team_games)

    full = features.iloc[:cutoff].reset_index(drop=True)
    partial = truncated_features.reset_index(drop=True)

    assert list(full["game_id"]) == list(partial["game_id"])
    for column in FEATURE_COLUMNS:
        np.testing.assert_allclose(
            full[column].to_numpy(dtype=float),
            partial[column].to_numpy(dtype=float),
            rtol=1e-10,
            atol=1e-12,
            err_msg=(
                f"La feature {column!r} cambia al truncar el historial: "
                "está mirando partidos posteriores."
            ),
        )


def test_unplayed_games_do_not_advance_state(synthetic_data):
    """Un partido sin resultado no puede mover el estado.

    Es la otra mitad de la garantía: al pronosticar la jornada que viene, el
    estado tiene que quedarse exactamente donde lo dejó el último partido
    jugado. Si un partido futuro actualizase los ratings, la predicción de la
    semana N+2 usaría un rating contaminado por la N+1 (que aún no ha ocurrido).
    """
    games, team_games = synthetic_data
    ordered = games.sort_values(["gameday", "game_id"], kind="mergesort").reset_index(drop=True)

    played = ordered.iloc[:800].copy()
    future = ordered.iloc[800:816].copy()
    future["played"] = 0
    future["margin"] = np.nan
    future["home_score"] = np.nan
    future["away_score"] = np.nan

    _, builder_played = build_features(played, team_games)
    _, builder_with_future = build_features(
        pd.concat([played, future], ignore_index=True), team_games
    )

    assert builder_played.elo.ratings == pytest.approx(builder_with_future.elo.ratings)
    assert builder_played.epa.off == pytest.approx(builder_with_future.epa.off)


def test_walk_forward_never_trains_on_the_future(features):
    """El walk-forward sólo entrena con temporadas estrictamente anteriores."""
    seen: list[tuple[int, int]] = []

    original_fit = MarketAwareModel.fit

    def spy(self, frame):
        seen.append((int(frame["season"].max()), 0))
        return original_fit(self, frame)

    MarketAwareModel.fit = spy
    try:
        predictions, metrics = walk_forward(features, first_season=2019, min_train_seasons=8)
    finally:
        MarketAwareModel.fit = original_fit

    for (max_train_season, _), season in zip(seen, sorted(metrics), strict=True):
        assert max_train_season < season, (
            f"El modelo de {season} se entrenó con datos de {max_train_season}."
        )
    assert set(predictions["season"]) == set(metrics)


# ---------------------------------------------------------------------------
# Elo
# ---------------------------------------------------------------------------

def test_elo_moves_toward_the_winner():
    elo = EloModel()
    elo.start_season(2020)
    before = elo.rating("KC")
    elo.update("KC", "DEN", margin=14.0)
    assert elo.rating("KC") > before
    assert elo.rating("DEN") < BASE_RATING
    # Suma cero: lo que gana uno lo pierde el otro.
    assert elo.rating("KC") + elo.rating("DEN") == pytest.approx(2 * BASE_RATING)


def test_elo_margin_has_diminishing_returns():
    """Ganar de 40 no puede valer el doble que ganar de 20."""
    small, large = EloModel(), EloModel()
    small.start_season(2020)
    large.start_season(2020)
    small.update("KC", "DEN", margin=20.0)
    large.update("KC", "DEN", margin=40.0)

    gain_small = small.rating("KC") - BASE_RATING
    gain_large = large.rating("KC") - BASE_RATING
    assert gain_large > gain_small
    assert gain_large < 2 * gain_small


def test_hfa_adapts_and_only_from_home_games():
    """La HFA aprende de partidos con local, y no se mueve en sede neutral."""
    elo = EloModel()
    elo.start_season(2020)
    baseline = elo.hfa_points

    for _ in range(40):
        elo.update("KC", "DEN", margin=20.0, neutral=True)
    assert elo.hfa_points == pytest.approx(baseline)

    elo_home = EloModel()
    elo_home.start_season(2020)
    for _ in range(40):
        elo_home.update(f"T{_ % 8}", f"S{_ % 8}", margin=15.0, neutral=False)
    assert elo_home.hfa_points > baseline


def test_season_carryover_regresses_toward_the_mean():
    elo = EloModel()
    elo.start_season(2020)
    elo.ratings["KC"] = 1700.0
    elo.start_season(2021)
    assert BASE_RATING < elo.rating("KC") < 1700.0


# ---------------------------------------------------------------------------
# Ratings de eficiencia — la convención de signo
# ---------------------------------------------------------------------------

def test_defensive_rating_sign_high_means_permissive():
    """`dfn` alto = defensa permisiva, y el ataque esperado se SUMA.

    El signo se invirtió una vez y no da ningún síntoma visible: el modelo sigue
    entrenando y las métricas empeoran un poco. Este test lo fija.
    """
    ratings = EfficiencyRatings(learning_rate=0.3)
    ratings.start_season(2020)

    # Una defensa que concede mucho, repetidamente.
    for _ in range(30):
        ratings.update("BUF", "SOFT", observed=0.35, plays=65)
        ratings.update("MIA", "TOUGH", observed=-0.20, plays=65)

    assert ratings.defense("SOFT") > 0, "Una defensa permisiva debe tener dfn positivo."
    assert ratings.defense("TOUGH") < 0, "Una defensa dura debe tener dfn negativo."
    # Y por tanto el mismo ataque rinde más contra SOFT que contra TOUGH.
    assert ratings.expected("BUF", "SOFT") > ratings.expected("BUF", "TOUGH")


def test_ratings_take_off_from_the_first_observation():
    """Sin `mean_prior_n` el residuo inicial sale 0 y el rating nunca despega.

    Fue un error real: la media de liga absorbía la primera observación, el
    residuo era exactamente cero, y ni ataque ni defensa se movían jamás.
    """
    ratings = EfficiencyRatings()
    residual = ratings.update("KC", "DEN", observed=0.30, plays=65)

    assert residual != 0.0
    assert ratings.off["KC"] != 0.0
    assert ratings.dfn["DEN"] != 0.0


def test_shrinkage_keeps_early_season_opinions_weak():
    ratings = EfficiencyRatings(learning_rate=0.3)
    ratings.update("KC", "DEN", observed=0.40, plays=65)
    after_one = ratings.offense("KC")

    for _ in range(20):
        ratings.update("KC", "DEN", observed=0.40, plays=65)
    after_many = ratings.offense("KC")

    assert abs(after_one) < abs(after_many)


def test_qb_rating_shrinks_small_samples():
    """Un suplente con un buen partido no puede aparecer como élite."""
    qbs = QBRatings()
    qbs.update("backup", epa_per_dropback=0.45, dropbacks=20)
    qbs.update("starter", epa_per_dropback=0.20, dropbacks=20)
    for _ in range(30):
        qbs.update("starter", epa_per_dropback=0.20, dropbacks=35)

    assert qbs.rating("starter") > qbs.rating("backup")
    assert qbs.rating("unknown_rookie") == 0.0


# ---------------------------------------------------------------------------
# Distribución con números clave
# ---------------------------------------------------------------------------

def test_key_numbers_emerge_from_the_data():
    """3 y 7 salen solos: no se le dice nada al modelo sobre el reglamento."""
    rng = np.random.default_rng(7)
    # Se simulan márgenes con la acumulación real en 3 y 7.
    base = rng.normal(0, 13, 40000)
    margins = np.round(base)
    key = rng.random(margins.size)
    margins = np.where(key < 0.09, np.sign(rng.normal(size=margins.size)) * 3, margins)
    margins = np.where((key >= 0.09) & (key < 0.15),
                       np.sign(rng.normal(size=margins.size)) * 7, margins)

    distribution = MarginDistribution().fit(margins)
    weights = dict(zip(distribution.grid, distribution.weights, strict=True))

    assert weights[3] > 1.2, "El multiplicador de k=3 debería destacar."
    assert weights[7] > 1.1, "El multiplicador de k=7 debería destacar."
    assert weights[3] > weights[2]
    assert weights[7] > weights[6]


def test_pmf_is_a_distribution_and_win_prob_is_monotone():
    distribution = MarginDistribution()
    pmf = distribution.pmf(3.0, total=44.0)
    assert pmf.sum() == pytest.approx(1.0)
    assert (pmf >= 0).all()

    probabilities = [distribution.win_probability(m) for m in (-14, -7, 0, 7, 14)]
    assert probabilities == sorted(probabilities)
    assert distribution.win_probability(0.0) == pytest.approx(0.5, abs=0.02)


def test_push_probability_is_material_on_key_lines():
    """En una línea de 3, empatar contra el número no es un caso raro."""
    rng = np.random.default_rng(11)
    margins = np.round(rng.normal(0, 13, 30000))
    key = rng.random(margins.size)
    margins = np.where(key < 0.10, np.sign(rng.normal(size=margins.size)) * 3, margins)

    distribution = MarginDistribution().fit(margins)
    _, push_three, _ = distribution.cover_probability(2.5, line=3.0)
    _, push_four, _ = distribution.cover_probability(2.5, line=4.0)

    assert push_three > push_four, "El push en 3 debe ser mayor que en 4."
    assert push_three > 0.05


def test_sigma_grows_with_the_expected_total():
    distribution = MarginDistribution()
    assert distribution.sigma(54.0) > distribution.sigma(38.0)
    assert distribution.sigma(10.0) >= distribution.sigma_floor


# ---------------------------------------------------------------------------
# Ensamblado y cross-fitting
# ---------------------------------------------------------------------------

def test_blend_weights_are_fit_out_of_sample(features):
    """Los pesos salen de predicciones fuera de muestra, y son no negativos.

    La fuga de stacking (ajustarlos en muestra) hacía que el modelo combinado
    fuese *peor* que sus componentes y costaba 0,6 puntos de MAE.
    """
    train = features[features["season"] < 2020]
    model = MarketAwareModel().fit(train)

    assert (model.blend_weights >= 0).all()
    assert model.blend_weights.sum() > 0


def test_ensemble_is_not_worse_than_its_components(features):
    """La señal de alarma de la fuga de stacking: el combinado peor que sus partes.

    Si este test falla, la primera hipótesis **no** es que el ensamblado sea
    mala idea: es que los pesos se están ajustando en muestra otra vez.
    """
    train = features[features["season"] < 2020]
    test = features[features["season"] >= 2020]
    predicted = MarketAwareModel().fit(train).predict(test)

    truth = predicted["margin"].to_numpy(dtype=float)
    mae_blend = np.mean(np.abs(truth - predicted["pred_margin"]))
    mae_market = np.mean(np.abs(truth - predicted["pred_margin_market"]))
    mae_free = np.mean(np.abs(truth - predicted["pred_margin_free"]))

    # Tolerancia de 0.15 puntos: el ensamblado puede quedar marginalmente por
    # detrás del mejor componente por ruido muestral. Los 0,6 puntos que
    # producía la fuga están muy por encima de eso.
    assert mae_blend <= min(mae_market, mae_free) + 0.15


def test_free_model_ignores_the_line(features):
    """`pred_margin_free` no puede depender de la línea publicada.

    Es la columna con la que se responde "¿aporta algo la señal deportiva por sí
    sola?". Si mirase la línea, la respuesta no significaría nada.
    """
    train = features[features["season"] < 2020]
    test = features[features["season"] >= 2020].copy()
    model = MarketAwareModel().fit(train)

    original = model.predict(test)["pred_margin_free"].to_numpy()
    test["spread_line"] = test["spread_line"] + 7.0
    shifted = model.predict(test)["pred_margin_free"].to_numpy()

    np.testing.assert_allclose(original, shifted, rtol=1e-12)


def test_predictions_survive_a_missing_line(features):
    """Sin línea (jornada futura sin mercado) se cae al modelo libre, no a NaN."""
    train = features[features["season"] < 2020]
    test = features[features["season"] >= 2020].head(50).copy()
    test["spread_line"] = np.nan

    predicted = MarketAwareModel().fit(train).predict(test)
    assert predicted["pred_margin"].notna().all()
    np.testing.assert_allclose(
        predicted["pred_margin"].to_numpy(), predicted["pred_margin_free"].to_numpy()
    )


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------

def test_metrics_report_the_market_too(features):
    """No se puede reportar el Brier del modelo sin el del mercado al lado."""
    train = features[features["season"] < 2020]
    test = features[features["season"] >= 2020]
    predicted = MarketAwareModel().fit(train).predict(test)

    metrics = evaluate(predicted)
    assert metrics.market_brier is not None
    assert metrics.market_margin_mae is not None
    assert 0 < metrics.brier < 0.30
    assert metrics.ece < 0.10


def test_ece_detects_a_miscalibrated_model():
    """Dos modelos con el MISMO orden: uno calibrado y otro exagerado.

    El ECE tiene que separarlos, y el Brier apenas los separa. Esa es justo la
    razón de reportar los dos: para apostar, el precio sale de la probabilidad,
    no del ranking, y un modelo que dice 90% cuando gana el 70% de las veces
    pierde dinero aunque ordene los partidos perfectamente.
    """
    rng = np.random.default_rng(3)
    honest = rng.uniform(0.15, 0.85, 20000)
    outcomes = (rng.random(honest.size) < honest).astype(float)
    # Mismo orden, confianza inflada: se estira la distancia al 0,5.
    overconfident = np.clip(0.5 + 2.2 * (honest - 0.5), 0.01, 0.99)

    assert expected_calibration_error(honest, outcomes) < 0.02
    assert expected_calibration_error(overconfident, outcomes) > 0.10


def test_ats_record_always_carries_its_uncertainty(features):
    train = features[features["season"] < 2020]
    test = features[features["season"] >= 2020]
    predicted = MarketAwareModel().fit(train).predict(test)

    ats = summarize_ats(predicted)
    assert ats.bets > 0
    assert ats.ci_low < ats.win_rate < ats.ci_high
    # Contra un mercado eficiente simulado, "significativo" debe salir False.
    # Si sale True, la hipótesis por defecto es fuga, no genialidad.
    assert ats.significant is False
