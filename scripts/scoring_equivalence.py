"""¿Reproducen los componentes los puntos, exactamente?

La afirmación de V2 bloque A es fuerte y por eso se mide en vez de razonarse:

    media_ponderada(puntuar(semanas)) == puntuar(medias_ponderadas(componentes))

La puntuación es lineal en las estadísticas y la media es lineal, así que las dos
cantidades son la MISMA. El umbral no es una tolerancia amable: es **cero** hasta
el epsilon de coma flotante. Si sale una diferencia real, es un componente que
falta o un alias contado dos veces, no «ruido de redondeo».
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from oracle.config import paths as project_paths  # noqa: E402
from oracle.fantasy.components import COMPONENTS, compile_points, weighted_components  # noqa: E402
from oracle.fantasy.scoring import (  # noqa: E402
    HALF_PPR,
    PPR,
    STANDARD,
    TE_PREMIUM,
    ScoringRules,
    score_player_weeks,
)

PROFILES: dict[str, ScoringRules] = {
    "PPR": PPR,
    "Half PPR": HALF_PPR,
    "Standard": STANDARD,
    "TE premium": TE_PREMIUM,
    "6-pt pass TD": ScoringRules(passing_td=6.0),
    "INT -1": ScoringRules(interception=-1.0),
    "0.5 rec + 6pt TD": ScoringRules(reception=0.5, passing_td=6.0),
}


def main() -> int:
    paths = project_paths()
    weeks = pd.read_parquet(paths.processed / "player_weeks.parquet")
    weeks = weeks[weeks["season"].between(2022, 2025)]
    weeks = weeks[weeks["position"].isin(("QB", "RB", "WR", "TE"))]
    print(f"{len(weeks):,} filas jugador-semana, 2022-2025\n")

    # Pesos arbitrarios pero no constantes: con pesos iguales la igualdad
    # saldría por un motivo más débil del que se quiere demostrar.
    rng = np.random.default_rng(0)
    weeks = weeks.assign(w=rng.uniform(0.2, 1.0, len(weeks)))

    worst = 0.0
    for name, rules in PROFILES.items():
        direct = []
        compiled_rows = []
        positions = []
        keys = []
        for (player_id, position), group in weeks.groupby(["player_id", "position"],
                                                          observed=True):
            weights = group["w"].to_numpy(dtype=float)
            total = weights.sum()
            if total <= 0:
                continue
            points = score_player_weeks(group, rules).to_numpy(dtype=float)
            direct.append(float((points * weights).sum() / total))
            compiled_rows.append(weighted_components(group, weights))
            positions.append(position)
            keys.append(player_id)

        components = pd.DataFrame(compiled_rows, index=keys)[list(COMPONENTS)]
        compiled = compile_points(components, rules, pd.Series(positions, index=keys))
        delta = np.abs(np.asarray(direct) - compiled.to_numpy())
        worst = max(worst, float(delta.max()))
        print(f"  {name:18s} n={len(delta):5d}  max |Δ| = {delta.max():.3e}  "
              f"media |Δ| = {delta.mean():.3e}")

    print(f"\nPeor diferencia sobre los {len(PROFILES)} perfiles: {worst:.3e}")
    # 1e-9 no es una tolerancia de modelado: es el epsilon acumulado de sumar
    # varios miles de flotantes. Una diferencia real sería de orden 0.1 o mayor.
    ok = worst < 1e-9
    print("EXACTO" if ok else "NO EQUIVALENTE — falta un componente o hay un alias duplicado")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
