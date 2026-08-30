# Apuestas, modelo de partidos y props — auditoría de 2026-08-30 (E20)

La regla permanente enmarca todo: **desacuerdo del modelo ≠ ventaja**
(`docs/REGLA_edge.md`, E4). Este documento fija qué sabe el modelo de partidos,
qué datos de mercado existen, y qué separa cada afirmación de apuestas de poder
hacerse.

## El pipeline, de punta a punta (F47)

    nflverse pbp/schedules ─→ ingest ─→ team_games/games (líneas de CIERRE incluidas)
    features.py (pasada cronológica): Elo, EPA ajustado, forma, QB, descanso,
      viaje, altitud, HFA adaptativa, techo ─→ 19 features por partido
    MarketAwareModel:
      · residual (ridge α=30): margen − spread de cierre     ← MERCADO-INFORMADO
      · libre    (ridge α=3):  margen directo                ← INDEPENDIENTE
      · total    (ridge α=10): total − total de cierre       ← SIEMPRE residual
      · mezcla NNLS ajustada con predicciones FUERA DE PLIEGUE (la fuga de
        stacking que costó 0,6 MAE está corregida y testeada)
      · distribución discreta de márgenes con números clave (w(3)≈1,9, w(7)≈1,5,
        aprendidos, no impuestos) y σ creciente con el total
      · probabilidad = distribución + calibración logística, reajustadas en cada
        paso del walk-forward

Salidas y su clase, tras E20: `pred_margin` VALIDATED (mercado-informado),
`pred_margin_free` VALIDATED como variante independiente, `pred_total`
VALIDATED (residual: **no existe total independiente**), marcadores por equipo
VALIDATED (derivación exacta, no un tercer modelo), `home_win_prob` VALIDATED
como probabilidad calibrada. Nada de esto valida edge.

## E20 — los números (3.829 partidos, walk-forward 2012-2025)

| salida | modelo | cierre | baseline ingenuo |
|---|---|---|---|
| margen (MAE) | 10,04 | 9,97 | 11,30 (cero) |
| margen LIBRE | 10,28 | — | — |
| total (MAE) | 10,57 | 10,51 | 11,08 (media temporada previa) |
| puntos local | 7,49 | 7,43 | — |
| puntos visitante | 7,26 | 7,23 | — |
| Brier probabilidad | 0,2128 | 0,2113 (moneyline sin vig) | 0,2470 (constante 0,554) |

Por temporada (14 de 14): el modelo queda a 0,0-0,2 puntos del cierre y no lo
bate en ninguna. Favorito/no favorito: 9,97/10,16 contra 9,91/10,08 del cierre
— sin bolsa escondida de ventaja. Calibración por cubos: 0,157→0,175 ·
0,258→0,246 · 0,357→0,350 · 0,441→0,451 · 0,557→0,569 · 0,648→0,661 ·
0,742→0,773 · 0,842→0,898 (n=216) · 0,923→0,909 (n=22). ATS por discrepancia
(la comprobación de E4, reproducida): 49,3% (n=2.189), 50,1% (n=1.488), 64,3%
con **n=56** — muestra que no afirma nada — y n=3 arriba. Sin crecimiento
utilizable.

**La transformación margen→probabilidad (F52) no es una sigmoide arbitraria**:
es la distribución empírica discreta más una capa de calibración, y la
fiabilidad por cubos la valida por separado del error de margen.

## Procedencia: mercado-informado no testifica contra el mercado (F77)

El margen publicado usa la línea de cierre como ancla. Por eso `REGLA_edge` es
permanente: presentar `pred_margin − spread` como evidencia independiente sería
circular. El único comparable honesto contra el mercado es el modelo LIBRE
(10,28 frente a 9,97 — pierde, y así se dice). La arquitectura ya publica los
dos con nombres distintos; la web enseña la procedencia en /modelo.

## Datos de mercado (F53)

