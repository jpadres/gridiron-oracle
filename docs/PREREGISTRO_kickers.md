# Preregistro — ranking de pateadores

**Fecha:** 2026-08-29. **Escrito ANTES de construir el modelo.**

## Lo que dicen los datos antes de modelar nada

Exploratorio sobre 492 temporadas de pateador con 10+ partidos (2010–2025) y
359 pares de temporadas consecutivas del mismo pateador.

| magnitud | r año N → N+1 | r² |
|---|---|---|
| **CONVERSIÓN** — % de acierto en FG | **0,024** | 0,001 |
| OPORTUNIDAD — intentos de FG por partido (pateador) | 0,122 | 0,015 |
| OPORTUNIDAD — intentos de FG por partido (equipo) | 0,086 | 0,007 |
| OPORTUNIDAD — intentos de PAT por partido (pateador) | 0,316 | 0,100 |
| **OPORTUNIDAD** — intentos de PAT por partido (equipo) | **0,376** | 0,141 |

### La conversión no es una habilidad medible a esta escala

El % de acierto de un pateador **no predice nada** de su % del año siguiente:
r = 0,024. Y la dispersión observada lo explica:

- desviación típica observada del % de acierto: **0,071**
- desviación típica que produciría el **puro azar** con 30 intentos: **0,066**

Restando varianzas, la parte atribuible a habilidad tiene una desviación típica
de unos **0,026** — es decir, **alrededor del 13% de la varianza observada es
habilidad y el 87% es azar**, y esa estimación es generosa porque atribuye a
habilidad todo lo que no es binomial (incluye distancia media, clima y estadio).

Un ranking de pateadores por «quién patea mejor» estaría ordenando ruido.

### Lo único que persiste es el ataque del equipo

Los intentos de punto extra son la señal con más persistencia (r = 0,376 a nivel
de equipo), y no es un dato sobre el pateador: es la tasa de touchdowns de su
ataque. Los intentos de campo apenas persisten (r = 0,086), porque dependen de
que las series se atasquen justo en una franja concreta del campo.

**Conclusión previa al modelo: un ranking de pateadores es, casi por completo,
un ranking de ataques.**

## Hipótesis

Un modelo que proyecte **oportunidad** —intentos de PAT y de FG derivados de los
puntos y el total proyectados del equipo— y trate la **conversión** como la media
de la liga con un encogimiento fuerte hacia ella, bate a:

- **Baseline A:** el pateador medio de la liga (una constante).
- **Baseline B:** la media ponderada de los últimos seis partidos del pateador,
  el mismo baseline que usan las demás posiciones.

## Métrica y umbral, fijados antes de medir

Walk-forward. Calibración sobre 2018–2021, evaluación sobre 2022–2025 sin volver
a tocar nada. Puntuación de pateador estándar de Sleeper si es representable; si
no, la variante que se documente, la misma para modelo y baselines.

- **Métrica principal:** MAE de puntos de fantasy por jornada.
- **Métrica secundaria:** Spearman dentro de la jornada.
- **Umbral:** batir a **los dos baselines** en MAE **y** en Spearman.
- **Umbral de alarma:** Spearman > 0,25 fuera de muestra. Con una conversión que
  es 87% ruido, una correlación así sería extraordinaria y lo primero que hay
  que buscar es una fuga.

## Regla de decisión, fijada de antemano

1. Si **no** bate a los dos baselines: **no se publica un ranking de pateadores.**
   Se publica el hallazgo —que la conversión no es predecible y la oportunidad
   apenas— y, como mucho, un orden por ataque proyectado etiquetado como lo que
   es: «esto ordena ataques, no pateadores».

2. Si bate: se publica **con la separación real medida**. Concretamente, se
   publica la diferencia esperada en puntos por partido entre el K1 y el K12
   proyectados. Si esa diferencia es menor que **1,5 puntos por partido**, el
   ranking se publica con esa cifra al lado y la frase de que elegir pateador
   casi no mueve la aguja. Un ranking que ordena doce cosas separadas por dos
   décimas invita a una precisión que no existe.

