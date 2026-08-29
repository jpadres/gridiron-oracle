# Manifiesto de experimentos — Decision Lab

Bloque 0 del espec adversarial. **El estado congelado contra el que se mide todo
lo que venga después.** Si estos números cambian sin un experimento que lo
explique, algo se rompió.

## Estado congelado

**Commit base:** `157b3d1` · **Fecha:** 2026-08-29 · **Tests:** 217

| dataset | filas | columnas | corte |
|---|---|---|---|
| `games.parquet` | 7.548 | 29 | 2026 |
| `features.parquet` | 7.548 | 31 | 2026 |
| `player_weeks.parquet` | 476.158 | 150 | **2025** |
| `team_games.parquet` | 15.096 | 43 | 2026 |

El corte de `player_weeks` en 2025 es el que manda para todo lo de fantasy: no
hay una sola jornada de 2026 jugada. Cualquier «validación» sobre 2026 sería
sobre la nada.

**Versiones de modelo en producción:**

| modelo | versión / parámetros |
|---|---|
| partidos | ensamblado con cross-fitting temporal, Brier **0,2127**, MAE **10,0384**, acierto **66,39%**, n=3.829 |
| semanal de fantasy | multiplicadores QB 1,022 · RB 1,022 · WR 1,061 · TE 1,127; mezcla QB 0,35 · RB 0,60 · WR 0,50 · TE 0,65 |
| pateadores | oportunidad por puntos de equipo, conversión de liga |
| rookies | previa posición × ronda, encogimiento `SHRINK_PRIOR_N = 15` |
| riesgo / bust | `BUST_FRACTION = 0.70`, cortes 0,30 / 0,50 |

## El formulario obligatorio de cada experimento

Ninguno entra en el registro sin las nueve casillas. **No se mueve ninguna
después de ver el resultado.**

```
hipótesis
dataset
ventana de entrenamiento
ventana de validación
baseline
métrica
criterio de aprobado/suspenso
resultado
decisión
```

## Regla de la que cuelga todo lo demás

Un resultado negativo es un resultado. Se documenta y se sigue.
**Nunca se ajusta el umbral después de ver el resultado.**

Y las dos reglas permanentes del proyecto siguen vigentes aquí:
**UNKNOWN > INVENTED** y **MODEL DISAGREEMENT ≠ EDGE**
(`docs/REGLA_edge.md`).
