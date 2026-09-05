# E8d — ¿De dónde sale el sesgo negativo del pateador? (preregistro)

**Escrito antes de correr nada.** E8c midió que la proyección del pateador va
BAJA: −0,66 puntos por partido de media y −1,25 en estadios con techo fijo o
retráctil (2022-2025, 2.108 pateador-semanas). Esto NO se arregla sumando
0,66: se investiga de dónde sale y se prueba fuera de muestra.

## Hipótesis, con lo que cada una predice

- **H1 — Tramos sin muestra.** `project()` omite los tramos de distancia cuya
  tasa de conversión no llega a 50 intentos en la calibración (los de 50+
  yardas y los de 0-19). Los intentos de esos tramos cuentan en el reparto
  pero no suman puntos: eso empuja hacia abajo por construcción. Predice
  sesgo negativo proporcional a la cuota de intentos en tramos omitidos.
- **H2 — Intentos no lineales en los puntos.** Los intentos de campo no crecen
  linealmente con los puntos del equipo (un equipo que marca 35 anota
  touchdowns, no patea más). Una recta ajustada sobre todo el rango
  subestima en el centro. Predice sesgo distinto por tercil de total.
- **H3 — Techo.** Bajo techo se convierte más y de más lejos. Tasas de
  conversión únicas de liga subestiman bajo techo. Predice que el sesgo bajo
  techo se reduce con tasas separadas.
- **H4 — Composición.** Las semanas de pateadores suplentes (pocos intentos)
  entran en la calibración con el mismo peso. Predice poco.

## Diseño

- Datos: `player_weeks` (sólo REG), `team_games`, `backtest_preds` — los
  mismos de `kicker_falsify.py`.
- Calibración walk-forward: para cada temporada de evaluación 2022-2025 se
  ajusta con TODAS las anteriores desde 2016. (E8c calibró con un bloque
  fijo; aquí se hace por temporada para no mirar el futuro.)
- Baseline: el modelo actual (`fit_opportunity` + `distance_mix` + `project`).
- Candidatos: C1 = H1 con tasa de tramo pequeño heredada del tramo vecino
  (no inventada: la del tramo contiguo con muestra); C2 = H2 con intentos
  cuadráticos en puntos; C3 = H3 con tasas de conversión por techo; C4 =
  C1+C3.
- Métricas OOS: MAE y sesgo (proyectado − real), global y bajo techo.

## Aceptación, fijada ahora

Un candidato se ADOPTA sólo si, fuera de muestra:

1. MAE no empeora en ninguna de las cuatro temporadas (≤ baseline + 0,02), y
2. |sesgo global| baja al menos a la mitad (≤ 0,33), y
3. el sesgo bajo techo baja en valor absoluto en al menos 3 de 4 temporadas.

Si ninguno cumple las tres: se mantiene el modelo y la limitación publicada.
Si uno cumple: se adopta ese, y **la autoridad del orden K1…K12 NO cambia**
(`KICKER_ORDINAL_RANKING` sigue REJECTED): calibrar el nivel no es ordenar.

## Resultado (mismo día)

Walk-forward 2022-2025, calibrando con 2016 hasta la temporada anterior
(`docs/evidence/kicker_bias_experiment.json`):

| candidato | MAE | sesgo | sesgo techo | MAE ≤ base+0,02 | techo mejor (temporadas) | ACEPTA |
|---|---|---|---|---|---|---|
| baseline (lineal) | 3,710 | −0,42 | −1,00 | — | — | — |
| C1 tramos vecinos | 3,710 | −0,37 | −0,95 | sí | 4/4 | no (sesgo > 0,33) |
| **C2 cuadrático (con meseta)** | 3,715 | **−0,11** | **−0,68** | sí | 4/4 | **SÍ** |
| C3 tasas por techo | 3,705 | −0,43 | −0,88 | sí | 4/4 | no |
| C4 C1+C3 | 3,706 | −0,37 | −0,81 | sí | 4/4 | no |

C2 cumple los tres criterios y se adopta en `kickers.py` (término
cuadrático en los puntos del equipo, con MESETA tras el vértice para que más
puntos nunca den menos intentos — la variante que se envía es la que se
re-evaluó). Lo que hay que leer: el MAE NO mejora (+0,005, dentro del margen
fijado); lo que mejora es el nivel. Recomprobado después con el bloque fijo
de E8c: sesgo global −0,39 (era −0,66) y −0,97 bajo techo (era −1,25); E8
(MAE 3,72 frente a 3,77 y 4,07) sigue batiendo a los dos baselines.
`KICKER_ORDINAL_RANKING` sigue REJECTED: calibrar el nivel no es ordenar.
