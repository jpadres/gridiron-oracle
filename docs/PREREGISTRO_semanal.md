# Preregistro — proyección semanal de fantasy

**Fecha:** 2026-08-29. **Escrito y commiteado ANTES de tocar el modelo.**

## Punto de partida medido (2024–2025, fuera del periodo de calibración)

El modelo semanal publicado se comparó con su propio baseline —la media
ponderada de los últimos seis partidos del jugador— sobre 6.299 observaciones.

| pos | n | MAE modelo | MAE baseline | Δ | ρ modelo | ρ baseline | Δ | R² modelo |
|---|---|---|---|---|---|---|---|---|
| QB | 798 | 7,49 | 6,71 | **−0,78** | 0,066 | 0,248 | **−0,182** | **0,005** |
| RB | 1.630 | 5,61 | 5,73 | +0,13 | 0,552 | 0,560 | −0,008 | 0,268 |
| WR | 3.056 | 5,19 | 5,22 | +0,03 | 0,509 | 0,529 | −0,020 | 0,233 |
| TE | 815 | 5,13 | 5,18 | +0,04 | 0,307 | 0,333 | −0,026 | 0,106 |

**El modelo pierde contra su baseline en las cuatro posiciones por correlación
de rangos.** En QB pierde también por error absoluto, y por mucho.

`scripts/fantasy_weekly_calibrate.py` ya tenía escrito el listón —«bate al
baseline en las cuatro posiciones», Spearman y MAE— y **hoy no lo cumple**. El
script imprime «NO — y se publica igual, esa es la regla». Se publicó.

### El QB no está flojo: está roto

- Desviación típica de la proyección: **1,99**. De la realidad: **8,39**. Del
  propio baseline: 4,43. El modelo emite casi el mismo número para todos.
- R² **0,005**: explica el medio por ciento de la varianza. Es indistinguible
  de ordenar al azar.
- Pendiente de regresar real sobre proyectado: **0,296**.
- Sesgo medio **+3,97 puntos**: proyecta 12,76 donde la realidad es 16,73.

## Causas identificadas en el código, no supuestas

Todas verificadas leyendo `_project_player` y `team_volume`, y las dos primeras
medidas contra datos reales.

**(1) La resta de escapadas deja al equipo con menos acarreos de los que tiene.**
Medido sobre 2.174 equipo-partidos de 2022–2025, alimentando el modelo de
volumen con el marcador **real** para aislarlo del error del modelo de partidos:

| magnitud | proyectado | real | ratio |
|---|---|---|---|
| acarreos de equipo | 24,71 | 26,98 | **0,916** |
| acarreos + escapadas | 26,89 | 26,98 | **1,004** |
| intentos de pase | 31,70 | 32,95 | 0,962 |
| objetivos | 31,70 | 31,47 | 1,007 |

`rush_attempts = jugadas × (1 − tasa_pase) − escapadas`. El comentario dice que
resta las escapadas para no contarlas dos veces e inflar al corredor titular.
Pero el denominador de `rush_share` son los acarreos de la casilla —que **ya
incluyen** las escapadas del QB—, así que la cuota del quarterback ya las
separa. Restarlas otra vez las quita dos veces y **deprime a todos los
corredores y receptores un 8,4%**.

Los multiplicadores de posición actuales (RB 0,985, WR 0,972, TE 0,940) estaban
tapando este sesgo. Un multiplicador que absorbe un error de lógica no es una
calibración: es un parche que impide verlo.

**(2) El volumen de carrera del QB sale de las escapadas.**
`rush_yards = ypc × escapadas × 0,55`. Una escapada es improvisada. Un QB de
carrera diseñada —Hurts, Jackson, Daniels— tiene acarreos que no son escapadas,
y son justo los que separan a un QB1 de un QB15.

**(3) El QB no puntúa touchdowns de carrera.** RB, WR y TE tienen su término
`rush_td_rate`; el QB no tiene ninguno. Quince touchdowns corriendo en una
temporada son 90 puntos de fantasy invisibles para el modelo.

**(4) Nadie puntúa intercepciones.** `rules.interception = −2,0` existe y no se
usa en la proyección. En un QB son unos −1,4 puntos por partido, y varían mucho
entre quarterbacks.

