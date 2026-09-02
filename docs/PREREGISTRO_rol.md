# FIX #3 — Fase 1: señal de ROL que el modelo no ve. Research, sin código de modelo

Fecha: 2026-09-01. Todo lo de abajo está medido con `scripts/signal_stability.py`
y `scripts/vacated_volume_probe.py` (sólo diagnóstico; no tocan `draft.py`).

Punto de partida, ya medido: recalibrar no paga (disponibilidad INCONCLUSA,
ancla RECHAZADA, techo del gradiente ≈ 0). Lo único que puede mover el orden es
información que el modelo no tiene. A batir: valor capturado **RB 0,810**.

> Sobre el «82,6 % global»: no lo reproduzco. El arnés publica valor capturado
> POR POSICIÓN (QB 0,631 · RB 0,810 · TE 0,730 · WR 0,839); ponderado por su `k`
> estructural (12/24/12/36) da **0,785**, y la media simple 0,753. El listón de
> esta fase es el de RB, que es el que importa.

---

## 1. Qué hay ya en disco y no se usa

`draft.py` usa **sólo** los diez componentes de puntuación y `weighted_games`.
Todo esto está en `player_weeks` o en el pbp de `data/raw` y el board no lo mira:

| señal | dónde | estado |
|---|---|---|
| `targets`, `target_share`, `air_yards_share`, `receiving_air_yards`, `wopr`, `racr` | `player_weeks` (nflverse player_stats) | en disco, sin usar (el semanal sí usa `target_share`) |
| `carries` → cuota de acarreos | `player_weeks` | en disco, sin usar |
| aDOT = air yards / objetivos | derivable de `player_weeks` | sin usar |
| objetivos y acarreos en zona roja (≤20) y dentro de la 10 | pbp: `yardline_100`, `receiver_player_id`, `rusher_player_id` | en disco, sin usar |
| pass rate, **PROE** (`pass_oe`, `xpass`), ritmo (`plays`), `no_huddle`, `goal_to_go` | pbp | en disco, sin usar |
| `receiving_epa`, `rushing_epa`, `passing_cpoe` | `player_weeks` | en disco, sin usar |
| cambio de equipo | `roster_{S}` semana 1 vs equipo del historial | en disco; el board lo MARCA (`team_changed`), no lo usa |

**No en disco pero alcanzable** (nflverse releases; el proxy los deja pasar):

| dataset | desde | clave | qué aporta |
|---|---|---|---|
| `snap_counts/snap_counts_{S}` | **2013** (el fichero de 2012 existe y está vacío) | `pfr_player_id` | snaps y % de snaps ofensivos por partido |
| `pbp_participation/pbp_participation_{S}` | **2016** (verificado 2016, 2019, 2023-2025) | `offense_players` = lista de **gsis** por jugada (100 % de las jugadas) | snaps por jugador por jugada; `route` y `ngs_air_yards` en el 37-39 % de las jugadas (los pases); `offense_personnel` 76 % |
| `nextgen_stats/ngs_receiving|rushing|passing` (un fichero por tipo) | **2016** | `player_gsis_id` | separación, cushion, % de air yards intencionadas, YAC sobre esperado; agregado de temporada en `week == 0`, ~125 receptores cualificados por año |
| `ftn_charting/ftn_charting_{S}` | **2022** | `nflverse_game_id` + `play_id` → pbp | charting por jugada |

## 2. Cobertura histórica real

| señal | primera temporada útil | huecos |
|---|---|---|
| `targets` y todo lo derivado (cuota, air yards, WOPR, RACR, aDOT) | **2009** | 2003-2008 vienen a **cero, no a nulo**; 2006-2008 se ven 0,00/0,00 en la tabla de cobertura. Walk-forward con 3 años de historial: **2012-2025, 14 temporadas** |
| `carries` | ≤ 2006 | ninguno |
| zona roja desde pbp | ≤ 2006 | ninguno |
| `xpass` / `pass_oe` (PROE) | ≤ 2006 | **100 % en 2006-2025**, medido por equipo-temporada |
| `receiving_epa` | ≤ 2006 | 0,66-0,75 no nulo (sólo receptores) |
| snap counts | 2013 | walk-forward 2016-2025: 10 temporadas |
| participation | 2016 | walk-forward 2019-2025: **7 temporadas**, con `route` sólo en pases |
| NGS | 2016 | idem; sólo cualificados (~125 por año) |
| FTN | 2022 | **4 temporadas: no backtesteable** aquí |

