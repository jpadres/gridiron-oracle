# Preregistro — «confidence» en la sección de apuestas

Fijado **antes** de medir. El dueño pidió explícitamente que confidence no sea un
número inventado, así que aquí está exactamente qué se va a calcular y qué
resultado haría que **no se publique**.

## Qué se mide

Para cada tramo de `edge` (la diferencia entre la probabilidad del modelo y la
del mercado tras quitar el vig), la **tasa histórica de acierto contra el spread**
fuera de muestra, walk-forward, sobre 2012-2025.

Eso es lo único que puede sostener la palabra «confianza»: no una escala inventada
de 1 a 5, sino *cuántas veces acertaron en el pasado las apuestas que se parecían
a ésta*.

## Umbral de publicación

Un tramo sólo puede etiquetarse como apuesta recomendada si el **límite inferior
de su intervalo de confianza del 95% supera el 52,4%**, que es el punto de
equilibrio a cuota −110.

No vale que la tasa observada supere 52,4%: tiene que superarlo el límite inferior.
Con 3.736 apuestas repartidas en tramos, cada tramo tendrá unos cientos de casos y
un error estándar de varios puntos. Un tramo que marque 56% con IC [49%, 63%] es
**ruido con buena pinta**, y venderlo como confianza sería exactamente lo que este
proyecto dice no hacer.

## Qué pasa si ningún tramo pasa

Se publica igual, y la sección de apuestas dice con todas sus letras que **no hay
ningún tramo de edge con acierto demostrable por encima del equilibrio**. En ese
caso:

- No habrá «Best Bets» ni «Safer Plays» como afirmación de rentabilidad.
- La categorización se queda en descriptiva —cuánto discrepa el modelo del
  mercado— y no predictiva.
- «Confidence» pasa a llamarse otra cosa, porque no habría confianza que reportar.

El registro global ya es 49,81% con IC [48,2%, 51,4%] sobre 3.736 apuestas, así
que **la hipótesis por defecto es que ningún tramo pasa**. Si alguno pasa con
holgura, la primera sospecha es sobreajuste por trocear, no un hallazgo.

Fecha: 2026-08-29.
