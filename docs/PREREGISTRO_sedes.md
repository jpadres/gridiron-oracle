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

---

# RESULTADO — 2026-08-29

Medido **después** de escribir el umbral de arriba, sin tocarlo.

## Lo que cambió en los datos

| | antes | después |
|---|---|---|
| partidos con la sede mal situada | 924 lados | 0 |
| partidos con `indoors` distinto del `roof` real | 713 (9,8%) | 0 |
| partidos en sede neutral con viaje real | 0 de 102 | 102 de 102 |
| sedes sin coordenadas | — | 0 de 67 |

Los Rams de 1999–2015 vuelven a jugar en San Luis: sus husos horarios pasan de
un rango imposible a −1/0/+1/+2, que es lo que corresponde a la hora central.
Los 102 partidos en sede neutral pasan de una diferencia media de viaje falsa a
−0,037 (en millares de millas), es decir, prácticamente simétrica: los dos
equipos viajan, que es lo que ocurre de verdad.

## Backtest walk-forward desde 2012, 3.829 partidos

| métrica | antes | después | Δ |
|---|---|---|---|
| Brier | 0,2128 | 0,2127 | −0,0001 |
| Log-loss | 0,6138 | 0,6135 | −0,0003 |
| ECE | 0,0163 | 0,0167 | +0,0004 |
| Acierto | 66,28% | 66,40% | +0,12 pp |
| MAE de margen | 10,0403 | 10,0400 | −0,0003 |
| Registro contra el spread | 1861-1875-93 (49,8%) | 1854-1882-93 (49,6%) | −0,2 pp |

## Veredicto: **NO PASA EL UMBRAL — sin efecto medible**

El umbral pedía **0,02 puntos** de MAE. Se obtuvieron **0,0003**, unas setenta
veces menos. Brier y log-loss mejoran en la cuarta cifra decimal, el ECE empeora
en la cuarta, el acierto sube 0,12 puntos. Todo eso es ruido.

**Es el resultado que el preregistro daba por más probable, y se publica tal
cual.** El viaje, el huso horario y el techo son features de segundo orden en un
modelo cuyo peso está en Elo, EPA y el mercado; corregir el 10% de sus valores
no mueve una métrica agregada sobre 3.829 partidos.

## Y aun así las tres correcciones se quedan

Estaba escrito de antemano y se cumple: el umbral decidía **qué se puede
afirmar**, no si se arregla un dato falso.

- 713 partidos tenían mal si se jugaron bajo techo. Eso era incorrecto.
- 924 lados de partido situaban a un equipo en una ciudad a la que se mudó años
  después. Eso era incorrecto.
- Los 102 partidos de Londres, México y Múnich se calculaban como si nadie
  hubiera volado. Eso era incorrecto, y además contradecía lo que el propio
  docstring del módulo decía que hacía.

Lo que **no** se puede decir es «el modelo mejoró». No mejoró de forma medible.

## Efecto secundario: código muerto retirado

`NEUTRAL_STADIUMS` y el parámetro `venue` de `travel_profile` se eliminan. No
eran una capacidad: `_venue_key` leía una columna que no existe, así que en toda
la vida del proyecto no se ejecutaron ni una vez. Nueve estadios internacionales
cuidadosamente documentados que nunca situaron un partido.

También se corrige el comentario de la rama defensiva de `travel_profile`, que
afirmaba proteger de las reubicaciones antiguas. No lo hacía —`normalize_team`
corre antes— y esa afirmación falsa es probablemente el motivo de que el defecto
sobreviviera: había un comentario que decía que estaba resuelto.
