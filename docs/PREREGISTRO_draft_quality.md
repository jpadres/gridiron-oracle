# Preregistro — ¿la recomendación con contexto de plantilla DRAFTEA mejor?

**Fecha: 2026-09-05. El umbral se fija AQUÍ, antes de correr nada.**

`BEST_PICK_FOR_ME` está implementado desde septiembre de 2026 y sigue `BLOCKED`
en el registro porque su coherencia está cubierta y su **calidad de decisión no
está medida**. Esto es esa medición.

## La pregunta

Draftear siguiendo «Best pick for you» —el que más añade a tu alineación, con
saturación por huecos declarados— ¿produce **más puntos realizados** que
draftear siguiendo el board a secas (mejor disponible por VOR)?

## Por qué la métrica NO puede ser la que el motor optimiza

`bestForMe` maximiza el valor PROYECTADO de la alineación titular. Medirlo con
esa misma cantidad daría una victoria garantizada y vacía: estaría comprobando
que un optimizador optimiza. La medición se hace con **puntos REALIZADOS** de la
temporada, que el motor no puede ver — ni en el momento de recomendar ni nunca.

## Diseño

* Temporadas **2019-2025**, walk-forward: el board de la temporada S se compila
  sólo con datos anteriores a S (`project_season`, que ya lo garantiza).
* Liga de **12 equipos, snake, 15 rondas**, plantilla
  `QB RB RB WR WR TE FLEX DEF K` + banquillo.
* Los **once rivales** cogen siempre el mejor disponible por VOR, en los dos
  brazos. Así el estado inicial de cada turno mío es el mismo hasta que yo elija
  distinto, y a partir de ahí la divergencia es la consecuencia real de mi
  decisión, no del azar.
* Dos brazos, **el mismo simulador**:
  * **BOARD** — mi equipo coge el primero por VOR.
  * **AJUSTADO** — mi equipo sigue `bestForMe()`, la MISMA función que corre en
    producción. No se reimplementa en Python: el simulador es Node y la importa.
* **Los 12 puestos de draft** en cada temporada. n = 7 × 12 = **84 pares**.

## La métrica

Puntos **realizados** (PPR) de la alineación titular, donde los titulares se
eligen por **proyección** —la alineación que habrías puesto— y se puntúan con lo
que de verdad hicieron. No es la alineación óptima a posteriori: eso sería
hindsight, y se aplicaría igual a los dos brazos pero mediría otra cosa.

Comparación **pareada** por (temporada, puesto de draft).

## El umbral, fijado ahora

Sea `d` la media de la diferencia pareada (AJUSTADO − BOARD), en puntos por
equipo-temporada, y `t` el estadístico pareado.

| Resultado | Decisión |
|---|---|
| `d ≥ +15` y `t ≥ 2` y positivo en ≥ 5 de las 7 temporadas | **VALIDATED** |
| `d ≤ −15` y `t ≤ −2` | **REJECTED** — el ajuste EMPEORA el draft |
| cualquier otro caso | **sigue BLOCKED**, y se publica el número |

Quince puntos por temporada son ~1 punto por jornada: menos que eso no cambia
una liga y no justifica llamar a esto una mejora medida.

**El resultado se publica salga como salga**, y si sale inconcluso también — un
inconcluso con su n al lado es información, y esconderlo sería exactamente lo
que la regla 3 prohíbe.

## Lo que esta medición NO contesta

* No mide contra un humano, sólo contra el board.
* Los rivales son un autodraft por VOR, que no es cómo juega una liga real: no
  hay carreras por posición, ni reaches, ni nadie que se vacíe de corredores.
* La alineación se fija una vez por temporada, no jornada a jornada.
* Siete temporadas y una estructura de liga. Otra plantilla puede dar otra cosa.


---

# RESULTADO (E23) — corrido el 2026-09-05

    n = 84 pares (7 temporadas × 12 puestos de draft)
    d = +91,4 puntos por equipo-temporada   t = 4,51   7 de 7 temporadas positivas

**Y ese número no es el que vale.** Antes de darlo por bueno se hizo el control
que este proyecto exige ante un resultado grande: ¿de dónde sale la ventaja?

    huecos titulares VACÍOS por equipo:  board 0,27   ajustado 0,00

Un drafter por VOR puro no mira huecos, así que a veces **termina sin ala
cerrada** — y un hueco vacío son cero puntos. Eso no es elegir mejor: es que el
rival se dejó un hueco sin llenar. Restringiendo a los pares donde el board SÍ
completó su alineación:

    n = 63 de 84
    d = +48,3 puntos por equipo-temporada   t = 2,32   6 de 7 temporadas positivas

    -> el 47% del efecto de portada venía de los huecos vacíos del baseline

Ese subanálisis **no estaba en el preregistro** y se añadió a sabiendas, en la
dirección conservadora: puede tumbar un resultado positivo y nunca rescatar uno
negativo. Usarlo al revés —probar cortes hasta que uno salga bien— sería elegir
el resultado.

## VEREDICTO: VALIDATED, por la regla fijada antes

`d = +48,3 ≥ +15`, `t = 2,32 ≥ 2`, `6 de 7 ≥ 5`. Se cumple el umbral tal como se
escribió, y se aplica tal como se escribió.

## Y AHORA LO QUE HAY QUE LEER ANTES DE FIARSE

Por temporada, en el subconjunto limpio:

| 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|
| +53,2 | +100,0 | +88,9 | +128,3 | +12,3 | +5,6 | **−36,8** |

**El efecto está concentrado en 2019-2022 y ha desaparecido en las dos últimas
temporadas, con la última en negativo.** Eso no anula el veredicto —la regla se
fijó antes y se respeta— pero cambia lo que se puede decir en voz alta: esto NO
es «gana 48 puntos al año». Es «ganó mucho hace cinco años, nada hace dos y
perdió el año pasado», y con `t = 2,32` la evidencia es modesta.

Una hipótesis razonable y NO comprobada: el board ha mejorado con los años
(novatos con previa, ancla del encogimiento, reemplazo voraz), y cuanto mejor
ordena el board, menos queda por ganar reordenando por plantilla. Comprobarlo
exige otro preregistro, con su umbral, sobre las temporadas recientes.

## Lo que este número NO dice

* El baseline es un autodraft por VOR puro. **No es un humano**, y ningún humano
  se deja el ala cerrada sin llenar. Contra un drafter competente la ventaja
  medida aquí sería menor — probablemente mucho menor.
* Los once rivales draftean igual en los dos brazos, sin carreras por posición
  ni reaches. Una liga real no se comporta así.
* La alineación se fija una vez por temporada y no jornada a jornada.
* Siete temporadas, una estructura de liga, 63 pares limpios.