## 3. Mapeo de identidades — explícito, sin nombres

El board y `player_weeks` van por **gsis**; el mapa horneado del payload es
`sleeper_id → gsis` (516 entradas hoy).

- **participation y NGS** van por gsis: cruce directo, sin traducción.
- **snap counts** van por `pfr_player_id`. La traducción sale de `roster_*.parquet`
  (2013-2026), que trae `gsis_id` y `pfr_id` en la misma fila: **331 de los 337
  veteranos del board tienen `pfr_id`**; **464 de los 516** del mapa horneado.
  **Cero** `pfr_id` compartidos por dos gsis. Del top-100 ninguno se queda sin
  `pfr_id`; del top-150 sin fila en snaps 2025: Tank Dell, Aiyuk, Mixon — no
  jugaron, no es un fallo del mapa.
- **FTN** va por `nflverse_game_id + play_id` → pbp → `receiver/rusher_player_id` (gsis).

Regla: quien no tiene la clave se queda **sin señal**, no se empareja por nombre.

## 4. Qué persiste año a año y qué es ruido

Mismo jugador, temporada t → t+1, ≥ 8 partidos en ambas, 2006-2025 (Spearman):

| señal | QB | RB | WR | TE |
|---|---|---|---|---|
| puntos por partido (lo que el modelo ya proyecta) | 0,54 | **0,69** | 0,74 | 0,71 |
| oportunidades por partido (objetivos + acarreos) | 0,81 | **0,75** | 0,75 | 0,72 |
| cuota de objetivos | 0,01 | 0,66 | **0,78** | **0,74** |
| cuota de acarreos | 0,81 | **0,75** | 0,54 | 0,40 |
| cuota de air yards | 0,06 | 0,36 | **0,78** | **0,76** |
| aDOT | — | 0,33 | 0,58 | 0,49 |
| toques en zona roja por partido | 0,63 | 0,64 | 0,60 | 0,56 |
| objetivos en zona roja | 0,08 | 0,44 | 0,59 | 0,56 |
| yardas por acarreo | 0,64 | **0,18** | 0,04 | 0,23 |
| yardas por objetivo | — | 0,08 | 0,23 | 0,20 |
| TD por toque | 0,22 | **0,17** | 0,19 | 0,15 |
| tasa de TD en zona roja | 0,10 | **0,12** | 0,17 | 0,14 |

Contexto de equipo, mismo equipo t → t+1: pass rate 0,42 · PROE 0,46 · jugadas 0,41.

Lectura: el **volumen** persiste tanto o más que los puntos; la **eficiencia**
(YPC, yardas por objetivo, TD por toque, TD en zona roja) es ruido, como se
sospechaba. El contexto de equipo persiste poco (≈ 0,45): cambia con el
entrenador y el QB, que es justo lo que no se puede leer del año anterior.

**La medida que decide** — ¿añade la señal algo por encima de los puntos del año
anterior? Spearman parcial con ppg_t+1 controlando ppg_t, y ΔR² lineal:

| señal_t | QB | **RB** | WR | TE |
|---|---|---|---|---|
| oportunidades/partido | 0,15 (+0,014) | **0,04 (+0,001)** | 0,03 | 0,01 |
| cuota de objetivos | 0,04 | **−0,03** | 0,11 (+0,004) | 0,12 (+0,005) |
| cuota de acarreos | 0,15 (+0,020) | **0,05 (+0,001)** | 0,02 | 0,02 |
| cuota de air yards | 0,02 | −0,02 | 0,09 (+0,004) | **0,19 (+0,011)** |
| toques en zona roja/partido | 0,13 (+0,015) | **−0,05** | 0,01 | −0,01 |
| TD por toque | 0,06 | −0,07 | −0,07 | −0,11 |

