"""¿La probabilidad de bust publicada significa lo que dice?

Umbrales fijados antes de ejecutar, en `docs/PREREGISTRO_riesgo.md`. Las dos
condiciones tienen que cumplirse a la vez:

1. **Calibración**: ECE <= 0,08 sobre deciles.
2. **Discriminación**: tasa de bust del decil alto >= 1,5x la del decil bajo.

Si falla cualquiera, la probabilidad no se publica.

Todo es walk-forward: los coeficientes que se aplican a una temporada salen sólo
de las anteriores, igual que el resto del proyecto.
"""

from __future__ import annotations

import pandas as pd

from oracle.fantasy.availability import history, season_availability
from oracle.fantasy.bust import BUST_FRACTION, expected_calibration_error, fit, predict
from oracle.fantasy.draft import project_season
from oracle.fantasy.risk import components
from oracle.fantasy.scoring import PPR, score_player_weeks

ECE_THRESHOLD = 0.08
LIFT_THRESHOLD = 1.5
SEASONS = range(2013, 2026)
# Las temporadas que se evalúan. Las primeras sólo sirven para entrenar: sin un
# par de años de casos observados los coeficientes son ruido.
EVALUATED = range(2016, 2026)
BOARD_SIZE = 250
TD_POINTS = {"QB": 4.0, "RB": 6.0, "WR": 6.0, "TE": 6.0}


def panel() -> pd.DataFrame:
    players = pd.read_parquet("data/processed/player_weeks.parquet")
    team_games = pd.read_parquet("data/processed/team_games.parquet")

    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()

    availability = season_availability(players, team_games)

    rows = []
    for season in SEASONS:
        try:
            projected = project_season(players, season, PPR)
        except ValueError:
            continue
        projected = components(projected, TD_POINTS)
        # La posición se lee **sólo del pasado**. Con `groupby().last()` sobre
        # todo el historial, un jugador que cambia de posición en 2024 entraría
        # en la predicción de 2018 con su posición de 2024. Es la fuga más
        # tonta posible y la más fácil de escribir sin darse cuenta: regla dura
        # nº1 del proyecto.
        positions = (
            players[players["season"] < season]
            .sort_values("season")
            .groupby("player_id", observed=True)["position"]
            .last()
        )
        past = history(availability, positions, season)
        if past.empty:
            continue
        frame = projected.merge(past[["player_id", "missed_rate"]], on="player_id", how="left")
        # Sin historial de ausencia se usa la media del board de ese año: es lo
        # neutro. Rellenar con 0 le regalaría un «nunca se lesiona» a quien no
        # tiene datos, que es exactamente al revés de lo prudente.
        frame["missed_rate"] = frame["missed_rate"].fillna(frame["missed_rate"].mean())
        frame = frame.nlargest(BOARD_SIZE, "projected_points")

        try:
            truth = actual.xs(season, level="season")
        except KeyError:
            continue
        frame = frame[frame["player_id"].isin(truth.index)].copy()
        if len(frame) < 100:
            continue
        frame["observed"] = frame["player_id"].map(truth).astype(float)
        frame["bust"] = (
            frame["observed"] < BUST_FRACTION * frame["projected_points"].astype(float)
        ).astype(int)
        frame["season"] = season
        rows.append(frame)

    return pd.concat(rows, ignore_index=True)


def main() -> int:
    data = panel()

    predictions = []
    for season in EVALUATED:
        train = data[data["season"] < season]
        test = data[data["season"] == season]
        if len(train) < 300 or test.empty:
            continue
        model = fit(train)
        chunk = test.copy()
        chunk["p_bust"] = predict(model, chunk)
        predictions.append(chunk)

    if not predictions:
        print("sin datos suficientes")
        return 1

    out = pd.concat(predictions, ignore_index=True)
    ece = expected_calibration_error(out["p_bust"].to_numpy(), out["bust"].to_numpy())

    out["decile"] = pd.qcut(out["p_bust"], 10, labels=False, duplicates="drop")
    low = out[out["decile"] == out["decile"].min()]["bust"].mean()
    high = out[out["decile"] == out["decile"].max()]["bust"].mean()
    lift = high / low if low > 0 else float("inf")

    print(f"jugador-temporadas evaluadas: {len(out)}  "
          f"({out['season'].min()}-{out['season'].max()})")
    print(f"tasa base de bust (< {BUST_FRACTION:.0%} de la proyección): {out['bust'].mean():.1%}")
    print()
    print("Calibración por decil (predicho -> observado):")
    table = out.groupby("decile", observed=True).agg(
        predicho=("p_bust", "mean"), observado=("bust", "mean"), n=("bust", "size")
    )
    for _, row in table.iterrows():
        print(f"  {row['predicho']:.0%}  ->  {row['observado']:.0%}   (n = {int(row['n'])})")
    print()
    print(f"ECE:                 {ece:.4f}   (umbral <= {ECE_THRESHOLD})")
    print(f"Decil bajo:          {low:.1%} de bust")
    print(f"Decil alto:          {high:.1%} de bust")
    print(f"Lift alto/bajo:      {lift:.2f}x  (umbral >= {LIFT_THRESHOLD})")
    print()
    passes = ece <= ECE_THRESHOLD and lift >= LIFT_THRESHOLD
    print(f"Umbrales preregistrados -> {'PASA' if passes else 'NO PASA'}")
    return 0 if passes else 2


if __name__ == "__main__":
    raise SystemExit(main())
