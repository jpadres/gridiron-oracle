#!/usr/bin/env python3
"""Informe HTML de validación.

Un solo fichero autocontenido, sin CSS externo ni JavaScript. Es para mirarlo
después de un cambio y decidir si se queda o se revierte, no para publicarlo.

El informe enseña **siempre** el mercado al lado del modelo y el intervalo de
confianza del registro ATS. Un informe que sólo enseñe lo bueno no sirve para
decidir nada.
"""

from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.backtest.metrics import calibration_table, evaluate, summarize_ats
from oracle.backtest.walkforward import season_table, walk_forward
from oracle.config import DEFAULT_BACKTEST_START
from oracle.config import paths as resolve_paths
from oracle.pipeline import Oracle

STYLE = """
body { font-family: -apple-system, system-ui, sans-serif; max-width: 60rem;
       margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #16181d; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.9rem; }
th, td { border-bottom: 1px solid #e3e5ea; padding: 0.4rem 0.6rem; text-align: right; }
th:first-child, td:first-child { text-align: left; }
th { background: #f6f7f9; font-weight: 600; }
.verdict { padding: 1rem; border-left: 4px solid #b45309; background: #fffbeb; margin: 1.5rem 0; }
.caption { color: #5b6472; font-size: 0.85rem; }
"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Informe HTML de validación.")
    parser.add_argument("--root", default=None)
    parser.add_argument("--from", dest="first_season", type=int, default=DEFAULT_BACKTEST_START)
    parser.add_argument("--out", default=None)
    args = parser.parse_args(argv)

    paths = resolve_paths(args.root).ensure()
    oracle = Oracle.train(args.root)

    print(f"Walk-forward desde {args.first_season}...")
    predictions, metrics = walk_forward(oracle.features, args.first_season)
    overall = evaluate(predictions)
    ats = summarize_ats(predictions)

    destination = Path(args.out) if args.out else paths.out / "report.html"
    destination.write_text(
        _render(overall, ats, season_table(metrics), calibration_table(predictions)),
        encoding="utf-8",
    )
    print(f"Escrito {destination}")
    return 0


def _render(overall, ats, seasons: pd.DataFrame, calibration: pd.DataFrame) -> str:
    beats_market = (
        overall.market_brier is not None and overall.brier < overall.market_brier - 0.005
    )
    verdict = (
        "<p><strong>El modelo aparenta batir a la línea de cierre con holgura.</strong> "
        "La hipótesis por defecto NO es que haya mejorado: es que hay fuga de "
        "información. Busca el bug antes de celebrar nada — la línea de cierre agrega "
        "el dinero de todos los modelos privados que existen.</p>"
        if beats_market
        else "<p>El modelo <strong>iguala</strong> a la línea de cierre sin batirla. "
        "Es exactamente lo que debe pasar y es la mejor noticia posible: "
        "significa que la medición es honesta.</p>"
    )

    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Gridiron Oracle — informe de validación</title>
<style>{STYLE}</style></head><body>
<h1>Informe de validación</h1>
<p class="caption">Walk-forward estricto: para predecir la temporada S sólo se usan
temporadas anteriores. Modelo, distribución, calibración y pesos de ensamblado se
reajustan en cada paso.</p>

<div class="verdict"><h2>Veredicto</h2>{verdict}</div>

<h2>Fuera de muestra ({overall.games} partidos)</h2>
<table>
<tr><th>Métrica</th><th>Modelo</th><th>Mercado (cierre)</th></tr>
<tr><td>Brier</td><td>{overall.brier:.4f}</td>
    <td>{_optional(overall.market_brier)}</td></tr>
<tr><td>Log-loss</td><td>{overall.log_loss:.4f}</td><td>—</td></tr>
<tr><td>Error de calibración (ECE)</td><td>{overall.ece:.4f}</td><td>—</td></tr>
<tr><td>MAE del margen</td><td>{overall.margin_mae:.2f}</td>
    <td>{_optional(overall.market_margin_mae, ".2f")}</td></tr>
<tr><td>MAE del total</td><td>{_optional(overall.total_mae, ".2f")}</td><td>—</td></tr>
<tr><td>Acierto directo</td><td>{overall.accuracy:.1%}</td><td>—</td></tr>
</table>

<h2>Contra el spread</h2>
<p>{ats.wins}-{ats.losses}-{ats.pushes} ({ats.win_rate:.1%}),
IC 95% [{ats.ci_low:.1%}, {ats.ci_high:.1%}].
Equilibrio a -110: 52,4%.
<strong>{"Significativo." if ats.significant else "No significativo."}</strong></p>
<p class="caption">Un porcentaje ATS sin intervalo de confianza no significa nada.
El error estándar con unos cientos de apuestas es de varios puntos porcentuales.</p>

<h2>Por temporada</h2>
{_table(seasons.round(4))}

<h2>Calibración</h2>
<p class="caption">Probabilidad predicha frente a frecuencia observada. Si las dos
columnas se separan, el modelo miente aunque su Brier sea bueno.</p>
{_table(calibration.round(4))}

</body></html>
"""


def _optional(value, fmt: str = ".4f") -> str:
    return "—" if value is None else format(value, fmt)


def _table(frame: pd.DataFrame) -> str:
    """HTML de una tabla con todo escapado.

    No hay entrada de usuario en este proyecto, pero escapar cuesta una línea y
    evita que un nombre con un `&` rompa el informe en silencio.
    """
    header = "".join(f"<th>{html.escape(str(c))}</th>" for c in frame.columns)
    rows = "".join(
        "<tr>" + "".join(f"<td>{html.escape(str(v))}</td>" for v in row) + "</tr>"
        for row in frame.itertuples(index=False)
    )
    return f"<table><tr>{header}</tr>{rows}</table>"


if __name__ == "__main__":
    raise SystemExit(main())