**En RB, ninguna añade nada** (|parcial| ≤ 0,07; ΔR² ≤ 0,002). Persisten, pero son
colineales con los puntos: los puntos ya son oportunidad × eficiencia, y la
eficiencia no persiste. En WR/TE la cuota de objetivos y de air yards añaden un
poco (0,11-0,19). En QB, la carrera (0,15).

### Lo que la persistencia no puede ver: el CAMBIO de rol

Sondeo con la plantilla de la semana 1 de S (lo que se sabe en agosto) y los
partidos de S−1, 2010-2025, ≥ 8 partidos previos. Parcial con puntos de S dado
ppg de S−1:

| señal | RB | WR | TE |
|---|---|---|---|
| volumen vacante del equipo de S (cuota de S−1 de los que ya no están) | 0,02 | 0,03 | 0,02 |
| vacante × (1 − cuota propia) | 0,02 | 0,02 | 0,01 |
| vacante, sólo entre los que cambiaron de equipo | 0,11 (n=350) | 0,14 | 0,17 |
| cuota de objetivos propia de S−1 | 0,02 | 0,16 | 0,24 |
| **cambió de equipo** | **−0,15** (n=1448) | **−0,18** | **−0,14** |

El volumen vacante, solo, no dice nada. **Cambiar de equipo sí**, y en la
dirección contraria a la intuición de mercado: en la mitad alta por puntos
previos, **el 21 % de los RB cambian de equipo y realizan 23,5 puntos MENOS** que
un stayer con los mismos puntos previos (WR −25,0, TE −18,4). El board hoy los
**marca** con la flecha de equipo y no toca el número: proyecta el reparto de uso
del equipo del que se fueron. Es la única señal de esta fase con |parcial| > 0,1
en RB, y está en disco desde 2002.

## 5. E22 — preregistro: el cambio de equipo entra en la proyección

**Hipótesis.** Un jugador que cambia de equipo hereda un reparto de uso que ya no
es el suyo; su proyección debe descontarlo. El descuento se **estima**, no se
elige: es el residuo medio de los movers en temporadas anteriores.

**Definición, sin parámetros libres.**
- `moved_S` = el equipo de la plantilla de S (semana 1 de `roster_S`) ≠ el equipo
  del último partido del historial. Conocido en agosto; sin dato de S.
- `penalty_{pos,S}` = media, en temporadas < S, de (puntos por partido realizados −
  ppg_shrunk proyectado) para movers de esa posición **menos** la misma media para
  stayers. Walk-forward estricto, como la previa de rookie.
- `ppg_ajustado = ppg_shrunk + moved_S × penalty_{pos,S}`. Nada más cambia.
- Variante secundaria E22b, sólo si E22 pasa: en vez de un descuento fijo,
  fiabilidad de mover `wg/(wg + 3·SHRINK_PRIOR_GAMES)` (más encogimiento).

**Ventana.** Walk-forward 2013-2025 (la penalización de 2013 se estima con
2010-2012). Pool congelado del arnés (top-180 por puntos de S−1, independiente
del modelo). Mismo `validate()`, predictor `model_move` al lado de `model` y
`last_season`.

**Predicción, escrita antes de correr.**
- Valor capturado RB: de 0,810 a **≥ 0,820**. Con un 21 % de movers en la mitad
  drafteable y −23,5 puntos de residuo, el efecto debe verse; si el orden de RB no
  se mueve **en absoluto**, la señal no vale para el board aunque exista.
- Sesgo de la banda 51-100 (hoy +5,1): debe **bajar**.
- Comprobación de cordura: el residuo de los movers en las temporadas de test
  tiene que acercarse a cero (hoy −23,5). Si mejora la métrica y el residuo no se
  mueve, ha mejorado por otra razón y se descarta.

**Umbral de aceptación.** Se acepta sólo si RB ≥ 0,820 **y** ninguna posición
empeora más de 0,005 **y** la comprobación de cordura pasa. Cualquier otra cosa es
INCONCLUSO y no entra. Sin segundo intento con otra forma funcional: si E22 y
E22b fallan, la respuesta es que el cambio de equipo no ordena mejor.

