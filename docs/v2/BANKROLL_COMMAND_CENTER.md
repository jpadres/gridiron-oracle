# Betting Bankroll Command Center — auditoría y diseño

Estado: **DISEÑO. Nada implementado.** 30/8/2026.

Este documento audita lo que hay, diseña lo que se puede construir y deja
explícito lo que queda cerrado hasta que exista evidencia. No propone ni una
línea de código que afirme algo que los datos no sostienen.

La regla de `docs/REGLA_edge.md` gobierna todo lo que sigue:

> **MODEL DISAGREEMENT ≠ EDGE.** El modelo iguala al mercado y no demuestra
> superarlo. 49,81% ATS, IC [48,2%, 51,4%], equilibrio 52,4%.

La consecuencia de diseño es incómoda y hay que decirla al principio: **este
producto no puede decirte qué apostar.** Puede decirte, con precisión y sin
inventar nada, *cuánto estás arriesgando, en qué, y qué te ha pasado hasta ahora*.
Eso es lo que se diseña aquí.

---

## 1. Auditoría de los datos de apuestas

Fuente única: `nfldata/games.csv` (nflverse), una fila por partido, descargada
por `data/ingest.py`. No hay ninguna otra fuente de mercado en el proyecto.

### 1.1 Inventario por campo

| Campo | Estado | Evidencia medida |
|---|---|---|
| Líneas de partido (spread) | **AVAILABLE** | `spread_line`, 100% de 1999-2023, 81% de 2024-2026 |
| Totales | **AVAILABLE** | `total_line`, 96,1% desde 2012 |
| Moneylines | **AVAILABLE** | `home/away_moneyline`, 96,1% desde 2012; **0% antes de 2006** |
| Precio del spread | **AVAILABLE, SIN USAR** | `home/away_spread_odds`, 96,1% desde 2012, valores reales (−121…+104) |
| Precio del total | **AVAILABLE, SIN USAR** | `over_odds`/`under_odds`, 96,1% desde 2012 |
| Props de jugador | **NOT AVAILABLE** | cero campos en todo el repositorio |
| Casa de apuestas | **NOT AVAILABLE** | ninguna columna identifica el libro. El precio es un agregado sin procedencia |
| Timestamps de la cuota | **NOT AVAILABLE** | ninguna columna de cuándo se tomó ese precio |
| Movimiento de línea | **NOT AVAILABLE** | una fila por partido, un valor por campo |
| Línea de apertura | **NOT AVAILABLE** | no existe la columna |
| Línea de cierre | **HISTORICAL ONLY** | ver §1.2 — es el mismo campo, y esa es la trampa |
| Snapshots de mercado | **NOT AVAILABLE** | no se guarda ninguna serie temporal |
| Probabilidad implícita | **AVAILABLE (derivada)** | `betting/odds.py` + `devig_shin` |
| Salidas del modelo | **AVAILABLE** | `pred_margin`, `pred_total`, `home_win_prob` |
| Resultados históricos | **AVAILABLE** | `result`, 93,4% desde 2012; 285/285 en 2025 |
| Registro de apuestas | **NOT AVAILABLE** | no existe |
| Liquidación | **NOT AVAILABLE** | no existe |
| Estado del bankroll | **NOT AVAILABLE** | `bankroll` es un argumento de CLI, no un estado |

### 1.2 El hallazgo que condiciona todo lo demás

**`spread_line` es un campo mutable cuyo significado depende de si el partido se
ha jugado.** Medido hoy sobre 2026:

| Jornada | Partidos | Con línea |
|---|---|---|
| 1-6 | 93 | 93 (100%) |
| 7 | 14 | 7 |
| 8 | 14 | **0** |
| 9-18 | 151 | 12 |

Y 2025, temporada cerrada: 285 de 285.

Es decir: la línea aparece cuando el mercado la publica y **se sobrescribe hasta
quedar en el cierre**. El backtest mide contra el cierre porque para partidos
jugados eso es lo que hay en la columna. Pero para un partido futuro, esa misma
columna contiene una línea *temprana* que va a desaparecer.

Tres consecuencias, y ninguna es opcional:

1. **CLV es computable a posteriori, no en vivo.** Si se guarda la línea del
   momento de la apuesta y más tarde se lee la misma columna del mismo partido,
   la diferencia es CLV real. Pero sólo funciona **si la apuesta se congela en el
   momento**; sin eso no hay nada contra qué comparar.
