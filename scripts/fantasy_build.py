#!/usr/bin/env python3
"""Board de draft de fantasy: proyecciones de temporada ordenadas por VOR.

Tarda ~5 minutos porque además de proyectar la temporada que viene, valida la
metodología proyectando las cuatro anteriores contra su resultado real. Esa
validación no es opcional: un board sin correlación medida es una lista de
opiniones.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from oracle.config import paths as resolve_paths
from oracle.fantasy import availability as avail
from oracle.fantasy import risk
from oracle.fantasy.draft import (
    LeagueSettings,
    _td_points,
    draft_board,
    project_season,
)
from oracle.fantasy.scoring import ScoringRules, rules_from_name, score_player_weeks

# Temporadas sobre las que se reporta la validación. Se fija antes de mirar el
# resultado, que es la regla del proyecto.
VALIDATION_SEASONS = (2022, 2023, 2024, 2025)


def _attach_risk(
    players: pd.DataFrame,
    team_games: pd.DataFrame,
    board: pd.DataFrame,
    season: int,
) -> pd.DataFrame:
    """Tasa de ausencia y probabilidad de bust para cada jugador del board.

    Los coeficientes del bust se ajustan sobre las temporadas **anteriores** a
    la que se proyecta, reconstruyendo para cada una el board que se habría
    publicado entonces. Es más lento que ajustar una vez sobre todo, y es la
    diferencia entre una probabilidad calibrada y una que se ha visto a sí
    misma.
    """
    from oracle.fantasy.bust import fit as fit_bust
    from oracle.fantasy.bust import label as bust_label
    from oracle.fantasy.bust import predict as predict_bust

    availability = avail.season_availability(players, team_games)
    positions = (
        players[players["season"] < season]
        .sort_values("season")
        .groupby("player_id", observed=True)["position"]
        .last()
    )

    past = avail.history(availability, positions, season)
    board = board.merge(past[["player_id", "missed_rate", "availability_sample"]],
                        on="player_id", how="left")
    # Sin historial se usa la media del propio board: neutro. Un 0 le regalaría
    # un «nunca falta» a quien simplemente no tiene datos.
    board["missed_rate"] = board["missed_rate"].fillna(board["missed_rate"].mean())
    board["missed_games"] = board["missed_rate"] * 17.0

    training = _bust_training(players, team_games, season)
    if training is None or len(training) < 300:
        print("Sin historial suficiente para la probabilidad de bust; se omite.")
        return board

    model = fit_bust(training)
    board["p_bust"] = predict_bust(model, board)
    board["bust_label"] = [bust_label(p) for p in board["p_bust"]]
    print(f"Probabilidad de bust ajustada sobre {len(training)} jugador-temporadas "
          f"anteriores a {season}.")
    return board


def _bust_training(
    players: pd.DataFrame, team_games: pd.DataFrame, season: int
) -> pd.DataFrame | None:
    """Jugador-temporadas pasadas con su etiqueta de bust ya observada."""
    from oracle.fantasy.bust import BUST_FRACTION
    from oracle.fantasy.scoring import PPR

    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()
    availability = avail.season_availability(players, team_games)

    rows = []
    for past_season in range(2013, season):
        try:
            projected = project_season(players, past_season, PPR)
        except ValueError:
            continue
        projected = risk.components(projected, {"QB": 4.0, "RB": 6.0, "WR": 6.0, "TE": 6.0})
        positions = (
            players[players["season"] < past_season]
            .sort_values("season")
            .groupby("player_id", observed=True)["position"]
            .last()
        )
        history = avail.history(availability, positions, past_season)
        if history.empty:
            continue
        frame = projected.merge(history[["player_id", "missed_rate"]],
                                on="player_id", how="left")
        frame["missed_rate"] = frame["missed_rate"].fillna(frame["missed_rate"].mean())
        frame = frame.nlargest(250, "projected_points")
        try:
            truth = actual.xs(past_season, level="season")
        except KeyError:
            continue
        frame = frame[frame["player_id"].isin(truth.index)].copy()
        if frame.empty:
            continue
        frame["observed"] = frame["player_id"].map(truth).astype(float)
        frame["bust"] = (
            frame["observed"] < BUST_FRACTION * frame["projected_points"].astype(float)
        ).astype(int)
        rows.append(frame)

    return pd.concat(rows, ignore_index=True) if rows else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera el board de draft.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--season", type=int, default=None, help="Temporada a proyectar.")
    parser.add_argument("--ignore-league", action="store_true",
                        help="Ignora research/league.json y usa --scoring y --teams.")
    parser.add_argument("--scoring", default="ppr", help="ppr | half | standard")
    parser.add_argument("--teams", type=int, default=12)
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()

    # La configuración de la liga sincronizada manda sobre los valores por
    # defecto. La puntuación **cambia el ranking**, así que si existe hay que
    # usarla: un board en PPR para una liga estándar no es aproximado, es de
    # otra liga.
    synced = _synced_league(paths.root)
    if synced and not args.ignore_league:
        rules = ScoringRules(**synced["scoring"])
        settings = LeagueSettings(
            teams=synced["teams"],
            starters=tuple(synced["starters"].items()),
        )
        print(f"Usando la liga sincronizada: {synced.get('name')} "
              f"({settings.teams} equipos, {rules.reception:g} por recepción).")
    else:
        rules = rules_from_name(args.scoring)
        settings = None
    players = pd.read_parquet(paths.player_weeks)

    season = args.season or int(players["season"].max()) + 1
    if settings is None:
        settings = LeagueSettings(teams=args.teams)

    print(f"Proyectando {season} ({_scoring_label(rules)}, liga de {settings.teams})...")
    board = draft_board(project_season(players, season, rules), settings)

    # Etiqueta de riesgo. Validada contra el error realizado en
    # `scripts/fantasy_risk_validate.py`: Spearman +0.12 y el tercio de riesgo
    # yerra un 10.7% más. Pasa el umbral, y lo pasa por poco — la web lo dice
    # así, porque «predice el error» y «predice el error un poco» son
    # afirmaciones distintas.
    td_points = {pos: _td_points(pos, rules) for pos in ("QB", "RB", "WR", "TE")}
    board = risk.score(board, td_points)
    board["risk_reasons"] = [risk.reasons(row) for _, row in board.iterrows()]

    # Ausencia y bust. Las dos están validadas con umbral preregistrado en
    # `docs/PREREGISTRO_riesgo.md`:
    #
    # - Ausencia: Spearman +0,24 en la población del board, con el tercio alto
    #   perdiendo el 32,9% de los partidos frente al 18,1% del bajo.
    # - Bust: ECE 0,043 y el decil alto busteando 5,5 veces más que el bajo.
    #
    # Son cosas distintas de la volatilidad de `risk.py`, que mide cuánto puede
    # variar la proyección **en los dos sentidos**. El bust mira sólo la cola de
    # abajo, que es la pregunta que se hace en un draft.
    team_games = pd.read_parquet(paths.team_games)
    board = _attach_risk(players, team_games, board, season)

    print("\nTop 20 por VOR:\n")
    view = board.head(20)[
        ["overall_rank", "player_name", "position", "position_rank", "tier",
         "projected_points", "vor"]
    ]
    print(view.to_string(index=False, float_format=lambda x: f"{x:8.1f}"))

    print("\nValidando la metodología sobre temporadas pasadas...")
    validation = validate(players, rules, settings)
    print(validation.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))
    print(
        "\nSpearman ~0.55 está en línea con lo mejor que se publica — y aun así\n"
        "significa que una de cada tres parejas de jugadores termina en el orden\n"
        "contrario. Los rankings sirven para no cometer errores grandes."
    )

    destination = paths.out / "fantasy_draft.json"
    destination.write_text(
        json.dumps(
            {
                "season": season,
                # La etiqueta describe las reglas **de verdad**, no el nombre
                # del argumento: con una liga sincronizada, «ppr» podía acabar
                # publicado sobre un board de media recepción.
                "scoring": _scoring_label(rules),
                "league": synced.get("name") if synced and not args.ignore_league else None,
                "teams": settings.teams,
                "starters": dict(settings.starters),
                "board": board.head(250).round(3).to_dict(orient="records"),
                "validation": validation.round(4).to_dict(orient="records"),
            },
            ensure_ascii=False,
            default=str,
        ),
        encoding="utf-8",
    )
    print(f"\nEscrito {destination}")
    return 0


def _scoring_label(rules: ScoringRules) -> str:
    """Cómo se llama esta puntuación, mirando las reglas y no el argumento."""
    base = {1.0: "PPR", 0.5: "half-PPR", 0.0: "estándar"}.get(rules.reception)
    label = base or f"{rules.reception:g} por recepción"
    if rules.passing_td != 4.0:
        label += f", TD de pase a {rules.passing_td:g}"
    return label


def _synced_league(root) -> dict | None:
    """La liga sincronizada desde Sleeper, si la hay."""
    path = root / "research" / "league.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def validate(players: pd.DataFrame, rules, settings: LeagueSettings) -> pd.DataFrame:
    """Proyección de pretemporada frente al resultado real, temporada a temporada.

    Cada temporada se proyecta usando **sólo** lo anterior. Es la misma regla
    walk-forward del modelo de partidos, y por el mismo motivo: proyectar 2023
    con datos de 2023 da correlaciones preciosas y completamente falsas.
    """
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, rules)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()

    rows = []
    available = sorted(players["season"].unique())
    for season in VALIDATION_SEASONS:
        if season not in available:
            continue
        try:
            projected = project_season(players, season, rules)
        except ValueError:
            continue
        projected = projected.set_index("player_id")
        truth = actual.xs(season, level="season")

        common = projected.index.intersection(truth.index)
        if len(common) < 30:
            continue

        for position in ("QB", "RB", "WR", "TE"):
            subset = projected.loc[common]
            subset = subset[subset["position"] == position]
            if len(subset) < 15:
                continue
            predicted = subset["projected_points"].to_numpy(dtype=float)
            observed = truth.loc[subset.index].to_numpy(dtype=float)
            rows.append(
                {
                    "season": season,
                    "position": position,
                    "players": len(subset),
                    "pearson": float(pearsonr(predicted, observed)[0]),
                    "spearman": float(spearmanr(predicted, observed)[0]),
                    "mae": float(np.mean(np.abs(predicted - observed))),
                }
            )

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    # Se reporta la media por posición sobre todas las temporadas validadas.
    return frame.groupby("position", as_index=False).agg(
        seasons=("season", "nunique"),
        players=("players", "mean"),
        pearson=("pearson", "mean"),
        spearman=("spearman", "mean"),
        mae=("mae", "mean"),
    )


if __name__ == "__main__":
    raise SystemExit(main())
