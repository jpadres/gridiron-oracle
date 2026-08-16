"""Comando `oracle`.

La validación de entrada de aquí **no** es una defensa contra un atacante: no
hay atacante, esto lo ejecuta una persona en su portátil. Es para que un dedazo
(`--season 20226`) falle en el segundo cero con un mensaje claro, y no a los
cuatro minutos con un KeyError a mitad del backtest. Eso está dicho tal cual en
la sección de Seguridad del README.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from .config import DEFAULT_BACKTEST_START, FIRST_PBP_SEASON, MAX_REGULAR_SEASON_WEEK


def _season(value: str) -> int:
    season = int(value)
    if not FIRST_PBP_SEASON <= season <= 2100:
        raise argparse.ArgumentTypeError(
            f"Temporada fuera de rango: {season} (nflverse empieza en {FIRST_PBP_SEASON})."
        )
    return season


def _week(value: str) -> int:
    week = int(value)
    # 22 cubre la postemporada completa (comodín, divisional, campeonato, Super
    # Bowl) en la numeración de nflverse.
    if not 1 <= week <= 22:
        raise argparse.ArgumentTypeError(
            f"Semana fuera de rango: {week} (1-{MAX_REGULAR_SEASON_WEEK} regular, hasta 22 con playoffs)."
        )
    return week


def _positive(value: str) -> float:
    amount = float(value)
    if amount <= 0:
        raise argparse.ArgumentTypeError(f"Debe ser mayor que cero: {amount}.")
    return amount


def _fraction(value: str) -> float:
    fraction = float(value)
    if not 0 <= fraction < 1:
        raise argparse.ArgumentTypeError(f"Debe estar en [0, 1): {fraction}.")
    return fraction


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="oracle",
        description="Modelo de pronóstico NFL: margen, total, probabilidad y valor.",
    )
    parser.add_argument("--root", default=None, help="Raíz del proyecto (por defecto, la actual).")
    subparsers = parser.add_subparsers(dest="command", required=True)

    refresh = subparsers.add_parser("refresh", help="Descarga nflverse (~480 MB, 3-4 min).")
    refresh.add_argument("--from", dest="first_season", type=_season, default=FIRST_PBP_SEASON)
    refresh.add_argument("--to", dest="last_season", type=_season, default=None)

    subparsers.add_parser("features", help="Construye la tabla de features (pasada cronológica).")

    backtest = subparsers.add_parser("backtest", help="Validación walk-forward por temporada.")
    backtest.add_argument("--from", dest="first_season", type=_season,
                          default=DEFAULT_BACKTEST_START)
    backtest.add_argument("--to", dest="last_season", type=_season, default=None)
    backtest.add_argument("--json", dest="json_path", default=None)

    predict = subparsers.add_parser("predict", help="Predicciones de una jornada.")
    predict.add_argument("--season", type=_season, required=True)
    predict.add_argument("--week", type=_week, required=True)
    predict.add_argument("--json", dest="json_path", default=None)

    bets = subparsers.add_parser("bets", help="Apuestas con valor de una jornada.")
    bets.add_argument("--season", type=_season, required=True)
    bets.add_argument("--week", type=_week, required=True)
    bets.add_argument("--bankroll", type=_positive, default=1000.0)
    bets.add_argument("--min-edge", type=_fraction, default=0.015)
    bets.add_argument("--json", dest="json_path", default=None)

    subparsers.add_parser("ratings", help="Ratings actuales por equipo.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "refresh":
        return _cmd_refresh(args)
    if args.command == "features":
        return _cmd_features(args)
    if args.command == "backtest":
        return _cmd_backtest(args)
    if args.command == "predict":
        return _cmd_predict(args)
    if args.command == "bets":
        return _cmd_bets(args)
    if args.command == "ratings":
        return _cmd_ratings(args)
    return 1


def _cmd_refresh(args: argparse.Namespace) -> int:
    from .config import paths as resolve_paths
    from .data.ingest import refresh

    paths = resolve_paths(args.root).ensure()
    print(f"Descargando nflverse en {paths.raw} (esto tarda 3-4 minutos)...")
    refresh(paths, first_season=args.first_season, last_season=args.last_season)
    print(f"Listo. Tablas procesadas en {paths.processed}.")
    return 0


def _cmd_features(args: argparse.Namespace) -> int:
    from .pipeline import Oracle

    features = Oracle.build_features(args.root)
    print(f"{len(features)} partidos con features. Guardado en data/processed/features.parquet.")
    return 0


def _cmd_backtest(args: argparse.Namespace) -> int:
    from .backtest.metrics import summarize_ats
    from .backtest.walkforward import season_table
    from .pipeline import Oracle

    oracle = Oracle.train(args.root)

    def report(season: int, metrics) -> None:
        print(
            f"  {season}  Brier {metrics.brier:.4f}  "
            f"(mercado {metrics.market_brier:.4f})  MAE {metrics.margin_mae:.2f}"
            if metrics.market_brier is not None
            else f"  {season}  Brier {metrics.brier:.4f}  MAE {metrics.margin_mae:.2f}"
        )

    from .backtest.walkforward import walk_forward

    print(f"Walk-forward desde {args.first_season}...")
    predictions, metrics = walk_forward(
        oracle.features, args.first_season, args.last_season, on_season=report
    )

    from .backtest.metrics import evaluate

    overall = evaluate(predictions)
    ats = summarize_ats(predictions)

    print()
    print(f"Fuera de muestra: {overall.games} partidos")
    print(f"  Brier          {overall.brier:.4f}"
          + (f"   mercado {overall.market_brier:.4f}" if overall.market_brier else ""))
    print(f"  Log-loss       {overall.log_loss:.4f}")
    print(f"  ECE            {overall.ece:.4f}")
    print(f"  MAE margen     {overall.margin_mae:.2f}"
          + (f"   mercado {overall.market_margin_mae:.2f}" if overall.market_margin_mae else ""))
    if overall.total_mae is not None:
        print(f"  MAE total      {overall.total_mae:.2f}")
    print(f"  Acierto        {overall.accuracy:.1%}")
    print()
    # El registro ATS se imprime siempre con su intervalo, y con el veredicto
    # explícito. Un 52,4% sin intervalo es exactamente cómo se vende ruido.
    print(f"Contra el spread: {ats.wins}-{ats.losses}-{ats.pushes} "
          f"({ats.win_rate:.1%}, IC95% [{ats.ci_low:.1%}, {ats.ci_high:.1%}])")
    print("  Significativo frente al 52,4% de equilibrio: "
          + ("SÍ" if ats.significant else "NO"))

    if args.json_path:
        payload = {
            "overall": overall.to_dict(),
            "ats": ats.to_dict(),
            "seasons": season_table(metrics).to_dict(orient="records"),
        }
        _write_json(args.json_path, payload)
    return 0


def _cmd_predict(args: argparse.Namespace) -> int:
    from .pipeline import Oracle

    oracle = Oracle.train(args.root)
    predictions = oracle.predict(oracle.week_features(args.season, args.week))

    columns = [
        "away_team", "home_team", "spread_line", "pred_margin", "pred_margin_free",
        "pred_total", "home_win_prob", "edge_vs_line",
    ]
    view = predictions[columns].copy()
    view.columns = [
        "Visitante", "Local", "Línea", "Margen", "Margen (libre)", "Total", "P(local)", "Edge",
    ]
    print(view.to_string(index=False, float_format=lambda x: f"{x:7.2f}"))

    if args.json_path:
        _write_json(args.json_path, predictions[columns + ["game_id", "season", "week"]].to_dict(
            orient="records"
        ))
    return 0


def _cmd_bets(args: argparse.Namespace) -> int:
    from .betting.kelly import KellyConfig
    from .pipeline import Oracle

    oracle = Oracle.train(args.root)
    predictions = oracle.predict(oracle.week_features(args.season, args.week))
    bets = oracle.value_bets(
        predictions, bankroll=args.bankroll, config=KellyConfig(min_edge=args.min_edge)
    )

    if bets.empty:
        # Este es el resultado normal contra líneas de cierre, y conviene que el
        # mensaje lo diga: si no, uno acaba bajando el umbral hasta que salga algo.
        print("Ninguna apuesta supera el umbral de valor.")
        print("Es el resultado esperado la mayoría de las jornadas: el modelo iguala")
        print("al mercado, no lo bate. Bajar el umbral no crea edge, sólo lo esconde.")
        return 0

    view = bets[["matchup", "market", "selection", "model_prob", "market_prob", "edge", "ev",
                 "stake"]].copy()
    view.columns = ["Partido", "Mercado", "Selección", "P(modelo)", "P(mercado)", "Edge", "EV",
                    "Importe"]
    print(view.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))
    print(f"\nTotal comprometido: {bets['stake'].sum():.2f} de {args.bankroll:.2f} "
          f"({bets['stake'].sum() / args.bankroll:.1%} del bankroll)")

    if args.json_path:
        _write_json(args.json_path, bets.to_dict(orient="records"))
    return 0


def _cmd_ratings(args: argparse.Namespace) -> int:
    from .pipeline import Oracle

    oracle = Oracle.train(args.root)
    ratings = oracle.team_ratings()
    print(ratings.to_string(index=False, float_format=lambda x: f"{x:8.3f}"))
    return 0


def _write_json(path: str, payload: object) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=_json_default),
        encoding="utf-8",
    )
    print(f"\nEscrito {destination}")


def _json_default(value: object) -> object:
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    return str(value)


if __name__ == "__main__":
    sys.exit(main())
