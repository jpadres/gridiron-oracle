# Gridiron Oracle — contexto para Claude Code

Modelo de pronóstico NFL + rankings de fantasy football. **Un solo usuario** (el
dueño del repo). Sin cuentas, sin base de datos, sin backend.

**App en vivo:** https://gridiron-oracle-five.vercel.app

---

## Lo primero que hay que entender

**El modelo iguala a la línea de cierre del mercado; no la bate.** Brier 0.2118
frente a 0.2113, MAE 10.00 frente a 9.97, en 3.829 partidos fuera de muestra.

Ese resultado es correcto y está bien medido. La línea de cierre de la NFL agrega
el dinero de todos los modelos privados que existen. Si en algún momento un
cambio hace que el modelo *aparente* batirla con holgura, la hipótesis por
defecto no es "mejoró": es **fuga de información**. Búscala antes de celebrar.

Ese escepticismo ya pagó una vez. Durante el desarrollo el ensamblado ajustaba
sus pesos con predicciones dentro de muestra — la fuga de stacking clásica.
Parecía bien y costaba 0,6 puntos de MAE; el modelo combinado era *peor* que sus
componentes. Está corregido con cross-fitting temporal en
`models/predictor.py::MarketAwareModel.fit`.

---

## Reglas duras

Estas no son preferencias de estilo. Romper cualquiera invalida los resultados.

### 1. Cero información del futuro

Los features se construyen en **una única pasada cronológica**
(`data/features.py`), con una máquina de estados que sólo se actualiza *después*
de emitir la fila de ese partido. No uses `groupby().shift()` ni ventanas de
pandas: son fáciles de romper sin darte cuenta.

Hay un test que lo protege:
`tests/test_model.py::test_features_have_no_future_information`. Recalcula las
features truncando el historial y verifica que las filas anteriores al corte no
cambian. Si tocas `features.py`, ese test es la red.

### 2. Validación walk-forward, nunca cruzada aleatoria

Para predecir la temporada S sólo se usan temporadas < S. Todo: modelo,
distribución de márgenes, calibración y pesos de ensamblado. Barajar 2015 y 2023
en el mismo fold filtra futuro a través de los ratings de equipo y sobreestima el
rendimiento de forma masiva.

### 3. Reportar también lo que sale mal

El README y la web dicen abiertamente que el modelo no bate al mercado, que el
registro contra el spread no es significativo, y qué no sabe el modelo de
fantasy. Eso es una característica del proyecto, no un descuido. Si evalúas un
cambio, **fija el umbral de aceptación antes de ver el resultado** y publica el
resultado aunque sea negativo.

### 4. Nada de seguridad de adorno

El sitio no tiene endpoints, cookies, sesiones ni base de datos. No añadas auth,
rate limiting, sanitización de entrada de usuario ni RLS: no hay usuarios ni
datos que proteger. Lo que sí se mantiene está en la sección de Seguridad del
README y verificado en CI.

**La excepción de red, desde agosto de 2026:** el modo draft consulta
`api.sleeper.app` en runtime para tachar los picks ya hechos, y desde
septiembre `/fantasy/leagues` lee la cuenta enlazada (ligas, plantillas, mocks)
por el mismo adaptador. Es el **único** destino de datos de todo el sitio.
Las fotos de los jugadores (`headshot.jsx`) vienen de `sleepercdn.com` por
`sleeper_id`, y ese dominio sólo puede estar en `img-src`. Antes de añadir
un tercero, ten claro que ahora mismo tres controles de CI comprueban que no
exista: exactamente esos dos dominios en la CSP, cada uno sólo en su
directiva, y que `fetch` no aparezca fuera de `DraftMode.jsx` y
`useSleeperDraft.js` (el adaptador; la traducción vive en `sleeperAccount.js`,
sin red, para poder probarla con `node --test`). Están escritos como lista
blanca a propósito — un control que se relaja hasta no comprobar nada es peor
que no tenerlo, porque deja la sensación de que algo vigila.

La excepción es `ANTHROPIC_API_KEY`, que sí es una credencial de verdad: vive
sólo como secret de GitHub Actions, el código nunca la nombra (la lee el SDK del
entorno) y no viaja al bundle. Si acaba en un fichero, gitleaks lo caza — y
entonces hay que **rotarla**, no borrarla, porque sigue viva en el historial.

### 5. Una afirmación actual exige evidencia actual

