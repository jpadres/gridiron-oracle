#!/usr/bin/env python3
"""¿Decae la ventaja en RB o 2025 es una temporada rara? Diagnóstico, no modelo.

Tres preguntas, en este orden:

1. ¿Mejoró la baseline en 2025 o empeoramos nosotros? Niveles ABSOLUTOS de las
   dos series (VOR capturado / VOR disponible), y cuánto se solapan sus picks.
2. ¿En qué RB concretos perdimos 2025? Los del top-k real que el modelo dejó
   fuera y la baseline no, y al revés, con el VOR que costó cada uno.
3. ¿Cambió la composición del pool? Cambios de equipo, edad, muestra corta y
   cuánto del valor real lo hicieron jugadores que el año anterior no eran
   titulares.

Reproduce EXACTAMENTE el pool congelado y el `k` del arnés (`validate()`),
para que los números cuadren con los publicados.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from fantasy_build import DEFAULT_ROSTER, DRAFTABLE, VALIDATION_SEASONS, starters_by_position

from oracle.config import paths as resolve_paths
from oracle.fantasy.ages import ages_for_season, birth_dates
from oracle.fantasy.draft import FANTASY_POSITIONS, draft_board, project_season
from oracle.fantasy.league import roster_context
from oracle.fantasy.scoring import PPR, score_player_weeks

POS = "RB"


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--no-age", action="store_true",
                        help="Proyectar SIN curva de edad, como hace hoy validate().")
    args = parser.parse_args()
    paths = resolve_paths(None).ensure()
    players = pd.read_parquet(paths.player_weeks)
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()
    games = scored[scored["season_type"] == "REG"].groupby(["player_id", "season"])["week"].nunique()
    positions = players.drop_duplicates("player_id").set_index("player_id")["position"]
    names = players.drop_duplicates("player_id", keep="last").set_index("player_id")["player_name"]
    k = starters_by_position(DEFAULT_ROSTER, 12)[POS]
    bdays = birth_dates(paths.raw)

    resumen = []
    for season in VALIDATION_SEASONS:
        ages = None if args.no_age else ages_for_season(bdays, season)
        projected = project_season(players, season, PPR, ages=ages)
        if args.no_age:
            projected["age"] = np.nan
        board = draft_board(projected, roster_context(list(DEFAULT_ROSTER), 12, season=season))
        board = board.set_index("player_id")
        previos = actual.xs(season - 1, level="season")
        previos = previos[previos.index.map(positions).isin(FANTASY_POSITIONS)]
        congelado = previos.nlargest(DRAFTABLE).index
        pool = board.index.intersection(congelado)
        sub = board.loc[pool]
        rb = sub[sub["position"] == POS].copy()
        rb["real"] = actual.xs(season, level="season").reindex(rb.index).fillna(0.0)
        rb["prev"] = previos.reindex(rb.index).fillna(0.0)
        rb["games"] = games.xs(season, level="season").reindex(rb.index).fillna(0).astype(int)
        # Equipo de agosto (roster de la temporada, semana 1) contra el último equipo del historial.
        roster = pd.read_parquet(paths.raw / f"roster_{season}.parquet", columns=["gsis_id", "team", "week"])
        roster = roster[roster["week"] == roster["week"].min()].drop_duplicates("gsis_id").set_index("gsis_id")["team"]
        rb["team_aug"] = roster.reindex(rb.index)
        rb["moved"] = rb["team_aug"].notna() & (rb["team_aug"] != rb["team"])

        # VOR real dentro del pool: el mismo cálculo que `value_captured`.
        repl = float(rb["real"].nlargest(k + 1).iloc[-1])
        rb["vor_real"] = (rb["real"] - repl).clip(lower=0.0)
        best = float(rb["vor_real"].nlargest(k).sum())
        rb["rank_model"] = rb["overall_rank"].rank(method="first").astype(int)
        rb["rank_base"] = (-rb["prev"]).rank(method="first").astype(int)
        top_m = set(rb.nsmallest(k, "rank_model").index)
        top_b = set(rb.nsmallest(k, "rank_base").index)
        top_t = set(rb.nlargest(k, "vor_real").index)
        cap_m = rb.loc[list(top_m), "vor_real"].sum() / best
        cap_b = rb.loc[list(top_b), "vor_real"].sum() / best

        print(f"\n{'=' * 78}\n{season}  RB en pool {len(rb)} · k={k} · VOR disponible {best:.0f} · reemplazo real {repl:.0f} pts")
        print(f"  capturado: modelo {cap_m:.3f} · baseline {cap_b:.3f} · picks comunes {len(top_m & top_b)}/{k} "
              f"· aciertos del top real: modelo {len(top_m & top_t)}, baseline {len(top_b & top_t)}")

        # --- 2. quiénes ---------------------------------------------------------
        def fila(pid, rb=rb):
            r = rb.loc[pid]
            return (f"    {names.get(pid, pid):<16} real {r['real']:5.0f} (VOR {r['vor_real']:5.0f}) · "
                    f"prev {r['prev']:5.0f} · modelo #{int(r['rank_model']):>2} · base #{int(r['rank_base']):>2} · "
                    f"{'MOVER ' if r['moved'] else ''}wg {r['weighted_games']:.1f} · edad {r['age']:.0f} · {int(r['games'])} pj")
        miss_m = sorted(top_t - top_m, key=lambda p: -rb.loc[p, "vor_real"])
        miss_b = sorted(top_t - top_b, key=lambda p: -rb.loc[p, "vor_real"])
        print(f"  DEL TOP REAL, el modelo dejó fuera {len(miss_m)} (VOR {rb.loc[miss_m, 'vor_real'].sum():.0f}):")
        for pid in miss_m:
            print(fila(pid) + ("   <- la baseline SÍ lo tenía" if pid in top_b else ""))
        print(f"  DEL TOP REAL, la baseline dejó fuera {len(miss_b)} (VOR {rb.loc[miss_b, 'vor_real'].sum():.0f}):")
        for pid in miss_b:
            print(fila(pid) + ("   <- el modelo SÍ lo tenía" if pid in top_m else ""))
        # Y los que el modelo metió en su top-k y valieron cero: el coste de un pick quemado.
        quemados = [p for p in top_m if rb.loc[p, "vor_real"] == 0]
        print(f"  picks del modelo que valieron CERO VOR: {len(quemados)}"
              + ("" if not quemados else " — " + ", ".join(f"{names.get(p, p)} ({int(rb.loc[p, 'games'])} pj)" for p in quemados)))

        # --- 3. composición ------------------------------------------------------
        top_t_df = rb.loc[list(top_t)]
        resumen.append({
            "season": season, "pool": len(rb), "best_vor": best, "cap_model": cap_m, "cap_base": cap_b,
            "common": len(top_m & top_b),
            "moved_pool": rb["moved"].mean(), "moved_topreal": top_t_df["moved"].mean(),
            "age_pool": rb["age"].mean(), "wg_pool": rb["weighted_games"].mean(),
            "short_topreal": (top_t_df["weighted_games"] < 8).mean(),
            # Cuánto del VOR real lo hicieron jugadores que el año anterior estaban por
            # debajo del puesto k por puntos: los que rompieron.
            "breakout_share": top_t_df.loc[top_t_df["rank_base"] > k, "vor_real"].sum() / best,
            "zero_model": len(quemados),
        })

    r = pd.DataFrame(resumen)
    pd.set_option("display.width", 200)
    print("\n=== COMPOSICIÓN POR TEMPORADA ===")
    print(r.to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