**Fuera de alcance de E22, en cola.**
- E23: cuota de objetivos y de air yards para **WR/TE** (parciales 0,11-0,24). No
  toca RB, así que no compite con E22 y se preregistra aparte.
- Snaps/participation/NGS: 7-10 temporadas de walk-forward. Sólo si E22 y E23
  dejan hueco; el coste de ingesta es un dataset nuevo con clave `pfr`.
- Volumen vacante y PROE: medidos, ≈ 0 en solitario. No se prueban.

**Coste.** Un campo (`moved`) que el board ya calcula, una tabla walk-forward de
penalizaciones por posición, un predictor más en `validate()`. Cero datasets
nuevos, cero cambios en el navegador hasta que pase.

---

# Antes de E22 — 2026-09-02

## 1. El «82,6% global» no existe en ningún sitio

Se buscó en el código, la web, los docs, el payload y el historial de git
(`git log -S`): **ningún fichero del repo publica ni calculó nunca un 82,6%**.
Los tres «82.6» del historial son cifras del fixture de paridad de E18. La web
publica el valor capturado **por posición**, y el arnés no agregaba nada.

La cifra correcta es la que reproduce el arnés: **media por posición ponderada
por `k`**, los titulares que la liga alinea de cada una (QB 12, RB 24, WR 36,
TE 12).

| predictor | QB | RB | TE | WR | **ALL (k)** |
|---|---|---|---|---|---|
| modelo | 0,631 | 0,810 | 0,730 | 0,839 | **0,785** |
| baseline (puntos del año anterior) | 0,623 | 0,730 | 0,709 | 0,838 | **0,758** |

Desde este commit el arnés publica la fila `ALL` con ese cálculo, en la misma
tabla que la web pinta, para que sólo exista un número global y sea el que
sale del código. El 82,6 era un recuerdo, no una métrica.

## 2. RB 0,810 temporada a temporada — la validación que nunca se hizo

Pool congelado (los 180 primeros por puntos de la temporada anterior), `k` de
la estructura. Modelo contra baseline (puntos del año anterior):

| temporada | QB modelo / base | RB modelo / base | TE modelo / base | WR modelo / base |
|---|---|---|---|---|
| 2022 | 0,617 / 0,786 | **0,864 / 0,643** | 0,790 / 0,903 | 0,957 / 0,857 |
| 2023 | 0,656 / 0,516 | **0,718 / 0,670** | 0,808 / 0,733 | 0,874 / 0,935 |
| 2024 | 0,856 / 0,801 | **0,883 / 0,831** | 0,659 / 0,600 | 0,779 / 0,728 |
| 2025 | 0,397 / 0,391 | **0,773 / 0,775** | 0,578 / 0,684 | 0,742 / 0,836 |
| gana en | 3 de 4 | **3 de 4** | 2 de 4 | 2 de 4 |

Lectura honesta de RB: **no es media de dos buenas y dos flojas**. Gana en
2022 (+0,221), 2023 (+0,048) y 2024 (+0,052), y **empata en 2025** (−0,001). El
mínimo del modelo es 0,718, por encima de la media de la baseline (0,730 con
un 0,643 dentro). La ventaja es real y estable en tres de cuatro; lo que NO es
es creciente: 2025 es el peor delta de la serie y la temporada más reciente.

Lo que sí es frágil es **todo lo demás**: WR y TE ganan 2 de 4 con deltas que
cambian de signo cada año, y QB gana 3 de 4 sólo porque 2023 fue una
catástrofe de la baseline (0,516). Por la regla del proyecto —«ayuda en todas o
es INCONCLUSO»— **sólo RB pasa como ventaja del modelo**; WR, TE y QB son
INCONCLUSOS frente a ordenar por los puntos del año pasado. La página decía
que el modelo «apenas añade» en QB; debería decir lo mismo de WR y TE.

## 3. E22 — las dos preguntas antes de la luz verde

Población: mitad alta por puntos previos (los que se draftean), 2010-2025,
residuo de los puntos realizados sobre una recta en los puntos previos.

### Dispersión: el castigo plano acierta en promedio y falla en cada jugador

