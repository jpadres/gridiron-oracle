# Gridiron Oracle

> **Estado.** Esta base de código es una reconstrucción desde cero de la
> arquitectura descrita aquí, y **ya se ha ejecutado contra los datos reales de
> nflverse**. El backtest reproduce el recuento de partidos (3.829) y el MAE del
> mercado (9.97) del proyecto original, con Brier 0.2128 frente al 0.2119 del
> mercado y MAE 10.04. Las diferencias en el tercer decimal frente a las tablas
> de abajo son de implementación, no de método: dos implementaciones
> independientes sobre los mismos datos aterrizan en el mismo sitio, que es la
> mejor señal de que ninguna tiene una fuga.

Modelo de pronóstico para la NFL: margen, total, probabilidad de victoria,
detección de valor frente al mercado y rankings de fantasy football. Datos 100%
públicos (nflverse), validación walk-forward estricta y resultados reportados sin
maquillaje.

**App en vivo: https://gridiron-oracle-five.vercel.app**

Uso personal, un solo usuario. Sin base de datos, sin cuentas, sin backend: el
sitio es estático y los datos se hornean en el build. Todo corre en los planes
gratuitos de GitHub y Vercel — coste total del proyecto: 0.

---

## Resultado honesto en una línea

**El modelo iguala a la línea de cierre del mercado.** En 3.829 partidos fuera de
muestra (2012-2025) obtiene un Brier de **0.2118** frente al **0.2113** de las
casas de apuestas, y un MAE de margen de **10.00** frente a **9.97**.

Esto es exactamente lo que debe pasar y es la mejor noticia posible: la línea de
cierre de la NFL es uno de los estimadores más eficientes que existen en cualquier
mercado del mundo. Cualquier proyecto que afirme batirla de forma consistente por
un margen amplio, con datos públicos, está sobreajustando o midiendo mal.

Lo que sí aporta este modelo:

| | Modelo | Mercado (cierre) |
|---|---|---|
| Brier (prob. de victoria) | 0.2118 | 0.2113 |
| Log-loss | 0.6113 | — |
| Error de calibración (ECE) | **0.0172** | — |
| MAE del margen | 10.00 | 9.97 |
| MAE del total | 10.53 | 10.51 |
| Acierto directo (ganador) | **66.5%** | — |

Y sin usar la línea en absoluto (`pred_margin_free`, sólo señal deportiva):
MAE **10.24**, Brier **0.2187**, 65% de acierto directo. Un modelo autónomo a
0.27 puntos de la línea de Las Vegas usando únicamente datos gratuitos.