2. **La snapshot inmutable no es una floritura: es el requisito técnico.** Sin
   ella, la única fuente de la «línea a la que aposté» es un campo que ya se
   reescribió.
3. **La frescura del dato de un partido futuro es desconocida.** No hay
   timestamp. La UI no puede decir «línea de hace 2 horas»; como mucho puede
   decir «de la última descarga de nfldata», que es lo que de verdad sabe.

### 1.3 Un defecto real encontrado durante la auditoría

`betting/value.py` evalúa los spreads a un precio inventado:

```python
DEFAULT_SPREAD_ODDS = -110.0   # "convención del mercado americano"
```

Pero `home_spread_odds` y `away_spread_odds` **existen y están al 96,1% desde
2012**, con precios reales entre −121 y +104. Usar −110 cuando el precio real es
−121 sobreestima el EV de esa apuesta. No cambia la conclusión del proyecto (no
hay edge, y el sesgo va en contra del modelo, no a favor), pero es un número
publicado que no sale de los datos, que es exactamente lo que este proyecto no
hace en ningún otro sitio. **Corregirlo es prerequisito de cualquier trabajo de
apuestas, y obliga a revalidar E4.**

---

## 2. Qué se puede construir ahora

Todo esto depende **sólo de datos que yo introduzco**, no de una capacidad
predictiva. Por eso es construible sin validar nada:

- Libro mayor de bankroll (§4), completo y auditable.
- Unidades relativas al bankroll, configurables.
- Guardarraíles de exposición y capacidad restante.
- Ciclo de vida de la apuesta, con snapshot inmutable en el momento de apostar.
- Constructor de boleto con exposición agregada por partido, equipo y mercado.
- Etiquetas de correlación **cualitativas** y con motivo escrito.
- Origen SISTEMA / DISCRECIONAL, y su comparación descriptiva.
- Command Center mensual descriptivo.
- Diario de decisión.
- Estado **SIN JUGADAS** como resultado normal y correcto.
- CLV *a posteriori* para partidos ya jugados (§1.2), con su advertencia.

## 3. Qué necesita mejores datos, y qué necesita validación

| Cosa | Falta | Clase |
|---|---|---|
| Line shopping | precios por casa | **DATOS** |
| Movimiento de línea | serie temporal de mercado | **DATOS** |
| CLV en vivo | timestamps y línea de cierre separada | **DATOS** |
| Props de jugador (mercado) | cualquier fuente de props | **DATOS** |
| Props de jugador (modelo) | distribuciones por jugador validadas | **DATOS + VALIDACIÓN** |
| «Best Value Bets» | ver §11 | **VALIDACIÓN** |
| Coeficientes de correlación | medición sobre resultados conjuntos | **VALIDACIÓN** |
| Kelly / stake por confianza | probabilidades calibradas para apostar | **VALIDACIÓN** |
| «Fortalezas por mercado» | tamaño muestral suficiente | **VALIDACIÓN** |

Nota sobre props del modelo: los componentes (`carries × ypc`, `targets × ypt`,
`catch_rate`) **sí se calculan** dentro de `fantasy/weekly.py`, pero se colapsan
a puntos y nunca se han validado por separado. Además, lo que se publica es una
**mezcla** con el baseline (`blend_to_baseline` 0,35-0,65) aplicada a los puntos,
que no tiene descomposición coherente en componentes. Y una prop no necesita una
media: necesita una **distribución**, que es exactamente el motivo por el que
`MATCHUP_WIN_PROBABILITY` ya está BLOCKED. Publicar props sería reabrir por la
puerta de atrás una capacidad que ya está cerrada por delante.

## 4. Qué permanece oculto

| Elemento | Autoridad |
|---|---|
| «Best Value Bets», «Top Plays por EV», locks, estrellas de confianza | **HIDE** |
| Beneficio esperado, ROI proyectado | **HIDE** |
| Dimensionamiento por Kelly en la UI | **HIDE** (el motor se queda para el backtest) |
| Props de jugador | **HIDE** (no hay mercado ni distribución) |
| Coeficientes de correlación numéricos | **HIDE** |
| «Mercados en los que eres bueno» con n pequeña | **DATA_ONLY**, descriptivo y etiquetado |

---

## 5. Modelo de datos: bankroll

Libro mayor de **transacciones inmutables**. No hay saldo mutable en ninguna
parte: el saldo es una función del libro, siempre recalculada.

