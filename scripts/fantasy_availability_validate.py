"""¿La tasa de ausencia pasada predice la futura?

Umbral fijado antes de ejecutar, en `docs/PREREGISTRO_riesgo.md`:
**Spearman ≥ +0,15** walk-forward sobre 2015-2025. Por debajo, la señal no se
publica y se reporta el número igual.

La pregunta no es retórica. El comentario de `draft.PROJECTED_GAMES` afirma que
«las lesiones pasadas predicen las futuras mucho peor de lo que se cree», y esa
afirmación estaba puesta sin medir. Esto la mide.
"""

from __future__ import annotations

import pandas as pd
from scipy.stats import spearmanr

from oracle.fantasy.availability import history, season_availability
from oracle.fantasy.scoring import PPR, score_player_weeks

THRESHOLD = 0.15
SEASONS = range(2015, 2026)
# Sólo posiciones de fantasy: la ausencia de un liniero no la usa nadie y su
# patrón de aparición en los datos es distinto.
POSITIONS = ("QB", "RB", "WR", "TE")
# Con menos de media temporada de historial la tasa es ruido, y meterla mide
# sobre todo cuánto ruido hay. Se exige el equivalente a ~8 partidos ponderados.
MIN_SAMPLE = 8.0
# Tamaño del board publicado. La validación que decide se hace sobre esta
# población, no sobre todos los jugadores con historial.
BOARD_SIZE = 250


def main() -> int:
    player_weeks = pd.read_parquet("data/processed/player_weeks.parquet")
    team_games = pd.read_parquet("data/processed/team_games.parquet")

    availability = season_availability(player_weeks, team_games)

    scored = player_weeks[player_weeks["season_type"] == "REG"].copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    season_points = scored.groupby(["season", "player_id"], observed=True)[
        "fantasy_points"
    ].sum().reset_index()

    rows = []
    for season in SEASONS:
        # Posición leída sólo del pasado: `groupby().last()` sobre todo el
        # historial le daría a la predicción de 2018 la posición que el jugador
        # tuvo en 2024. Regla dura nº1.
        positions = (
            player_weeks[player_weeks["season"] < season]
            .sort_values("season")
            .groupby("player_id", observed=True)["position"]
            .last()
        )
        past = history(availability, positions, season)
        if past.empty:
            continue
        actual = availability[availability["season"] == season][["player_id", "missed_share"]]
        merged = past.merge(actual, on="player_id", how="inner")
        merged = merged[merged["availability_sample"] >= MIN_SAMPLE]
        merged["position"] = merged["player_id"].map(positions)
        merged = merged[merged["position"].isin(POSITIONS)]
        if len(merged) < 50:
            continue
        # Aproximación al board que se habría publicado antes de `season`:
        # los 250 mejores de la temporada anterior. Sólo mira hacia atrás.
        previous = season_points[season_points["season"] == season - 1].copy()
        previous["position"] = previous["player_id"].map(positions)
        previous = previous[previous["position"].isin(POSITIONS)]
        board_ids = set(previous.nlargest(BOARD_SIZE, "fantasy_points")["player_id"])
        merged["in_board"] = merged["player_id"].isin(board_ids)
        merged["season"] = season
        rows.append(merged)

    if not rows:
        print("sin datos suficientes")
        return 1

    panel = pd.concat(rows, ignore_index=True)
    rho, p = spearmanr(panel["missed_rate"], panel["missed_share"])

    print(f"jugador-temporadas: {len(panel)}  ({panel['season'].min()}-{panel['season'].max()})")
    print(f"Spearman global:    {rho:+.3f}   (p = {p:.2g})")
    print()
    print("Por posición:")
    for position in POSITIONS:
        chunk = panel[panel["position"] == position]
        if len(chunk) < 30:
            continue
        r, _ = spearmanr(chunk["missed_rate"], chunk["missed_share"])
        print(f"  {position}: {r:+.3f}   (n = {len(chunk)})")

    print()
    print("Tercios de tasa esperada frente a ausencia observada:")
    panel["bucket"] = pd.qcut(panel["missed_rate"], 3, labels=["baja", "media", "alta"])
    table = panel.groupby("bucket", observed=True)["missed_share"].agg(["mean", "size"])
    for name, row in table.iterrows():
        print(f"  {name:>6}: {row['mean']:.1%} de partidos perdidos   (n = {int(row['size'])})")

    # La cifra que se publica es ESTA, no la global.
    #
    # La global (+0,48) mide sobre todo «los suplentes siguen siendo suplentes»:
    # un ala cerrada que juega seis partidos al año tiene una tasa de ausencia
    # altísima y perfectamente estable, y eso no es propensión a lesionarse, es
    # el puesto en la plantilla. Restringiendo a titulares con 16+ partidos la
    # correlación se cae a +0,09.
    #
    # El board son 250 jugadores: ni la población entera ni sólo titulares de
    # hierro. Medir en la población donde el número se va a enseñar es la única
    # comparación honesta, y es la que decide.
    board = panel[panel["in_board"]]
    board_rho, _ = spearmanr(board["missed_rate"], board["missed_share"])
    print()
    print("=" * 60)
    print(f"EN LA POBLACIÓN DEL BOARD (top-{BOARD_SIZE} del año anterior)")
    print(f"  n = {len(board)}   Spearman = {board_rho:+.3f}")
    board = board.copy()
    board["bucket"] = pd.qcut(board["missed_rate"], 3,
                              labels=["baja", "media", "alta"], duplicates="drop")
    for name, row in board.groupby("bucket", observed=True)["missed_share"].agg(
        ["mean", "size"]
    ).iterrows():
        print(f"  {name:>6}: pierde {row['mean']:.1%} de los partidos  "
              f"(n = {int(row['size'])})")
    print("=" * 60)

    print()
    rho = board_rho
    verdict = "PASA" if rho >= THRESHOLD else "NO PASA"
    print(f"Umbral preregistrado: Spearman >= {THRESHOLD:+.2f}  ->  {verdict}")
    return 0 if rho >= THRESHOLD else 2


if __name__ == "__main__":
    raise SystemExit(main())