3. En ningún caso se publica un número de «habilidad» del pateador, ni una
   probabilidad de acierto individual por distancia ajustada a su historial.
   Con 30 intentos al año y una desviación típica de habilidad de 0,026, ese
   número sería ruido con tres decimales.

---

# RESULTADO — 2026-08-29

## El umbral de alarma hizo su trabajo antes que nada

La primera ejecución dio **Spearman 0,410**, por encima del umbral de alarma de
0,25 que obliga a investigar antes de publicar. La investigación tardó un
minuto: el script estaba alimentando el modelo con los **puntos reales** del
equipo. Le estaba dando la respuesta. Un pateador no se proyecta sabiendo el
marcador final.

Reescrito para usar `backtest_preds.parquet` —predicciones walk-forward, cada
temporada pronosticada por un modelo que no la ha visto—, el Spearman cae de
**0,410 a 0,136**. Ese factor de tres es exactamente la diferencia entre lo que
un modelo parece valer y lo que vale.

## Resultado con entradas honestas (2022–2025, 2.108 pateador-semanas)

| | MAE | Spearman |
|---|---|---|
| modelo | **3,728** | **0,136** |
| baseline A: pateador medio de la liga | 3,770 | — (constante) |
| baseline B: su propia forma reciente | 4,068 | 0,047 |

**Bate a los dos baselines: SÍ.** Formalmente pasa el umbral.

## Y aun así, la cifra que importa dice otra cosa

Puntos realizados por tramo del ranking proyectado:

| tramo | n | proyectado | realizado | IC 95% |
|---|---|---|---|---|
| K1–K3 | 216 | 8,20 | 8,62 | [8,05 – 9,19] |
| K4–K6 | 216 | 7,86 | 8,54 | [7,89 – 9,18] |
| K7–K9 | 216 | 7,65 | 8,33 | [7,68 – 8,97] |
| K10–K12 | 216 | 7,47 | 8,31 | [7,73 – 8,90] |
| K13–K20 | 576 | 7,20 | 7,78 | [7,38 – 8,17] |
| K21+ | 734 | 6,67 | 7,33 | [6,99 – 7,68] |

El ranking es monótono de arriba abajo, así que **hay señal**. Pero:

> **K1–K6 menos K7–K12, realizado: +0,26 puntos por partido.**
> Error estándar 0,31. **IC 95% [−0,36, +0,87].**
> **No es distinguible de cero.**

El recorrido completo, de K1–K3 a K21+, son 1,29 puntos por partido, contra una
desviación típica de **4,72 puntos** en una jornada cualquiera de pateador.

Traducido: lo que el modelo distingue es **«titular en un buen ataque» frente a
«suplente en un ataque malo»**. Para eso nadie necesita un modelo. Dentro de los
doce pateadores que un usuario se plantearía de verdad, el orden no separa nada
que se pueda medir.

## Qué se publica, según la regla escrita de antemano

La regla decía: si la separación K1–K12 es menor de 1,5 puntos por partido, se
publica el ranking **con esa cifra al lado** y con la frase de que elegir
pateador casi no mueve la aguja. Se cumple, y con la cifra que corresponde, que
no es el estimador puntual sino el intervalo:

> Entre el pateador número 1 y el número 12 de este ranking la diferencia
> medida es de 0,26 puntos por partido, con un intervalo de confianza del 95%
> que va de −0,36 a +0,87. Es decir: **no hay diferencia detectable.** La
> desviación típica de un pateador en una jornada es de 4,7 puntos, dieciocho
> veces mayor. Coge al titular de un buen ataque y no vuelvas a mirar.

**No se publica** ninguna estimación de habilidad individual del pateador, ni
probabilidad de acierto por distancia ajustada a su historial. El preregistro ya
lo prohibía y los datos lo confirman: con 30 intentos al año y una desviación
típica de habilidad de 0,026, ese número sería ruido con tres decimales.