| dato | fuente | estado |
|---|---|---|
| spread/total de CIERRE | nflverse schedules | HAY, 1999+, identidad limpia, gratis; el timestamp es «cierre», sin hora |
| moneyline de cierre | nflverse | HAY 2012+ (3.828/3.829 en la ventana) |
| línea de APERTURA | — | **NO HAY** (roadmap M2; exige captura propia o fuente de pago) |
| línea ACTUAL intra-semana | The Odds API (tier gratis, ~3 créditos/snapshot) | OBTENIBLE con timestamp propio de captura; términos permiten uso analítico derivado |
| totales por equipo (líneas) | The Odds API (créditos extra) | OBTENIBLE sin historial |
| props de jugador (líneas) | The Odds API de pago / vendors | **SIN HISTORIAL GRATUITO**; el bloqueo real de todo el track de props |
| props históricas | ninguna fuente limpia conocida | NO HAY |

Regla operativa: **nada se construye sobre instantáneas sin marca de tiempo.**
La única marca fiable hoy es «cierre»; cualquier captura intra-semana la
fechamos nosotros al capturarla.

## BEST_VALUE_BETS — el grafo (F55)

| dependencia | estado |
|---|---|
| cuotas con timestamp limpio | PARCIAL — sólo cierre |
| features exclusivamente pre-partido | HECHO (pasada cronológica + test anti-fuga) |
| de-vig correcto | HECHO (Shin en `betting/devig.py`, con su test de sesgo) |
| baseline de mercado | HECHO (cierre) |
| validación fuera de muestra | HECHO (E4: 3.708 apuestas) |
| calibración | HECHO (E20) |
| muestra suficiente | HECHO en spreads; NO en cubos altos de discrepancia |
| comparación con línea de cierre | HECHO — y el resultado es que NO la bate |
| sin fuga | HECHO (red-team F79 abajo) |

Todo existe — y por eso la conclusión es fuerte: **la puerta no está bloqueada
por infraestructura sino por el resultado**. E4 midió y falló. El registro pasa
BEST_VALUE_BET a NOT_READY (publica la hipótesis con su histórico al lado,
como ya hace la web) y BETTING_EDGE sigue REJECTED. La frontera no se debilita.

## Props de jugador — la matriz (F59, F82)

Leyenda: DATOS = historial del stat; MODELO = volumen×eficiencia semanal;
OOS = validado fuera de muestra; DIST = distribución calibrada; LÍNEAS =
mercado histórico; AUT = autoridad de apuesta.

| prop | DATOS | MODELO | OOS | DIST | LÍNEAS | AUT |
|---|---|---|---|---|---|---|
| yardas de pase | SÍ | SÍ (intentos×eficiencia) | media SÍ (E7) | NO (sd comprimida 3,3 vs 8,4) | NO | BLOCKED |
| TD de pase | SÍ | parcial | NO | NO | NO | BLOCKED |
| intercepciones | SÍ | NO | — | — | NO | BLOCKED |
| yardas de carrera | SÍ | SÍ (carreras×ypc) | media SÍ | NO | NO | BLOCKED |
| intentos de carrera | SÍ | SÍ (volumen puro) | dentro de E7 | NO | NO | BLOCKED |
| yardas de recepción | SÍ | SÍ (targets×eficiencia) | media SÍ | NO | NO | BLOCKED |
| recepciones | SÍ | SÍ (targets×catch rate) | dentro de E7 | NO | NO | BLOCKED |
| targets | SÍ | SÍ | dentro de E7 | NO | sin mercado estable | BLOCKED |
| anytime TD | SÍ | NO (exige modelo de eventos) | NO | NO | NO | BLOCKED |
| recepción/carrera más larga | jugada a jugada en pbp | NO | NO | NO | NO | BLOCKED |

La lectura correcta: **el motor de MEDIAS ya existe y está validado** (es el
semanal, E7, con la descomposición volumen×eficiencia bien hecha: dropbacks
menos capturas y escapadas, un titular por equipo, cuota sobre partidos del
equipo). Lo que falta para CUALQUIER prop es (1) distribución con colas
calibradas — no se asume normal; conteos y yardas piden familias distintas y
validación de cobertura — y (2) líneas históricas. El (2) no tiene fuente
gratuita: es el bloqueo duro.