**DATO REAL + FECHA VIEJA = RESPUESTA ACTUAL FALSA.** Es el fallo más peligroso
de una investigación automática porque no parece un error: la fuente es buena, la
cita es exacta, y lo único que está mal es el tiempo — que no se ve.

Nunca se da por actual algo sólo porque la fuente sea legítima. Antes de usar
cualquier dato sensible al tiempo (plantillas, depth charts, lesiones,
transacciones, cuotas, props, clima, ADP, estado de una liga o de un draft) hay
que establecerlo con `src/oracle/freshness.py`:

    RECUPERAR → FECHA DE PUBLICACIÓN → FECHA DEL HECHO → TEMPORADA Y JORNADA
    → ¿HAY ALGO MÁS NUEVO? → CLASIFICAR FRESCURA → USAR

Cuatro marcas que **no son la misma**: `published_at`, `event_at`,
`effective_at`, `retrieved_at`. Un artículo actualizado hoy puede contar algo de
marzo; uno histórico encontrado hoy sigue siendo histórico. **La hora de descarga
nunca da frescura** — convertirla en actualidad es exactamente cómo se fabrica
una respuesta falsamente actual.

Las ventanas son **por dominio**, porque la vida útil no es la misma: una cuota
caduca en minutos, un parte de lesiones el domingo en horas, y una estadística de
carrera **no caduca nunca**. Por eso `HISTORICAL` es una clasificación *válida* y
no una versión suave de `STALE`.

Ante el conflicto: primero lo oficial, después lo más nuevo, después lo mejor
atribuido — **conservando el desacuerdo**. «El equipo lo da dudoso» y «el
reportero espera que juegue» no son la misma clase de evidencia, y quedarse con
una sola borra lo que decide una alineación. Un informe del martes no anula un
inactivo oficial del domingo.

Y no hay respaldo silencioso: `require_current` **levanta** en vez de devolver lo
viejo. Se dice «no hay dato actual» o «último verificado [fecha]».

    UNKNOWN > STALE PRESENTADO COMO ACTUAL.

La interfaz nunca escribe `LIVE` salvo que la sincronización esté funcionando de
verdad; si no, `ÚLTIMA SINCRONIZACIÓN HACE X`, `STALE` o `ERROR DE SINCRONIZACIÓN`
según el estado técnico real. Esta regla no se debilita para que quepa una
funcionalidad nueva. Los tests adversarios están en `tests/test_freshness.py`.

### 6. Una liga es un contexto independiente

    UNA LIGA = UN CONTEXTO. UN DRAFT = UN ESTADO INDEPENDIENTE.

El estado de draft de una liga no puede contaminar a otra: distinta puntuación,
distinto tamaño, distinto puesto de draft, distintos jugadores ya cogidos. La
clave lleva temporada, liga y draft, y si falta cualquiera de las tres **no se
persiste** (`draftStorage.js`). Auditoría en `docs/v2/MULTILIGA_DRAFT.md`, prueba
adversaria en E14. Nada de valores por defecto asumidos como configuración real:
si no se sabe el tamaño o la puntuación de una liga, es `UNKNOWN`, no «12 equipos
PPR».

**Un contexto, un estado — no uno por pantalla.** El board y el Draft Room hablan
del mismo draft, así que leen y escriben el mismo registro: la identidad la
resuelve `activeIdentity` y el estado sale de `fold`, en las dos. Antes cada una
guardaba lo suyo en su propia clave y las dos tenían razón, que es la forma de
estar roto que no falla. Si añades una tercera superficie de draft, va por ahí:
consumir el registro, no inventarse otro. E17 lo prueba en las dos pantallas.

### 6b. Puntuación no es valor

    COMPILAR LA PUNTUACIÓN NO ES CALCULAR EL VALOR.

Un jugador que suma más puntos no vale más en el draft. El contraejemplo está
medido en E18: **un pase de TD de 6 puntos no cambia el board** —sube a todos los
quarterbacks y sube su reemplazo exactamente igual, 241 → 284, así que el VOR
queda intacto y el top-50 coincide entero. Y al revés: **superflex no toca ni una
regla de puntuación** y reordena 13 de los 50 primeros, porque mueve el reemplazo
del QB de QB13 a QB25.

De ahí que las dos cosas vivan en ficheros distintos y no se mezclen:
`scoring.py` convierte componentes en puntos, `league.py` convierte puntos en
valor. Si un día vuelven a caber en la misma función, es que alguien ha vuelto a
creer que personalizar la puntuación termina el trabajo.

