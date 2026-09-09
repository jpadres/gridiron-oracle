#!/usr/bin/env python3
"""¿Tiene la curva de edad la FORMA correcta, o cobra dos veces?

Umbral preregistrado en `docs/PREREGISTRO_edad_forma.md`, fijado antes de
ejecutar. Las CUATRO condiciones o no se cambia nada.

La hipótesis, en una línea: `ppg_shrunk` es la media de los partidos que el
jugador YA jugó (hace 1-3 temporadas), así que multiplicarla por la caída
acumulada DESDE EL PICO le cobra un envejecimiento que esos datos ya contienen.
Lo que hace falta es la caída de la edad de la MUESTRA a la edad PROYECTADA.

    candidato = curva(edad) / curva(edad − sample_lag)

Ni una constante nueva: la misma curva y los mismos pesos, evaluados en el
sitio correcto.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.fantasy.ages import ages_for_season, birth_dates
from oracle.fantasy.draft import _age_factor, project_season
from oracle.fantasy.scoring import PPR, regular_season, score_player_weeks

SEASONS = range(2019, 2026)
MIN_PROJECTED = 50.0          # mismo filtro que el preregistro anterior
VIEJOS = 30.0                 # «veterano» a efectos de la condición 1
JOVENES = 26.0                # «joven» a efectos de la condición 4


def factor_incremental(position: str, age: float, lag: float) -> float:
    """La curva evaluada donde toca: de la edad de la muestra a la proyectada."""
    if not np.isfinite(age) or not np.isfinite(lag):
        return 1.0
    ahora = _age_factor(position, age)
    entonces = _age_factor(position, age - lag)
    if entonces <= 0:
        return 1.0
    return float(max(ahora / entonces, 0.55))


def main() -> int:
    paths = resolve_paths(None)
    players = regular_season(pd.read_parquet(paths.player_weeks))
    births = birth_dates(paths.raw)
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    real = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()

    filas = []
    for season in SEASONS:
        board = project_season(players, season, ages=ages_for_season(births, season))
        board = board[board["projected_points"] >= MIN_PROJECTED].copy()
        board["real"] = [
            float(real.get((pid, season), 0.0)) for pid in board["player_id"]
        ]
        board["alt_factor"] = [
            factor_incremental(p, a, retraso)
            for p, a, retraso in zip(board["position"], board["age"], board["sample_lag"],
                                     strict=True)
        ]
        # La MISMA fórmula, cambiando sólo el multiplicador.
        board["proj_alt"] = board["ppg_shrunk"] * board["alt_factor"] * board["expected_games"]
        board["season"] = season
        filas.append(board)
    d = pd.concat(filas, ignore_index=True)
    d = d[np.isfinite(d["age"])]

    def resumen(sub: pd.DataFrame, etiqueta: str) -> dict:
        return {
            "grupo": etiqueta, "n": len(sub),
            "sesgo_base": float((sub["projected_points"] - sub["real"]).mean()),
            "sesgo_alt": float((sub["proj_alt"] - sub["real"]).mean()),
            "mae_base": float((sub["projected_points"] - sub["real"]).abs().mean()),
            "mae_alt": float((sub["proj_alt"] - sub["real"]).abs().mean()),
        }

    print(f"Muestra: {len(d)} jugador-temporada, {SEASONS.start}-{SEASONS.stop - 1}, "
          f"proyección >= {MIN_PROJECTED:.0f} puntos\n")

    print("=== SESGO POR EDAD (proyectado − real; positivo = se le proyecta de MÁS)")
    print(f"{'tramo':>12} {'n':>5} {'sesgo base':>11} {'sesgo alt':>11} "
          f"{'MAE base':>9} {'MAE alt':>9}")
    tramos = [(0, 24), (24, 26), (26, 28), (28, 30), (30, 32), (32, 99)]
    for lo, hi in tramos:
        sub = d[(d["age"] >= lo) & (d["age"] < hi)]
        if sub.empty:
            continue
        r = resumen(sub, "")
        print(f"{f'{lo}-{hi}':>12} {r['n']:>5} {r['sesgo_base']:>11.1f} {r['sesgo_alt']:>11.1f} "
              f"{r['mae_base']:>9.1f} {r['mae_alt']:>9.1f}")

    print("\n=== LAS CUATRO CONDICIONES PREREGISTRADAS")
    viejos = d[d["age"] >= VIEJOS]
    jovenes = d[d["age"] < JOVENES]
    rb = d[d["position"] == "RB"]
    rv, rj, rg, rr = (resumen(viejos, "30+"), resumen(jovenes, "<26"),
                      resumen(d, "global"), resumen(rb, "RB"))

    c1 = abs(rv["sesgo_alt"]) < abs(rv["sesgo_base"]) / 2
    c2 = rg["mae_alt"] <= rg["mae_base"] + 1.0
    c3 = rr["mae_alt"] <= rr["mae_base"] + 1.0
    c4 = abs(rj["sesgo_alt"]) <= abs(rj["sesgo_base"]) * 1.25

    print(f"1. sesgo 30+ a menos de la MITAD (n={rv['n']}): "
          f"{rv['sesgo_base']:+.1f} -> {rv['sesgo_alt']:+.1f}  {'PASA' if c1 else 'FALLA'}")
    print(f"2. MAE global no empeora >1,0: "
          f"{rg['mae_base']:.2f} -> {rg['mae_alt']:.2f}  {'PASA' if c2 else 'FALLA'}")
    print(f"3. MAE de RB no empeora >1,0 (n={rr['n']}): "
          f"{rr['mae_base']:.2f} -> {rr['mae_alt']:.2f}  {'PASA' if c3 else 'FALLA'}")
    print(f"4. sesgo <26 no empeora >25% (n={rj['n']}): "
          f"{rj['sesgo_base']:+.1f} -> {rj['sesgo_alt']:+.1f}  {'PASA' if c4 else 'FALLA'}")

    # Control obligatorio ante cualquier resultado: ¿de dónde sale el cambio?
    subio = int((d["alt_factor"] > d["age_factor"] + 1e-9).sum())
    bajo = int((d["alt_factor"] < d["age_factor"] - 1e-9).sum())
    print(f"\nfactor: sube en {subio}, baja en {bajo}, de {len(d)}. "
          f"por encima de 1,0: {int((d['alt_factor'] > 1.0).sum())} "
          f"(máx {d['alt_factor'].max():.3f})")

    veredicto = c1 and c2 and c3 and c4
    print(f"\nVEREDICTO: {'ACEPTADO' if veredicto else 'RECHAZADO'} "
          f"(las cuatro condiciones eran obligatorias)")
    return 0 if veredicto else 1


if __name__ == "__main__":
    raise SystemExit(main())
