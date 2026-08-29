# Preregistro — geografía de sede y techo por partido

**Fecha:** 2026-08-29. **Escrito y commiteado ANTES de medir el efecto.**

## Los dos defectos encontrados

Ambos verificados sobre `data/processed`, no supuestos.

### 1. Geografía posterior a la mudanza aplicada a temporadas anteriores

`normalize_team` traduce `STL → LAR`, `SD → LAC` y `OAK → LV` para que la
continuidad de franquicia funcione en Elo — y eso está bien. El efecto colateral
es que `TEAM_STADIUMS` devuelve entonces la sede **actual** para una temporada en
la que el equipo jugaba en otra ciudad.

| equipo | sede real | temporadas | partidos de local | error |
|---|---|---|---|---|
| LAR | Edward Jones Dome, San Luis | 1999–2015 | 141 | 1.594 millas, −2 husos |
| LAC | Qualcomm, San Diego | 1999–2016 | 149 | 107 millas |
| LV | Coliseum, Oakland | 1999–2019 | 173 | 404 millas |

463 partidos con la sede local mal situada y 461 con el origen de viaje del
visitante mal situado.

`travel_profile` tiene una rama que dice atender esto («Equipo desconocido
(reubicaciones antiguas: STL, SD, OAK)»). **Es inalcanzable**: `normalize_team`
corre antes y nunca deja pasar `STL`. Es una protección documentada que no
protege — peor que no tenerla, porque deja la sensación de que algo vigila.

### 2. `indoors` derivado de una tabla estática teniendo el dato real al lado

nflverse trae `roof` por partido (`dome`, `closed`, `open`, `outdoors`) y ya está
cargado en `games.parquet`. El feature `indoors` no lo usa: sale de un campo fijo
por equipo. Resultado: **713 de 7.276 partidos (9,8%) con el valor equivocado.**

| equipo | partidos mal | motivo |
|---|---|---|
| LAC, LV | 173 cada uno | jugaban a cielo abierto antes de mudarse |
| DAL | 90 | techo retráctil, abierto ese día |
| ARI | 79 | ídem |
| HOU | 46 | ídem |
| LAR | 35 | Memorial Coliseum, a cielo abierto |
| IND, ATL, MIN, SEA | 85 entre los cuatro | ídem |

Un partido en Dallas con el techo abierto y otro con el techo cerrado no son el
mismo entorno. El modelo los trataba como idénticos.

## Hipótesis

Corregir los dos defectos mejora el modelo de partidos, porque el viaje, el
cambio de huso y el techo dejan de estar mal medidos en el 10–12% de la muestra.

## Métrica y umbral, fijados antes de medir

Backtest walk-forward desde 2012, la configuración publicada, comparando
**antes** y **después** sobre exactamente los mismos partidos.

- **Métrica principal:** MAE de margen fuera de muestra.
- **Métrica secundaria:** Brier.
- **Umbral de mejora:** MAE ≥ **0,02 puntos** mejor Y Brier no peor de
  **0,0005**. Por debajo de eso se declara **sin efecto medible**.
- **Umbral de alarma:** si el MAE mejora más de **0,15 puntos**, la hipótesis por
  defecto **no** es que el modelo mejoró: es que algo se rompió o entró
  información que no debería. Se investiga antes de publicar.

## Qué pasa con cada resultado

**Los dos defectos se corrigen pase lo que pase.** No es un experimento cuyo
resultado decida si se arregla un dato falso: 713 partidos tienen mal el techo y
924 tienen mal la geografía, y eso es incorrecto independientemente de lo que
diga el MAE.

Lo que el umbral decide es únicamente **qué se puede afirmar**:

- Mejora ≥ umbral → se publica como mejora, con el número.
- Mejora por debajo → se publica «corregido, sin efecto medible en el backtest».
  Es el resultado más probable: son features de segundo orden.
- Empeora → se publica que empeoró, y se investiga por qué un dato correcto da
  peor métrica que uno incorrecto. Un empeoramiento con el dato bueno significa
  que el modelo estaba explotando el error, y eso hay que entenderlo.