Los huecos compartidos se reparten **asignándolos**, no por pesos fijos: cada
flex va a la posición cuyo mejor jugador libre vale más. Es lo que hace que la
demanda cuadre con los huecos que la liga define de verdad — el reparto por pesos
consumía 95 de 96. Y el reemplazo es **el primero que no es titular**, no el
último que sí lo es.

### 7. Sleeper es un adaptador, no el producto

    EL DRAFT ROOM CONSUME EVENTOS DE PICK CANÓNICOS.
    DE DÓNDE VENGAN ES UN DETALLE DEL ADAPTADOR.

El modo manual funciona en Sleeper, ESPN, Yahoo, NFL Fantasy y en un draft
presencial, y **no es un plan B**: es el modo que funciona en todas partes. La
sincronización con Sleeper automatiza los mismos eventos, nada más.

De ahí una distinción que no se vuelve a mezclar: `SLEEPER_LIVE_BROWSER`
(BLOCKED) bloquea **la sincronización automática** y decir `LIVE` sobre datos de
Sleeper. **No** bloquea el Draft Room. Diseño en `docs/v2/DRAFT_ROOM.md`.

Un draft manual tampoco tiene problema de frescura de red: su estado canónico son
los picks introducidos, y marcarlo `STALE` porque Sleeper no ha sincronizado es
aplicarle el modelo equivocado.

Y la regla que protege la plantilla: **un pick nunca se asigna a un roster en
silencio**. Si el puesto de draft no permite derivarlo, es `UNKNOWN` y el jugador
cuenta como fuera del board sin entrar en la plantilla de nadie.

### 8. La prensa no toca el modelo

`src/oracle/narrative/research.py` barre noticias a diario. Nada de eso entra en
un cálculo, ni como feature ni como ajuste ni como multiplicador. Se publica al
lado de los rankings, con su fuente y su etiqueta de fiabilidad.

**Marcar no es calcular, y por eso sí se hace.** Desde septiembre de 2026 la
prensa aporta lo que los datos no tienen: quién está suspendido, exento, en IR o
en PUP de temporada. Un apartado figura `ACT` en su plantilla —cobra y ocupa
sitio— así que `mark_rostered` no puede verlo, y Josh Jacobs salía en el puesto
38 del board como si nada. El fichero curado es `research/player_status.json`,
por id resuelto a mano y con fuente; el traductor, `narrative/status.py`.

La frontera es la de siempre y está escrita en el propio módulo: **el número de
la fila es el mismo con marca y sin ella**. Lo que cambia es que se dice, y que
un OUT deja de encabezar la lista corta — igual que ya pasaba con SIN EQUIPO.
`attach()` sólo escribe campos con prefijo `status_`, para que la regla se pueda
comprobar leyendo veinte líneas.

Y el estado dura mientras la comprobación caduca: `effective_at` es cuándo
empezó y `verified_at` cuándo se comprobó. Pasada una semana sin recomprobar la
marca **no se borra** —diría «disponible» de alguien apartado— sino que deja de
afirmarse como actual y pasa a «last verified [fecha]». Es la regla 5 aplicada a
un estado en vez de a una cifra.

No es purismo: la garantía anti-fuga se demuestra recalculando features con el
historial truncado. Una noticia de agosto no tiene fecha comprobable dentro de esa
pasada, así que en cuanto moviera un número, esa demostración deja de valer — y
con ella todas las métricas de validación del proyecto.

### 9. Un número generado que no está en los datos es un fallo, no un matiz

Los textos que redacta Claude sobre el modelo (`narrative/weekly.py`) pasan por
`narrative/factcheck.py`: se extraen todas las cifras del texto y se comprueban
contra los datos que se le pasaron. Si alguna no cuadra, se reintenta una vez
señalándola y, si vuelve a fallar, **el texto se descarta**. La web sale sin esa
sección y no pasa nada.

Si añades un campo al contexto del prompt, estás ampliando lo que el texto puede
citar. Si el texto necesita una cantidad derivada (una diferencia, un
porcentaje), **calcúlala en Python y métela en el contexto** — no esperes que el
modelo la deduzca, porque el validador la rechazará por correcta que sea.

---

## Arquitectura