Volumen vs eficiencia (F61): targets, carries, attempts, target share y volumen
de equipo están; faltan snaps y rutas (nflverse: rutas sólo post-temporada vía
FTN; snaps 4×/día PERO con id de PFR → crosswalk), rol de zona roja (derivable
del pbp — el hueco más barato de cerrar), depth charts (diario, ESPN) y
lesiones (Sleeper, del bloque anterior). Matchup defensivo (F62): el semanal ya
usa defensa-contra-posición corregida por calidad y amortiguada al 45% porque
entera EMPEORA fuera de muestra — el «allows most fantasy points to WR» ingenuo
está medido y domesticado.

## Props de partido (F58), ordenadas por viabilidad

1. **Total por equipo** — el modelo ya lo produce (mitades de margen y total);
   sólo faltan líneas. La única prop a un paso.
2. Primera mitad (spread/total) — exigiría modelo de mitades; el pbp lo
   permite; sin líneas históricas.
3. Márgenes exactos — la distribución discreta YA da P(margen=k) calibrada por
   números clave; curiosamente es lo más modelado y lo menos lineado.
4. Ambos anotan N+ / cuarto más anotador — sin modelo, sin datos de mercado,
   sin interés: no se construye porque un sportsbook lo liste.

## CLV (F66)

Arquitectura limpia y pequeña, NO construida: capturar con The Odds API la
línea al publicar cada `value_bet` (timestamp propio de captura), guardar
`(game_id, market, line_bet, ts)` en `research/` (kilobytes, versionado), y
comparar con el cierre de nflverse cuando llegue. Cero historial fabricado: el
CLV empieza a existir el día que se captura la primera línea, y hasta acumular
muestra sólo se ENSEÑA, no se interpreta.

## Versionado (F78) y red-team del backtest (F79)

Versionado: `MODEL_VERSION` en el registro, `generated_at` en el payload,
`last_validated` por capacidad, y el corte de entrenamiento implícito en el
walk-forward. Falta un `data_as_of` explícito del parquet — anotado como mejora
menor. Red-team: sin lookahead (pasada cronológica única + test de truncado),
el cierre sólo se usa como feature del partido AL QUE pertenece (pre-evento por
definición del mercado), sin stats post-partido en features, sin lesiones (no
hay — no puede fugar), sin normalización con futuros (medias con prior, no de
temporada completa), identidad por `normalize_team` y GSIS. Sin hallazgos
nuevos; las dos fugas históricas (stacking, clima observado) ya estaban
corregidas y documentadas.

## Crossover fantasy ↔ apuestas (F86-87)

La columna vertebral ya es la correcta y es UNA:

    modelo de partidos (margen+total) → guion de juego → volumen de equipo
    → oportunidad del jugador → media semanal (E7) → [falta: distribución]
    → fantasy semanal Y props

Primitivos compartidos hoy: proyección de QB, volumen de pase del equipo,
target/rush share, defensa rival, total implícito (alimenta DST y serviría a
props). No hay modelos duplicados de la misma cantidad — la regla se mantiene.
El eslabón que falta para AMBOS mundos es el mismo: **distribuciones por
jugador con colas validadas** (también bloquean MATCHUP_WIN_PROBABILITY).

## Prioridades de investigación (F88)

| programa | datos | validación | impacto | coste | riesgo id/licencia | orden |
|---|---|---|---|---|---|---|
| semanal con lesiones actuales (Sleeper) | listos | E7 re-run | alto | bajo | bajo | 1 |
| calibración prospectiva 2026 de E20 | listos | preregistrada | medio | casi cero | nulo | 2 |
| distribuciones por jugador (colas) | listos | nueva, dura | alto (fantasy+props) | medio | nulo | 3 |
| shortlist de draft + ADP (FFC) | por capturar | calibración | alto en agosto | medio (mapeo curado) | medio | 4 |
| rol de zona roja desde pbp | listos | feature test | medio | bajo | nulo | 5 |
| captura de líneas + CLV | por capturar | acumulativa | medio | bajo | bajo (términos OK) | 6 |
| props de jugador | SIN líneas históricas | imposible hoy | alto si existiera | alto | alto | 7 |
| edge de apuestas | listos | E4 FALLÓ | — | — | — | cerrado salvo dato nuevo (apertura, M2) |