```
LedgerEntry
  id                 ULID, monótono en el tiempo
  occurred_at        cuándo pasó (lo dice el usuario)
  recorded_at        cuándo se anotó (lo dice el sistema)
  kind               DEPOSIT | WITHDRAWAL | STAKE | PAYOUT | REFUND | ADJUSTMENT
  amount_cents       entero con signo. NUNCA float
  bet_id             obligatorio en STAKE/PAYOUT/REFUND, nulo en el resto
  note               texto libre
  reverses_id        para corregir: se anota el reverso, no se edita el asiento
```

Reglas duras:

- **En céntimos enteros.** `0.1 + 0.2 != 0.3`, y un bankroll que no cuadra por
  medio céntimo destruye la confianza en todo lo demás.
- **Nada se edita ni se borra.** Una corrección es un asiento nuevo que apunta al
  viejo con `reverses_id`. El historial es el producto.
- **Un solo lado escribe cada cantidad.** `STAKE` la resta al apostar; `PAYOUT`
  suma la devolución total (importe + ganancia) al liquidar; `REFUND` devuelve el
  importe en push y void. Una apuesta ganada de 100 a −110 genera STAKE −100 y
  PAYOUT +190,91. Un push genera STAKE −100 y REFUND +100.

Cantidades derivadas, todas del libro:

```
current_bankroll  = Σ(todos los asientos)
open_exposure     = Σ(stake de apuestas en OPEN)
available         = current_bankroll − open_exposure
settled_pl        = Σ(PAYOUT + REFUND) − Σ(STAKE) sobre apuestas liquidadas
```

`available` es la cifra que manda en la interfaz, y es la única que responde a
«cuánto puedo apostar». `current_bankroll` sin restar la exposición abierta es el
número que hace que alguien apueste dos veces el mismo dinero.

### Unidades

```
unit_pct           por defecto 0,01 — configurable y visible, nunca escondido
unit_basis         MONTH_START | CURRENT | FIXED
```

`unit_basis` importa más de lo que parece: con base CURRENT una racha mala
encoge la unidad automáticamente (Kelly de pobres, y defendible), con
MONTH_START la unidad es estable dentro del mes y comparable. **Por defecto
MONTH_START**, porque el propósito principal es medirse, y una unidad que cambia
cada día hace incomparables las semanas de un mismo mes.

Incrementos: 0,25u / 0,5u / 0,75u / 1u. Nada por encima de 1u sin escribirlo a
mano y confirmar.

### Guardarraíles

```
max_per_bet             por defecto 1u
max_open_exposure       por defecto 5u
max_daily_exposure      por defecto 3u
max_weekly_exposure     por defecto 5u
max_same_game_exposure  por defecto 1,5u
max_player_exposure     por defecto 1u
```

Son **controles de riesgo, no predicciones**, y la UI lo dice con esas palabras.
Se muestran como `EXPOSICIÓN ACTUAL / CAPACIDAD RESTANTE`, nunca como una barra
de progreso que se llena: una barra al 40% invita a llegar al 100%, y aquí llegar
al máximo no es un logro, es el peor resultado posible.

Superar un límite **no bloquea**: avisa, exige confirmación y **marca la apuesta
como `over_limit`** para que después se pueda medir aparte si esas apuestas van
peor. Bloquear a un adulto en su propio dinero es teatro; medirle no lo es.

---

## 6. Modelo de datos: apuesta

```
Bet
  id                  ULID
  status              CONSIDERING | PLANNED | PLACED | OPEN | WON | LOST | PUSH | VOID
  origin              SYSTEM_CARD | DISCRETIONARY | WATCHLIST | OTHER
  created_at / placed_at / settled_at
  sportsbook          texto libre. Lo escribe el usuario: el proyecto no lo sabe
  game_id             clave de nflverse, o nulo si el mercado no es de partido
  market              SPREAD | MONEYLINE | TOTAL | OTHER
  selection / line / odds_american
  stake_cents / potential_payout_cents / actual_payout_cents
  over_limit          bool: se saltó un guardarraíl a propósito
  notes_why / notes_changed / notes_learned
  snapshot            ver abajo. Inmutable
```

### Snapshot inmutable

Se congela al pasar a `PLACED` y **nunca se reescribe**. Reutiliza
`narrative/snapshots.py`, que ya falla al sobrescribir en vez de machacar — esa
garantía es la mitad del producto:

```
snapshot
  taken_at
  line_at_bet / odds_at_bet
  market_prob_devig       Shin sobre el precio real del momento
  model_margin / model_total / model_win_prob
  model_version
  evidence                la ficha de betting/evidence.py de esa clase
  capability_status       BETTING_EDGE = REJECTED. Se congela también
  data_freshness          fecha de la descarga de nfldata que se usó
  bankroll_at_bet / available_at_bet / unit_size_at_bet
  reasoning               lo que escribió el usuario
```

Congelar `capability_status` parece redundante hoy, cuando siempre vale
REJECTED. No lo es: el día que cambie, la única forma de saber qué sabía el
producto cuando apostaste es que esté escrito en la apuesta.

**El cierre va aparte, y por eso funciona:**

```
closing
  line_at_close / odds_at_close
  captured_at
  source                  "nfldata games.csv"
  clv_points              line_at_close − line_at_bet, con el signo de la selección
```

Se rellena **después** del partido, releyendo `games.csv`, y sólo si el partido
ya se jugó. Nunca se estima, nunca se interpola. Sin cierre disponible el campo
queda vacío y la UI dice «sin cierre», no «0,0».

---

## 7. Tarjeta semanal

Grupos: **GAME LINES**, **TOTALS**, **WATCHLIST**. No hay grupo de props: no hay
datos. No hay «TOP PLAYS»: implicaría un orden por calidad que no se puede
justificar.

Lo que sí hay es un orden explícito y etiquetado como lo que es:

> **Ordenado por discrepancia entre el modelo y la línea.**
> Esto **no** es un orden de calidad. Medido sobre 3.736 apuestas, acertar **no
> aumenta** con la discrepancia: 49,3% / 50,9% / 48,8% por tramo, contra un
> equilibrio de 52,4%. Es un orden para mirar, no para apostar.

Por oportunidad se enseña sólo lo que tiene fuente: mercado, línea, precio real
(`spread_odds`, no −110), probabilidad implícita sin vig, la vista del modelo con
su discrepancia, la ficha histórica de esa clase de `betting/evidence.py`, la
hora del partido, la frescura del dato, y las limitaciones.

Y lo que **no** se enseña: EV, edge %, confianza, importe sugerido por calidad.

El estado vacío es un resultado de primera clase:

> **Ninguna jugada esta semana.**
> Es el resultado normal. Bajar el listón no crea ventaja, sólo la esconde.

Sin contadores regresivos, sin cuotas parpadeando, sin verde por defecto.

## 8. Props de jugador

**No se diseña interfaz.** Faltan las dos mitades: no hay ninguna fuente de
mercado de props en el proyecto, y el modelo no tiene distribuciones por jugador
validadas. Se registra como capacidad BLOCKED con lo que haría falta escrito.

Si algún día llega una fuente, la advertencia va escrita ya:

> **DIFERENCIA DE PROYECCIÓN ≠ VENTAJA.** Proyectar 72 yardas contra una línea de
> 68,5 no significa que el OVER valga. La línea incorpora información que el
> modelo no tiene, y el modelo tiene un error que la diferencia no muestra.

## 9. Constructor de boleto

Antes de confirmar: número de apuestas, importe total, % del bankroll, exposición
abierta resultante, desglose por partido / equipo / mercado, y capacidad restante
contra cada guardarraíl.

Correlación, **sólo cualitativa**:

- `POSIBLEMENTE CORRELACIONADAS` cuando comparten `game_id`, o comparten equipo,
  o combinan el spread de un equipo con el total del mismo partido.
- Con el motivo escrito: «las dos dependen de que este partido se juegue por
  arriba».
- **Nunca un coeficiente.** «correlación = 0,68» exigiría medir resultados
  conjuntos, y no está medido.

## 10. Command Center mensual

Bankroll inicial y actual, P/L, unidades, total apostado, exposición abierta,
número de apuestas, W/L/P, importe medio, desglose sistema vs discrecional y por
tipo de mercado. **ROI se muestra sobre el total apostado, nunca sobre el
bankroll**, y con la advertencia al lado.

La regla que gobierna esta pantalla:

> **Descriptivo, no evidencia.** Un 7-2 no demuestra habilidad. Con 9 apuestas,
> el intervalo de confianza al 95% (Wilson) del acierto va de **45,3% a 93,7%**:
> contiene el 52,4% del equilibrio, así que es perfectamente compatible con no
> tener ninguna ventaja.

Cualquier corte con **n < 100** sale marcado `MUESTRA PEQUEÑA — DESCRIPTIVO` y
sin ordenar de mejor a peor. La comparación sistema vs discrecional es la más
interesante y la que más tarda en significar algo; se publica desde el primer día
como descriptiva, con su n a la vista.