```
src/oracle/
  data/ingest.py         descarga nflverse -> parquet equipo-partido
  data/features.py       PASADA CRONOLÓGICA ÚNICA (garantía anti-fuga)
  data/stadiums.py       coordenadas, husos horarios, altitud
  models/elo.py          Elo con margen, HFA adaptativa
  models/ratings.py      eficiencia ajustada por rival + ratings de QB
  models/distribution.py distribución discreta con números clave (3 y 7)
  models/predictor.py    ensamblado con cross-fitting temporal
  backtest/              walk-forward y métricas
  betting/               de-vig (Shin), EV, Kelly fraccionado
  fantasy/               puntuación, proyecciones de draft, ranking semanal
  narrative/             textos generados y barrido de prensa (opcional, con clave)
  narrative/status.py    suspensiones, exentos y listas: MARCA, no calcula
  freshness.py           ventanas por dominio: qué se puede afirmar como ACTUAL
  survivor/              plan de survivor: asignación lineal sobre log-probabilidades
  leagues/sleeper.py     liga, puntuación y picks del draft (API pública, sin clave)
  fantasy/risk.py        volatilidad de la proyección, VALIDADA contra el error real
  fantasy/availability.py tasa de ausencia: partidos del equipo en que no aparece
  fantasy/bust.py        P(terminar bajo el 70% de la proyección), calibrada
  fantasy/rookies.py     previa por capital de draft: la ÚNICA fuente de valor
                         de un novato, en componentes y con intervalo
  pipeline.py            Oracle.train() -> predict() -> value_bets()
  cli.py                 comando `oracle`
research/                archivo diario de prensa + dossier curado — SÍ se versiona
web/                     Next.js 16, páginas estáticas, datos horneados
                         (hay varios componentes de cliente — draft, Draft Room,
                          Leagues, explorador semanal — pero el modo draft sigue
                          siendo el ÚNICO que hace red: sondea Sleeper si lo
                          activas; el resto trabaja sólo con datos horneados)
scripts/                 generación de artefactos y utilidades
```

`research/` se versiona al revés que `data/` y `out/`: son unos kilobytes de
texto que **no se pueden reconstruir**. Si mañana se cae el enlace o el medio
reescribe la nota, lo que se publicó hoy sólo existe si se guardó hoy.

**El flujo de datos de la web:** los scripts de Python generan
`web/data/model.json`, que se comprime a `web/data/model.b64.js` (gzip+base64,
~24 KB). `web/data/model.js` lo descomprime en el servidor **en build time**. Por
eso las 8 páginas son estáticas y el sitio no hace ni una petición de red.

Si regeneras los datos, **hay que recomprimir**. El paso está en
`.github/workflows/weekly-predictions.yml`; cópialo de ahí si lo haces a mano.

---

## Comandos

```bash
pip install -e ".[dev]"

oracle refresh          # descarga nflverse: ~480 MB, 3-4 min
oracle features         # pasada cronológica: ~1 min
oracle backtest --from 2012      # walk-forward: ~4 min
oracle predict --season 2026 --week 1
oracle bets --season 2026 --week 1 --bankroll 1000

python scripts/fantasy_build.py                # rankings de draft: ~5 min
python scripts/fantasy_weekly_build.py --season 2026 --week 1
python scripts/fantasy_weekly_calibrate.py     # recalibra y valida: ~7 min
python scripts/survivor_build.py               # plan de survivor: ~1 min
python scripts/fantasy_risk_validate.py        # ¿la volatilidad predice el error?: ~4 min
python scripts/fantasy_availability_validate.py  # ¿la ausencia pasada predice la futura?
python scripts/fantasy_bust_validate.py        # ¿está calibrada la P(bust)?: ~3 min
python scripts/sleeper_sync.py --league <id>   # lee tu liga: puntuación y tamaño reales
python scripts/sleeper_draft_sync.py --league <id>  # picks ya hechos -> research/draft_state.json
python scripts/dossier_import.py libro.xlsx    # importa el dossier curado
python scripts/export_web_data.py              # regenera el payload de la web
python scripts/make_report.py                  # informe HTML de validación

# Opcionales, necesitan ANTHROPIC_API_KEY (pip install -e ".[narrative]")
python scripts/research_build.py               # barrido diario de prensa: ~5 min
python scripts/research_patch.py               # mete el research en el payload sin reentrenar
python scripts/export_web_data.py --with-narrative   # resumen y explicaciones

pytest -q          # 126 tests, sobre datos sintéticos (no requieren `oracle refresh`)
ruff check src tests scripts
cd web && npx next build
```