> **Dónde está el edge real, y por qué no está aquí todavía.** Este backtest se
> valida contra la línea de *cierre*. Nadie apuesta al cierre. El dinero se hace
> contra la línea de apertura, contra libros lentos y con noticias de lesiones
> antes de que el mercado las digiera. Ese es el trabajo del roadmap
> (issues #7, #8 y #9), no una promesa de que el modelo ya lo hace.

---

## Qué hace distinto a este modelo

### 1. Distribución discreta con números clave, no una normal

El margen en la NFL no es continuo. Se acumula brutalmente en 3 y 7. Convertir
"margen esperado 2.8" en probabilidad con una normal comete errores grandes y
*sistemáticos* justo en las líneas donde se juega el dinero.

Aquí la densidad se factoriza:

```
P(margen = k | pred) ∝ w(k) · N(k ; pred, σ(pred, total))
```

`w(k)` es un multiplicador empírico estimado como el cociente entre la frecuencia
observada de cada margen y su versión suavizada por kernel. Sale ~1.9 en k=3,
~1.5 en k=7 y ~0.55 en k=2 y k=5, sin que nadie se lo diga. Eso da
probabilidades de *push* correctas y precios correctos en líneas de -3 y -7.

### 2. Parametrización sobre el residuo del mercado

El modelo de producción no predice el margen con la línea como una feature más.
Predice `margen − línea`: en qué se equivoca el mercado. El objetivo tiene media
casi cero, así que la regularización empuja por defecto hacia "el mercado tiene
razón" y sólo se separa con evidencia. Es la diferencia entre un modelo que
respeta al mercado y uno que pelea con él por ruido.

### 3. Ratings de eficiencia ajustados por rival, en línea

El EPA bruto mide resultado, no calidad. Un ataque con 0.15 EPA/jugada puede ser
bueno o haber jugado contra las tres peores defensas de la liga. El ajuste es
iterativo y online, sin mirar al futuro:

```
esperado      = media_liga + off[equipo] + def[rival]
residuo       = observado − esperado
off[equipo]  += lr · 0.62 · residuo · peso_muestra
def[rival]   += lr · 0.38 · residuo · peso_muestra
```

Con encogimiento por partidos jugados (semana 1 no puede tener opiniones
fuertes) y arrastre parcial entre temporadas.

### 4. El quarterback como corrección explícita

Ningún rating de equipo captura que el titular cambió. `qb_vs_offense` mide la
diferencia entre el rating del QB anunciado y el nivel reciente del ataque:
captura suplentes y lesiones sin necesidad de un feed de lesiones de pago. En la
NFL eso vale entre 2 y 7 puntos de spread.

### 5. Ventaja local adaptativa

La HFA de la NFL cayó de ~2.7 puntos (2005) a ~1.5 (2020-22) y volvió a subir.
Fijarla en una constante es un error sistemático de medio punto durante años
enteros. Aquí se estima de forma recursiva a partir de los residuos locales.

### 6. Viaje, husos horarios y altitud reales

Coordenadas de las 32 sedes más las internacionales (Wembley, Tottenham, Azteca,
Múnich, São Paulo, Dublín, Madrid, Melbourne, Berlín). Distancia haversine,
cambio de huso horario y desnivel de altitud (Denver y Ciudad de México importan).

### 7. Validación walk-forward, sin excepciones

No hay validación cruzada aleatoria en este proyecto. Barajar partidos de 2015 y
2023 en el mismo fold filtra futuro a través de los ratings de equipo y
sobreestima el rendimiento de forma masiva. Para predecir la temporada S sólo se
usan temporadas < S: modelo, distribución, calibración y pesos de ensamblado se
reajustan en cada paso.

Además, los pesos de ensamblado se ajustan con predicciones **fuera de muestra**
generadas por bloques temporales disjuntos. Ajustarlos en muestra es la fuga de
stacking clásica; en este mismo proyecto costaba 0.6 puntos de MAE y hacía que el
modelo combinado fuese *peor* que sus componentes.

---

## Fantasy football

Un segundo modelo, con lógica propia, sobre los mismos datos.

**Rankings de draft.** Proyección de temporada completa por jugador a partir del
volumen y la eficiencia de las tres últimas temporadas (ponderadas 56/30/14),
encogidos hacia la media posicional según el tamaño de muestra, y corregidos por
la curva de edad de cada posición — el acantilado del running back a partir de
los 28 está bien documentado y es brutal. Los touchdowns se encogen más que nada:
son la estadística más ruidosa del fantasy y la que más engaña al mirar el año
anterior.

El orden final es por **VOR** (valor sobre reemplazo), no por puntos totales. Es
la única forma honesta de comparar un quarterback con un running back: lo que
importa no es cuántos puntos hace un jugador, sino cuántos más hace que el que
puedes conseguir gratis en su posición. Los tiers salen de los huecos reales en
VOR, y dicen cuándo puedes esperar una ronda más y cuándo no.

**Validación** (proyección de pretemporada frente al resultado real, 2022-2025):

| Posición | Correlación | Spearman | MAE |
|---|---|---|---|
| QB | 0.51 | 0.44 | 115 pts |
| RB | 0.59 | 0.59 | 63 pts |
| WR | 0.55 | 0.53 | 47 pts |
| TE | 0.66 | 0.64 | 37 pts |

Spearman ~0.55 está en línea con lo mejor que se publica — y aun así significa
que una de cada tres parejas de jugadores termina en el orden contrario. Los
rankings sirven para no cometer errores grandes, no para adivinar la temporada.

### Ranking semanal por posición

El puente con el modelo de partidos es el guion de juego: `pred_margin` y
`pred_total` determinan cuántas jugadas tendrá cada equipo y de qué tipo. Un
receptor con 26% de target share en un partido que se proyecta 17-27 en contra
vale más que en uno 28-17 a favor, porque el equipo que va perdiendo lanza más.

Encima va el ajuste de emparejamiento: cuánto concede la defensa rival a esa
posición, **corregido por la calidad de los ataques que ha enfrentado** — sin esa
corrección, las defensas de divisiones flojas parecen mucho mejores de lo que
son. Se aplica amortiguado al 45%: "defensa contra la posición" es una señal real
pero mucho más pequeña y ruidosa de lo que se cuenta por ahí, y aplicarla entera
empeora las proyecciones.

**Validación**, con el listón que importa: la media ponderada de los últimos seis
partidos del jugador, que cualquiera calcula en dos minutos. La calibración se
ajustó con 2022-2023 y se evaluó sin tocarla sobre 2024-2025.

| Posición | Spearman modelo | Spearman baseline | MAE modelo | MAE baseline |
|---|---|---|---|---|
| QB | **0.272** | 0.227 | **6.53** | 6.73 |
| RB | **0.513** | 0.479 | **5.57** | 5.77 |
| WR | **0.377** | 0.349 | **5.25** | 5.44 |
| TE | **0.268** | 0.219 | **4.56** | 4.76 |

Cara a cara (dos jugadores de la misma posición y semana, ¿acierta el orden?):
**63.7%** frente al 62.6% del baseline.

Bate al baseline en las cuatro posiciones — y lo hace por dos décimas de punto de
error. El fantasy semanal es, en su mayor parte, ruido; quien prometa más que
esto no lo ha medido. La corrección más grande del desarrollo fue el
quarterback: los intentos de pase de un equipo no son los de su quarterback, y
sin descontar capturas y escapadas la posición salía un 28% alta.

Sólo entra el titular de cada equipo. Sin esa restricción, cualquier suplente que
arrancó dos partidos hereda el volumen completo del equipo y aparece entre los
mejores de la jornada — que es justo el error que hace inútil a un ranking
semanal.

### Riesgo por jugador: «Bust» y «Falta»

Dos columnas en el board, las dos con el umbral de aceptación fijado **antes de
medir** en `docs/PREREGISTRO_riesgo.md`.

**Bust** es la probabilidad de terminar por debajo del **70% de la proyección**.
No es lo mismo que volatilidad: una proyección puede fallar hacia arriba, y eso
no es un riesgo. Mide sólo la cola de abajo.

Se ajusta con una regresión logística sobre cuatro entradas —las tres
componentes de volatilidad más la tasa de ausencia— y **walk-forward**: los
coeficientes de una temporada salen sólo de las anteriores.

| Métrica | Umbral preregistrado | Resultado |
|---|---|---|
| ECE sobre deciles | ≤ 0,08 | **0,043** |
| Bust del decil alto / decil bajo | ≥ 1,5× | **5,5×** (91% frente a 17%) |

Sobre 1.865 jugador-temporadas de 2016 a 2025. La tasa base del board es del
**43%**: cuatro de cada diez elecciones de draft se quedan cortas, y eso incluye
las buenas.

**Falta** son los partidos que se espera que pierda de 17, del historial de
ausencias ponderado 56/30/14 y encogido por tamaño de muestra.

**No es un parte médico**, y la distinción no es cosmética. Mide en cuántos
partidos de su equipo el jugador *no aparece en los datos*: puede ser una lesión,
o ser suplente, o estar inactivo, y estos datos no los distinguen. La etiqueta de
disponibilidad del dossier sí viene de un parte real y manda si se contradicen.

Sobre todos los jugadores con historial la correlación con la ausencia del año
siguiente es **+0,48**, y casi toda es un espejismo: mide que los suplentes
siguen siendo suplentes. Entre titulares de 16+ partidos se cae a **+0,09**. El
número que se publica es el de la población del board: **+0,24**, con el tercio
alto perdiendo el **32,9%** de los partidos frente al **18,1%** del bajo.

Reproducir:

```bash
python scripts/fantasy_availability_validate.py
python scripts/fantasy_bust_validate.py
```


### Limitaciones

- Los rookies no aparecen: sin partidos NFL no hay historial que proyectar.
- No hay parte de lesiones; el titular se deduce del volumen reciente.
- El reparto interno de un backfield nuevo se hereda del año anterior.
- En el draft se proyectan 15,5 partidos para todos: el riesgo de lesión
  individual no está diferenciado.

```bash
python scripts/fantasy_build.py                          # rankings de draft
python scripts/fantasy_weekly_build.py --season 2026 --week 1   # ranking semanal
python scripts/fantasy_weekly_calibrate.py               # reajusta y valida
```

## Empezar

Si abres esto con Claude Code, lee primero `CLAUDE.md`: tiene las reglas duras
del proyecto (anti-fuga temporal, walk-forward) y la lista de errores ya
cometidos. `docs/ESTADO.md` dice qué está hecho y qué falta.

## Instalación

```bash
git clone https://github.com/<tu-usuario>/gridiron-oracle.git
cd gridiron-oracle
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# El repo no incluye los datos (~490 MB, van en .gitignore).
# Este par de comandos los reconstruye desde cero:
oracle refresh    # descarga nflverse, 3-4 min
oracle features   # pasada cronológica, 1 min
```

## Uso

```bash
oracle refresh                       # descarga nflverse (pbp 1999+ y calendario con líneas)
oracle features                      # construye la tabla de features (una pasada cronológica)
oracle backtest --from 2012          # validación walk-forward por temporada
oracle predict --season 2026 --week 1 --json out/w1.json
oracle bets --season 2026 --week 1 --bankroll 1000
```

Desde Python:

```python
from oracle.pipeline import Oracle

o = Oracle.train(".")
preds = o.predict(o.predict_week(2026, 1))
bets  = o.value_bets(preds)
```

## Estructura

```
src/oracle/
  data/ingest.py        descarga y agregación a nivel equipo-partido
  data/features.py      pasada cronológica única (garantía anti-fuga)
  data/stadiums.py      geografía, husos horarios, altitud
  models/elo.py         Elo con margen, HFA adaptativa, variante anclada al mercado
  models/ratings.py     eficiencia ajustada por rival + ratings de QB
  models/distribution.py distribución discreta con números clave
  models/predictor.py   ensamblado con cross-fitting temporal
  backtest/             walk-forward y métricas
  betting/              de-vig (Shin), EV y Kelly fraccionado
  fantasy/              puntuación configurable, proyecciones y VOR
  narrative/            textos generados y barrido de prensa (opcional)
  survivor/             plan de survivor por asignación lineal
research/               archivo diario de prensa + dossier curado
web/                    app Next.js desplegada en Vercel
```

## Research y textos generados

Dos cosas opcionales que necesitan `ANTHROPIC_API_KEY` y que **no tocan el
modelo**:

| Qué | Cuándo | Dónde acaba |
|---|---|---|
| Resumen de la jornada y explicación de por qué el modelo prefiere a un jugador | Con la regeneración semanal | Portada y ranking semanal |
| Barrido de prensa, insiders y campamentos de los 32 equipos | A diario, 12:00 UTC | Página de research y avisos bajo cada tabla |

La frontera entre los dos primeros y el tercero es la regla del módulo. **Los
textos de resumen sólo pueden citar números que estén en los datos del modelo**,
y hay un verificador que extrae todas las cifras del texto generado y descarta el
texto entero si alguna no cuadra. Un resumen ausente se nota y se arregla; uno
con una cifra inventada se lee, se cree, y no se distingue de uno bueno.

El barrido de prensa es otra cosa: son afirmaciones de terceros, cada una con su
enlace y con una etiqueta de fiabilidad (confirmado / informado / rumor). **No
entran en ningún cálculo.** El modelo se construye con una pasada cronológica
sobre nflverse y su garantía es que ninguna fila ve el futuro; en el momento en
que un titular de hoy moviera una proyección, esa garantía dejaría de poder
demostrarse — y con ella todas las métricas de validación. Las noticias van al
lado de los números, nunca dentro.

```bash
pip install -e ".[narrative]"
export ANTHROPIC_API_KEY=...                        # nunca en un fichero del repo

python scripts/research_build.py                    # barrido diario, ~5 min
python scripts/research_build.py --beats insiders --max-searches 4   # más barato
python scripts/research_patch.py                    # mete el research en el payload
python scripts/export_web_data.py --with-narrative  # resumen y explicaciones
```

Sin clave no falla nada: los scripts avisan y el sitio se construye sin esas
secciones, igual que se construye sin los artefactos de fantasy.

**Lo que cuesta.** Once llamadas diarias con búsqueda web a Opus 5 salen por unos
3-5 $ al día, que es con diferencia el mayor gasto del proyecto — el resto es CPU
gratuita de GitHub Actions. `--beats`, `--max-searches` y
`ORACLE_NARRATIVE_MODEL=claude-sonnet-5` lo bajan.

## Survivor

Elegir un ganador por jornada sin repetir equipo. **Es el único sitio del
proyecto donde el modelo tiene ventaja real**, y por una razón concreta: en un
survivor no compites contra un mercado eficiente, compites contra el calendario y
contra tu propio bote de equipos. Lo que hace falta no es una probabilidad mejor
que la del mercado —que no la hay— sino una bien calibrada y la capacidad de
mirar dieciocho jornadas a la vez.

La decisión difícil no es «¿quién gana el domingo?», es «¿cuánto me cuesta gastar
hoy al equipo que me salvaría la jornada once?». Maximizar la supervivencia es
maximizar el producto de las probabilidades de acierto, o sea la **suma de sus
logaritmos** con un equipo por jornada y ninguno repetido: un problema de
asignación lineal, exacto y en milisegundos con el húngaro. El coste de quemar un
equipo sale de resolverlo dos veces —el óptimo libre y el óptimo forzando ese
equipo hoy— y la diferencia *es* lo que cuesta.

```bash
python scripts/survivor_build.py
python scripts/survivor_build.py --used KC,BUF --from-week 3
```

Lo que **no** hace: no modela al resto del bote (en un survivor grande a veces
conviene separarse del favorito público, y eso necesita saber qué elige la gente),
y las jornadas lejanas son priors de fuerza de equipos, no pronósticos — sin línea
de mercado publicada el modelo cae a su variante autónoma, que es peor.

El número honesto que sale de aquí: **el plan óptimo sobrevive las 18 jornadas
menos del 1% de las veces.** No es un fallo del modelo, es la aritmética de
multiplicar dieciocho probabilidades del 70%.

## Contraste con el consenso

El board propio tiene un problema evidente: **no sabe si tiene razón**. Por eso
se importa un ranking de consenso de expertos (`scripts/dossier_import.py`) y se
publica sólo la **diferencia**. Coincidir no informa de nada: si los dos boards
dicen lo mismo, daba igual cuál mirases.

Los desacuerdos resultan caer justo sobre las limitaciones documentadas del
modelo, que es la mejor señal de que el contraste sirve: sube a los lesionados
(no ve el parte médico), sube a los veteranos (la curva de edad está
implementada pero inactiva) y baja a los jóvenes con poco historial (no puede
proyectar un cambio de papel).

Cuando dos jugadores comparten inicial, apellido y equipo —Bijan Robinson y
Brian Robinson Jr. son los dos «B.Robinson» de Atlanta— **no se emparejan**. El
formato de nflverse no los distingue, y adivinar produciría una discrepancia
llamativa sobre el jugador equivocado.

## Seguridad

La superficie de ataque de este proyecto es deliberadamente diminuta, y eso vale
más que cualquier lista de mitigaciones: **0 endpoints de API, 0 subidas de
archivos, 0 cookies, 0 sesiones, 0 base de datos.** El sitio son doce páginas
estáticas con los datos horneados en el build. No hay login que forzar, ni
consultas que inyectar, ni registros ajenos que leer, porque no hay usuarios ni
registros.

**Hay exactamente un destino de red en runtime, y sólo si lo activas:**
`api.sleeper.app`. El modo draft consulta los picks de tu liga (o de un mock)
para tachar solo a quien ya se llevaron, y la página de Leagues lee tu cuenta
—ligas, plantillas, mocks— cuando la enlazas por nombre de usuario. Hasta agosto
de 2026 el sitio era cero-red y el README lo decía; se cambió a petición del
dueño porque marcar 250 nombres a mano en un móvil durante un draft en vivo no
es viable.

Lo que eso cuesta y lo que no:

- `connect-src` deja de estar vacío. Sigue siendo una **lista blanca de un solo
  destino**: cualquier otro host lo bloquea el navegador. Desde septiembre
  `img-src` admite además `sleepercdn.com`, y sólo ahí: las fotos de los
  jugadores se cargan por `sleeper_id` desde el CDN de Sleeper, sin referrer y
  sin credenciales. Dos dominios, cada uno en su directiva, y CI comprueba que
  no haya un tercero ni uno de ellos fuera de su sitio.
- **No viaja ninguna credencial.** La API de Sleeper es pública y de sólo
  lectura: sin clave, sin OAuth, nada que rotar. Lo único que sale del navegador
  es el id de tu liga o tu nombre de usuario, que ya son públicos en la URL de
  Sleeper.
- CI lo verifica **contra el servidor real**: que el único dominio externo de la
  CSP sea ése, que esté en `connect-src` y en ninguna otra directiva, y que
  `fetch` no aparezca en ningún fichero de `app/` salvo el adaptador de Sleeper
  (`useSleeperDraft.js`) y el modo draft.

**Hay una credencial, y sólo una.** `ANTHROPIC_API_KEY`, para los textos
generados y el barrido de prensa. Vive únicamente como secret de GitHub Actions:
el SDK la lee del entorno, el código nunca la nombra, y no viaja al bundle de la
web — para cuando el navegador ve la página, los textos ya son HTML. El resto del
proyecto (modelo, backtest, fantasy, web) funciona entero sin ella; por eso es un
extra de instalación y no una dependencia.

Lo que sí se aplica, porque protege al proyecto y no a usuarios inexistentes:

| | Cómo |
|---|---|
| Cabeceras de seguridad | CSP estricta (sin dominios externos), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Verificadas en CI contra el servidor real, no solo leídas del config. |
| HTTPS forzado | HSTS a dos años con `includeSubDomains; preload`, más `upgrade-insecure-requests` en la CSP. |
| Sin fugas de credenciales | nflverse es público y sin autenticación; la única clave del proyecto sólo existe como secret de CI y nunca se escribe en un fichero. Gitleaks revisa el **historial completo** en cada push — una clave commiteada no se arregla borrándola, hay que rotarla, porque sigue viva en los commits anteriores. |
| Contenido de terceros | Las notas de prensa traen texto y URLs de fuera. React escapa todo el texto (no hay `dangerouslySetInnerHTML` en el proyecto) y los enlaces se filtran por esquema antes de publicarse: sólo `http` y `https` con dominio. Salen con `rel="noopener noreferrer nofollow"`. |
| Dependencias sin vulnerabilidades | `npm audit` y `pip-audit` en CI, y también cada lunes por si sale un aviso mientras el repo está quieto. Dependabot abre los PR de actualización. |
| Validación de entrada | La CLI valida temporada, semana, bankroll y umbral. No es defensa contra un atacante — es para que un dedazo falle en el segundo cero y no a los cuatro minutos. |
| Superficie mínima | Sin `X-Powered-By`, sin `dangerouslySetInnerHTML`, sin `fetch` en runtime, 3 dependencias npm. |

Lo que **no** se hizo, y por qué: cifrado de datos sensibles (no hay datos
sensibles — son estadísticas públicas de la NFL), hash de contraseñas y rate
limiting de login (no hay login), row-level security y consultas
parametrizadas (no hay base de datos), escapado de contenido de usuario (no hay
usuarios que suban contenido). Implementar esas cosas aquí sería teatro.

## Gestión de riesgo

El módulo de apuestas usa Kelly fraccionado (0.25) **más** un encogimiento
explícito del 50% del edge estimado, tope duro del 2% del bankroll por apuesta y
umbral mínimo de edge del 1.5%. Kelly completo con probabilidades estimadas
produce drawdowns del 60-80%; no es una opción defendible.

El de-vig usa el método de Shin, no la normalización proporcional: las cuotas de
los no favoritos sobrestiman su probabilidad real, y en moneylines desequilibradas
la diferencia entre ambos métodos es de 1-2 puntos porcentuales — exactamente el
tamaño del edge que se busca detectar.

## Limitaciones conocidas

- Se valida contra líneas de **cierre**, las más difíciles de batir.
- Sin datos de lesiones en tiempo real; el efecto QB se infiere del titular anunciado.
- Clima histórico observado, no pronosticado: para partidos futuros se usa el valor por defecto.
- Sin líneas de múltiples casas, así que no hay *line shopping* (donde está buena parte del edge real).
- Sin mercados de props ni alternativos.

## Aviso

Proyecto de investigación y análisis deportivo. Las apuestas conllevan riesgo de
pérdida. Nada aquí es una recomendación financiera. Cumple la legislación de tu
jurisdicción.

## Datos y licencia

Datos de [nflverse](https://github.com/nflverse) (dominio público / CC).
Código bajo licencia MIT.
