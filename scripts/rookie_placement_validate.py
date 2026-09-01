#!/usr/bin/env python3
"""¿Cae el novato en el SITIO correcto del board, al lado de los veteranos?

`rookie_validate.py` contesta otra pregunta: si la previa ordena a los novatos
ENTRE ELLOS (Spearman 0,604, y sí). Esto contesta la que decide un draft: cuando
un novato y un veterano compiten por el mismo pick, ¿está el novato donde le
toca?

Importa porque las dos escalas no son la misma y se sabía antes de medir:

    veterano  = puntos por partido × 15,5      (supone que juega)
    novato    = total observado de su año      (ceros incluidos)

La segunda incluye a quien no jugó nunca; la primera no descuenta los partidos
que se pierde. Eso empuja al novato hacia abajo, y la pregunta es CUÁNTO.

## Preregistro

Se mide el SESGO en puntos —realizado menos proyectado— por separado para
novatos y veteranos, sobre el top-200 por VOR del board conjunto de cada
temporada. La comparación que importa es la DIFERENCIA de sesgos: si el board
subestima a todo el mundo por igual, el orden no se resiente.

    |sesgo_novato - sesgo_veterano| < 20 puntos  ->  la escala es comparable
    diferencia positiva                          ->  el novato está DEMASIADO ABAJO
    diferencia negativa                          ->  demasiado arriba

Umbral fijado antes de correrlo. El resultado se publica salga como salga: este
script no ajusta nada, sólo dice qué tan lejos está.

## Segunda medición, preregistrada aparte

La primera salió con n=4: la previa es tan conservadora que casi ningún novato
entra en el top-200, así que ahí no hay potencia para concluir nada. Eso NO se
arregla cambiando el estimador y quedándose con el que guste — se declara otra
medición, con su umbral, antes de correrla.

    EMPAREJADA POR VALOR PROYECTADO. Para cada novato se toman los veteranos
    del board con proyección dentro de ±10 puntos, y se compara lo que
    REALIZARON unos y otros. Es la pregunta del draft: a igual número en el
    board, ¿quién produce más?

    |diferencia| < 20 puntos   ->  la escala es comparable
    n < 100 novatos emparejados -> INCONCLUSO, sin importar el número

La segunda no sustituye a la primera: se publican las dos, con su n al lado.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd
from fantasy_build import rookie_rows  # noqa: E402

from oracle.config import paths as resolve_paths  # noqa: E402
from oracle.fantasy.draft import draft_board, project_season  # noqa: E402
from oracle.fantasy.scoring import PPR, score_player_weeks  # noqa: E402

EVALUATION = range(2019, 2026)
TOP_N = 200
UMBRAL = 20.0
VENTANA = 10.0
N_MINIMO = 100


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=None)
    args = parser.parse_args()
    paths = resolve_paths(args.root).ensure()
    players = pd.read_parquet(paths.player_weeks)

    weeks = players[players["season_type"] == "REG"].copy()
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
        # Quien no jugó ni un partido hizo cero. No es un dato que falte: es el
        # resultado, y quitarlo convertiría la medición en «entre los que
        # jugaron», que es justo la selección que infla al novato.
        board["real"] = [
            float(realizado.get((pid, season), 0.0)) for pid in board["player_id"]
        ]
        board["season"] = season
        board["rank"] = board["overall_rank"]
        filas.append(board[["season", "player_id", "player_name", "position", "rank",
                            "rookie", "projected_points", "vor", "real"]])

    if not filas:
        print("Sin temporadas evaluables.")
        return 1
    ev_todo = pd.concat(filas, ignore_index=True)
    ev_todo["sesgo"] = ev_todo["real"] - ev_todo["projected_points"]
    ev = ev_todo[ev_todo["rank"] <= TOP_N]

    print(f"Top-{TOP_N} por VOR de {EVALUATION.start}-{EVALUATION.stop - 1}, "
          f"{len(ev):,} filas\n")
    print(f"{'grupo':12}{'n':>7}{'proyectado':>13}{'realizado':>12}{'sesgo':>10}")
    resumen = {}
    for nombre, grupo in (("novatos", ev[ev.rookie]), ("veteranos", ev[~ev.rookie])):
        resumen[nombre] = float(grupo["sesgo"].mean())
        print(f"{nombre:12}{len(grupo):>7}{grupo['projected_points'].mean():>13.1f}"
              f"{grupo['real'].mean():>12.1f}{grupo['sesgo'].mean():>10.1f}")

    diferencia = resumen["novatos"] - resumen["veteranos"]
    print(f"\nDiferencia de sesgos: {diferencia:+.1f} puntos "
          f"(umbral preregistrado: ±{UMBRAL:.0f})")
    if abs(diferencia) < UMBRAL:
        print("VEREDICTO: la escala es comparable. El novato cae donde le toca.")
    elif diferencia > 0:
        print("VEREDICTO: el novato está DEMASIADO ABAJO — rinde más de lo proyectado\n"
              "           en comparación con el veterano de su mismo puesto del board.")
    else:
        print("VEREDICTO: el novato está DEMASIADO ARRIBA.")

    print("\nPor posición (sólo novatos):")
    print(f"{'pos':5}{'n':>6}{'proyectado':>13}{'realizado':>12}{'sesgo':>10}")
    for position, grupo in ev[ev.rookie].groupby("position", observed=True):
        print(f"{position:5}{len(grupo):>6}{grupo['projected_points'].mean():>13.1f}"
              f"{grupo['real'].mean():>12.1f}{grupo['sesgo'].mean():>10.1f}")

    # --- segunda medición: emparejada por valor proyectado -----------------
    print(f"\n--- emparejado por posición y proyección (±{VENTANA:.0f} puntos) ---")
    emparejados = []
    for season, grupo in ev_todo.groupby("season", observed=True):
        vet = grupo[~grupo.rookie]
        for row in grupo[grupo.rookie].itertuples(index=False):
            # DENTRO DE LA POSICIÓN. La primera versión emparejaba sólo por
            # puntos y comparaba a un receptor novato con quarterbacks de banco
            # proyectados en la misma cifra: cien puntos no significan lo mismo
            # en dos posiciones, y la diferencia salía inflada.
            misma = vet[vet["position"] == row.position]
            vecinos = misma[(misma["projected_points"] - row.projected_points).abs() <= VENTANA]
            if len(vecinos) < 5:
                continue
            emparejados.append({
                "season": season, "position": row.position,
                "novato": row.real, "veterano": float(vecinos["real"].mean()),
                "proyectado": row.projected_points,
            })
    pares = pd.DataFrame(emparejados)
    if len(pares) == 0:
        print("  sin pares suficientes")
    else:
        diferencia_emp = float((pares["novato"] - pares["veterano"]).mean())
        print(f"{'grupo':12}{'n':>7}{'realizado':>12}")
        print(f"{'novatos':12}{len(pares):>7}{pares['novato'].mean():>12.1f}")
        print(f"{'veteranos':12}{len(pares):>7}{pares['veterano'].mean():>12.1f}")
        print(f"\nDiferencia emparejada: {diferencia_emp:+.1f} puntos "
              f"(umbral ±{UMBRAL:.0f}, n mínimo {N_MINIMO})")
        if len(pares) < N_MINIMO:
            print("VEREDICTO: INCONCLUSO por muestra.")
        elif abs(diferencia_emp) < UMBRAL:
            print("VEREDICTO: a igual proyección, novato y veterano producen lo mismo.")
        else:
            print("VEREDICTO: a igual proyección NO producen lo mismo — "
                  f"el novato {'rinde MÁS' if diferencia_emp > 0 else 'rinde MENOS'}.")
        print("\n  por posición:")
        for position, grupo in pares.groupby("position", observed=True):
            print(f"    {position:4}{len(grupo):>6}"
                  f"  novato {grupo['novato'].mean():7.1f}"
                  f"  veterano {grupo['veterano'].mean():7.1f}"
                  f"  dif {grupo['novato'].mean() - grupo['veterano'].mean():+8.1f}")

    print("\nPor temporada (diferencia de sesgos):")
    for season, grupo in ev.groupby("season", observed=True):
        nov = grupo[grupo.rookie]["sesgo"]
        vet = grupo[~grupo.rookie]["sesgo"]
        if len(nov) == 0:
            continue
        print(f"  {season}  novatos {len(nov):>3}  diferencia {nov.mean() - vet.mean():+8.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