**Tras clonar el repo, `data/raw` y `data/processed` están vacíos** (van en
`.gitignore`, son ~490 MB). Hay que correr `oracle refresh && oracle features`
antes de cualquier cosa que toque el modelo. Los scripts largos conviene lanzarlos
en segundo plano y revisar el log.

---

## Errores ya cometidos — no los repitas

Cada uno de estos costó una iteración de depuración. Están corregidos; el
comentario está para que no los reintroduzcas.

| Qué pasó | Dónde | Lección |
|---|---|---|
| Pesos de ensamblado ajustados en muestra | `predictor.py` | Fuga de stacking: +0,6 MAE, combinado peor que sus partes |
| Signo invertido en el rating defensivo | `ratings.py` | `dfn` **alto** = defensa permisiva. Ataque esperado = `off[equipo] + dfn[rival]`, con **suma** |
| La media de liga absorbía la primera observación | `ratings.py` | Sin `mean_prior_n`, el residuo salía 0 y el rating nunca despegaba |
| QB proyectado 28% alto en fantasy | `fantasy/weekly.py` | Los dropbacks del equipo **no** son los intentos del QB: descuenta capturas y escapadas |
| Suplentes proyectados como titulares | `fantasy/weekly.py` | Un equipo tiene **un** titular. Sin esa restricción, cualquiera que arrancó dos partidos hereda el volumen completo |
| Cuotas calculadas con el equipo del año pasado | `fantasy/weekly.py` | El roster se aplica **antes** de calcular target share, no después |
| `AZ` vs `ARI` entre fuentes | `data/ingest.py` | nflverse no es consistente entre datasets. Todo pasa por `normalize_team` |
| Shin al revés | `betting/devig.py` | Shin da **menos** probabilidad al no favorito, no más (sesgo favorito-longshot) |
| Suma de medias por jugador como denominador | `fantasy/weekly.py` | La cuota de uso se calcula sobre los partidos del **equipo**, no sumando promedios condicionales: inflaba el denominador entre un 5% y un 34% **según el equipo**, que es lo que rompe la comparación entre equipos. Se descubrió dibujando la gráfica, no con un test |
| Un aviso que sale en los 250 jugadores | `fantasy/risk.py` | «Muestra corta» con la saturación en 40 partidos, cuando el ponderado 56/30/14 satura en 19. Un motivo que aparece siempre no informa: es decoración con nombre técnico |
| «DUDA» y «Seguro» en la misma fila | `fantasy/risk.py` | Disponibilidad y volatilidad son cosas distintas, pero las palabras chocaban y se leía como contradicción. Ahora son «Estable/Volátil» |
| Bijan y Brian Robinson, los dos «B.Robinson» de ATL | `narrative/dossier.py` | El formato abreviado de nflverse no distingue a dos jugadores con la misma inicial, apellido y equipo. Quedarse con el último daba «el modelo sube a Bijan 139 puestos». **Ante la duda no se empareja** |
| Códigos de equipo sin normalizar en el importador | `scripts/dossier_import.py` | Un `LA` que debía ser `LAR` no emparejaba con nada y el jugador nunca se colgaba de su fila. Fallo silencioso. Todo código pasa por `normalize_team` |
| Publicar «ppr» sobre un board de media recepción | `scripts/fantasy_build.py` | La etiqueta salía del argumento y no de las reglas usadas. Ahora la deriva de `ScoringRules`: si la liga sincronizada manda, la etiqueta también |
| Una señal de ausencia que parecía enorme | `fantasy/availability.py` | Spearman +0,48 sobre todos los jugadores era **el puesto en la plantilla**, no propensión a lesionarse: entre titulares de 16+ partidos se cae a +0,09. Se publica el +0,24 de la población del board, que es donde se enseña el número |
| Tres modelos de flex para la misma liga | `draft.py`, `leagues/sleeper.py`, `fantasy/league.py` | Daban el reemplazo del receptor en el puesto 36, 42 y 41, y nada decía cuál se usaba. Un reparto, en `roster_context` |
| `counts[pos] or DEFAULT_STARTERS[pos]` | `leagues/sleeper.py` | Cero es falso en Python, así que una liga **sin TE titular** recibía un TE inventado. Un valor por defecto colado como configuración real, e invisible |
| El reemplazo era el ÚLTIMO titular | `draft.py` | La definición es **el primero que no lo es**. El desplazamiento no es igual en todas las posiciones, así que distorsionaba justo la comparación entre posiciones para la que existe el VOR |
| Sólo 28 quarterbacks en el payload | `scripts/fantasy_build.py` | El recorte era el top-250 por VOR **de la liga por defecto**. Una superflex de 14 equipos necesita el QB43: el navegador se quedaba sin pool justo en el formato donde el valor por liga más cambia |
| Un fixture de test con el QB24 por debajo del WR40 | `web/tests/scoring.test.mjs` | El reparto voraz compara puntos brutos, así que mandaba huecos de superflex a receptores — correcto para ese pool, absurdo para el fútbol. Un fixture que no se parece al dominio hace fallar propiedades verdaderas |
| El TE premium se leía en el navegador y no en Python | `leagues/sleeper.py` | `bonus_rec_te` estaba en el traductor de JS y no en el de Python, así que `sleeper_sync.py` **rechazaba la liga entera** mientras la web la leía sin problema. Dos traductores del mismo formato con distinta cobertura es peor que uno incompleto: el producto parecía soportar una liga que no podía sincronizar |
| Los 72 raíles de equipo del war room, grises | `system.css` | El puente que resuelve `--team` desde `--team-light`/`--team-dark` es una LISTA de selectores, y las filas del Draft Room no estaban. La identidad faltaba justo donde el diseño la prometía, sin fallar nada. **Segunda vez**: si añades una superficie que pinte color de equipo, va en esa lista |
| «2 left in tier» contado sobre lo pintado | `DraftRoom.jsx` | El corte de tier contaba dentro de las 60 filas renderizadas, no del pool disponible: decía 3 con doce disponibles. Un número que se lee como escasez y era un artefacto del scroll |
| «No player matches that» con el board vacío | `DraftRoom.jsx` | Búsqueda sin resultados y board agotado decían lo mismo. En una liga de 32 el pool se acaba de verdad —480 huecos contra 344 jugadores— y el mensaje mandaba a buscar un fallo de filtro inexistente |
| Un test que aprobaba el fallo que existía para cazar | `tools/lab/tier-truth.mjs` | Pedía `suma >= pintadas` y con el bug la suma valía exactamente lo pintado. Todo guardián nuevo se prueba INYECTANDO el fallo: si no se pone rojo, no es un guardián |
| El validador de cifras rechazaba textos correctos | `narrative/factcheck.py` | «Cae 4,9 puntos» con el dato en -4.9. Se admite el valor absoluto: en prosa el signo lo lleva el verbo. Un validador con falsos positivos acaba desactivado |
| El barrido diario salía VERDE sin barrer nada | `daily-research.yml` | Sin `ANTHROPIC_API_KEY` el script avisaba y salía con 0 — correcto en local, mentira en CI, donde barrer es su ÚNICA tarea. Encima commiteaba «research: barrido del \<fecha\>». Ahora `--require-key` lo pone rojo y el mensaje dice lo que pasó de verdad |
| El research diario publicaba CERO enlaces a jugador | `research_build.py` | El índice de enlazado salía de `out/fantasy_weekly.json`, y `out/` está en `.gitignore`: **en CI no existe nunca**. Publicaba las 45 fichas sueltas encima de las buenas, vaciando las marcas del ranking. Ahora cae al payload versionado, y si no puede enlazar **no reescribe** |
| El parche diario borraba «Today's Intelligence» | `research_patch.py` | Escribía `payload["research"]` entero sin la clave `today`, que sólo añadía la regeneración semanal. Cada barrido dejaba la sección vacía hasta el miércoles. Ahora las dos rutas llaman a la MISMA `attach_today` — el fallo de los dos traductores de Sleeper, otra vez |
| «Best available for you» multiplicaba el VOR por una necesidad inventada | `DraftMode.jsx` | VOR × 0,35 cuando «la posición estaba llena» según una plantilla estándar que nadie declaró: una recomendación personalizada sin experimento, vestida de board validado. Retirado en 2026-08: el VOR se enseña puro y lo que tienes se dice al lado, como conteo. BEST AVAILABLE tiene UNA definición en todo el producto |
| El `status` del draft se cacheaba y no se releía | `useSleeperDraft.js` | `LIVE` exige que Sleeper diga `drafting`, y el objeto del draft se leía UNA vez. Un draft que terminaba mientras mirabas seguía diciendo `LIVE` para siempre: el sondeo de picks seguía saliendo bien y la copia en memoria seguía diciendo `drafting`. La regla de frescura burlada por una caché, no por un fallo de la regla |
| El asistente enseñaba «12 equipos» y dibujaba 10 | `RoomShell.jsx` | La parrilla, el puesto y el board ya usaban los ajustes del PROVEEDOR y la cabecera seguía leyendo los tecleados: los dos números en pantalla a la vez, y el equivocado en el sitio que se lee primero. Una liga EFECTIVA, y todo lee de ella |
| Un doble de Sleeper por laboratorio | `tools/lab/sleeper-double.mjs` | Al resolver por id y derivar la identidad de `draft_order`, un doble al que le falte un campo no falla: prueba otra cosa y sale VERDE. Tres copias eran tres coberturas distintas del mismo formato — el fallo de los dos traductores, por cuarta vez. Uno solo, compartido |
| El mapa de identidad, pedido en caliente | `export_web_data.py` | El catálogo de jugadores de Sleeper son 5 MB y su documentación pide no bajarlo a menudo. Es información ESTABLE: se hornea en el build desde los rosters de nflverse, que ya publican `sleeper_id` junto al `gsis_id` del board. Cero peticiones extra, y los 4 que no cuadran salen UNMAPPED en vez de emparejarse por nombre |
| El asistente decía «tu liga» sobre el board publicado | `draft/page.jsx` | La superflex de 12 daba el MISMO orden que la PPR de 12 porque a esa página nunca le llegaron `positionPriors` ni `componentOrder`: `leagueBoardFrom` devolvía `null` en silencio y se caía al publicado. El compilador estaba bien; el contexto llegaba pobre. **Un fallback silencioso a algo correcto-para-otra-cosa no falla, miente** |
| Un tier con 358 jugadores | `draft.py` | Los cortes se hacían sobre TODO el board, así que al entrar 227 novatos —todos empatados dentro de su celda— los huecos más grandes se mudaron al fondo y los quince cortes se fueron detrás. Del puesto 10 al 370, un solo tier, justo donde los tiers se usan. **No fue el bug de los novatos: fue que el corte dependía de la población.** Ahora se cortan sobre el pool drafteable y hay un test que añade morralla al final y exige que los 50 primeros no se muevan |
| El board publicaba diez corredores con el mismo número | `candidates.js` | Phil Mafah, Lew Nichols, Ulysses Bentley y siete más entre los puestos 150 y 180, todos con ~112 puntos, porque 112 **es** la media del corredor: con `weighted_games` de 0,3 el encogimiento presta el 97% de la cifra. `risk_label` decía «Normal». Se marca `% PRIOR` —que es la fórmula leída al revés, no una predicción— y por debajo de tres partidos ponderados no se recomienda |
| Bajar el ancla mejoró el número y empeoró el orden | `docs/PREREGISTRO_ancla.md` | Encoger hacia la media de los de muestra parecida: MAE y sesgo mejoran, valor capturado cae en tres posiciones de cuatro. RECHAZADO por el umbral fijado antes. El motivo es que un suplente con dos partidos y **un titular que volvió de lesión** tienen la misma muestra y son cosas opuestas: la variable correcta es el ROL, no los partidos |
| Josh Jacobs, apartado y en el puesto 38 | `narrative/status.py` | La proyección no comprueba si el jugador puede jugar, y un exento del comisionado figura `ACT` en su equipo: `mark_rostered` no lo ve porque **sí** está en la plantilla. Dos agujeros distintos —sin equipo y apartado— con dos remedios distintos, y el segundo sólo lo puede traer la prensa |
| Publicar UNKNOWN teniendo la medición hecha | `scripts/fantasy_build.py` | El board no proyectaba novatos y la interfaz escribía UNKNOWN mientras `ROOKIE_PRIOR` llevaba meses VALIDATED (Spearman 0,604 walk-forward). UNKNOWN > INVENTADO sigue en pie; **UNKNOWN > MEDIDO no**. Callar una medición no es prudencia, es media medición |
| El novato, encogido dos veces | `leagueValue.js` | `projectPlayer` encoge con `weighted_games` como fiabilidad y un novato tiene CERO: devolvía la media de la posición, la misma para el pick 3 y para la séptima ronda. O sea, borraba justo la señal por la que existe la previa. Un novato se compila y no se vuelve a encoger |
| El novato cae bajo, y está medido | `scripts/rookie_placement_validate.py` | A igual proyección y posición, los novatos de 2019-2025 realizaron 127,2 puntos y los veteranos de al lado 19,6. Las escalas no son la misma —el veterano se proyecta como si jugara 15,5 partidos; la previa de novato es el total observado con sus ceros— y el sesgo se publica **sin corregir**: no hay corrección validada, y un multiplicador a ojo sería peor que el sesgo conocido |
| Un fixture de Sleeper sin `metadata.position` | `tools/lab/live-assistant.mjs` | El emparejamiento cruza por nombre Y posición. El doble no la mandaba, así que no casaba NADA y el laboratorio esperaba 180 veces su timeout. El fallo no estaba en el producto sino en un doble que no se parecía al original: **un doble que miente en un campo prueba otra cosa** |
| Contar WR sobre las filas pintadas | `tools/lab/live-assistant-matrix.mjs` | La lista se corta en 60, así que «cuántos receptores quedan» medía el scroll. Es el artefacto exacto del «2 left in tier», reaparecido en el TEST esta vez. Se cuenta sobre el pool que el producto declara |
| «MIA -3.5» para un MIA que recibía 3,5 | `betting/value.py` | `spread_line` es el MARGEN del local (positivo = favorito); el handicap que se apuesta lleva el signo CONTRARIO. La etiqueta salía con el signo del margen y la probabilidad correcta al lado — el número cuadraba y nadie miró el signo. Se cazó al exponer TODOS los mercados en la web, donde los dos lados se leen juntos |

