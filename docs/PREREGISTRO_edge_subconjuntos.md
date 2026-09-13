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

## Resultado — 13 de septiembre de 2026

`scripts/edge_subsets_experiment.py`, 3.831 predicciones walk-forward
(2012-2025), 3.737 apuestas decididas y 94 empujes.

**Agregado, E4 reproducido con las features de hoy: 49,61%**, IC corregido
[47,4%, 51,8%], ROI −5,3% a -110. E4 publicó 49,81% sobre 3.736 el 29 de agosto;
la diferencia de 0,2 puntos es la recompilación de features del 12-13 de
septiembre, y las dos cifras dicen lo mismo — el intervalo contiene el 50% y
excluye el 52,4%.

### Los ocho, pasen o no

| subconjunto | desc. n | desc. % | ¿avanza? | conf. n | conf. % | IC inf. corregido | ROI a -110 | veredicto |
|---|---:|---:|---|---:|---:|---:|---:|---|
| `KEY_CROSS` | 319 | 49,22% | no | 224 | 50,45% | 41,3% | −3,7% | **FALLA** |
| `KEY_CROSS_3` | 204 | 50,00% | no | 146 | 52,05% | 40,7% | −0,6% | **FALLA** |
| `HOME_DOG` | 274 | 48,91% | no | 228 | 50,44% | 41,4% | −3,7% | **FALLA** |
| `AWAY_DOG` | 947 | 51,74% | no | 684 | 50,44% | 45,2% | −3,7% | **FALLA** |
| `SHORT_LINE` | 752 | 52,26% | no | 620 | 49,84% | 44,3% | −4,9% | **FALLA** |
| `LARGE_LINE` | 598 | 49,50% | no | 482 | 45,44% | 39,2% | −13,3% | **FALLA** |
| `BIG_EDGE` | 51 | 50,98% | no | 15 | 66,67% | 33,4% | +27,3% | **FALLA** |
| `KEY_CROSS_AND_DOG` | 204 | 49,51% | no | 138 | 52,90% | 41,3% | +1,0% | **FALLA** |

**NINGUNO PASA, y ninguno llegó a la etapa de confirmación**: cero de los ocho
superaron el 52,381% en descubrimiento, así que la segunda etapa se calcula y se
publica pero ni uno tenía derecho a llegar a ella. Es el negativo más limpio
posible — la búsqueda no se quedó corta en el último paso, se quedó corta en el
primero.

### Las tres cosas que hay que leer, y no son el veredicto

**1. `BIG_EDGE` en confirmación: 66,67% y ROI +27,3%, sobre QUINCE apuestas.** Es
exactamente el titular que se habría publicado sin el `n >= 200` fijado antes de
mirar: «el modelo acierta dos de cada tres cuando se separa tres puntos o más».
El intervalo corregido va del 33,4% al 100% — no es un hallazgo débil, es que no
hay información ahí. Este experimento existe para que ese número no salga a una
pantalla, y el preregistro es lo único que lo impidió.

**2. Lo más cerca que estuvo nada: `SHORT_LINE`, 52,26% en descubrimiento**, a
doce centésimas del equilibrio, y en confirmación 49,84%. O sea que ni siquiera
la mejor mitad del mejor subconjunto se sostiene en la segunda mitad del tiempo.
`AWAY_DOG` hace lo mismo: 51,74% y luego 50,44%.

**3. `LARGE_LINE` es el único resultado con señal, y va EN CONTRA**: 45,44% en
confirmación, ROI −13,3%. Con el equilibrio en 52,4%, perder a ese ritmo sobre
482 apuestas no es ruido cómodo. La lectura honesta no es «hay edge apostando al
revés» —eso sería la misma búsqueda con el signo cambiado, y no está
preregistrada— sino que el modelo es PEOR de lo normal en los partidos de línea
grande, que es información sobre el modelo y no sobre el mercado.

### Qué cambia y qué no

`BETTING_EDGE` sigue **REJECTED**, ahora citando E4 y E27. La página no cambia su
afirmación porque ya era la correcta; lo que cambia es que detrás hay ocho sitios
más donde se buscó y no había nada.

Y la pregunta del dueño queda contestada con su propio criterio: el camino no era
apostar más semanas, y tampoco era ninguno de estos ocho subconjuntos. El
siguiente sitio donde mirar sigue siendo el del roadmap —**líneas de apertura**,
porque el backtest entero mide contra el CIERRE, que es el número más eficiente
del mercado y el que nadie puede apostar— y ése necesita datos que este
repositorio no tiene todavía.
