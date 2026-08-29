# Regla permanente — MODEL DISAGREEMENT ≠ EDGE

Decisión del dueño, 29/8/2026. **No caduca** y no depende de quién trabaje en el
proyecto. Cualquier cambio que la contradiga es un bug, no una mejora.

## El hecho

El modelo de partidos **iguala aproximadamente al mercado y no demuestra
superarlo**:

- Brier 0,2128 frente a 0,2119 de las casas, sobre 3.829 partidos fuera de muestra.
- Registro contra el spread: **49,81%**, IC [48,2%, 51,4%], sobre 3.736 apuestas.
  El equilibrio a −110 es 52,4%.
- Por tramos de discrepancia (`scripts/betting_confidence_validate.py`), ningún
  tramo supera el equilibrio — y **el acierto no crece con la discrepancia**:
  49,3% / 50,9% / 48,8%.

Ese último punto es el importante. Que el modelo se aleje más de la línea **no
predice acertar más**, así que la discrepancia no es una señal de calidad.

## Lo que se prohíbe

1. **No llamar «edge» a una discrepancia por sí sola.** Discrepar es discrepar.
2. **No construir «confianza» sólo sobre modelo contra mercado.** Se probó con el
   umbral fijado antes y no pasó.
3. **No presentar picks como +EV sin validación fuera de muestra.**
4. **No fabricar probabilidades adicionales** que no salgan de un cálculo
   validado.
5. **Separar siempre** la probabilidad implícita del mercado de la del modelo.
   Nunca presentarlas como si una fuese la corrección de la otra.

## Lo que sí se puede hacer

Publicar la discrepancia como **lo que es** —cuánto se separa el modelo de la
línea— acompañada de la ficha histórica de esa clase de apuesta. Eso es un hecho
medido y casi siempre dice que no apuestes. Está en `betting/evidence.py`.

## Cómo se levanta

Si un backtest fuera de muestra demuestra edge —con el umbral fijado **antes** de
mirar, y exigiendo que el límite inferior del intervalo supere el equilibrio, no
la media— se reevalúa. Hasta entonces, la regla se aplica entera.

Trocear la muestra hasta encontrar un tramo que gane no cuenta: eso es
sobreajuste, y es exactamente lo que el umbral del límite inferior existe para
impedir.
