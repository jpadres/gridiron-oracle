# E12 — ¿Cuánta diferencia hace falta para que el orden signifique algo?

Bloques 54 (estabilidad del ranking) y 77 (robustez de la decisión) del espec.

## La pregunta

«¿Qué diferencia real hay entre el puesto 14 y el 15?» El ranking semanal
publica 256 jugadores numerados del 1 en adelante. Esa numeración promete una
precisión que hay que comprobar antes de seguir enseñándola.

## Método

Los mismos 89.114 pares del backtest de Start/Sit (2024–2025, misma posición y
jornada, los dos ≥ 8 puntos proyectados), agrupados por **cuánto se separan sus
proyecciones**. Para cada tramo, con qué frecuencia el jugador mejor proyectado
supera de verdad al otro. IC 95% de Wilson.

## Resultado

| diferencia proyectada | n | acierto | IC 95% |
|---|---|---|---|
| **0 – 0,5 pts** | 8.122 | **50,6%** | **[49,5% – 51,7%]** |
| **0,5 – 1 pt** | 7.715 | **50,7%** | **[49,6% – 51,8%]** |
| 1 – 2 pts | 14.270 | 53,0% | [52,1% – 53,8%] |
| 2 – 3 pts | 12.247 | 55,8% | [54,9% – 56,7%] |
| 3 – 5 pts | 19.682 | 59,8% | [59,1% – 60,5%] |
| 5+ pts | 27.078 | 66,7% | [66,2% – 67,3%] |

Monótona y sin sorpresas en la forma. Lo que importa es dónde está el suelo.

## La respuesta, sin rodeos

> **Por debajo de un punto de diferencia proyectada, el orden no contiene
> información.** Los dos primeros tramos tienen el 50% dentro de su intervalo de
> confianza, con más de quince mil pares detrás. No es que la señal sea débil:
> es que no se distingue de una moneda.

Y como los puestos consecutivos de un ranking semanal suelen separarse por
mucho menos de un punto, la conclusión es directa: **el puesto 14 y el 15 no se
distinguen. Ni el 14 y el 17.**

Numerarlos del 1 al 256 promete una precisión que el modelo no tiene.

## Escala derivada de los datos, no de tres etiquetas elegidas a ojo

| diferencia | etiqueta | acierto medido |
|---|---|---|
| < 1 punto | **MONEDA AL AIRE** | 50,6% — indistinguible del azar |
| 1 – 3 puntos | **LEVE** | 53–56% |
| 3 – 5 puntos | **CLARO** | 60% |
| > 5 puntos | **MUY CLARO** | 67% |

Cada etiqueta lleva su número detrás. Ninguna es una opinión sobre cuánta
confianza «se siente».

## Consecuencias para el producto

1. **El ranking semanal debería enseñar bandas, no puestos individuales.** Dentro
   de una banda de menos de un punto, el orden es decorativo.
2. **Una recomendación de Start/Sit con menos de un punto de diferencia debe
   decir que es una moneda al aire**, no elegir uno y callarse. Elegir está bien;
   fingir que la elección tiene fundamento, no.
3. **Es la mitad honesta del 54,3% del bloque 11.** El sistema acierta el 54% en
   decisiones apretadas *porque* las decisiones apretadas de verdad son casi
   irresolubles. El valor está en las que no lo son tanto.

## Lo que NO habilita esto

No habilita publicar «61% de probabilidad de que A supere a B». Estas tasas son
frecuencias históricas por tramo de diferencia, no una probabilidad calibrada
por par. Convertir lo uno en lo otro es otro experimento.

**Estado: PASA** — la escala está medida y es utilizable. Su implementación en
la interfaz espera a que cierre la pasada visual.
