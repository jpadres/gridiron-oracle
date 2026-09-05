# Revalidación sin playoffs — 5 de septiembre de 2026

Hasta hoy `fantasy_weekly_calibrate.py`, `fantasy_risk_validate.py` y
`fantasy_bust_validate.py` evaluaban también sobre jornadas de playoffs
(`season_type == "POST"`), que la fantasy no puntúa. Se filtraron con
`scoring.regular_season()` y se volvieron a correr. **Los umbrales son los
que ya estaban escritos en cada script; no se movió ninguno.**

| Script | Resultado con sólo temporada regular | Veredicto |
|---|---|---|
| `fantasy_bust_validate.py` | 1.863 jugador-temporadas 2016-2025; ECE 0,0505 (umbral ≤ 0,08); lift decil alto/bajo 5,15× (umbral ≥ 1,5) | PASA |
| `fantasy_risk_validate.py` | Spearman(riesgo, error normalizado) +0,208 (p = 4·10⁻²⁰); QB +0,493, TE +0,234, RB +0,193, WR +0,185; diferencia +24,4% (umbral ≥ 10%) | PASA |
| `fantasy_weekly_calibrate.py` | 2024-2025: RB Spearman 0,564 vs 0,555 y MAE 5,653 vs 5,728; WR 0,542 vs 0,535 y 5,107 vs 5,212; TE 0,336 vs 0,336 y 5,141 vs 5,203; QB 0,222 vs **0,239** y 6,604 vs 6,725 | «Bate al baseline en las cuatro posiciones: NO» — QB pierde en Spearman, como ya decía `START_SIT_QB = NOT_READY`; TE empata en Spearman y gana en MAE |

Lo que cambia en el registro de capacidades: nada de estado. Los veredictos
coinciden con los publicados; lo que se corrige es que ahora se midieron sobre
la competición que la fantasy puntúa.