| | movers: media | sd | IQR | % negativos | efecto / sd |
|---|---|---|---|---|---|
| RB | −18,7 | **73,0** | [−70, +24] | 63% | **0,32** |
| WR | −20,0 | 74,4 | [−74, +31] | 65% | 0,34 |
| TE | −15,0 | 50,7 | [−57, +19] | 65% | 0,36 |

La desviación es **tres veces el efecto**. Un tercio de los movers rinde POR
ENCIMA de lo que su historial decía. Un descuento plano de −20 mueve el nivel
de un grupo cuya dispersión individual es de ±73: exactamente la firma que se
rechazó dos veces esta semana (mejora la calibración, no el orden).

### Interacción: se midió, y no está

La primera medición del volumen vacante fue **sólo efecto principal**
(rho 0,02 sobre toda la población), como sospechabas. La prueba de verdad es
la interacción, y ahora está hecha de tres formas:

- **OLS con término cruzado** `ppr ~ ppg_prev + moved + vac + moved×vac`:
  RB moved **−34,6 (±14,4)**, vac +24,4 (±20,1), **moved×vac +10,5 (±33,8)**.
  El signo es el que la hipótesis pide —llegar a un hueco duele menos— y el
  error estándar es tres veces el coeficiente. No distinguible de cero. WR
  +8,9 (±37,3), TE +37,0 (±41,9): igual.
- **Sólo entre movers**, residuo contra vacante del destino: rho **+0,11** en
  RB (n=150), +0,09 WR, +0,04 TE.
- **Terciles de vacante entre movers**, residuo medio: RB **−24 / −20 / −12**,
  WR −27 / −25 / −8, TE −16 / −14 / −15.

Hay un gradiente en RB y WR en la dirección correcta, pero con 150 movers y
una sd de 73 no se separa del ruido, y explica una fracción pequeña de la
dispersión (rho 0,11 → ~1% de la varianza).

### Lo que esto significa para E22

- Lo que se puede afirmar con datos: **mover, en promedio, cuesta ~20 puntos**
  y el modelo no lo descuenta. Eso es un sesgo de NIVEL en un 20% del pool.
- Lo que NO se puede afirmar: a quién le cuesta y a quién no. La vacante del
  destino apunta bien y no alcanza. La cuota propia previa tampoco (RB +0,11).
- Con efecto/sd = 0,32 y sin interacción medible, la predicción honesta es que
  E22 **mejora el sesgo de los movers y mueve poco el orden**: los movers se
  reordenan entre sí igual que antes (castigo uniforme) y bajan en bloque
  frente a los stayers. El valor capturado sólo sube si ese bloque estaba, de
  media, demasiado alto respecto a los stayers de al lado — que es lo que dice
  el −23,5, así que no es cero, pero es un efecto de frontera, no de orden.

Recomendación: no correr E22 como estaba escrito (descuento plano). Si se
corre, que sea la variante **E22b — encogimiento extra para movers** (más
peso al ancla, no una resta), con la misma predicción y el mismo umbral, y
con la expectativa escrita de INCONCLUSO. La señal que ordena dentro de los
movers no está en estos datos: sería el depth chart de agosto, que es prensa,
y la prensa no toca el modelo.

---

# E22 — CERRADO SIN CORRER. Negativo. 2026-09-02

Ni descuento plano ni encogimiento extra. Los tres números que lo cierran:

- **efecto / sd = 0,32** en RB (media −18,7, desviación 73,0);
- **interacción mover × vacante +10,5 ± 33,8**: signo correcto, error tres
  veces el coeficiente;
- **un tercio de los movers rinde por encima de su historial**.

Motivo de no correr ni la variante: el autor predijo INCONCLUSO antes de
correrla. Un experimento cuyo resultado esperado está escrito como inconcluso
no es un experimento, es gastar el turno; y un positivo con esa predicción
delante tampoco sería creíble.

Lo que queda establecido con datos, y se puede citar: mover cuesta ~20 puntos
de media y el modelo no lo descuenta; a quién le cuesta no está en estos datos.


---

# Diagnóstico RB 2025 — 2026-09-02. No es decadencia, y el instrumento está roto

Reproducción del arnés por jugador (`scripts/rb_2025_diagnostic.py`): mismo pool
congelado, mismo `k`, mismo reemplazo real.

