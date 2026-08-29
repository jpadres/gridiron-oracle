# E10 — Clima: el umbral de 15 mph y la trampa que esconde

Bloque 44 del espec adversarial.

## Hipótesis

Los umbrales de `narrative/weather.py` (viento sostenido 15 mph, racha 25 mph)
venían de «la literatura de apuestas» — es decir, folclore. ¿Aguantan los datos?

## Dataset y método

5.008 partidos a cielo abierto o con el techo abierto, 2000–2025, con viento
medido. Puntos totales del partido por tramo de viento, con IC 95%.

## Resultado: el umbral es correcto

| viento | n | puntos totales | IC 95% |
|---|---|---|---|
| 0–5 mph | 1.518 | 44,65 | [43,93 – 45,37] |
| 6–10 | 2.088 | 43,62 | [43,02 – 44,21] |
| 11–15 | 945 | 42,19 | [41,30 – 43,07] |
| 16–20 | 346 | 41,30 | [39,80 – 42,81] |
| 21–25 | 83 | 40,84 | [37,78 – 43,91] |
| **26+** | 26 | **30,65** | [25,92 – 35,38] |

Contra la referencia de ≤10 mph (44,05 puntos):

- **>15 mph: −3,47 puntos**, IC 95% [−4,78, −2,16] — **significativo**
- **>20 mph: −5,71 puntos**, IC 95% [−8,37, −3,04] — **significativo**

**El corte de 15 mph era folclore y ha resultado estar bien puesto.** Eso no
siempre pasa; por eso se mide en vez de suponerlo.

## Y aquí está la trampa

Contra el **total de cierre del mercado**:

| viento | n | residuo vs línea | diferencia vs referencia | IC 95% |
|---|---|---|---|---|
| >15 mph | 457 | −1,26 | **−2,22** | [−3,47, −0,97] |
| >20 mph | 111 | −2,60 | **−3,56** | [−6,06, −1,06] |

Leído sin cuidado: **el mercado no descuenta del todo el viento y ahí hay una
ventaja de dos puntos de total.** Sería el primer edge real del proyecto.

**Es falso, y la comprobación tardó una consulta:**

> De los 272 partidos de 2026 sin jugar, **cero** traen viento o temperatura.
> De los 7.276 jugados, el 71,6% sí.

El clima de nflverse es **observado**, no pronosticado. Sólo existe *después*
del partido. Ese −2,22 contra la línea no es información que el mercado ignore:
es información que **nadie tenía** cuando la línea se cerró, yo incluido.

Usarlo para apostar o para proyectar sería fuga P0 de manual, y de la variedad
más seductora: la que produce un resultado que da la razón a lo que uno quería
creer.

El README ya listaba «clima histórico observado, no pronosticado» como
limitación conocida. Esto lo confirma con números y explica **por qué** importa,
que es distinto de saber que existe.

## Decisiones

1. Los umbrales de `weather.py` pasan de folclore a medidos, con los números y
   sus intervalos en el comentario.
2. Queda escrito ahí mismo que están medidos con viento **observado** y que el
   módulo consume un **pronóstico**, cuyo error nunca se ha medido en este
   proyecto: el efecto real sobre una predicción con pronóstico es
   necesariamente menor que −3,47.
3. **El clima sigue sin entrar en ningún cálculo del modelo.** Se verificó que
   hoy no entra en ninguno (`grep` sobre `src/oracle`: cero usos fuera del
   propio módulo), y así se queda.

**Estado: PASA el umbral / FALLA como señal utilizable.** Las dos cosas a la vez,
que es el resultado más interesante posible.