---

## Estado actual y qué sigue

**Funcionando:** modelo de partidos validado, board de draft de fantasy, ranking
semanal por posición, web desplegada, CI con tests + lint + escaneo de
dependencias + verificación de cabeceras, workflow semanal que regenera y publica.

**Pendiente de la mano del dueño** (ver `docs/ESTADO.md`):
1. Subir el repo a GitHub — `./scripts/bootstrap_github.sh jpadres/gridiron-oracle --public`
2. Importar en su Vercel personal con **Root Directory: `web`**
3. Borrar el proyecto viejo del equipo PeopleCloud

**Roadmap** (18 issues los crea el script de bootstrap). Los tres que más valen:

- **Líneas de apertura** (M2). El backtest mide contra el **cierre**, que nadie
  apuesta. Ahí es donde está el edge real, no en más features.
- **La escala del novato contra la del veterano** (M5). Los novatos ya están en
  el board, con la previa por capital de draft. Lo que queda es que las dos
  escalas no son comparables —medido: +107,6 puntos a favor del novato a igual
  proyección— y arreglarlo de verdad pasa por el lado del VETERANO, cuya
  proyección supone 15,5 partidos para todo el mundo.
- **Line shopping** (M2). Buena parte del edge no está en el modelo, está en
  apostar el mismo número donde mejor lo pagan.

