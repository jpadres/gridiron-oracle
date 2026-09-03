#!/usr/bin/env python3
"""¿El modelo de totales mejora la línea, o la empeora?

El experimento del clima dejó un dato al margen que importa más que el propio
experimento: en el walk-forward completo, el MAE del total PREDICHO (10,574) era
peor que el de la **línea de cierre a secas** (10,510). Si eso es real y no
ruido, el modelo de totales está restando, y publicar sus totales como si
añadieran algo sería exactamente lo que este proyecto no hace.

Esto lo mide como hay que medirlo: **pareado**, partido a partido, con el error
estándar de la diferencia. Dos MAE parecidos no se comparan a ojo cuando las dos
series están correlacionadas al 0,99 — la incertidumbre de la diferencia es
mucho menor que la de cada una por separado, y eso corta en las dos direcciones.

    python scripts/totals_vs_line.py --from 2012
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.backtest.walkforward import walk_forward  # noqa: E402
from oracle.config import paths as resolve_paths  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Totales: modelo contra la línea")
    parser.add_argument("--root", default=None)
    parser.add_argument("--from", dest="first", type=int, default=2012)
    args = parser.parse_args(argv)
    paths = resolve_paths(args.root)

    frame = pd.read_parquet(paths.processed / "features.parquet")
    preds, _ = walk_forward(frame, first_season=args.first)

    hay = preds["total"].notna() & preds["pred_total"].notna() & preds["total_line"].notna()
    d = preds.loc[hay, ["season", "total", "pred_total", "total_line"]].copy()
    d["err_modelo"] = (d["total"] - d["pred_total"]).abs()
    d["err_linea"] = (d["total"] - d["total_line"]).abs()
    # Positivo = el modelo es PEOR que la línea en ese partido.
    d["dif"] = d["err_modelo"] - d["err_linea"]

    n = len(d)
    media = float(d["dif"].mean())
    ee = float(d["dif"].std(ddof=1) / np.sqrt(n))
    t = media / ee if ee > 0 else float("nan")
    print(f"Partidos con línea y total: {n}")
    print(f"MAE modelo {d['err_modelo'].mean():.3f} · MAE línea {d['err_linea'].mean():.3f}")
    print(f"Diferencia pareada (modelo − línea): {media:+.4f} ± {ee:.4f}  (t = {t:+.2f})")
    print(f"El modelo gana en {float((d['dif'] < 0).mean()):.1%} de los partidos")

    print("\nPor temporada (diferencia pareada, positivo = el modelo es peor):")
    filas = []
    for season, g in d.groupby("season"):
        m = float(g["dif"].mean())
        filas.append({"season": int(season), "dif": m, "n": int(len(g))})
        print(f"  {int(season)}  {m:+.3f}  (n={len(g)})")
    peores = sum(1 for f in filas if f["dif"] > 0)
    print(f"\nEl modelo es peor en {peores} de {len(filas)} temporadas")

    # EL SIGNO, que es lo que se apuesta. El MAE puede ser peor y aun así tener
    # valor si acierta la DIRECCIÓN cuando se separa de la línea. Se mide por
    # tramos de discrepancia: cuando el modelo dice «más de lo que dice la
    # línea» por encima de X puntos, ¿cuántas veces pasa de verdad?
    d["lean"] = d["pred_total"] - d["total_line"]
    d["over"] = (d["total"] > d["total_line"]).astype(float)
    empates = int((d["total"] == d["total_line"]).sum())
    print(f"\nEmpates exactos con la línea (push): {empates}")
    print("Acierto direccional por tamaño de la discrepancia:")
    tramos = []
    for lo in (0.0, 1.0, 2.0, 3.0):
        sel = d[(d["lean"].abs() >= lo) & (d["total"] != d["total_line"])]
        if len(sel) < 30:
            continue
        # Acierta si el modelo se inclinó al lado que salió.
        aciertos = float((((sel["lean"] > 0) & (sel["over"] > 0))
                          | ((sel["lean"] < 0) & (sel["over"] < 1))).mean())
        # Con n partidos, el error estándar de una proporción cerca de 0,5.
        ee_p = float(np.sqrt(0.25 / len(sel)))
        tramos.append({"desde": lo, "n": int(len(sel)), "acierto": aciertos, "ee": ee_p})
        print(f"  |lean| >= {lo:.0f}  n={len(sel):5d}  acierto {aciertos:.1%} ± {ee_p:.1%}"
              f"   (52,4% es el punto de equilibrio a -110)")

    # La correlación entre las dos series de error explica por qué el error
    # estándar de la diferencia es tan pequeño comparado con el de cada MAE.
    r = float(np.corrcoef(d["err_modelo"], d["err_linea"])[0, 1])
    print(f"Correlación entre los dos errores: {r:.3f}")

    salida = paths.out / "totals_vs_line.json"
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps({
        "n": n,
        "mae_modelo": float(d["err_modelo"].mean()),
        "mae_linea": float(d["err_linea"].mean()),
        "diferencia_pareada": media,
        "error_estandar": ee,
        "t": t,
        "gana_el_modelo_pct": float((d["dif"] < 0).mean()),
        "por_temporada": filas,
        "correlacion_errores": r,
        "direccional": tramos,
        "push": empates,
    }, indent=2), encoding="utf-8")
    print(f"\nEscrito {salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
