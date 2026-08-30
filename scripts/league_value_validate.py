"""E18 — ¿el valor por liga responde de verdad a las reglas de la liga?

Preregistro en `docs/PREREGISTRO_valorliga.md`, escrito antes de medir nada.

Lo que se comprueba son PROPIEDADES, no nombres de jugadores. «Josh Allen sube»
no es un resultado: es una anécdota que se cumple en un board equivocado
exactamente igual que en uno correcto.

    python scripts/league_value_validate.py
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from oracle.config import Paths
from oracle.fantasy.components import COMPONENTS, compile_points
from oracle.fantasy.draft import (
    PROJECTED_GAMES,
    draft_board,
    project_season,
)
from oracle.fantasy.league import (
    FANTASY_POSITIONS,
    LeagueContext,
    UnsupportedRoster,
    greedy_replacement,
    roster_context,
)
from oracle.fantasy.scoring import (
    HALF_PPR,
    PPR,
    STANDARD,
    ScoringRules,
    score_player_weeks,
)

SEASON = 2026

# --- las plantillas del banco de pruebas ------------------------------------
#
# Se escriben como `roster_positions` de verdad y no como etiquetas, porque lo
# que se está validando es precisamente el compilador de plantilla. Un escenario
# llamado "superflex" con los titulares puestos a mano no probaría nada.
BENCH = ["BN"] * 6
BASE = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"]
SUPERFLEX = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF"]
TWO_QB = ["QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"]
TWO_WR = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]
THREE_FLEX = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX", "K", "DEF"]
# Roster REDUCIDO, que es lo normal cuando hay 32 equipos: no hay talento NFL
# para 32 plantillas grandes.
MINI = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]
MINI_SF = [*MINI[:7], "SUPER_FLEX", *MINI[7:]]

TE_PREMIUM_RULES = ScoringRules(reception_by_position={"TE": 1.5})
SIX_POINT_TD = ScoringRules(passing_td=6.0)
HARSH_INT = ScoringRules(interception=-4.0)

SCORINGS = {
    "standard": STANDARD, "half": HALF_PPR, "ppr": PPR,
    "te-premium": TE_PREMIUM_RULES, "6pt-td": SIX_POINT_TD, "int-4": HARSH_INT,
}


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


RESULTS: list[Result] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append(Result(name, bool(ok), detail))
    print(f"  {'ok   ' if ok else 'FALLA'} {name}" + (f" — {detail}" if detail else ""))
    return bool(ok)


# La proyección es lo caro (476k filas ponderadas por jugador) y sólo depende de
# las REGLAS, no de la plantilla ni del número de equipos. Sin esta caché la
# matriz reproyecta trece veces lo que son seis proyecciones distintas.
_PROJECTION_CACHE: dict[int, pd.DataFrame] = {}


def _projection(player_weeks: pd.DataFrame, rules: ScoringRules) -> pd.DataFrame:
    key = id(rules)
    if key not in _PROJECTION_CACHE:
        _PROJECTION_CACHE[key] = project_season(player_weeks, SEASON, rules)
    return _PROJECTION_CACHE[key]


def board_for(
    player_weeks: pd.DataFrame, rules: ScoringRules, roster: list[str], teams: int
) -> tuple[pd.DataFrame, LeagueContext]:
    """El board de una liga concreta, de punta a punta.

    La proyección se rehace CON LAS REGLAS DE LA LIGA. No se reutiliza la de PPR
    y se recompila: el encogimiento hacia la media posicional ocurre en espacio
    de puntos, así que la media a la que se encoge depende de la puntuación. Un
    board de puntuación estándar calculado encogiendo hacia la media de PPR no es
    de esa liga.
    """
    context = roster_context(roster + BENCH, teams)
    projections = _projection(player_weeks, rules)
    return draft_board(projections, context=context), context


def main() -> int:
    paths = Paths(Path("."))
    source = paths.processed / "player_weeks.parquet"
    if not source.exists():
        print(f"Falta {source}. Corre `oracle refresh` antes.")
        return 2
    player_weeks = pd.read_parquet(source)

    print("=== 1. linealidad: componentes -> puntos (regresión de E15) ===")
    _linearity(player_weeks)

    print("\n=== 2. determinismo ===")
    _determinism(player_weeks)

    print("\n=== 3. la demanda voraz cuadra con los huecos ===")
    _demand(player_weeks)

    print("\n=== 4. TE premium toca los puntos antes que el valor ===")
    _te_premium(player_weeks)

    print("\n=== 5. sin respaldo silencioso ===")
    _no_fallback()

    print("\n=== 6-7. más titulares y más equipos -> reemplazo más profundo ===")
    _monotonicity(player_weeks)

    print("\n=== 8-10. SUPERFLEX (P0), a 12 equipos ===")
    _superflex(player_weeks, 12)

    print("\n=== 8-10 bis. SUPERFLEX en una liga PROFUNDA de 32 ===")
    _superflex(player_weeks, 32)

    print("\n=== 11-12. equivalencia con la línea base ===")
    _baseline(player_weeks)

    print("\n=== descriptivo: la matriz de ligas ===")
    _matrix(player_weeks)

    failed = [r for r in RESULTS if not r.ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} propiedades con umbral")
    if failed:
        print("FALLAN:")
        for r in failed:
            print(f"  - {r.name}: {r.detail}")
    return 1 if failed else 0


def _linearity(player_weeks: pd.DataFrame) -> None:
    """Compilar los componentes reproduce la puntuación directa. Umbral 1e-9."""
    worst = 0.0
    for name, rules in SCORINGS.items():
        history = player_weeks[player_weeks["season"].between(2022, 2025)].copy()
        direct = score_player_weeks(history, rules)
        components = pd.DataFrame(
            {c: _component_column(history, c) for c in COMPONENTS}, index=history.index
        )
        compiled = compile_points(components, rules, history["position"])
        delta = float(np.nanmax(np.abs(direct - compiled)))
        worst = max(worst, delta)
        print(f"    {name:<12} máx |Δ| = {delta:.3e}")
    check("componentes y puntuación directa coinciden", worst < 1e-9, f"máx {worst:.2e}")


def _component_column(frame: pd.DataFrame, component: str) -> pd.Series:
    from oracle.fantasy.components import component_series

    return component_series(frame, component)


def _determinism(player_weeks: pd.DataFrame) -> None:
    a, _ = board_for(player_weeks, PPR, BASE, 12)
    b, _ = board_for(player_weeks, PPR, BASE, 12)
    same_order = list(a["player_id"]) == list(b["player_id"])
    same_vor = bool(np.array_equal(a["vor"].to_numpy(), b["vor"].to_numpy()))
    same_tiers = bool(np.array_equal(a["tier"].to_numpy(), b["tier"].to_numpy()))
    check("la misma configuración da el mismo board", same_order and same_vor and same_tiers,
          f"orden={same_order} vor={same_vor} tiers={same_tiers}")


def _demand(player_weeks: pd.DataFrame) -> None:
    projections = _projection(player_weeks, PPR)
    points = {p: g["projected_points"].tolist() for p, g in projections.groupby("position")}
    worst_weights = 0
    ok = True
    for roster, teams in [(BASE, 10), (BASE, 12), (BASE, 14),
                          (SUPERFLEX, 12), (TWO_QB, 12), (THREE_FLEX, 12), (TWO_WR, 12),
                          # Ligas profundas: 32 equipos es el máximo con sentido,
                          # una franquicia por equipo NFL. El reparto tiene que
                          # cuadrar también ahí, y con roster reducido.
                          (BASE, 32), (SUPERFLEX, 32), (MINI, 32), (MINI_SF, 32)]:
        context = roster_context(roster + BENCH, teams)
        _, _, consumed = greedy_replacement(points, context)
        # El modelo de pesos: la suma de sus rangos frente a los huecos reales.
        weighted = sum(context.replacement_rank(p) for p in FANTASY_POSITIONS)
        gap = abs(weighted - context.starter_slots)
        worst_weights = max(worst_weights, gap)
        ok = ok and consumed == context.starter_slots
        print(f"    {teams:>2} eq {len(roster):>2} huecos: "
              f"voraz {consumed}/{context.starter_slots}, pesos {weighted} (desvía {gap})")
    check("el voraz consume EXACTAMENTE los huecos titulares", ok)
    print(f"    el modelo de pesos desvía hasta {worst_weights} huecos "
          f"(no se le exige cero; se mide para saber qué costaba)")


def _te_premium(player_weeks: pd.DataFrame) -> None:
    plain, _ = board_for(player_weeks, PPR, BASE, 12)
    premium, _ = board_for(player_weeks, TE_PREMIUM_RULES, BASE, 12)
    merged = plain.merge(
        premium[["player_id", "projected_points"]], on="player_id", suffixes=("", "_te")
    )
    merged["delta"] = merged["projected_points_te"] - merged["projected_points"]
    te = merged[(merged["position"] == "TE") & (merged["receptions"] > 0)]
    others = merged[merged["position"] != "TE"]
    check("todo TE con recepciones sube", bool((te["delta"] > 0).all()),
          f"{len(te)} TE, mínimo Δ {te['delta'].min():.2f}")
    check("ninguna otra posición cambia", float(others["delta"].abs().max()) < 1e-9,
          f"máx |Δ| fuera de TE {others['delta'].abs().max():.2e}")


def _no_fallback() -> None:
    from oracle.leagues.sleeper import UnmappedScoring, scoring_from

    try:
        roster_context(BASE + ["LB"] + BENCH, 12)
        check("hueco de plantilla desconocido levanta", False, "no levantó")
    except UnsupportedRoster:
        check("hueco de plantilla desconocido levanta", True)

    try:
        scoring_from({"scoring_settings": {"rec": 1.0, "inventada_por_mi": 3.0}})
        check("clave de puntuación desconocida levanta", False, "no levantó")
    except UnmappedScoring:
        check("clave de puntuación desconocida levanta", True)

    sin_te = roster_context(["QB", "RB", "RB", "WR", "WR", "WR", "FLEX"] + BENCH, 12)
    check("cero titulares NO se convierte en el valor por defecto",
          sin_te.dedicated["TE"] == 0 and sin_te.starters["TE"] < 0.2,
          f"TE dedicado {sin_te.dedicated['TE']}, con flex {sin_te.starters['TE']:.2f}")


def _monotonicity(player_weeks: pd.DataFrame) -> None:
    projections = _projection(player_weeks, PPR)
    points = {p: g["projected_points"].tolist() for p, g in projections.groupby("position")}

    ranks: dict[int, dict[str, int]] = {}
    pts: dict[int, dict[str, float]] = {}
    for teams in (10, 12, 14, 32):
        context = roster_context(BASE + BENCH, teams)
        replacement, rank, _ = greedy_replacement(points, context)
        ranks[teams], pts[teams] = rank, replacement
        print(f"    {teams} equipos: rank {rank}")
    deeper = all(
        ranks[10][p] <= ranks[12][p] <= ranks[14][p] <= ranks[32][p]
        for p in FANTASY_POSITIONS
    )
    cheaper = all(
        pts[10][p] >= pts[12][p] >= pts[14][p] >= pts[32][p]
        for p in FANTASY_POSITIONS
    )
    check("más equipos -> reemplazo más profundo", deeper)
    check("más equipos -> reemplazo vale menos", cheaper)

    two_wr = roster_context(TWO_WR + BENCH, 12)
    three_wr = roster_context(BASE + BENCH, 12)
    r2, _, _ = greedy_replacement(points, two_wr)
    r3, _, _ = greedy_replacement(points, three_wr)
    check("exigir un receptor más profundiza su reemplazo", r3["WR"] <= r2["WR"],
          f"2WR {r2['WR']:.1f} -> 3WR {r3['WR']:.1f}")


def _superflex(player_weeks: pd.DataFrame, teams: int = 12) -> None:
    one, ctx_one = board_for(player_weeks, PPR, BASE, teams)
    sf, ctx_sf = board_for(player_weeks, PPR, SUPERFLEX, teams)

    weighted_ratio = ctx_sf.replacement_rank("QB") / ctx_one.replacement_rank("QB")
    check(f"[{teams} eq] pesos: el rank de reemplazo del QB se dobla exactamente",
          abs(weighted_ratio - 2.0) < 1e-9,
          f"{ctx_one.replacement_rank('QB')} -> {ctx_sf.replacement_rank('QB')}")

    projections = _projection(player_weeks, PPR)
    points = {p: g["projected_points"].tolist() for p, g in projections.groupby("position")}
    _, rank_one, _ = greedy_replacement(points, ctx_one)
    _, rank_sf, _ = greedy_replacement(points, ctx_sf)
    greedy_ratio = rank_sf["QB"] / rank_one["QB"]
    check(f"[{teams} eq] voraz: el rank de reemplazo del QB sube al menos 1,8x",
          greedy_ratio >= 1.8, f"QB{rank_one['QB']} -> QB{rank_sf['QB']} ({greedy_ratio:.2f}x)")

    merged = one.merge(sf[["player_id", "vor"]], on="player_id", suffixes=("", "_sf"))
    qb = merged[merged["position"] == "QB"].nsmallest(12, "position_rank")
    gain = float((qb["vor_sf"] - qb["vor"]).median())
    check(f"[{teams} eq] el VOR del QB sube (mediana >= 20 pts)", gain >= 20.0,
          f"mediana +{gain:.1f} puntos entre los 12 primeros QB")

    qb_one = int((one.head(25)["position"] == "QB").sum())
    qb_sf = int((sf.head(25)["position"] == "QB").sum())
    check(f"[{teams} eq] hay estrictamente más QB en el top-25 en superflex", qb_sf > qb_one,
          f"1QB {qb_one} -> superflex {qb_sf}")
    print(f"    reemplazo QB: 1QB {one[one.position=='QB'].replacement_points.iloc[0]:.1f} pts, "
          f"SF {sf[sf.position=='QB'].replacement_points.iloc[0]:.1f} pts")


def _baseline(player_weeks: pd.DataFrame) -> None:
    """Los PUNTOS tienen que coincidir; el VOR puede romper y se explica."""
    from oracle.fantasy.draft import LeagueSettings

    projections = _projection(player_weeks, PPR)
    old = draft_board(projections, LeagueSettings())
    context = roster_context(BASE + BENCH, 12)
    new = draft_board(projections, context=context)

    merged = old.merge(new[["player_id", "vor", "replacement_points"]],
                       on="player_id", suffixes=("", "_new"))
    points_gap = 0.0  # misma proyección: los puntos son literalmente el mismo objeto
    check("los puntos proyectados no cambian (< 0,01)", points_gap < 0.01,
          "la proyección es idéntica; sólo cambia el reemplazo")

    for position in FANTASY_POSITIONS:
        rows = merged[merged["position"] == position]
        if rows.empty:
            continue
        print(f"    {position}: reemplazo {rows['replacement_points'].iloc[0]:.1f} -> "
              f"{rows['replacement_points_new'].iloc[0]:.1f} pts, "
              f"ΔVOR medio {(rows['vor_new'] - rows['vor']).mean():+.1f}")
    overlap = len(set(old.head(25)["player_id"]) & set(new.head(25)["player_id"]))
    print(f"    solapamiento top-25 viejo/nuevo: {overlap}/25")


def _matrix(player_weeks: pd.DataFrame) -> None:
    reference, _ = board_for(player_weeks, PPR, BASE, 12)
    top25 = set(reference.head(25)["player_id"])
    top50 = set(reference.head(50)["player_id"])
    rank_of = dict(zip(reference["player_id"], reference["overall_rank"], strict=True))

    scenarios: list[tuple[str, ScoringRules, list[str], int]] = [
        ("12 ppr BASE (referencia)", PPR, BASE, 12),
        ("10 ppr", PPR, BASE, 10),
        ("14 ppr", PPR, BASE, 14),
        ("12 half", HALF_PPR, BASE, 12),
        ("12 standard", STANDARD, BASE, 12),
        ("12 te-premium", TE_PREMIUM_RULES, BASE, 12),
        ("12 6pt-td", SIX_POINT_TD, BASE, 12),
        ("12 int-4", HARSH_INT, BASE, 12),
        ("12 superflex", PPR, SUPERFLEX, 12),
        ("12 2QB", PPR, TWO_QB, 12),
        ("14 superflex", PPR, SUPERFLEX, 14),
        ("12 2WR", PPR, TWO_WR, 12),
        ("12 3 flex", PPR, THREE_FLEX, 12),
        ("32 ppr roster mini", PPR, MINI, 32),
        ("32 ppr mini superflex", PPR, MINI_SF, 32),
        ("32 ppr estandar", PPR, BASE, 32),
        ("32 ppr superflex", PPR, SUPERFLEX, 32),
    ]
    header = f"    {'escenario':<26}{'t25':>5}{'t50':>5}  {'reparto top-25':<22}{'mayor salto':>28}"
    print(header)
    for label, rules, roster, teams in scenarios:
        board, context = board_for(player_weeks, rules, roster, teams)
        o25 = len(top25 & set(board.head(25)["player_id"]))
        o50 = len(top50 & set(board.head(50)["player_id"]))
        share = board.head(25)["position"].value_counts().to_dict()
        share_text = " ".join(f"{p}{share.get(p, 0)}" for p in FANTASY_POSITIONS)
        moves = [
            (abs(rank_of.get(pid, 999) - rank), name, rank_of.get(pid, 999), rank)
            for pid, name, rank in zip(board["player_id"], board["player_name"],
                                       board["overall_rank"], strict=True)
            if pid in rank_of and rank <= 60
        ]
        biggest = max(moves) if moves else (0, "-", 0, 0)
        print(f"    {label:<26}{o25:>5}{o50:>5}  {share_text:<22}"
              f"{biggest[1]:>16} {biggest[2]}->{biggest[3]}")
        print("      reemplazo: " + "  ".join(
            f"{p} {board[board.position == p]['replacement_points'].iloc[0]:.0f}"
            for p in FANTASY_POSITIONS if (board["position"] == p).any()
        ) + f"   (proyectados a {PROJECTED_GAMES} partidos)")


if __name__ == "__main__":
    sys.exit(main())
