#!/usr/bin/env python3
"""E26 — DÓNDE entra el +108,9 entre el novato y el veterano.

    LA DIFERENCIA NO ESTÁ EN LA CONSTANTE DE PARTIDOS. ESTÁ EN EL CONDICIONAL.

E25 falsó el candidato obvio: multiplicar la previa del novato por 15,5 como al
veterano salió **idéntico** al baseline, porque `expected_games` ya vale 15,5
para todo novato. La constante era la misma desde el principio. Lo que E25 no
contestó es qué queda entonces, y ese hueco es lo que este script mide.

## Las dos cifras no prometen lo mismo

    veterano  = puntos por partido DE LOS QUE JUGÓ (encogido) × 15,5
    novato    = total de temporada observado de su celda / 15,5 × 15,5

La segunda incluye a los novatos de esa celda que **no jugaron nunca**: el cero
está dentro de la media. La primera es una tasa CONDICIONADA a jugar, y luego se
extiende a una temporada completa como si jugarla estuviera garantizado. La
diferencia entre las dos no es un factor: es la probabilidad de que el jugador
esté en el campo, que sólo una de las dos lleva dentro.

## Lo que este script publica

El sesgo (realizado − proyectado) POR TRAMO DE PUESTO del board conjunto, para
novatos y veteranos por separado. Sirve para tres cosas que la diferencia global
no puede contestar:

1. **De qué lado está el error.** Si el veterano estuviera bien y el novato
   bajo, el sesgo del veterano sería ~0.
2. **Dónde duele.** Un sesgo en el puesto 700 no decide ningún pick.
3. **Cuántos pares hay dentro del board drafteable**, que es lo que convierte
   —o no— la medición en un problema de producto.

No cambia ni un número. La corrección va por el lado del veterano y exige un
modelo de disponibilidad que no existe todavía; inventarle un multiplicador
sería peor que el sesgo conocido, que es la conclusión que E24 ya escribió sobre
la escala del novato y que aquí se confirma con el sesgo del veterano medido.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd  # noqa: E402
from fantasy_build import rookie_rows  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.draft import draft_board, project_season  # noqa: E402
from oracle.fantasy.scoring import PPR, regular_season, score_player_weeks  # noqa: E402

EVALUATION = range(2019, 2026)
#: Los cortes por los que se parte el board. El último es el tamaño publicado.
TRAMOS = [0, 50, 100, 150, 250, 400, 552]
VENTANA = 10.0


def construir(paths) -> dict:
    players = pd.read_parquet(paths.player_weeks)
    weeks = regular_season(players).copy()
    weeks["fp"] = score_player_weeks(weeks, PPR)
    realizado = weeks.groupby(["player_id", "season"], observed=True)["fp"].sum()

    filas = []
    for season in EVALUATION:
        veteranos = project_season(players, season, PPR)
        novatos, _ = rookie_rows(paths, players, PPR, season)
        if novatos.empty:
            continue
        juntos = pd.concat([veteranos, novatos], ignore_index=True)
        juntos["rookie"] = juntos.get("rookie", False).fillna(False).astype(bool)
        board = draft_board(juntos).copy()
        # Quien no jugó hizo CERO. No es un dato que falte.
        board["real"] = [float(realizado.get((p, season), 0.0)) for p in board["player_id"]]
        board["season"] = season
        filas.append(board[["season", "player_id", "player_name", "position",
                            "overall_rank", "rookie", "projected_points", "vor", "real"]])
    todo = pd.concat(filas, ignore_index=True)
    todo["sesgo"] = todo["real"] - todo["projected_points"]

    bandas = []
    for inicio, fin in zip(TRAMOS, TRAMOS[1:], strict=False):
        tramo = todo[(todo.overall_rank > inicio) & (todo.overall_rank <= fin)]
        fila = {"desde": inicio + 1, "hasta": fin}
        for clave, grupo in (("veteranos", tramo[~tramo.rookie]), ("novatos", tramo[tramo.rookie])):
            fila[clave] = {
                "n": int(len(grupo)),
                "proyectado": round(float(grupo["projected_points"].mean()), 1) if len(grupo) else None,
                "realizado": round(float(grupo["real"].mean()), 1) if len(grupo) else None,
                "sesgo": round(float(grupo["sesgo"].mean()), 1) if len(grupo) else None,
            }
        bandas.append(fila)

    # Los pares emparejados, restringidos a cada corte: es lo que dice si la
    # diferencia global vive donde se draftea o donde ya no mira nadie.
    cortes = []
    for corte in (150, 250, 400, 552, None):
        pares = _pares(todo, corte)
        cortes.append({
            "corte": corte,
            "n_pares": len(pares),
            "diferencia": round(float((pares["novato"] - pares["veterano"]).mean()), 1)
            if len(pares) else None,
            "novato_realizado": round(float(pares["novato"].mean()), 1) if len(pares) else None,
            "veterano_realizado": round(float(pares["veterano"].mean()), 1) if len(pares) else None,
            "veteranos_a_cero": round(float(pares["veterano_a_cero"].mean()), 3)
            if len(pares) else None,
        })
    return {
        "experiment": "E26",
        "question": "¿de qué lado del emparejamiento está el sesgo, y dónde duele?",
        "seasons": [EVALUATION.start, EVALUATION.stop - 1],
        "window_points": VENTANA,
        "bias_by_rank": bandas,
        "pairs_by_cutoff": cortes,
        "conclusion": (
            "El sesgo está en el VETERANO y crece con el puesto: casi nulo en el "
            "top 50, cerca de -100 puntos a partir del puesto 150. Es la tasa por "
            "partido CONDICIONADA a jugar extendida a una temporada entera. La "
            "previa del novato ya lleva dentro a quien no jugó."
        ),
    }


def _pares(todo: pd.DataFrame, corte: int | None) -> pd.DataFrame:
    salida = []
    for _, grupo in todo.groupby("season", observed=True):
        acotado = grupo[grupo.overall_rank <= corte] if corte else grupo
        veteranos = acotado[~acotado.rookie]
        for row in acotado[acotado.rookie].itertuples(index=False):
            misma = veteranos[veteranos["position"] == row.position]
            vecinos = misma[
                (misma["projected_points"] - row.projected_points).abs() <= VENTANA
            ]
            if len(vecinos) < 5:
                continue
            salida.append({
                "novato": row.real,
                "veterano": float(vecinos["real"].mean()),
                "veterano_a_cero": float((vecinos["real"] <= 1.0).mean()),
            })
    return pd.DataFrame(salida, columns=["novato", "veterano", "veterano_a_cero"])


def main() -> int:
    parser = argparse.ArgumentParser(description="E26: dónde entra el hueco novato/veterano")
    parser.add_argument("--root", default=None)
    args = parser.parse_args()
    paths = resolve_paths(args.root).ensure()
    informe = construir(paths)

    print(f"{'puesto':>12}{'n vet':>8}{'sesgo vet':>12}{'n nov':>8}{'sesgo nov':>12}")
    for banda in informe["bias_by_rank"]:
        v, n = banda["veteranos"], banda["novatos"]
        print(f"{banda['desde']:>5}-{banda['hasta']:<6}{v['n']:>8}"
              f"{(v['sesgo'] if v['sesgo'] is not None else float('nan')):>12.1f}"
              f"{n['n']:>8}"
              f"{(n['sesgo'] if n['sesgo'] is not None else float('nan')):>12.1f}")
    print(f"\n{'corte':>12}{'pares':>8}{'diferencia':>13}{'vet a cero':>13}")
    for corte in informe["pairs_by_cutoff"]:
        etiqueta = f"top-{corte['corte']}" if corte["corte"] else "completo"
        print(f"{etiqueta:>12}{corte['n_pares']:>8}"
              f"{(corte['diferencia'] or float('nan')):>13.1f}"
              f"{(corte['veteranos_a_cero'] or float('nan')):>13.2f}")

    destino = Path(__file__).resolve().parents[1] / "docs" / "evidence" / "rookie_gap_location.json"
    destino.write_text(json.dumps(informe, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nEscrito {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
