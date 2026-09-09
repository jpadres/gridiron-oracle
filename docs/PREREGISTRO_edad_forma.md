# Preregistro — la FORMA de la curva de edad, no si se activa

Fijado **antes** de ejecutar nada. Fecha: 2026-09-08.

`PREREGISTRO_edad.md` preguntó si la curva mejora respecto a NO tener curva.
Pasó y se activó. Esto pregunta otra cosa que nadie ha comprobado: si el
multiplicador tiene la **forma** correcta.

## La hipótesis

    projected_points = ppg_shrunk × age_factor × expected_games

`ppg_shrunk` es la media por partido DEL PROPIO JUGADOR, ponderada hacia lo
reciente (56/30/14 sobre las tres últimas temporadas). O sea: para un corredor
de 32 años, esa media sale de partidos que jugó a los 29, 30 y 31.

`age_factor` es `1 − 0,055 × (edad − 25,5)`, la caída **acumulada desde el
pico**. A los 32,7 vale 0,606.

**Esas dos cosas se solapan.** La media observada ya contiene el envejecimiento
que el jugador ha sufrido de verdad entre los 25,5 y los 31. Multiplicarla
además por la caída acumulada desde el pico le cobra siete años de deterioro
que sus propios datos ya reflejan — y le cobra el deterioro MEDIO de su
posición aunque él, individualmente, no lo haya tenido.

Lo que la fórmula necesita no es «cuánto ha caído desde su pico», es **cuánto
va a caer de aquí a la temporada que se proyecta**: la diferencia entre la edad
de la MUESTRA y la edad PROYECTADA. Para casi todo el mundo, un año.

## La predicción falsable

Si la hipótesis es cierta, la curva actual tiene que quedarse **sistemáticamente
CORTA con los veteranos**: los jugadores mayores realizarán MÁS puntos de los
que se les proyecta, y el sesgo tiene que crecer con la edad. Si el sesgo por
edad es plano, la hipótesis es falsa y aquí no hay nada que arreglar.

## El candidato

    factor_incremental = curva(edad_proyectada) / curva(edad_de_la_muestra)

donde `edad_de_la_muestra` es la edad media de los partidos que entran en
`ppg_shrunk`, ponderada por los MISMOS pesos que ya usa el compilador. No hay
ninguna constante nueva: son la misma curva y los mismos pesos, evaluados en el
sitio correcto. El suelo de 0,55 se conserva.

## Umbral de aceptación

Las **cuatro**, y se miden walk-forward sobre 2019-2025 (cada temporada
proyectada sólo con las anteriores), sobre jugadores con proyección ≥ 50 puntos:

1. **El sesgo de los 30+ se reduce a menos de la MITAD** en valor absoluto.
   Es la predicción central; si no se cumple, la hipótesis está mal.
2. **El MAE global no empeora** más de 1,0 punto.
3. **El MAE de running back no empeora** más de 1,0 punto. Es la posición cuya
   curva es más agresiva y donde vive el caso que motivó esto.
4. **El sesgo de los menores de 26 no empeora** en valor absoluto más de un 25%.
   Un arreglo que endereza a los viejos rompiendo a los jóvenes no es un arreglo.

## Qué pasa si no pasa

No se cambia nada. Se publica el resultado con sus números, la curva se queda
como está, y Derrick Henry se queda en el puesto 147 con la explicación de por
qué. **No se van a retocar los parámetros hasta que pase**: eso es ajustar al
conjunto de prueba, y este repositorio ya rechazó un cambio por esa razón
(`PREREGISTRO_ancla.md`).

## Qué pasa si pasa

Se cambia la forma, se republica el board, y se dice cuánto se movió cada quién.
