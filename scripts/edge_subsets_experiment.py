"""E27 — ¿bate el modelo al spread en algún SUBCONJUNTO?

Ejecuta EXACTAMENTE lo que declara `docs/PREREGISTRO_edge_subconjuntos.md`: ocho
subconjuntos de lista cerrada, partición temporal descubrimiento/confirmación y
Bonferroni sobre los ocho. No hay ningún umbral en este fichero que no esté
escrito antes en ese documento.

El registro se calcula con `summarize_ats`, que es la ÚNICA definición de
«apostar el lado que el modelo prefiere» en el proyecto. Aquí no se reimplementa:
sólo se le pasan las filas del subconjunto. Dos copias de la misma regla es el
fallo que más veces ha aparecido en este repositorio, y el de esta mañana estaba
justo en un guardián.

    python scripts/edge_subsets_experiment.py            # ~4 min (walk-forward)
    python scripts/edge_subsets_experiment.py --preds out/backtest_preds.parquet
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

from oracle.backtest.metrics import summarize_ats

# --- CONSTANTES DEL PREREGISTRO. No se tocan sin un preregistro nuevo. -------
BREAKEVEN = 0.52381            # -110 los dos lados; CONVENCIÓN declarada
MIN_BETS = 200
DISCOVERY = range(2012, 2020)  # 2012-2019
CONFIRM = range(2020, 2026)    # 2020-2025
N_TESTS = 8
# Bonferroni a dos colas sobre los ocho: 1 - 0,05/8. Se deja la cifra escrita
# además de la fórmula para que se pueda comprobar sin ejecutar nada.
Z_CORRECTED = 2.7344
KEY_NUMBERS = (3.0, 7.0)


def _cruza_clave(linea: float, pred: float, claves=KEY_NUMBERS) -> bool:
    """¿Cae un número clave ESTRICTAMENTE entre la línea y la predicción?

    Se miran los dos signos: un partido con el local favorito por 2,5 y el
    modelo diciendo 4 cruza el 3; el simétrico (−2,5 y −4) cruza el −3, y es el
    mismo hecho visto desde el visitante.
    """
    lo, hi = min(linea, pred), max(linea, pred)
    for k in claves:
        for valor in (k, -k):
            if lo < valor < hi:
                return True
    return False


def subsets(frame: pd.DataFrame) -> dict[str, pd.Series]:
    """Las ocho máscaras del preregistro, en su orden y con su nombre."""
    linea = frame["spread_line"].astype(float)
    pred = frame["pred_margin"].astype(float)
    edge = pred - linea
    pick_home = edge > 0
    cruza = pd.Series(
        [_cruza_clave(a, b) for a, b in zip(linea, pred, strict=True)], index=frame.index
    )
    cruza3 = pd.Series(
        [_cruza_clave(a, b, (3.0,)) for a, b in zip(linea, pred, strict=True)],
        index=frame.index,
    )
    # No favorito: el lado apostado recibe puntos. Local con línea negativa, o
    # visitante con línea positiva.
    dog = (pick_home & (linea < 0)) | (~pick_home & (linea > 0))
    return {
        "KEY_CROSS": cruza,
        "KEY_CROSS_3": cruza3,
        "HOME_DOG": pick_home & (linea < 0),
        "AWAY_DOG": (~pick_home) & (linea > 0),
        "SHORT_LINE": linea.abs() <= 3,
        "LARGE_LINE": linea.abs() >= 7,
        "BIG_EDGE": edge.abs() >= 3,
        "KEY_CROSS_AND_DOG": cruza & dog,
    }


def _registro(frame: pd.DataFrame) -> dict:
    """El registro ATS del subconjunto, con el intervalo CORREGIDO."""
    ats = summarize_ats(frame)
    if ats.bets == 0 or not math.isfinite(ats.win_rate):
        return {"bets": 0, "win_rate": None, "ci_low": None, "ci_high": None,
                "pushes": int(ats.pushes)}
    # El IC de `summarize_ats` es a 1,96; aquí hace falta el de Bonferroni.
    return {
        "bets": ats.bets,
        "wins": ats.wins,
        "losses": ats.losses,
        "pushes": ats.pushes,
        "win_rate": ats.win_rate,
        "ci_low": ats.win_rate - Z_CORRECTED * ats.standard_error,
        "ci_high": ats.win_rate + Z_CORRECTED * ats.standard_error,
        # ROI a -110: ganas 100/110 por acierto, pierdes 1 por fallo.
        "roi_110": (ats.wins * (100 / 110) - ats.losses) / ats.bets,
    }


def run(preds: pd.DataFrame) -> dict:
    jugados = preds[preds["margin"].notna() & preds["spread_line"].notna()
                    & preds["pred_margin"].notna()].copy()
    mascaras = subsets(jugados)
    assert len(mascaras) == N_TESTS, "la lista es CERRADA: ocho, ni más ni menos"

    desc = jugados[jugados["season"].isin(DISCOVERY)]
    conf = jugados[jugados["season"].isin(CONFIRM)]
    mas_desc = subsets(desc)
    mas_conf = subsets(conf)

    filas = []
    for nombre in mascaras:
        d = _registro(desc[mas_desc[nombre]])
        c = _registro(conf[mas_conf[nombre]])
        avanza = bool(
            d["bets"] >= MIN_BETS and d["win_rate"] is not None
            and d["win_rate"] > BREAKEVEN
        )
        pasa = bool(
            avanza and c["bets"] >= MIN_BETS and c["ci_low"] is not None
            and c["ci_low"] > BREAKEVEN
        )
        filas.append({
            "subset": nombre,
            "discovery": d,
            "confirmation": c,
            "advances": avanza,
            "passes": pasa,
            "verdict": "PASA" if pasa else ("AVANZA, NO CONFIRMA" if avanza else "FALLA"),
        })

    return {
        "experiment": "E27",
        "preregistration": "docs/PREREGISTRO_edge_subconjuntos.md",
        "breakeven": BREAKEVEN,
        "min_bets": MIN_BETS,
        "z_corrected": Z_CORRECTED,
        "n_tests": N_TESTS,
        "discovery_seasons": [min(DISCOVERY), max(DISCOVERY)],
        "confirmation_seasons": [min(CONFIRM), max(CONFIRM)],
        "games_total": int(len(jugados)),
        "overall": _registro(jugados),
        "subsets": filas,
        "any_passes": any(f["passes"] for f in filas),
    }


def _pct(x) -> str:
    return "—" if x is None else f"{x * 100:.1f}%"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preds", default=None,
                    help="parquet de predicciones ya calculado; si falta, se corre el walk-forward")
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", dest="json_path", default="out/edge_subsets.json")
    args = ap.parse_args()

    if args.preds and Path(args.preds).exists():
        preds = pd.read_parquet(args.preds)
        print(f"Predicciones leídas de {args.preds}: {len(preds)} filas")
    else:
        from oracle.backtest.walkforward import walk_forward
        from oracle.pipeline import Oracle
        print("Walk-forward desde 2012 (unos cuatro minutos)...")
        oracle = Oracle.train(args.root)
        preds, _ = walk_forward(oracle.features, 2012, None)
        Path("out").mkdir(exist_ok=True)
        preds.to_parquet("out/backtest_preds.parquet")
        print(f"  {len(preds)} predicciones fuera de muestra")

    res = run(preds)

    o = res["overall"]
    print(f"\nAgregado (E4 reproducido): {o['bets']} apuestas, {_pct(o['win_rate'])}, "
          f"IC corregido [{_pct(o['ci_low'])}, {_pct(o['ci_high'])}]")
    print(f"Equilibrio declarado: {_pct(BREAKEVEN)}  ·  z = {Z_CORRECTED} (Bonferroni/{N_TESTS})\n")
    cab = f"{'subconjunto':22} {'desc n':>7} {'desc %':>8} {'conf n':>7} {'conf %':>8} {'IC inf':>8} {'ROI':>7}  veredicto"
    print(cab)
    print("-" * len(cab))
    for f in res["subsets"]:
        d, c = f["discovery"], f["confirmation"]
        print(f"{f['subset']:22} {d['bets']:>7} {_pct(d['win_rate']):>8} "
              f"{c['bets']:>7} {_pct(c['win_rate']):>8} {_pct(c['ci_low']):>8} "
              f"{_pct(c.get('roi_110')):>7}  {f['verdict']}")
    print()
    print("VEREDICTO E27: " + ("ALGÚN SUBCONJUNTO PASA — leer el preregistro antes de "
                              "celebrar: pasar NO es VALIDATED"
                              if res["any_passes"] else
                              "NINGUNO PASA. BETTING_EDGE sigue REJECTED."))

    Path(args.json_path).parent.mkdir(parents=True, exist_ok=True)
    Path(args.json_path).write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(f"\nEscrito {args.json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