---

## 11. Cambios en el registro de capacidades

Se añaden cinco. Ninguna nace VALIDATED.

| id | status | authority | por qué |
|---|---|---|---|
| `BANKROLL_LEDGER` | VALIDATED | RECOMMEND | contabilidad, no predicción. Se valida con tests de reconciliación, no con un backtest |
| `EXPOSURE_GUARDRAILS` | VALIDATED | RECOMMEND | aritmética sobre datos propios |
| `BEST_VALUE_BETS` | REJECTED | DATA_ONLY | E4 ya lo midió y lo rechazó. Nace rechazada, no pendiente |
| `PLAYER_PROP_EDGE` | BLOCKED | HIDE | sin mercado y sin distribuciones por jugador |
| `CLOSING_LINE_VALUE` | BLOCKED | HIDE | ver §12. Desbloqueable con trabajo, no con datos nuevos |
| `BET_CORRELATION` | DESIGN_ONLY | HIDE | sólo etiquetas cualitativas hasta que se mida |

`BANKROLL_LEDGER` como VALIDATED merece una nota, porque es la primera capacidad
del registro que no se valida con un backtest: se valida con reconciliación
—«¿la suma del libro reproduce el saldo en todos los casos del red team?»— y eso
es una clase de evidencia distinta que el registro tiene que poder expresar sin
diluir lo que VALIDATED significa para las demás.

## 12. Plan de validación de «Best Value Bets»

E4 ya lo midió y lo **rechazó**: 49,81% ATS, IC [48,2%, 51,4%], equilibrio 52,4%.
Reabrirlo exige un experimento nuevo y preregistrado, no un ajuste de umbral.

**Preregistro obligatorio antes de mirar un solo resultado.** Requisitos, todos:

1. **Odds con timestamp y por casa.** Sin esto no hay nada que hacer: hoy no
   sabemos ni el libro ni la hora.
2. **Apertura y cierre como campos separados**, no un campo que se sobrescribe.
3. **Sólo features pregame**, con la garantía anti-fuga del proyecto: recalcular
   truncando el historial y comprobar que las filas anteriores no cambian.
4. **Baseline = el mercado**, no el azar. Batir al 50% no es nada.
5. **Walk-forward**, nunca cruzada aleatoria.
6. **Calibración medida**, no sólo acierto.
7. **De-vig con Shin** sobre el precio real, ya corregido el −110.
8. **Comparación con el cierre** como métrica de proceso.
9. **Coste de transacción**: el precio real disponible, no el mejor teórico.
10. **n ≥ 500** apuestas fuera de muestra en el tramo que se afirme.
11. **Estabilidad entre temporadas**: si el efecto sólo existe en un año, no
    existe.
12. **Un solo umbral**, fijado antes. Barrer veinte y quedarse con el mejor es
    sobreajuste con otro nombre.

Criterio de aceptación, escrito antes: **el límite inferior del IC95% del acierto
tiene que superar el equilibrio del precio real disponible.** No la media. El
límite inferior. Es el mismo criterio con el que se rechazó, y usar uno más laxo
al reabrir sería elegir el criterio después de ver el dato.

Hasta entonces `BEST_VALUE_BETS` = REJECTED / DATA_ONLY.

CLV (`CLOSING_LINE_VALUE`) es más barata y por eso va primero: sale gratis de la
snapshot inmutable más una relectura de `games.csv` tras el partido. Se desbloquea
midiendo si el CLV que produce este flujo predice algo, con n ≥ 200 apuestas
propias — que a 5-10 apuestas por semana son dos temporadas. Ese plazo es el
dato: no es una función que se entrega, es una medición que empieza.

---

## 13. Riesgos principales

1. **Que la interfaz suene más segura que la evidencia.** Es el riesgo número uno
   y es de diseño, no de código. Mitigación: la ficha de evidencia va pegada a
   cada oportunidad, y el estado vacío es de primera clase.
2. **Que el bankroll deje de cuadrar.** Mitigación: céntimos enteros, asientos
   inmutables, reversos en vez de ediciones, y un test de reconciliación en cada
   caso del red team.
3. **Que la mutabilidad de `spread_line` se cuele en el histórico.** Es el fallo
   más fácil de cometer y el más difícil de detectar: reconstruir «la línea a la
   que aposté» leyendo el CSV de hoy. Mitigación: la snapshot, y que nada lea la
   línea del CSV para una apuesta ya colocada.