(3) y (4) explican por qué la proyección de QB es casi constante: se quedó con
los dos términos que menos distinguen —yardas y touchdowns de pase sobre un
volumen de intentos casi igual para todos— y perdió los tres que sí distinguen.

## Qué se va a cambiar

1. Quitar la resta de escapadas de `rush_attempts`. Es un error de signo con
   corrección exacta, no un parámetro que se ajusta a ojo.
2. Volumen de carrera del QB = `rush_share × acarreos del equipo`, el mismo
   mecanismo que el resto de posiciones y consistente con el denominador de la
   cuota.
3. Añadir touchdowns de carrera del QB.
4. Añadir intercepciones al QB.
5. Reajustar los multiplicadores por posición **después** de 1–4, porque los de
   hoy absorben los errores de arriba.

**Lo que NO se va a tocar:** `BASE_PASS_RATE`, `SACK_RATE`, `SCRAMBLE_RATE`,
`BASE_PLAYS`. Los intentos de pase salen un 3,9% bajos y sería fácil mover una
constante hasta que la media cuadre. Eso es ajustar a la media, no corregir un
fallo, y no se hace. Arreglar un error de signo y ajustar una constante para que
salga el número que quiero son cosas distintas.

## Métrica, validación y umbral — fijados antes de medir

Calibración sobre **2022–2023**. Evaluación sobre **2024–2025**, sin volver a
tocar nada. Baseline: la media ponderada de seis partidos, la misma de siempre.

**Umbral de aceptación:**

- **QB:** tiene que batir al baseline en **Spearman Y MAE**. Hoy pierde en las
  dos (ρ 0,066 vs 0,248; MAE 7,49 vs 6,71).
- **RB, WR, TE:** tienen que batir al baseline en MAE (hoy lo hacen por poco) y
  no perder más de **0,02** de Spearman frente al baseline.
- **Nivel:** `|media(real) − media(proyectado)| ≤ 0,5 puntos` en las cuatro.

**Umbral de alarma:** si el R² del QB fuera de muestra sale por encima de
**0,35**, la hipótesis por defecto no es que el modelo mejoró. El fantasy
semanal es ruido en su mayor parte; un R² así sería extraordinario y lo primero
que hay que buscar es una fuga. Se investiga antes de publicar nada.

## Regla de decisión, fijada de antemano

Para que no se pueda racionalizar después de ver el resultado:

**Toda posición que no bata al baseline en las dos métricas se publica como una
mezcla** `w · baseline + (1 − w) · modelo`, con `w` ajustado **sólo sobre
2022–2023** y evaluado sobre 2024–2025.

Si el `w` ajustado sale **≥ 0,95**, significa que el modelo no aporta nada en esa
posición, y **eso se dice en la web con esas palabras**. No se publica una
proyección con maquinaria de modelo cuando lo que la sostiene es una media de
seis partidos.

## Qué se hace con el fallo si ocurre

Se documenta y se publica. Un modelo semanal que no bate a una media ponderada
de seis partidos es un resultado válido y es exactamente lo que hoy está
midiendo. Lo que no es válido es seguir publicándolo como si lo batiera.

---

# RESULTADO — 2026-08-29

Calibración sobre 2022–2023, evaluación sobre 2024–2025 sin volver a tocar nada.
Umbral y regla de decisión tal y como estaban escritos arriba.

## Los arreglos del quarterback funcionaron

| | antes | después | referencia |
|---|---|---|---|
| R² fuera de muestra | 0,005 | **0,048** | — |
| sesgo medio | **+3,97** | **−0,285** | umbral ≤ 0,5 |
| desviación típica de la proyección | 1,99 | **3,27** | real 8,39 |
| MAE | 7,49 | **6,59** | baseline 6,71 |
| Spearman | 0,066 | **0,213** | baseline 0,248 |

El R² se multiplica por diez, el sesgo de casi cuatro puntos desaparece, y el
MAE pasa de perder contra el baseline por 0,78 a **ganarle por 0,12**.

Los multiplicadores reajustados lo confirman por otra vía: el del quarterback
pasa de **0,812 a 1,022**. Ese 0,812 no era una calibración, era un parche que
recortaba un 19% para tapar los términos que faltaban. Los de RB, WR y TE suben
también (1,022 / 1,061 / 1,127), que es lo que corresponde tras quitar la resta
de escapadas que deprimía los acarreos un 8,4%.

