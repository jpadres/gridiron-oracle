# Plan del modelo: qué se puede medir, qué costaría y qué no está aquí

Fecha: 3 de septiembre de 2026.

Se pidió ir a fondo: coordinadores defensivos, esquemas, oportunidades, planes de
partido, momios, clima, lesiones, temperatura, «cómo van a jugar». Este
documento separa tres cosas que se mezclan con facilidad:

1. **Lo que el modelo YA consume** — y que conviene saber antes de pedir más.
2. **Lo que se puede medir con lo que hay descargado** — y por tanto se mide.
3. **Lo que exigiría una fuente nueva** — con lo que costaría y qué habría que
   demostrar para que entre.

La regla que ordena todo esto no cambia: **el modelo iguala a la línea de cierre
y no la bate** (Brier 0,2118 contra 0,2113; MAE 10,00 contra 9,97 en 3.829
partidos fuera de muestra). Cualquier añadido que aparente batirla con holgura
es sospechoso de fuga antes que de mérito.

---

## 1. Lo que el modelo ya consume

Antes de añadir nada conviene no pedir dos veces lo mismo. Hoy entran:

| Familia | Columnas | Qué captura |
|---|---|---|
| Fuerza | `elo_diff`, `elo_margin`, `market_elo_margin` | Elo con margen y Elo calibrado al mercado |
| Eficiencia | `off_epa_diff`, `def_epa_diff`, `net_rating_diff`, `pass_epa_diff`, `rush_epa_diff` | EPA ajustada por rival, separada por pase y carrera |
| Forma | `form_diff` | Desviación reciente sobre el propio nivel |
| Quarterback | `qb_diff`, `qb_vs_offense` | Rating del QB y su hueco contra el ataque de su equipo |
| Contexto físico | `rest_diff`, `travel_miles_diff`, `tz_shift_away`, `altitude_delta_away`, `neutral_site`, `indoors` | Descanso, viaje, husos, altitud, techo, campo neutral |
| Incertidumbre | `experience_min`, `travel_known` | Cuánto se sabe de los dos equipos y si la sede se pudo situar |
| Mercado | `spread_line`, `total_line` | El modelo predice el RESIDUO contra la línea, no el partido en bruto |

O sea: **descanso, viaje, husos, altitud y techo ya están**. «El clima» que
faltaba era literalmente viento y temperatura, y eso es lo que mide
`docs/PREREGISTRO_clima.md`.

Y hay una pieza que la gente no espera: el modelo **no predice el partido**,
predice **la diferencia contra la línea**. Es la razón de que sea tan difícil
mejorarlo: la línea ya trae dentro casi todo lo que se le pueda añadir.

---

## 2. Lo que se puede medir hoy, con los datos ya descargados

### 2a. Viento y temperatura — MEDIDO (ver `PREREGISTRO_clima.md`)

Único experimento que los datos actuales permiten cerrar sin fuente nueva. Con
una asimetría que lo hace barato: los datos de nflverse son las condiciones
REALES del partido, no el pronóstico del viernes. Si con el dato real no mejora,
con un pronóstico tampoco, y la pregunta queda cerrada para siempre.

### 2b. Reparto de oportunidad por jugador — YA ESTÁ, en fantasy

Lo que en el pedido se llamó «oportunidades» ya existe para fantasy:
`fantasy/weekly.py` proyecta intentos de pase, acarreos y objetivos desde el
guion del partido (margen y total proyectados deciden cuántas jugadas y de qué
tipo). Ahí están las tres correcciones que costaron iteraciones: los dropbacks
del equipo no son los intentos del QB, un equipo tiene UN titular, y la cuota se
calcula sobre los partidos del equipo.

### 2c. Líneas de APERTURA — el hueco que más vale, y no está descargado

El backtest mide contra la línea de **cierre**, que es la que nadie apuesta. El
edge, si existe, está entre la apertura y el cierre. nflverse publica el cierre
(`spread_line`, `total_line`) y **no la apertura**. Es la primera prioridad del
roadmap por una razón: no es un modelo mejor, es medir contra el número correcto.

