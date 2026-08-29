# Preregistro — rookies por capital de draft

**Fecha:** 2026-08-29. **Escrito ANTES de construir el modelo.**

## El problema que resuelve

Los rookies **no aparecen hoy en el board**. `project_season` se apoya en el
historial NFL del jugador, y un rookie no tiene ninguno. No es que salgan mal:
es que no salen. En una liga de 12 equipos eso deja fuera a los que suelen ser
seis u ocho de las primeras cien elecciones.

## Exploratorio: cuánto predice el capital de draft

3.311 temporadas de rookie (QB/RB/WR/TE) entre 2006 y 2025. 1.369 con número de
draft; 1.942 sin él (no drafteados).

**Spearman entre número de draft y puntos PPR de su año rookie** (negativo
significa que un pick más temprano predice más puntos):

| pos | ρ | n |
|---|---|---|
| QB | **−0,629** | 205 |
| RB | **−0,618** | 368 |
| WR | **−0,579** | 544 |
| TE | **−0,586** | 252 |

**Es la señal más fuerte medida en todo el proyecto.** Para comparar: la
proyección semanal alcanza ρ 0,21–0,55 según la posición, el streaming de
defensas ronda 0,04 de una semana a otra, y los pateadores 0,14.

Y no puede haber fuga: el número de draft se conoce en abril, meses antes de que
se juegue nada.

### Medias por ronda (PPR, temporada rookie completa)

| ronda | QB | RB | WR | TE |
|---|---|---|---|---|
| 1ª | 162,5 | 174,1 | 138,1 | 115,7 |
| 2ª | 63,4 | 132,7 | 95,0 | 66,2 |
| 3ª | 45,3 | 90,6 | 60,1 | 45,6 |
| 4ª | 8,9 | 72,0 | 44,2 | 34,3 |
| 5ª | 30,5 | 56,0 | 31,7 | 24,9 |
| 6ª | 15,5 | 38,1 | 29,1 | 24,5 |
| 7ª | 9,5 | 21,0 | 19,6 | 8,9 |
| UDFA | 6,5 | 11,7 | 6,6 | 3,0 |

### La incertidumbre no es un adorno: es bimodal

El quarterback de segunda ronda promedia **63,4 puntos** y su **mediana es 15,9**.
Esa distancia entre media y mediana no es asimetría suave: es que un QB de
segunda ronda o se hace titular (y suma 200) o se sienta (y suma 0). No hay
término medio.

Publicar «63 puntos» para ese jugador sería el peor número posible: no describe
a casi ninguno de ellos.

Lo mismo, más suave, en el resto: RB de 6ª ronda promedia 38,1 con mediana 11,6;
WR de 5ª promedia 31,7 con mediana 12,0.

## Hipótesis

Una previa por **posición × ronda**, encogida hacia la media de la posición por
tamaño de muestra, predice los puntos de un rookie mejor que:

- **Baseline A:** cero (que es lo que hay hoy — el rookie no existe).
- **Baseline B:** la media de todos los rookies de esa posición, sin distinguir
  capital de draft.

## Métrica y umbral, fijados antes de medir

Walk-forward estricto: para proyectar la temporada S sólo se usan rookies de
temporadas **anteriores** a S. Evaluación sobre 2016–2025.

- **Métrica principal:** Spearman dentro de la cohorte de rookies de cada año.
- **Métrica secundaria:** MAE contra los puntos reales de la temporada.
- **Umbral:** batir a **los dos baselines** en Spearman **y** en MAE.
- **Umbral de alarma:** Spearman > 0,75. El exploratorio da 0,58–0,63 sobre toda
  la historia a la vez; un walk-forward que saliera muy por encima indicaría que
  algo está mirando el resultado.

## Reglas que no dependen del resultado

1. **Se publica un intervalo, no un punto.** Con la bimodalidad medida arriba,
   una cifra sola engaña. Se publican los percentiles 25, 50 y 75 observados de
   su posición × ronda, y el número de rookies históricos que hay detrás.

2. **UDFA no es cero para siempre.** Su previa es baja (3,0–11,7 puntos según
   posición) y eso es correcto de partida, pero 39 UDFAs de la muestra superaron
   los 100 puntos en su año rookie. La previa tiene que poder actualizarse con
   evidencia real posterior —entró en la plantilla, subió en el depth chart, se
   lesionó el titular— y el diseño deja el hueco para eso explícitamente.

3. **El modelo de bust de veteranos NO se aplica a rookies.** Está ajustado
   sobre jugadores con historial NFL y sus features (`risk_sample`,
   `risk_shrink`) no existen para quien no ha jugado nunca. Aplicarlo produciría
   un número con la forma correcta y sin significado.

4. **Un rookie que no cumpla las condiciones anteriores no entra en el board.**
   Es preferible un board sin rookies —lo que hay hoy— a un board con rookies
   inventados.

---

# RESULTADO — 2026-08-29

Walk-forward estricto: la previa de la temporada S sólo ve rookies de temporadas
anteriores a S. 2.250 rookies evaluados sobre 2016–2025.

| | MAE | Spearman |
|---|---|---|
| **previa por capital de draft** | **23,68** | **0,604** |
| baseline A: cero (lo que hay hoy) | 24,06 | — (constante) |
| baseline B: media de la posición | 39,36 | 0,093 |

Por posición: QB ρ 0,566 (n=222) · RB 0,575 (n=564) · WR 0,619 (n=1.026) ·
TE 0,622 (n=438).

**Bate a los dos baselines. El umbral de alarma (ρ > 0,75) no salta.**

## Dónde gana, y dónde no

Hay que decir esto con precisión, porque el titular «bate a los dos baselines»
esconde una asimetría enorme:

- **En error absoluto casi no gana**: 23,68 frente a 24,06 de predecir cero. Son
  cuatro décimas. Y el motivo es que el rookie **modal realmente hace cero
  puntos**: la mayoría no juega. Contra esa realidad, un cero constante es un
  predictor difícil de batir en MAE.
- **En orden gana por goleada**: ρ 0,604 frente a 0,093 de la media de posición,
  y frente a nada en absoluto del cero constante, que no ordena.

Un board de draft **no necesita acertar los puntos**: necesita acertar el orden.
Ahí es exactamente donde esta previa aporta, y por eso se construye. Pero nadie
debería leer «MAE 23,68» y pensar que ya sabemos cuántos puntos hará un rookie.

## Un fallo propio que encontró un test

La condición del aviso de bimodalidad se escribió como
`p50 > 0 and mean > 2 * p50`. Con **mediana cero** —el caso más bimodal que
existe: la mayoría no juega y unos pocos suman doscientos— el aviso **no
saltaba**, justo donde más falta hace. Corregido comparando contra la media
(`p50 <= 0.5 * mean`), que cubre el caso sin excepciones.

## Lo que NO se ha integrado, y por qué

La previa **no entra todavía en el board publicado ni en el payload**. Enseñar
rookies bien exige lo que el propio preregistro obliga: un intervalo en vez de
un punto, el tamaño de muestra a la vista y un aviso de bimodalidad. Eso son
columnas y distintivos nuevos en la tabla del board — es decir, **UI**, y la
pasada visual de fases 1–7 está activa.

Queda el módulo, la validación y los tests. La integración es la primera tarea
de fantasy en cuanto cierre la fase 7.
