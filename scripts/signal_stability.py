#!/usr/bin/env python3
"""FIX #3, fase 1: ¿qué señales de ROL persisten de un año al siguiente?

Sólo mide. No toca el modelo. Para cada señal y posición: cobertura por
temporada y autocorrelación año-sobre-año (Pearson y Spearman) entre la
temporada t y la t+1 del MISMO jugador, con un mínimo de partidos en las dos.

    La cuota de objetivos persiste; los touchdowns en zona roja, no tanto.
    Eso es una hipótesis: aquí se mide.

La comparación que importa es contra la persistencia de los PUNTOS POR
PARTIDO, que es lo que el modelo ya proyecta: una señal que persiste MENOS que
los puntos no puede aportar orden; una que persiste más, quizá.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from oracle.config import paths as resolve_paths

POS = ("QB", "RB", "WR", "TE")
MIN_GAMES = 8
FIRST = 2006          # `targets` es 0 y no nulo en 2003-2008 (ingest.py): se empieza donde hay aire


def red_zone(paths, seasons):
    """Objetivos y acarreos dentro de la 20 y de la 10, por jugador-temporada, desde el pbp."""
    frames = []
    cols = ["season", "week", "season_type", "play_type", "yardline_100", "receiver_player_id",
            "rusher_player_id", "posteam", "air_yards", "pass", "rush", "xpass", "pass_oe"]
    for s in seasons:
        p = paths.raw / f"pbp_{s}.parquet"
        if not p.exists():
            continue
        pbp = pd.read_parquet(p, columns=cols)
        pbp = pbp[(pbp["season_type"] == "REG") & pbp["play_type"].isin(["pass", "run"])]
        rz = pbp[pbp["yardline_100"] <= 20]
        i10 = pbp[pbp["yardline_100"] <= 10]
        t = rz.groupby("receiver_player_id").size().rename("rz_targets")
        c = rz.groupby("rusher_player_id").size().rename("rz_carries")
        t10 = i10.groupby("receiver_player_id").size().rename("i10_targets")
        c10 = i10.groupby("rusher_player_id").size().rename("i10_carries")
        f = pd.concat([t, c, t10, c10], axis=1).fillna(0.0)
        f["season"] = s
        f.index.name = "player_id"
        frames.append(f.reset_index())
        # Contexto de EQUIPO: pass rate over expected y ritmo.
        team = pbp.groupby("posteam").agg(plays=("play_type", "size"),
                                          pass_rate=("pass", "mean"),
                                          proe=("pass_oe", "mean"),
                                          xpass_cov=("xpass", lambda x: x.notna().mean()))
        team["season"] = s
        frames[-1] = (frames[-1], team.reset_index())
    players = pd.concat([a for a, _ in frames], ignore_index=True)
    teams = pd.concat([b for _, b in frames], ignore_index=True)
    return players, teams


def main() -> int:
    paths = resolve_paths(None).ensure()
    pw = pd.read_parquet(paths.player_weeks)
    pw = pw[(pw["season_type"] == "REG") & pw["position"].isin(POS) & (pw["season"] >= FIRST)].copy()

    # --- cobertura por temporada de cada columna que interesa ---------------
    print("=== COBERTURA (fracción no nula / fracción no cero) por temporada ===")
    cols = ["targets", "target_share", "air_yards_share", "receiving_air_yards", "wopr", "racr",
            "carries", "receiving_epa", "rushing_epa", "passing_cpoe", "passing_air_yards"]
    cov = pw.groupby("season")[cols].agg(lambda x: f"{x.notna().mean():.2f}/{(x.fillna(0)!=0).mean():.2f}")
    print(cov.to_string())

    # --- señales de temporada por jugador --------------------------------------
    # Cuotas calculadas sobre el total del EQUIPO en cada partido (sumando a todos
    # los jugadores de ese equipo-semana): es la lección de weekly.py, el
    # denominador es el equipo, no la suma de medias.
    team_week = pw.groupby(["season", "team", "week"]).agg(team_targets=("targets", "sum"),
                                                          team_carries=("carries", "sum"),
                                                          team_air=("receiving_air_yards", "sum"))
    pw = pw.join(team_week, on=["season", "team", "week"])
    g = pw.groupby(["player_id", "season", "position"])
    s = g.agg(games=("week", "nunique"),
              targets=("targets", "sum"), team_targets=("team_targets", "sum"),
              carries=("carries", "sum"), team_carries=("team_carries", "sum"),
              air=("receiving_air_yards", "sum"), team_air=("team_air", "sum"),
              rec_tds=("receiving_tds", "sum"), rush_tds=("rushing_tds", "sum"),
              rec=("receptions", "sum"), rec_yds=("receiving_yards", "sum"),
              rush_yds=("rushing_yards", "sum"),
              ppr=("fantasy_points_ppr", "sum")).reset_index()
    s["target_share"] = s["targets"] / s["team_targets"].replace(0, np.nan)
    s["carry_share"] = s["carries"] / s["team_carries"].replace(0, np.nan)
    s["air_share"] = s["air"] / s["team_air"].replace(0, np.nan)
    s["adot"] = s["air"] / s["targets"].replace(0, np.nan)
    s["yprr_proxy"] = s["rec_yds"] / s["targets"].replace(0, np.nan)     # yardas por objetivo
    s["ypc"] = s["rush_yds"] / s["carries"].replace(0, np.nan)
    s["td_per_touch"] = (s["rec_tds"] + s["rush_tds"]) / (s["targets"] + s["carries"]).replace(0, np.nan)
    s["ppg"] = s["ppr"] / s["games"]
    s["opp_pg"] = (s["targets"] + s["carries"]) / s["games"]           # oportunidades por partido

    rz, teams = red_zone(paths, sorted(s["season"].unique()))
    s = s.merge(rz, on=["player_id", "season"], how="left")
    for c in ["rz_targets", "rz_carries", "i10_targets", "i10_carries"]:
        s[c] = s[c].fillna(0.0)
    s["rz_touch_share_pg"] = (s["rz_targets"] + s["rz_carries"]) / s["games"]
    s["rz_td_rate"] = (s["rec_tds"] + s["rush_tds"]) / (s["rz_targets"] + s["rz_carries"]).replace(0, np.nan)

    print("\n=== CONTEXTO DE EQUIPO: cobertura de xpass/pass_oe por temporada ===")
    print(teams.groupby("season")["xpass_cov"].mean().round(2).to_string())

    # --- autocorrelación año a año ----------------------------------------------
    signals = ["ppg", "opp_pg", "target_share", "carry_share", "air_share", "adot", "yprr_proxy",
               "ypc", "td_per_touch", "rz_touch_share_pg", "rz_td_rate", "rz_targets", "rz_carries"]
    s = s[s["games"] >= MIN_GAMES]
    nxt = s.copy()
    nxt["season"] -= 1
    pair = s.merge(nxt, on=["player_id", "season", "position"], suffixes=("", "_next"))
    print(f"\n=== AUTOCORRELACIÓN t -> t+1, mismo jugador, >= {MIN_GAMES} partidos en ambas, {FIRST}-2025 ===")
    print(f"{'señal':<18}" + "".join(f"{p:>22}" for p in POS))
    print(f"{'':<18}" + "".join(f"{'r / rho / n':>22}" for _ in POS))
    out = []
    for sig in signals:
        row = f"{sig:<18}"
        for p in POS:
            d = pair[(pair["position"] == p)][[sig, sig + "_next"]].replace([np.inf, -np.inf], np.nan).dropna()
            if len(d) < 50:
                row += f"{'—':>22}"
                continue
            r = pearsonr(d[sig], d[sig + "_next"]).statistic
            rho = spearmanr(d[sig], d[sig + "_next"]).statistic
            row += f"{r:6.2f} {rho:6.2f} {len(d):6d}   "
            out.append(dict(signal=sig, position=p, pearson=r, spearman=rho, n=len(d)))
        print(row)
    pd.DataFrame(out).to_csv(paths.out / "signal_stability.csv", index=False)

    # --- ¿la señal de rol del año t predice los PUNTOS del año t+1 mejor que los puntos? ---
    print("\n=== PREDICCIÓN CRUZADA: Spearman(señal_t, ppg_t+1), por posición ===")
    print(f"{'señal_t':<18}" + "".join(f"{p:>10}" for p in POS))
    for sig in ["ppg", "opp_pg", "target_share", "carry_share", "air_share", "rz_touch_share_pg", "td_per_touch"]:
        row = f"{sig:<18}"
        for p in POS:
            d = pair[pair["position"] == p][[sig, "ppg_next"]].replace([np.inf, -np.inf], np.nan).dropna()
            row += f"{spearmanr(d[sig], d['ppg_next']).statistic:10.2f}" if len(d) >= 50 else f"{'—':>10}"
        print(row)
    # --- LO QUE DECIDE: ¿añade la señal algo que los puntos del año t no tengan? ---
    # Correlación parcial de Spearman entre señal_t y ppg_t+1 CONTROLANDO por
    # ppg_t, y la ganancia de R² de una regresión lineal ppg_t+1 ~ ppg_t + señal_t
    # frente a ppg_t+1 ~ ppg_t. El modelo de draft ya conoce los puntos; una señal
    # que no añade nada sobre ellos no puede mover el orden por muy estable que sea.
    print("\n=== INCREMENTO SOBRE ppg_t: parcial Spearman | ΔR² lineal (ppg_t+1 ~ ppg_t [+ señal_t]) ===")
    print(f"{'señal_t':<18}" + "".join(f"{p:>16}" for p in POS))

    def _rank(x):
        return pd.Series(x).rank().to_numpy(dtype=float)

    def partial(a, b, c):
        ra, rb, rc = _rank(a), _rank(b), _rank(c)
        ra = ra - np.polyval(np.polyfit(rc, ra, 1), rc)
        rb = rb - np.polyval(np.polyfit(rc, rb, 1), rc)
        return float(np.corrcoef(ra, rb)[0, 1])

    def delta_r2(y, x1, x2):
        X1 = np.column_stack([np.ones_like(x1), x1])
        X2 = np.column_stack([np.ones_like(x1), x1, x2])
        r1 = 1 - ((y - X1 @ np.linalg.lstsq(X1, y, rcond=None)[0]) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        r2 = 1 - ((y - X2 @ np.linalg.lstsq(X2, y, rcond=None)[0]) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        return r1, r2

    for sig in ["opp_pg", "target_share", "carry_share", "air_share", "adot", "rz_touch_share_pg",
                "rz_carries", "rz_targets", "td_per_touch", "rz_td_rate"]:
        row = f"{sig:<18}"
        for p in POS:
            d = pair[pair["position"] == p][[sig, "ppg", "ppg_next"]].replace([np.inf, -np.inf], np.nan).dropna()
            if len(d) < 50:
                row += f"{'—':>16}"
                continue
            pr = partial(d[sig].to_numpy(), d["ppg_next"].to_numpy(), d["ppg"].to_numpy())
            r1, r2 = delta_r2(d["ppg_next"].to_numpy(float), d["ppg"].to_numpy(float), d[sig].to_numpy(float))
            row += f"{pr:6.2f} {r2 - r1:+6.3f}   "
        print(row)

    # --- contexto de equipo: ¿persiste año a año? ------------------------------
    t = teams.copy()
    t["plays_pg"] = t["plays"] / 17.0
    nxt_t = t.copy()
    nxt_t["season"] -= 1
    tp = t.merge(nxt_t, on=["posteam", "season"], suffixes=("", "_next"))
    print("\n=== EQUIPO t -> t+1 (mismo equipo): r / rho / n ===")
    for sig in ["pass_rate", "proe", "plays"]:
        d = tp[[sig, sig + "_next"]].dropna()
        print(f"{sig:<12} {pearsonr(d[sig], d[sig + '_next']).statistic:6.2f} "
              f"{spearmanr(d[sig], d[sig + '_next']).statistic:6.2f} {len(d):6d}")

    print(f"\nEscrito {paths.out / 'signal_stability.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
