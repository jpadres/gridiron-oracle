# E11 sin playoffs — 5 de septiembre de 2026

`scripts/startsit_backtest.py` evaluaba 2024-2025 con jornadas de playoffs
dentro. Se filtró con `scoring.regular_season()` (que ahora FALLA CERRADO sin
la columna de etapa) y se volvió a correr con los umbrales de
`docs/PREREGISTRO_startsit.md`, sin tocarlos: bate a la forma reciente, IC
inferior por encima del 50%, alarma > 62%.

## Sin condicionar (incluye DNP) — la cifra que publica el registro

| pos | antes (con playoffs) n / modelo / forma | ahora (sólo REG) n / modelo / forma | veredicto |
|---|---|---|---|
| QB | 5.959 / 54,2% / **54,4%** | 5.884 / 53,5% / **54,6%** | sigue perdiendo → `START_SIT_QB` NOT_READY, sin cambio |
| RB | 8.294 / **53,9%** / 51,8% | 8.257 / **54,9%** / 52,7% | bate → VALIDATED, sin cambio |
| WR | 24.834 / **52,4%** / 48,6% | 24.224 / **52,0%** / 49,1% | bate → VALIDATED, sin cambio |
| TE | 3.267 / **51,7%** / 49,7% | 3.170 / **51,0%** / 49,4% | bate → VALIDATED, sin cambio |
| Total | 42.354 / 54,3%* / 50,1% | 41.535 / 52,7% / 50,6% | IC [52,2%, 53,2%] por encima del 50%; alarma no salta |

\* la cifra global «54,3%» del preregistro era la de los pares en que los
dos jugaron; sin condicionar era +2,8 pp. Ahora: +2,1 pp sin condicionar y
+0,1 pp condicionado a que jueguen (54,0% frente a 53,9%, IC [53,4%, 54,6%]).

## Los dos jugaron — sólo REG

| pos | n | modelo | forma |
|---|---|---|---|
| QB | 4.095 | 53,8% | **54,7%** |
| RB | 6.314 | **55,6%** | 54,8% |
| WR | 18.134 | 53,7% | **53,8%** |
| TE | 2.447 | **52,1%** | 51,6% |

Condicionado a que jueguen, el receptor EMPATA con la forma reciente (−0,1
pp). El registro publica la cifra sin condicionar, que es la decisión real
—un jugador que no juega es la decisión equivocada más cara—, y ahí el WR
sigue por delante (+2,9 pp). Se dice para que nadie lea la ventaja del
receptor como más grande de lo que es.

## Por tamaño de la diferencia (sólo REG)

| diferencia | n | acierto |
|---|---|---|
| 0–0,5 | 7.985 | 50,1% |
| 0,5–1 | 7.652 | 50,9% |
| 1–2 | 13.858 | 53,0% |
| 2–3 | 12.040 | 55,2% |
| 3–5 | 19.126 | 59,7% |
| 5+ | 26.499 | 67,0% |

Ningún estado del registro cambia. Cambian las cifras que lo sostienen, y
están propagadas al registro en el mismo commit.
