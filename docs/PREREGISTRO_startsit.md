# Preregistro — backtest de Start/Sit por pares

Bloques 11 y 12 del espec adversarial. **Escrito ANTES de generar un solo par.**

## La pregunta

No «¿acierta el modelo los puntos?» sino **«¿ayuda en las decisiones
difíciles?»**. Son cosas distintas y sólo la segunda es el producto.

Un ranking que acierta que Bijan Robinson rinde más que el tercer corredor de
los Jets no ayuda a nadie: eso ya lo sabías. La pregunta es qué pasa cuando la
decisión es real.

## Zona de decisión — definida ANTES de ver nada

Un par entra en el backtest si cumple **las cuatro** condiciones:

1. **Misma posición y misma jornada.** Comparar un WR con un TE es una decisión
   de alineación, no de Start/Sit.
2. **Los dos son titulares plausibles**: los dos con proyección ≥ **8 puntos**.
   Esto quita el «WR1 contra suplente» que infla cualquier tasa de acierto.
3. **La decisión es apretada**: diferencia de proyección ≤ **3,0 puntos**. Por
   encima de eso nadie duda, y medir ahí es medirse a uno mismo.
4. **Los dos jugaron.** Es una limitación y se dice: aísla la calidad de la
   proyección de la de la predicción de ausencias, que este modelo no hace. Se
   reporta **también** la variante sin esta condición, para no esconder que un
   manager de verdad sí se come los DNP.

## Métricas

- **Tasa de acierto por pares.** Si el sistema dice A > B, ¿cuántas veces A supera
  a B de verdad?
- **Arrepentimiento (bloque 12).** `puntos del mejor − puntos del elegido`.
  Perder una decisión por 0,3 puntos no es lo mismo que perderla por 18, y una
  tasa de acierto sola no distingue las dos.
- **Tasa de error grave**: fracción de decisiones donde el arrepentimiento supera
  **10 puntos**.
- **Diferencia media de puntos** entre elegido y no elegido.

## Baselines

- **A: la forma reciente.** La media ponderada de seis partidos, el baseline de
  siempre del proyecto.
- **B: cara o cruz.** Elegir al azar entre los dos. Define el 50%.

## Umbral de aceptación, fijado antes de medir

Para poder decir que el Start/Sit **funciona**, hacen falta las dos cosas:

1. La tasa de acierto del modelo **bate a la de la forma reciente**.
2. El **IC 95% inferior** de la tasa de acierto del modelo **queda por encima del
   50%**. Una tasa del 52% sobre 300 pares no dice nada, y un producto que
   recomienda alineaciones tiene que superar a la moneda con evidencia, no de
   media.

**Umbral de alarma:** tasa de acierto > **62%** en la zona apretada. En
decisiones separadas por menos de tres puntos proyectados, un acierto así sería
extraordinario; lo primero que habría que buscar es una fuga.

## Regla de decisión, fijada de antemano

- **Pasa las dos** → el Start/Sit se puede construir, publicando la tasa medida
  y su intervalo al lado de la recomendación.
- **Bate al baseline pero no al 50% con significación** → se puede construir,
  pero **etiquetado como orientativo**, con el intervalo a la vista y sin
  lenguaje de certeza.
- **No bate al baseline** → **no se construye un Start/Sit basado en el modelo.**
  Si la forma reciente decide mejor, el producto honesto es enseñar la forma
  reciente y decir que es eso.

En ningún caso se publica un «61% de probabilidad de que A supere a B» salvo que
esa probabilidad esté calibrada, que es otro experimento y no éste.