## El modelo puro NO pasa el umbral en ninguna posición

| pos | MAE mod | MAE base | gana | ρ mod | ρ base | pierde | ok | sesgo |
|---|---|---|---|---|---|---|---|---|
| QB | 6,594 | 6,712 | SÍ | 0,213 | 0,248 | −0,035 | **NO** | −0,285 |
| RB | 5,737 | 5,732 | **NO** | 0,552 | 0,560 | −0,008 | SÍ | −0,024 |
| WR | 5,308 | 5,220 | **NO** | 0,509 | 0,529 | −0,020 | SÍ | +0,089 |
| TE | 5,277 | 5,176 | **NO** | 0,307 | 0,333 | −0,026 | **NO** | −0,487 |

El QB gana en error y pierde en orden. RB, WR y TE pierden en error por muy
poco. **Ninguna de las cuatro pasa.**

Hay un detalle que merece decirse: RB, WR y TE tienen ahora **peor** MAE que
antes de los arreglos (WR 5,19 → 5,31). No es que los arreglos empeoraran el
modelo: es que el multiplicador se ajusta para igualar la **media**, y con una
distribución sesgada a la derecha como la de los puntos de fantasy, el predictor
que minimiza el MAE es la **mediana**. Los multiplicadores viejos —bajos, 0,94 y
0,97— estaban accidentalmente más cerca de la mediana. El nivel correcto y el
MAE mínimo no son el mismo número, y aquí se ha elegido el nivel correcto porque
sin él no se pueden comparar posiciones entre sí.

## La regla de decisión se aplica: se publica la mezcla

`w · forma reciente + (1 − w) · modelo`, con `w` ajustado sólo sobre 2022–2023.

| pos | w | MAE mezcla | MAE base | gana | ρ mezcla | ρ base | gana |
|---|---|---|---|---|---|---|---|
| QB | 0,35 | **6,574** | 6,712 | SÍ | 0,236 | 0,248 | **NO** |
| RB | 0,60 | **5,666** | 5,732 | SÍ | **0,570** | 0,560 | SÍ |
| WR | 0,50 | **5,150** | 5,220 | SÍ | **0,537** | 0,529 | SÍ |
| TE | 0,65 | **5,131** | 5,176 | SÍ | **0,335** | 0,333 | SÍ |

**La mezcla bate al baseline en MAE en las cuatro posiciones, y en Spearman en
tres de las cuatro.** Ningún peso llega a 0,95, así que el modelo aporta en
todas: no se da el caso que obligaba a decir «esto es una media de seis
partidos con adornos».

## Lo que hay que decir del quarterback, y se dice

La mezcla de QB **reduce el error** (6,57 frente a 6,71) pero **ordena algo
peor** que la media ponderada de sus seis últimos partidos (Spearman 0,236
frente a 0,248). Si lo que quieres es acertar cuántos puntos hará, la mezcla es
mejor. Si lo que quieres es saber cuál de dos quarterbacks hará más, la media de
sus últimos seis partidos sigue siendo igual de buena.

Esto no se esconde detrás de un promedio de las cuatro posiciones.

## Efecto secundario: los números publicados ahora componen

Antes se publicaba `baseline_points` y `matchup_multiplier` junto a un
`projected_points` que no salía de multiplicarlos: el QB1 de la jornada aparecía
con baseline 20,1, multiplicador 1,04 y proyección 15,2. Quien intentara la
aritmética evidente obtenía otro número. Ahora se publican `model_points`,
`baseline_points` y `blend_weight`, y componen exactamente — con un test que lo
fija.

## Pendiente, y por qué no se ha tocado

`_defense_vs_position` calcula la media esperada de cada jugador **incluyendo el
partido que evalúa**. No es fuga hacia el futuro —toda la ventana es pasada—
pero sí un sesgo hacia 1,0 en el multiplicador de emparejamiento, que ya viene
amortiguado al 45%. La corrección (media dejando fuera esa observación) es
barata. **No se ha hecho aquí a propósito:** cambiarla a mitad de este
experimento habría confundido los dos efectos. Va con su propio preregistro.
