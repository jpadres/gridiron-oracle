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