4. **Que el −110 inventado contamine cualquier medición nueva.** Mitigación:
   corregirlo antes de tocar nada más, y revalidar E4 con el precio real.
5. **Que «sistema vs discrecional» se lea como un veredicto antes de tiempo.**
   Mitigación: n a la vista siempre, sin ordenar por debajo de 100.
6. **Que el producto fomente apostar.** Un panel de bankroll con capacidad
   restante puede leerse como una lista de tareas. Mitigación: capacidad como
   texto y no como barra que se llena; sin rachas celebradas; sin notificaciones.
7. **Que el usuario introduzca mal los datos.** Todo lo que se mide depende de
   que lo que se anota sea lo que se apostó. Mitigación: reversos visibles, y no
   presumir de precisión que depende de la entrada manual.

## 14. Qué hace esto mejor que una página de picks

Una página de picks te dice qué apostar y no lleva la cuenta. Esto es lo
contrario, a propósito:

1. **Publica que no tiene ventaja.** Una página de picks no puede permitírselo;
   su producto es la certeza. Aquí la evidencia va pegada a cada fila y casi
   siempre dice que no apuestes.
2. **La contabilidad es el producto, no un extra.** Lo único que este proyecto
   puede afirmar con rigor sobre tus apuestas es *cuánto has arriesgado y qué ha
   pasado*, y resulta que es también lo más útil.
3. **Separa la decisión del resultado.** Buena decisión con mal resultado es un
   estado representable. Ninguna página de picks lo tiene, porque su negocio es
   justamente confundirlos.
4. **Sistema contra discrecional.** El experimento más informativo disponible no
   es sobre la NFL: es sobre ti. Y es medible con lo que ya hay.
5. **Snapshots inmutables.** El postmortem sólo vale si lo que creías no se puede
   reescribir. `narrative/snapshots.py` ya falla al sobrescribir en vez de
   machacar, y esa garantía técnica es la que separa un registro de una opinión
   retroactiva.
6. **«Sin jugadas» es un resultado correcto.** Un producto que tiene que llenar
   una parrilla cada semana acabará inventando contenido. Éste no tiene que.
7. **El registro de capacidades gobierna la interfaz.** Lo que se puede afirmar
   no depende de quién escriba el copy: sale de un estado que exige un
   experimento para cambiar.

## 15. Red team — casos que el diseño tiene que resolver

Cada uno es un test antes de que exista la funcionalidad.

| Caso | Resolución de diseño |
|---|---|
| Depósito / retirada a mitad de mes | asientos con `occurred_at`; el mes se recalcula, no se parchea |
| Push | STAKE −100, REFUND +100. P/L cero, **no cuenta como victoria ni derrota** |
| Void | idéntico a push, con `status` distinto para poder medirlo aparte |
| La cuota se mueve tras apostar | irrelevante: la snapshot tiene la cuota tomada. El movimiento es CLV, no una corrección |
| Apuesta duplicada | aviso por (game_id, market, selection) abierta. No se bloquea: doblar puede ser deliberado |
| La misma apuesta en dos casas | dos apuestas, dos `sportsbook`. Suman a la exposición del partido |
| Apuestas correlacionadas | etiqueta cualitativa con motivo. Nunca un coeficiente |
| Se supera un límite | avisa, exige confirmación, marca `over_limit`, y luego se mide aparte |
| Semana sin apuestas | estado de primera clase, no un vacío |
| Racha buena o mala | se muestra el número, **nunca** «en racha». Con n<100, descriptivo |
| Falta la liquidación | la apuesta se queda OPEN y cuenta como exposición. Aviso pasadas 48 h del kickoff |
| Falta el cierre | campo vacío y «sin cierre». Jamás se estima |
| Jugador declarado fuera | es contexto del dossier, al lado. **No** recalcula nada de una apuesta colocada |
| Datos de mercado no disponibles | la tarjeta semanal enseña los partidos sin línea como *sin línea*. En 2026, la jornada 8 tiene cero |
| Dato viejo | `data_freshness` visible siempre; sin timestamp real se dice de qué descarga viene, no una hora inventada |
| Reseteo parcial de bankroll | un ADJUSTMENT con nota. **Nunca** borrar el libro |
| Discrepancia modelo-mercado grande | la ficha de evidencia dice que por encima de 3,5 puntos hay 28 casos en catorce temporadas y **no se publica tasa** |