## Antes de las tres preguntas: el quinto instrumento

`validate()` proyecta cada temporada con `project_season(players, season,
rules)` — **sin curva de edad** —, mientras el board que se publica se
construye con `ages=ages`. **El arnés valida un modelo que no es el que se
publica.** Se comprobó las dos formas: sin edad el diagnóstico reproduce el
arnés al milésimo (0,864 / 0,718 / 0,883 / 0,773); con edad, que es lo que
ve el usuario, sale otra serie.

| RB, valor capturado | 2022 | 2023 | 2024 | 2025 | media | gana |
|---|---|---|---|---|---|---|
| baseline (puntos previos) | 0,643 | 0,670 | 0,831 | 0,775 | 0,730 | — |
| **arnés: modelo SIN edad** (lo publicado como 0,810) | 0,864 | 0,718 | 0,883 | 0,773 | 0,810 | 3 + empate |
| **modelo CON edad** (el board real) | 0,864 | 0,662 | 0,796 | **0,830** | 0,788 | 2 de 4 |

Dos consecuencias que importan más que 2025:

1. **El «empate perdido» de 2025 es del modelo sin edad.** El modelo que se
   publica GANA 2025: 0,830 contra 0,775. Los ocho picks del arnés que valieron
   cero en 2025 son casi todos de 29-30 años —Jones, Kamara, Ekeler, Mixon,
   Conner— y la curva de edad los saca del top-24. Ahí la curva vale +0,057.
