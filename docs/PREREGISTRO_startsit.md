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

---

# RESULTADO — 2026-08-29

7.584 proyecciones sobre 2024–2025. Zona de decisión tal y como se definió
arriba, sin tocarla.

## Condicionado a que los dos jugaran — 31.776 pares

| criterio | n | acierto | IC 95% | arrep. medio | error grave |
|---|---|---|---|---|---|
| **modelo** | 31.776 | **54,3%** | [53,7% – 54,8%] | **3,67** | **14,4%** |
| forma reciente | 31.776 | 53,6% | [53,0% – 54,1%] | 3,73 | 14,5% |

- Bate a la forma reciente: **SÍ** (+0,7 pp)
- IC inferior por encima del 50%: **SÍ**
- Umbral de alarma (>62%): **no salta**

**Pasa los dos criterios.**

## Sin condicionar, incluyendo los que no jugaron — 42.354 pares

| criterio | n | acierto | IC 95% | arrep. medio | error grave |
|---|---|---|---|---|---|
| **modelo** | 42.354 | **52,9%** | [52,4% – 53,4%] | **3,94** | **16,0%** |
| forma reciente | 42.354 | **50,1%** | [49,7% – 50,6%] | 4,25 | 17,2% |

Aquí está el hallazgo que no esperaba: **la forma reciente es exactamente una
moneda al aire (50,1%) en cuanto se incluyen los partidos que el jugador no
jugó.** La ventaja del modelo pasa de +0,7 a **+2,8 puntos porcentuales**.

El motivo es mecánico y tiene sentido: la media de seis partidos arrastra hacia
adelante a un jugador que puede haber perdido su papel, mientras que el modelo
recalcula las cuotas de uso con el roster y el contexto de partido actuales.

## Por posición (sin condicionar)

| pos | n | modelo | forma | arrep. |
|---|---|---|---|---|
| QB | 5.959 | 54,2% | **54,4%** | 4,31 |
| RB | 8.294 | **53,9%** | 51,8% | 3,78 |
| WR | 24.834 | **52,4%** | 48,6% | 3,95 |
| TE | 3.267 | **51,7%** | 49,7% | 3,60 |

**El quarterback vuelve a perder contra la media simple**, ahora por tercera vía
independiente (Spearman, y ahora acierto por pares). Ya no es un detalle de una
métrica: es el mismo hecho visto tres veces.

## Qué significa esto en un producto, sin adornos

54,3% en decisiones apretadas es una ventaja **real y pequeña**. Traducido a una
temporada, con del orden de diez decisiones de este tipo por jornada:

- **+0,7 pp** condicionado a que jueguen ≈ una decisión más acertada al año.
- **+2,8 pp** sin condicionar ≈ cinco decisiones más al año.
- **0,31 puntos de arrepentimiento menos por decisión** ≈ unos 50 puntos de
  temporada que no se dejan en el banquillo.

No es «el sistema decide por ti». Es «el sistema acierta un poco más que tu
intuición basada en la forma reciente, y bastante más si la alternativa es
fijarse sólo en lo que hizo el mes pasado».

## Decisión, según la regla escrita de antemano

Pasa las dos condiciones → **el Start/Sit se puede construir**, publicando la
tasa medida y su intervalo junto a la recomendación.

Con dos condiciones que no estaban en el preregistro pero que los datos imponen:

1. **El QB se etiqueta aparte.** Pierde contra la media simple en las tres
   métricas medidas. No se puede publicar una recomendación de Start/Sit de
   quarterback con la misma confianza que una de receptor.
2. **Nunca un porcentaje de «probabilidad de que A supere a B»** sin calibrarlo,
   que es otro experimento. Lo que se puede publicar es la tasa histórica de
   acierto del sistema en decisiones de esta dificultad: **54%**.