---

## El skill de UI/UX

`.claude/skills/ui-ux-pro-max/` (MIT, de NextLevelBuilder). Es un buscador local
de reglas de interfaz — sin red, sólo librería estándar — y se usa así:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<consulta>" --domain ux
```

Se auditó antes de instalarlo: los `urllib` y `subprocess` del repo original
están en sus tests y en una utilidad de mantenimiento, no en la ruta que se
ejecuta. Los tests no se versionan (`.gitignore`) porque son del proyecto de
origen.

**Lo que encontró que los tests de aquí no podían encontrar:** los botones
«Yo»/«Fuera» del modo draft medían 35×29 px con 6 px de separación, cuando el
mínimo táctil es 44×44 con 8 px. Hacen cosas opuestas —uno te mete al jugador en
la plantilla y el otro lo tacha— así que fallar el toque en un móvil no era una
molestia: corrompía el estado del draft.

Sus reglas son buenos valores por defecto, no leyes. Se saltó a propósito la de
«estado activo en la navegación»: implementarla exige saber la ruta actual, y en
el App Router eso obliga a un componente de cliente en el layout — o sea, mandar
JavaScript en las ocho páginas para resaltar un enlace que el `<h1>` de debajo ya
nombra. El precio no compensa.

## Estilo

Comentarios y documentación **en español**. Nombres de código en inglés.

Los comentarios explican **por qué**, no qué. Si un número es raro (`0.812` de
calibración del QB, `DEF_STRENGTH = 0.45`), el comentario dice de dónde salió y
qué pasa si lo cambias. Esos números se ajustaron con datos y se validaron fuera
de muestra — no son a ojo, y cambiarlos sin revalidar rompe el modelo en silencio.
