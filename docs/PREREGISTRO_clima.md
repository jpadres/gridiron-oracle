# Preregistro — viento y temperatura en el modelo de partidos

Fecha: 2026-09-03. Escrito **antes** de correr el experimento.

## Por qué este experimento y no otro

Se pidió «ir a fondo» en el modelo: esquemas, coordinadores, planes de partido,
clima, lesiones. De todo eso, **una sola cosa se puede medir hoy con los datos
que el repositorio ya tiene descargados**, y es el clima. Lo demás está en el
plan de investigación (`docs/PLAN_MODELO.md`) con lo que costaría cada pieza; no
se anuncia como hecho lo que no está medido.

## Lo que el modelo YA usa

`FEATURE_COLUMNS` incluye `rest_diff`, `travel_miles_diff`, `tz_shift_away`,
`altitude_delta_away`, `neutral_site` e `indoors`. O sea: descanso, viaje, huso
horario, altitud y **si se juega bajo techo**. Lo que no entra es **cuánto
viento y cuánto frío** hace cuando no hay techo.

## La hipótesis, en una frase

El viento reduce el juego aéreo y los goles de campo, así que debería bajar el
**total** de puntos; el mercado lo sabe, pero puede no descontarlo del todo, y
esa diferencia sería una señal en el residuo contra `total_line`.

Sobre el **margen** la expectativa es que no aporte nada: el viento afecta a los
dos equipos, y sólo desequilibraría si un ataque dependiera del pase mucho más
que el otro — que es un efecto de segundo orden que este experimento no separa.

## La asimetría que hace que valga la pena correrlo

`temp` y `wind` de nflverse son las condiciones **registradas del partido**, no
el pronóstico que había el viernes. Usarlas es mirar por la ventana del futuro:

- Si con el dato REAL **no mejora**, con un pronóstico tampoco. La pregunta
  queda cerrada y no hay que montar una fuente meteorológica.
- Si mejora, **no es un edge todavía**: sería una cota superior, y haría falta
  un segundo experimento con pronósticos a 48 horas para saber cuánto sobrevive.

Publicar un resultado positivo como si fuera desplegable sería exactamente el
fallo que este proyecto persigue.

## El cambio que se prueba

Tres columnas nuevas, sólo para el partido al aire libre:

    wind_mph      = viento en mph, 0 bajo techo
    temp_f        = temperatura en °F, 21 °C (70 °F) bajo techo
    wind_outdoor  = wind_mph × (1 − indoors)

`wind_outdoor` es redundante con las otras dos por construcción, y va a
propósito: el ridge está estandarizado y la interacción explícita le ahorra
tener que descubrirla con un término lineal.

Lo que falte se rellena con la **mediana de la temporada anterior** para esa
sede, y una columna `weather_known` dice si el dato existía. Un cero de «no hay
dato» y un cero de «no hacía viento» no son lo mismo, y sin esa columna el
modelo aprende que lo desconocido es un día en calma — el mismo fallo que ya
está corregido con `travel_known`.

## Umbral de aceptación, fijado AHORA

Se adopta **sólo** si se cumplen las tres:

1. **MAE de totales** mejora ≥ **0,15 puntos** sobre el conjunto fuera de
   muestra completo (2012 en adelante).
2. Mejora en **al menos 3 de las últimas 4 temporadas**. Es la regla de este
   proyecto: una media que sale de dos años buenos y dos malos no es una mejora,
   es una casualidad con dos decimales.
3. No empeora el resto: MAE de margen no sube más de **0,01** ni el Brier más de
   **0,0005**.

Si (1) se cumple y (2) no: **INCONCLUSO**, y no se adopta.

Si el resultado es negativo se publica igual, aquí y en el README, con sus
números. Ésa es la regla 3.

## Lo que este experimento NO contesta

- Si un pronóstico a 48 horas conserva la señal (haría falta otra fuente).
- Si el clima afecta más a un equipo que a otro según su plan de juego.
- Nada sobre coordinadores, esquemas ni personal: no hay datos de eso aquí.
