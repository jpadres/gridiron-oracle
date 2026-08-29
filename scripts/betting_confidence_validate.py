#!/usr/bin/env python3
"""¿Hay algún tramo de edge con acierto ATS demostrable por encima del equilibrio?

Umbral fijado antes de medir en `docs/PREREGISTRO_confianza.md`: el **límite
inferior** del IC del 95% de un tramo tiene que superar el 52,4% de equilibrio a
cuota −110. La media observada no basta: con la muestra troceada, un tramo al 56%
con IC [49%, 63%] es ruido con buena pinta.

Esto decide si la palabra «confianza» puede aparecer en la web o no.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.backtest.metrics import summarize_ats
from oracle.backtest.walkforward import walk_forward
from oracle.config import paths as resolve_paths

# Equilibrio a −110: hay que acertar 11/21 para no perder dinero.
BREAKEVEN = 110 / 210

# Tramos de |pred_margin − spread_line| EN PUNTOS, fijados antes de mirar. Cinco,
# no veinte: el propio docstring de `summarize_ats` avisa de que barrer umbrales
# y quedarse con el mejor es sobreajuste con otro nombre.
BUCKETS = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.5), (3.5, 6.0), (6.0, 99.0)]

# Caché del walk-forward: son cuatro minutos y el resultado es determinista.
CACHE = "out/backtest_preds.parquet"


def _predictions(paths) -> pd.DataFrame:
    cache = Path(CACHE)
    if cache.exists():
        print(f"Usando {CACHE} (bórralo para recalcular).")
        return pd.read_parquet(cache)
    print("Ejecutando el walk-forward (unos minutos)...")
    features = pd.read_parquet(paths.features)
    predictions, _ = walk_forward(features)
    cache.parent.mkdir(parents=True, exist_ok=True)
    predictions.to_parquet(cache)
    return predictions


def main() -> int:
    paths = resolve_paths(None)
    frame = _predictions(paths)

    # La convención de signo NO se reimplementa aquí. `summarize_ats` es la que
    # produce el 49,81% publicado, y reescribirla a mano ya me costó una medición
    # falsa de 78% que era una doble negación de `spread_line`.
    edge = (frame["pred_margin"] - frame["spread_line"]).abs()

    overall = summarize_ats(frame)
    print(f"\nRegistro global: {overall.wins}-{overall.losses}-{overall.pushes} "
          f"({overall.win_rate:.2%}), IC [{overall.ci_low:.1%}, {overall.ci_high:.1%}]\n")

    print(f"{'discrepancia':<18}{'n':>7}{'acierto':>10}{'IC 95%':>19}   veredicto")
    print("-" * 68)
    any_passes = False
    for low, high in BUCKETS:
        chunk = frame[(edge >= low) & (edge < high)]
        record = summarize_ats(chunk)
        if record.bets < 30:
            continue
        passes = bool(record.ci_low > BREAKEVEN)
        any_passes = any_passes or passes
        label = f"{low:.1f}–{high:.1f} pts" if high < 90 else f"{low:.1f}+ pts"
        print(f"{label:<18}{record.bets:>7}{record.win_rate:>9.1%}"
              f"{f'[{record.ci_low:.1%}, {record.ci_high:.1%}]':>20}   "
              f"{'PASA' if passes else 'no pasa'}")

    print("-" * 68)
    print(f"Equilibrio a −110: {BREAKEVEN:.1%}")
    print()
    if any_passes:
        print("Algún tramo supera el umbral. Antes de publicarlo hay que descartar")
        print("que sea un artefacto de trocear.")
    else:
        print("NINGÚN tramo tiene acierto demostrable por encima del equilibrio.")
        print("Es lo que anticipaba el preregistro. Consecuencia: la web NO puede")
        print("publicar «confianza» como afirmación de rentabilidad.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
