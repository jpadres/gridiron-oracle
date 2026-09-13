# E27 — ¿Hay algún SUBCONJUNTO donde el modelo bata al spread?

**Preregistrado el 13 de septiembre de 2026, ANTES de calcular un solo
subconjunto.** Los umbrales de abajo se fijan aquí y no se tocan después: la
regla 3 del proyecto existe porque elegir el criterio a la vista del resultado
convierte cualquier ruido en un hallazgo.

## De dónde sale la pregunta

`BETTING_EDGE` está REJECTED por E4: 49,81% contra el spread sobre 3.736
apuestas, IC95% [48,2%, 51,4%], frente a un equilibrio de 52,4%; y el acierto
**no** crece con la discrepancia (49,3% / 50,9% / 48,8%). Eso mide el agregado.

La objeción del dueño es la correcta y no es «apostar más semanas»:

> el camino no es apostar más semanas: es correr el E4 sobre un modelo distinto
> (por ejemplo, solo los juegos donde el gap cruza un número clave, o solo
> underdogs en casa) y ver si algún subconjunto sale arriba de 52,4% con muestra
> decente.

Es una hipótesis con mecanismo, no una búsqueda a ciegas: los márgenes de la NFL
acumulan masa en 3 y 7 (por eso `models/distribution.py` los modela aparte), así
que una diferencia modelo-línea que CRUZA uno de esos números mueve más
probabilidad que su tamaño en puntos. Y el sesgo favorito-longshot es un efecto
documentado del mercado, así que el lado del no favorito es un sitio razonable
donde mirar.

## Lo que hace falta decir antes: esto es una BÚSQUEDA

Probar ocho subconjuntos sobre los mismos datos produce un «mejor» subconjunto
aunque no exista ninguno. Con ocho pruebas independientes al 5%, la probabilidad
de que al menos una salga «significativa» por azar es 34%, no 5%. Dos defensas,
las dos fijadas aquí:

1. **Corrección por multiplicidad.** El intervalo se calcula con
   `z = 2.734` (Bonferroni: 1 − 0,05/8 a dos colas) y no con 1,96.
2. **Partición descubrimiento / confirmación, por TIEMPO.**
   - DESCUBRIMIENTO: temporadas **2012-2019**.
   - CONFIRMACIÓN: temporadas **2020-2025**.

   La partición es temporal y no aleatoria por la regla 2: barajar temporadas
   filtra futuro a través de los ratings.

## Los datos

Las predicciones walk-forward del propio proyecto (`backtest.walkforward`), 2012-2025,
fuera de muestra por construcción: para la temporada S sólo se usan temporadas
< S. El registro se calcula con `backtest.metrics.summarize_ats`, que YA existe y
es la única definición de «apostar el lado que el modelo prefiere» — no se
reimplementa aquí (en este repositorio, dos copias de la misma regla es el fallo
que más veces ha aparecido).

**Equilibrio: 52,381%** (-110 en los dos lados). Es una CONVENCIÓN declarada, no
una medición: el backtest histórico sólo tiene `spread_line`, sin precio por
lado. Los precios reales por lado sólo existen en el payload de 2026, y con un
lado a -118 el equilibrio de ese lado sube a 54,1% — o sea que la convención es
**optimista**, y si algún subconjunto pasara habría que rehacerlo con precios.

## Los ocho subconjuntos — lista CERRADA

`edge = pred_margin − spread_line`. `spread_line` es el margen del local
(positivo = local favorito). La apuesta va al local si `edge > 0`.

| # | id | Definición exacta |
|---|---|---|
| 1 | `KEY_CROSS` | algún número clave (±3, ±7) cae ESTRICTAMENTE entre `spread_line` y `pred_margin` |
| 2 | `KEY_CROSS_3` | ídem, sólo ±3 |
| 3 | `HOME_DOG` | la apuesta es al LOCAL y `spread_line < 0` (el local recibe puntos) |
| 4 | `AWAY_DOG` | la apuesta es al VISITANTE y `spread_line > 0` |
| 5 | `SHORT_LINE` | `abs(spread_line) <= 3` |
| 6 | `LARGE_LINE` | `abs(spread_line) >= 7` |
| 7 | `BIG_EDGE` | `abs(edge) >= 3` |
| 8 | `KEY_CROSS_AND_DOG` | `KEY_CROSS` **y** la apuesta va a un no favorito |

**No se añade ningún subconjunto después de ver los resultados.** Si al mirar
aparece algo interesante que no está en esta lista, va a un preregistro NUEVO
para una ejecución futura — no a esta tabla.

## Criterio de aceptación

Un subconjunto **AVANZA** de descubrimiento si:
- `n >= 200` apuestas decididas (los empujes no cuentan), **y**
- acierto puntual `> 52,381%`.

Un subconjunto **PASA** si, en confirmación:
- `n >= 200`, **y**
- el límite INFERIOR del IC corregido (`z = 2.734`) `> 52,381%`.

Cualquier otro resultado es un **FALLO** y se publica igual, con su n, su
acierto y su intervalo. Los ocho se publican pasen o no.

## Y qué significaría que uno pasara

**Pasar esto NO lo convierte en VALIDATED.** Un subconjunto encontrado buscando
entre ocho, incluso con la corrección y la partición temporal, sigue siendo un
candidato: lo que demuestra es que merece una validación PROSPECTIVA, jornada a
jornada, sobre partidos que no existían cuando se escribió el criterio. El
estado que le correspondería es `NOT_READY` con el experimento citado, nunca
`VALIDATED`, y `BETTING_EDGE` seguiría REJECTED hasta esa validación
prospectiva.

Y si ninguno pasa —el resultado que espero— la respuesta es la que ya da la
página, ahora con una medición más detrás: **no hay ventaja demostrada, ni en el
agregado ni en los ocho sitios donde tenía sentido buscarla.**

## Resultado

Se rellena al ejecutar `scripts/edge_subsets_experiment.py`, con la fecha, y se
propaga a `docs/experimentos/REGISTRO.md` y al registro de capacidades EN EL
MISMO COMMIT — una etiqueta de autoridad con la cifra vieja ya costó una
iteración en este proyecto.