2. **Pero la curva cuesta 2024 (−0,087, Henry a los 31: modelo #30, baseline
   #12, 206 de VOR) y 2023 (−0,056).** La curva se aceptó en
   `PREREGISTRO_edad` por MAE, y por ORDEN es mixta: el modelo publicado gana
   2 de 4 en RB, que por nuestra regla es **INCONCLUSO**. La misma trampa —
   calibración contra orden — que ya cazó dos veces esta semana, esta vez en un
   cambio que ya está en producción.

Recomendación, sin ejecutarla porque pediste diagnóstico: (a) que `validate()`
proyecte con la misma llamada que producción —una línea— y se republiquen las
tablas; (b) reevaluar la curva de edad con valor capturado por temporada, con
umbral escrito, porque hoy está aceptada por una métrica que no mide lo que el
board hace.

## Las tres preguntas, en los términos del arnés (sin edad, que es lo citado)

**1. ¿Mejoró la baseline o empeoramos nosotros?** Mejoró la baseline. Nivel
del modelo: 0,864 / 0,718 / 0,883 / 0,773 — plano dentro del ruido. Nivel de la
baseline: 0,643 / 0,670 / **0,831 / 0,775** — salta en 2024-25. El motivo está
en la composición (pregunta 3): en 2024-25 hubo menos *breakouts*, y ordenar por
el año pasado acierta más cuando el año pasado se repite. En 2025 el modelo y la
baseline comparten **21 de 24 picks**: la diferencia entera es de tres nombres.

**2. ¿En qué RB perdimos 2025?** En tres, y con explicación común:

| | modelo # | baseline # | VOR real |
|---|---|---|---|
| Chase Brown (el modelo lo dejó fuera) | 26 | 12 | **140** |
| Rico Dowdle, mover (fuera) | 31 | 23 | 76 |
| Kenneth Walker (el modelo lo tenía) | 15 | 29 | 124 |
| Rhamondre Stevenson (lo tenía) | 24 | 30 | 88 |

Chase Brown solo son 140 de 2.596 de VOR disponible: el 5,4%, más que la
diferencia total (0,2 puntos). Los cinco que **ninguno** de los dos tenía
—Etienne, Javonte Williams, Warren, Charbonnet, Tracy— son los mismos para
los dos. Es **ruido de dos o tres jugadores, no fallo repartido**: los aciertos
del top real son 16 y 16.

**3. ¿Cambió la composición?** No en 2025 en particular; cambió en 2024-25
contra 2022-23:

| | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|
| RB en el pool congelado | 55 | 48 | 49 | 43 |
| cuota del VOR real hecha por jugadores fuera del top-24 previo (*breakouts*) | 0,357 | 0,330 | 0,169 | 0,225 |
| movers en el top-24 real | 0,00 | 0,17 | 0,33 | 0,13 |
| muestra corta (< 8 wg) en el top-24 real | 0,08 | 0,08 | 0,04 | 0,00 |

Menos breakouts es la temporada en que la baseline mejor funciona, y ahí el
modelo no puede separarse mucho. Nada de novatos (el pool congelado los excluye
por construcción) ni una explosión de comités.

**Veredicto: 2025 es ruido de tres jugadores sobre una baseline que mejoró
porque 2024-25 se repitieron más. No hay decadencia medible en RB — y lo que
sí hay es que la cifra que se publica es de un modelo que no es el publicado.**

---

# E23 — cuota de objetivos para WR y TE. Preregistro. 2026-09-02

> Aviso: la referencia de WR y TE está medida con el arnés SIN curva de edad
> (ver el diagnóstico de arriba). Los criterios de E23 son relativos —3 de 4
> contra la baseline, no perder más de 0,010 contra el modelo actual— así que
> sobreviven a corregir el instrumento, pero la corrida tiene que hacerse
> DESPUÉS de que `validate()` proyecte el modelo publicado.

## Qué compite contra qué

WR y TE son **INCONCLUSOS** por la regla del proyecto: el modelo empata con
ordenar por los puntos del año pasado (WR 0,839 vs 0,838; TE 0,730 vs 0,709,
ganando 2 de 4 cada uno). E23 no defiende una ventaja: intenta convertir un
empate en una ventaja. El listón se define en consecuencia.

## La señal, medida en Fase 1

Condicionada a los puntos del año anterior, la cuota de objetivos añade
**parcial 0,11 en WR y 0,12 en TE**; la cuota de air yards, 0,09 y **0,19**.
ΔR² +0,004 (WR) y +0,011 (TE). Es una señal pequeña y real. En RB no añade
nada (−0,03), y por eso E23 **no toca RB**: el cambio se aplica sólo a WR y
TE, y el arnés tiene que devolver RB y QB idénticos al decimal — si se mueven,
el experimento está mal montado.

## El cambio (una variante, sin segundo intento)

El encogimiento hacia la media de la posición se hace hoy con
`reliability = wg / (wg + 10)` sobre puntos por partido. E23 añade a la
proyección de WR/TE un término de OPORTUNIDAD estimado walk-forward:

    ppg_E23 = ppg_shrunk + β_pos · (share_prev − share_media_pos)

donde `share_prev` es la cuota de objetivos ponderada 56/30/14 del propio
historial (mismo denominador de equipo que en `weekly.py`) y `β_pos` se
estima por posición con temporadas < S por regresión de los puntos realizados
sobre `ppg_shrunk` y la cuota. Sin parámetro elegido a ojo: β sale de los datos
anteriores, y si en alguna temporada sale ≤ 0 el término es cero.

## Predicción escrita

Efecto pequeño, del tamaño del ΔR²: **WR +0,005 a +0,015; TE +0,010 a
+0,025** en valor capturado medio. No espero un cambio de orden en los diez
primeros.

## Qué cuenta como éxito, fijado ahora

Como se compite contra un empate, la magnitud no basta: hace falta
**consistencia**.

- **Éxito:** en WR y en TE, `model_E23` gana a la baseline en **3 de 4
  temporadas** Y no empeora respecto al modelo actual en más de 0,010 en
  ninguna temporada. Las dos posiciones a la vez; si una pasa y la otra no, la
  que pasa se acepta y la otra no.
- **Cordura obligatoria:** RB y QB idénticos al decimal (la señal no los toca).
  Cualquier movimiento ahí invalida la corrida.
- **Fracaso:** gana en ≤ 2 de 4 en las dos, o empeora al modelo actual > 0,010
  en alguna temporada. Se publica y se cierra.
- **INCONCLUSO:** cualquier otra combinación. No se reintenta con otro β ni
  con la cuota de air yards: si la de objetivos no ordena, la otra —más
  ruidosa— tampoco.

Umbral fijado antes de correr; el resultado se publica salga como salga.
