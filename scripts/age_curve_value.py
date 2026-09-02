#!/usr/bin/env python3
"""¿Está mal calibrado el castigo por edad en RB? Medido por ORDEN, no por MAE.

La curva se aceptó en `PREREGISTRO_edad` por MAE. El board ordena, así que la
pregunta es otra: ¿cuánto VOR real nos cuesta cada temporada dejar fuera del
top-k a corredores de 29+ a los que la curva les baja el número, y cuánto nos
ahorra sacar a los que sí se caen?

Por cada temporada del pool congelado, RB de 29+:
  - proyección con y sin curva, puesto con y sin curva, VOR realizado;
  - «superó su curva» = realizó más de lo que la proyección CON curva decía;
  - coste = VOR real de los que la curva sacó del top-k y estaban en el top-k
    real; ahorro = VOR cero de los que la curva sacó y valieron cero.
No cambia nada: mide.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd
from fantasy_build import DEFAULT_ROSTER, DRAFTABLE, VALIDATION_SEASONS, starters_by_position

from oracle.config import paths as resolve_paths
from oracle.fantasy.ages import ages_for_season, birth_dates
from oracle.fantasy.draft import FANTASY_POSITIONS, draft_board, project_season
from oracle.fantasy.league import roster_context
from oracle.fantasy.scoring import PPR, score_player_weeks

POS = "RB"
OLD = 29


def main() -> int:
    paths = resolve_paths(None).ensure()
    players = pd.read_parquet(paths.player_weeks)
    scored = players.copy()
    scored["fantasy_points"] = score_player_weeks(scored, PPR)
    actual = scored.groupby(["player_id", "season"], observed=True)["fantasy_points"].sum()
    positions = players.drop_duplicates("player_id").set_index("player_id")["position"]
    names = players.drop_duplicates("player_id", keep="last").set_index("player_id")["player_name"]
    k = starters_by_position(DEFAULT_ROSTER, 12)[POS]
    bdays = birth_dates(paths.raw)
    ctx = lambda s: roster_context(list(DEFAULT_ROSTER), 12, season=s)  # noqa: E731

    filas = []
    for season in VALIDATION_SEASONS:
        con = draft_board(project_season(players, season, PPR, ages=ages_for_season(bdays, season)), ctx(season)).set_index("player_id")
        sin = draft_board(project_season(players, season, PPR), ctx(season)).set_index("player_id")
        previos = actual.xs(season - 1, level="season")
        previos = previos[previos.index.map(positions).isin(FANTASY_POSITIONS)]
        pool = con.index.intersection(previos.nlargest(DRAFTABLE).index)
        rb = con.loc[pool]
        rb = rb[rb["position"] == POS].copy()
        rb["real"] = actual.xs(season, level="season").reindex(rb.index).fillna(0.0)
        repl = float(rb["real"].nlargest(k + 1).iloc[-1])
        rb["vor_real"] = (rb["real"] - repl).clip(lower=0.0)
        rb["rank_con"] = rb["overall_rank"].rank(method="first").astype(int)
        rb["proj_sin"] = sin["projected_points"].reindex(rb.index)
        rb["rank_sin"] = sin["overall_rank"].reindex(rb.index).rank(method="first").astype(int)
        top_real = set(rb.nlargest(k, "vor_real").index)
        top_con, top_sin = set(rb.nsmallest(k, "rank_con").index), set(rb.nsmallest(k, "rank_sin").index)
        best = rb["vor_real"].nlargest(k).sum()

        old = rb[rb["age"] >= OLD].copy()
        old["beat"] = old["real"] > old["projected_points"]
        sacados = old[(old.index.isin(top_sin)) & (~old.index.isin(top_con))]
        coste = sacados.loc[sacados.index.isin(top_real), "vor_real"].sum()
        ahorro_n = int((sacados["vor_real"] == 0).sum())
        print(f"\n{season}: RB 29+ en el pool {len(old)} de {len(rb)} · con curva {rb.loc[list(top_con), 'vor_real'].sum() / best:.3f} "
              f"· sin curva {rb.loc[list(top_sin), 'vor_real'].sum() / best:.3f}")
        print(f"  superaron su curva {int(old['beat'].sum())} de {len(old)} · la curva SACÓ del top-{k} a {len(sacados)}: "
              f"{ahorro_n} valieron cero, y los que estaban en el top real costaron {coste:.0f} de VOR")
        for pid, r in old.sort_values("vor_real", ascending=False).iterrows():
            marca = "SACADO" if pid in sacados.index else ("dentro" if pid in top_con else "fuera")
            print(f"    {names.get(pid, pid):<14} {r['age']:.0f} años · factor {r['age_factor']:.2f} · proy con {r['projected_points']:5.0f} / sin {r['proj_sin']:5.0f}"
                  f" · real {r['real']:5.0f} (VOR {r['vor_real']:4.0f}) · #con {int(r['rank_con']):>2} #sin {int(r['rank_sin']):>2} · {marca}"
                  + ("  <- top real" if pid in top_real else ""))
        # Y A CUALQUIER EDAD: la curva del RB empieza a bajar a los 25,5, así que
        # mirar sólo a los de 29+ deja fuera la mitad de lo que mueve. Todos los
        # RB cuya pertenencia al top-k cambia entre con y sin curva, con su VOR.
        flips = rb[(rb.index.isin(top_con)) != (rb.index.isin(top_sin))]
        print(f"  CAMBIAN de top-{k} por la curva, a cualquier edad: {len(flips)}")
        for pid, r in flips.sort_values("vor_real", ascending=False).iterrows():
            sentido = "ENTRA por la curva" if pid in top_con else "SALE por la curva"
            print(f"    {names.get(pid, pid):<14} {r['age']:.0f} años · factor {r['age_factor']:.2f} · "
                  f"real {r['real']:5.0f} (VOR {r['vor_real']:4.0f}) · #con {int(r['rank_con']):>2} #sin {int(r['rank_sin']):>2} · {sentido}")
        entra = flips[flips.index.isin(top_con)]["vor_real"].sum()
        sale = flips[~flips.index.isin(top_con)]["vor_real"].sum()
        print(f"  VOR neto de la curva en el top-{k}: entra {entra:.0f} − sale {sale:.0f} = {entra - sale:+.0f} ({(entra - sale) / best:+.3f})")
        filas.append(dict(season=season, old=len(old), beat=int(old["beat"].sum()), sacados=len(sacados),
                          coste=coste, cero=ahorro_n, share_coste=coste / best, flips=len(flips),
                          neto=(entra - sale) / best))
    print("\n=== RESUMEN RB 29+ ===")
    print(pd.DataFrame(filas).to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
