#!/usr/bin/env python3
"""FIX #3, fase 1: ¿el VOLUMEN VACANTE del equipo, conocido en agosto, predice algo?

Diagnóstico, no modelo. Para cada equipo y temporada S:

    vacante_S = cuota de objetivos (y de acarreos) de S-1 que se llevaron
                jugadores que NO están en la plantilla de S.

Se calcula con la plantilla de S tal como la publica nflverse en su primera
semana, que es lo que se sabe al draftear, y con los partidos de S-1. Ni un
snap de S. Luego se pregunta, por posición: ¿la vacante del equipo al que
pertenece un jugador en S añade algo a sus puntos de S-1 para predecir los de S?
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from oracle.config import paths as resolve_paths
from oracle.data.ingest import normalize_team_series

POS = ("RB", "WR", "TE")
FIRST, LAST = 2010, 2025


def _movers_size(pop: pd.DataFrame) -> None:
    """Cuántos se mueven, y cuánto rinden por debajo de su ppg previo. Para dimensionar E22."""
    print("\n=== LOS QUE CAMBIAN DE EQUIPO: tamaño y magnitud ===")
    top = pop[pop["ppg_prev"] >= pop.groupby(["season", "position"])["ppg_prev"].transform(
        lambda x: x.quantile(0.5))]   # la mitad alta por ppg previo: los que se draftean
    for p in POS:
        d = top[top["position"] == p].copy()
        share = d["moved"].mean()
        # Residuo de ppr_S sobre una recta en ppg_prev, por grupo.
        coef = np.polyfit(d["ppg_prev"], d["ppr"], 1)
        d["resid"] = d["ppr"] - np.polyval(coef, d["ppg_prev"])
        mv, st = d[d["moved"]]["resid"], d[~d["moved"]]["resid"]
        print(f"  {p}: cambian {share:.0%} (n={int(d['moved'].sum())}) · residuo medio movers {mv.mean():+6.1f} "
              f"vs stayers {st.mean():+6.1f} · diferencia {mv.mean() - st.mean():+6.1f} pts")


def _dispersion_and_interaction(pop: pd.DataFrame) -> None:
    """Las dos preguntas antes de E22: dispersión del efecto e interacción con la vacante.

    Un castigo plano acierta en promedio y falla en cada jugador si la desviación
    del residuo entre movers es del tamaño del efecto o mayor. Y si mover duele,
    debería doler MENOS a quien llega a un hueco: eso es una interacción
    mover × vacante, no un efecto principal.
    """
    print("\n=== DISPERSIÓN del residuo (ppr_S sobre recta en ppg_prev), mitad alta por ppg previo ===")
    top = pop[pop["ppg_prev"] >= pop.groupby(["season", "position"])["ppg_prev"].transform(
        lambda x: x.quantile(0.5))].copy()
    for p in POS:
        d = top[top["position"] == p].copy()
        coef = np.polyfit(d["ppg_prev"], d["ppr"], 1)
        d["resid"] = d["ppr"] - np.polyval(coef, d["ppg_prev"])
        mv, st = d[d["moved"]]["resid"], d[~d["moved"]]["resid"]
        print(f"  {p}: movers media {mv.mean():+6.1f} sd {mv.std():5.1f} IQR [{mv.quantile(.25):+6.1f}, {mv.quantile(.75):+6.1f}] "
              f"negativos {(mv < 0).mean():.0%} · stayers sd {st.std():5.1f} · efecto/sd = {abs(mv.mean() - st.mean()) / mv.std():.2f}")
        # ¿Con qué se explica la dispersión entre movers? Correlación del residuo
        # con la vacante del destino, la cuota propia previa y su interacción.
        m = d[d["moved"]].copy()
        m["vac_x_room"] = m["vac_t"] * (1 - m["t_prev"].fillna(0)) if p != "RB" else m["vac_c"] * (1 - m["c_prev"].fillna(0))
        vac = "vac_c" if p == "RB" else "vac_t"
        own = "c_prev" if p == "RB" else "t_prev"
        for name in (vac, own, "vac_x_room"):
            x = m[[name, "resid"]].dropna()
            rho = spearmanr(x[name], x["resid"]).statistic if len(x) > 30 else float("nan")
            print(f"      resid ~ {name:<10} rho {rho:+.2f} (n={len(x)})")
        # Terciles de vacante del destino, entre movers: media del residuo.
        m["tercil"] = pd.qcut(m[vac].rank(method="first"), 3, labels=["baja", "media", "alta"])
        print("      residuo medio por tercil de vacante:", {k: round(v, 1) for k, v in m.groupby("tercil", observed=True)["resid"].mean().items()})

    print("\n=== INTERACCIÓN formal: ppr_S ~ ppg_prev + moved + vac + moved:vac (OLS, población entera) ===")
    for p in POS:
        d = top[top["position"] == p].copy()
        vac = "vac_c" if p == "RB" else "vac_t"
        d = d.dropna(subset=[vac])
        X = np.column_stack([np.ones(len(d)), d["ppg_prev"], d["moved"].astype(float), d[vac],
                             d["moved"].astype(float) * d[vac]])
        beta, *_ = np.linalg.lstsq(X, d["ppr"].to_numpy(float), rcond=None)
        resid = d["ppr"].to_numpy(float) - X @ beta
        se = np.sqrt(np.diag(np.linalg.pinv(X.T @ X)) * resid.var(ddof=X.shape[1]))
        print(f"  {p}: moved {beta[2]:+6.1f} (±{se[2]:.1f}) · vac {beta[3]:+6.1f} (±{se[3]:.1f}) · "
              f"moved×vac {beta[4]:+6.1f} (±{se[4]:.1f}) · n={len(d)}")


def main() -> int:
    paths = resolve_paths(None).ensure()
    pw = pd.read_parquet(paths.player_weeks)
    pw = pw[(pw["season_type"] == "REG") & (pw["season"] >= FIRST - 1)]
    pw["team"] = normalize_team_series(pw["team"])

    # Plantilla de S en su primera semana publicada: lo que se sabe en agosto.
    rosters = []
    for s in range(FIRST, LAST + 1):
        r = pd.read_parquet(paths.raw / f"roster_{s}.parquet",
                            columns=["season", "week", "team", "gsis_id", "position"])
        first = r["week"].min()
        r = r[r["week"] == first].dropna(subset=["gsis_id"])
        r["team"] = normalize_team_series(r["team"])
        rosters.append(r.assign(first_week=first))
    ros = pd.concat(rosters, ignore_index=True)
    print("primera semana publicada por temporada:",
          ros.groupby("season")["first_week"].first().to_dict())

    # Volumen de S-1 por jugador y equipo.
    vol = pw.groupby(["season", "team", "player_id"], observed=True).agg(
        targets=("targets", "sum"), carries=("carries", "sum"), games=("week", "nunique"),
        ppr=("fantasy_points_ppr", "sum")).reset_index()
    team_tot = vol.groupby(["season", "team"])[["targets", "carries"]].sum().rename(
        columns={"targets": "team_targets", "carries": "team_carries"})
    vol = vol.join(team_tot, on=["season", "team"])
    vol["t_share"] = vol["targets"] / vol["team_targets"].replace(0, np.nan)
    vol["c_share"] = vol["carries"] / vol["team_carries"].replace(0, np.nan)

    # Vacante de S: cuota de S-1 de quienes NO están en la plantilla de S de ese equipo.
    prev = vol.rename(columns={"season": "prev_season"})
    prev["season"] = prev["prev_season"] + 1
    on_roster = ros[["season", "team", "gsis_id"]].rename(columns={"gsis_id": "player_id"})
    on_roster["still"] = True
    prev = prev.merge(on_roster, on=["season", "team", "player_id"], how="left")
    prev["still"] = prev["still"].fillna(False).astype(bool)
    vac = prev.loc[~prev["still"]].groupby(["season", "team"]).agg(
        vac_t=("t_share", "sum"), vac_c=("c_share", "sum")).reset_index()
    print("\nvacante media por equipo-temporada: objetivos "
          f"{vac['vac_t'].mean():.2f} · acarreos {vac['vac_c'].mean():.2f} "
          f"(n={len(vac)}); p90 objetivos {vac['vac_t'].quantile(.9):.2f}")

    # Jugador en S: su equipo de S (plantilla), su cuota y puntos de S-1 (en el
    # equipo que fuera), y la vacante de SU equipo de S.
    me = ros.rename(columns={"gsis_id": "player_id"})[["season", "team", "player_id", "position"]]
    last = vol.groupby(["season", "player_id"]).agg(
        ppr_prev=("ppr", "sum"), g_prev=("games", "sum"), t_prev=("t_share", "max"),
        c_prev=("c_share", "max"), team_prev=("team", "last")).reset_index()
    last["season"] += 1
    me = me.merge(last, on=["season", "player_id"], how="left").merge(vac, on=["season", "team"], how="left")
    real = vol.groupby(["season", "player_id"]).agg(ppr=("ppr", "sum"), games=("games", "sum")).reset_index()
    me = me.merge(real, on=["season", "player_id"], how="left")
    me["ppr"] = me["ppr"].fillna(0.0)
    me["ppg_prev"] = me["ppr_prev"] / me["g_prev"]
    me["moved"] = (me["team_prev"].notna()) & (me["team_prev"] != me["team"])

    # Población: quien tenía historial (>= 8 partidos en S-1). Es la que el modelo proyecta.
    pop = me[(me["g_prev"] >= 8) & me["position"].isin(POS)].dropna(subset=["vac_t", "vac_c"]).copy()

    def _rank(x):
        return pd.Series(x).rank().to_numpy(dtype=float)

    def partial(a, b, c):
        ra, rb, rc = _rank(a), _rank(b), _rank(c)
        ra = ra - np.polyval(np.polyfit(rc, ra, 1), rc)
        rb = rb - np.polyval(np.polyfit(rc, rb, 1), rc)
        return float(np.corrcoef(ra, rb)[0, 1])

    print(f"\n=== Spearman parcial(señal, ppr_S | ppg_{{S-1}}), {FIRST}-{LAST}, >=8 partidos en S-1 ===")
    print(f"{'señal':<26}" + "".join(f"{p:>14}" for p in POS))
    filas = {
        "vac_t (equipo en S)": "vac_t", "vac_c (equipo en S)": "vac_c",
        "moved (cambió de equipo)": "moved", "t_prev (su cuota S-1)": "t_prev", "c_prev (su cuota S-1)": "c_prev",
    }
    for label, col in filas.items():
        row = f"{label:<26}"
        for p in POS:
            d = pop[pop["position"] == p][[col, "ppr", "ppg_prev"]].dropna()
            row += f"{partial(d[col].astype(float), d['ppr'], d['ppg_prev']):8.2f} n={len(d):<4}"
        print(row)

    # Interacción: la vacante sólo puede importar a quien puede absorberla. Cuota
    # propia baja + vacante alta = el caso Hampton/Lloyd.
    pop["absorb_t"] = pop["vac_t"] * (1 - pop["t_prev"].fillna(0))
    pop["absorb_c"] = pop["vac_c"] * (1 - pop["c_prev"].fillna(0))
    print("\n--- interacción vacante × (1 − cuota propia) ---")
    for col in ("absorb_t", "absorb_c"):
        row = f"{col:<26}"
        for p in POS:
            d = pop[pop["position"] == p][[col, "ppr", "ppg_prev"]].dropna()
            row += f"{partial(d[col], d['ppr'], d['ppg_prev']):8.2f} n={len(d):<4}"
        print(row)

    _movers_size(pop)
    _dispersion_and_interaction(pop)

    # Y sólo entre los que CAMBIARON de equipo, donde la historia propia vale menos.
    print("\n--- sólo los que cambiaron de equipo ---")
    for col in ("vac_t", "vac_c"):
        row = f"{col:<26}"
        for p in POS:
            d = pop[(pop["position"] == p) & pop["moved"]][[col, "ppr", "ppg_prev"]].dropna()
            row += (f"{partial(d[col], d['ppr'], d['ppg_prev']):8.2f} n={len(d):<4}" if len(d) >= 40
                    else f"{'—':>8} n={len(d):<4}")
        print(row)
    # Referencia: cuánto predice ppg_prev a secas.
    print("\nreferencia Spearman(ppg_prev, ppr_S):",
          {p: round(spearmanr(pop[pop.position == p]['ppg_prev'], pop[pop.position == p]['ppr']).statistic, 2)
           for p in POS})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