Coste: una fuente histórica de aperturas (varias existen, de pago o raspando) y
un experimento que compare EV contra apertura y contra cierre. Sin eso, la
página de apuestas seguirá siendo honesta y limitada.

---

## 3. Lo que exigiría una fuente nueva

Aquí es donde hay que ser claro: **estas cosas no están en el repositorio y no
se pueden inventar**. Cada una lleva lo que costaría y, sobre todo, qué habría
que demostrar para que entrara al modelo.

### 3a. Lesiones (informes oficiales)

- **Fuente**: nflverse publica los partes semanales (`load_injuries`). Es la
  pieza que más cerca está: se descarga igual que lo demás.
- **Lo bueno**: el parte del viernes es información PREVIA al partido. No es
  fuga usarla.
- **El riesgo real**: la designación no es el impacto. «Dudoso» del titular no
  vale lo mismo que «dudoso» del tercer receptor, y el mercado ya mueve la línea
  cuando sale el parte. Habría que medir el residuo contra la línea **después**
  de que la noticia esté pública.
- **Umbral honesto**: lo mismo que el clima — mejora en 3 de las últimas 4
  temporadas o INCONCLUSO.

### 3b. Coordinadores defensivos, esquemas y personal

- **Fuente**: no existe en nflverse en forma estructurada. Hay tablas de
  personal (11, 12, nickel, dime) en proveedores de pago, y los cambios de
  coordinador hay que mantenerlos a mano.
- **El problema de fondo**: un cambio de coordinador es un evento por equipo y
  temporada. Con 32 equipos y ~10 cambios al año, son ~10 observaciones por
  temporada para estimar un efecto que el mercado ya conoce desde enero. La
  potencia estadística es casi nula, y el proyecto ya rechazó dos cambios por
  exactamente eso (el ancla y el castigo por mover de equipo).
- **Lo que sí se puede hacer HOY sin modelo**: publicarlo como contexto en la
  capa de prensa, que es donde ya viven los estados de jugador — con su fuente y
  su fecha, sin tocar un número (regla 8).

### 3c. «Cómo van a jugar»: ritmo, proporción de pase, plan de partido

- **Fuente**: derivable del play-by-play que YA está descargado (ritmo, pase
  sobre neutral, uso de play-action). No hace falta comprar nada.
- **Por qué no está**: el guion del partido ya entra por el margen y el total
  proyectados, que es la forma agregada de lo mismo. Añadir ritmo bruto sin
  ajustarlo por marcador mete el efecto al revés — un equipo que va perdiendo
  corre más jugadas, y eso es consecuencia, no causa.
- **Experimento razonable**: proporción de pase en situación NEUTRAL (marcador
  ajustado, primera mitad), que sí es plan y no reacción. Es la siguiente pieza
  medible después del clima.

### 3d. Props de jugador

Requiere cuotas de props históricas (de pago) para saber si el modelo de fantasy
bate a esas líneas. Sin ellas se puede publicar la proyección, no el valor.

---

## 4. El orden que recomienda este documento

1. **Clima** (hecho: `PREREGISTRO_clima.md`). Cierra una pregunta con lo que ya hay.
2. **Lesiones desde nflverse**. Es la única fuente nueva barata y con hipótesis clara.
3. **Líneas de apertura**. El mayor valor esperado de todo el proyecto, y no es
   un modelo: es medir contra el número que sí se puede apostar.
4. **Proporción de pase en situación neutral**. Del play-by-play que ya está.
5. Coordinadores y esquemas: **como contexto publicado, no como feature**, hasta
   que exista una fuente y una hipótesis que sobrevivan al umbral.

Lo que NO se va a hacer: meter una variable porque suena a que debería importar.
Cada una de las cinco lleva su preregistro con el umbral escrito antes, y el
resultado se publica aunque sea negativo. Es lo que hace que los números de este
sitio se puedan creer.
