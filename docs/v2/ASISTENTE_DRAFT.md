# El asistente de draft: hasta dónde llega la verdad hoy

Escrito en el laboratorio de investigación de 2026-08-30, junto al estudio de
FantasyPros y competidores (`docs/v2/INVESTIGACION_MERCADO.md`). La pregunta
del documento es una: **¿qué puede afirmar Gridiron en un draft, hoy, sin
inventar nada?**

## La escalera de capacidad

    NIVEL 1 — DRAFT TRACKER ............................ HECHO (E16, E17)
    NIVEL 2 — AVAILABLE PLAYER BOARD ................... HECHO (E16, E17)
    NIVEL 3 — LEAGUE-SPECIFIC VALUE .................... HECHO ≤14 equipos (E18)
    NIVEL 4 — CANDIDATE SHORTLIST ...................... HECHO como presentación
    NIVEL 5 — BEST PICK RECOMMENDATION ................. BLOCKED, y esto es el porqué

**Nivel 1 (registrar el draft).** Datos: eventos de pick canónicos. Validación:
E16 (27 escenarios, cero picks perdidos), E17 (un solo estado para board y
Room). Estado: en producción, con deshacer, replay y aislamiento multi-liga
(E14).

**Nivel 2 (el board de disponibles).** Datos: los mismos eventos contra el pool
publicado. Validación: la de E16/E17 más el laboratorio de tortura (1.000
drafts sembrados, 232k picks, cero violaciones). Estado: en producción; desde
este bloque el pool incluye K y DST como fichables sin valor.

**Nivel 3 (valor por liga).** Datos: componentes canónicos (E15) + estructura
declarada de la liga. Validación: E18, 16/16 propiedades preregistradas hasta
14 equipos; E18b marca el límite (a 32 equipos la estructura aguanta y la
magnitud no). Estado: en producción con `value_confidence` y la advertencia de
liga profunda.

**Nivel 4 (la lista corta).** La distinción que este bloque deja fijada: una
lista corta es **defendible cuando es presentación transparente del ranking
validado** — «los primeros disponibles por VOR de tu liga» — y deja de serlo en
cuanto reordena por conveniencia personal. Lo primero no añade ningún número
nuevo; lo segundo es el Nivel 5 con otro nombre. Por eso `CANDIDATE_SHORTLIST`
entra al registro como VALIDATED **heredando** E18, con la limitación escrita
de que no mira tu plantilla. La sala ya la enseña: el mejor disponible marcado
y la lista ordenada, con la etiqueta «best available by VOR, not a
recommendation».

**Nivel 5 (best pick).** BLOCKED. El grafo de abajo dice exactamente qué falta.

## El grafo de dependencias de BEST_PICK_FOR_ME

| Entrada | Clase | Estado |
|---|---|---|
| Puntuación de la liga | REQUIRED | HECHO — compilador E15, sincronización Sleeper |
| Estructura de plantilla | REQUIRED | HECHO — configurador + reparto voraz (E18) |
| Mi plantilla actual | REQUIRED | HECHO — fold del registro canónico |
| Pool disponible | REQUIRED | HECHO — E16/E17 |
| Valor validado por jugador | REQUIRED | HECHO ≤14 equipos (E18); NOT_READY más allá |
| Valor de reemplazo | REQUIRED | HECHO — voraz, primero-no-titular |
| Escasez posicional | OPTIONAL | HECHO como conteo factual (tiers por hueco de VOR) |
| **Regla de construcción de plantilla** | REQUIRED | **UNVALIDATED** — el multiplicador que existía (VOR × 0,35) se retiró en este bloque por convención sin medir sobre plantilla supuesta |
| **Disponibilidad futura (¿aguanta hasta mi pick?)** | REQUIRED | **UNSUPPORTED** — exige ADP con marca de tiempo por formato + calibración; fuente identificada (FFC ADP, licencia limpia), estudio NO hecho |
| ADP como contexto | OPTIONAL | UNSUPPORTED hoy (misma fuente FFC; exige mapeo de identidad curado — FFC no publica ids externos) |
| Solapamiento de descansos | OPTIONAL | HECHO como hecho informativo (primitivo de byes) |
| Capital de draft (rookies) | OPTIONAL | VALIDATED como prior (E9), no integrado al board |
| Construcción del equipo rival | OPTIONAL | UNSUPPORTED — sería otra regla sin medir |

Lo que separa el Nivel 4 del 5 son exactamente las dos filas en negrita. Todo
lo demás existe y está validado. Y las dos exigen lo mismo: **un experimento
preregistrado**, no más ingeniería.

## Por qué la disponibilidad futura está BLOCKED y no «pendiente»

El Pick Predictor de FantasyPros y el porcentaje de Fantasy Life demuestran que
el mercado lo valora — y ninguno publica su calibración. Aquí la regla es la
contraria: un «el 78% de las veces no vuelve» sin calibración medida es un
número inventado con dos cifras. El camino honesto, documentado y NO ejecutado:

1. ADP de FFC por formato (licencia explícita de uso libre, con atribución).
2. Mapeo de identidad **curado a mano** contra el board (~200-350 jugadores,
   ambiguo = UNKNOWN; FFC no publica ids externos y el emparejamiento por
   nombre automático está prohibido).
3. Estudio de calibración sobre drafts pasados: dado ADP σ y distancia al
   próximo pick, ¿qué fracción real sobrevive? Umbral fijado ANTES de mirar.
4. Sólo entonces, la interfaz puede decir una probabilidad — con su intervalo.

## La realidad de Sleeper, sin adornos

- **Desde este contenedor**: `api.sleeper.app` da 403 — es el proxy del
  entorno, no Sleeper (E13 demostró 200 desde GitHub Actions).
- **Desde el navegador del usuario**: la CSP ya permite `connect-src` a
  Sleeper; el modo draft sondea picks al activarlo. `SLEEPER_LIVE_BROWSER`
  sigue BLOCKED hasta que un draft real lo ejercite — bloquea decir LIVE y la
  sincronización automática, no el Room.
- **La arquitectura más corta hacia el tachado automático** ya existe entera:
  adaptador de picks → eventos canónicos efímeros (`providerEvents`) → mismo
  fold del Room. Lo único pendiente es ejercitarla en un draft de verdad y
  medir la latencia del sondeo. No hay que construir nada nuevo; hay que
  presenciarlo una vez.

## BEST AVAILABLE: una definición

En todo el producto, **best available = el disponible con mayor VOR del board
de la liga activa**. No es «mayor proyección» (eso ignora el reemplazo), no es
«mejor para ti» (eso está BLOCKED), y las dos superficies que lo enseñan lo
etiquetan igual. El multiplicador de necesidad del modo draft del board se
retiró en este bloque; lo que tienes en cada posición se enseña al lado, como
conteo.

## La capa de «¿por qué?» (diseño, no construido)

Si algún día la sala dice «considera a X», cada componente de la explicación ya
existe como hecho: mayor VOR disponible (E18), corte de tier a N jugadores
(conteo), hueco elegible abierto (assignSlots), distancia de reemplazo (el
board). La explicación correcta es la composición de esos hechos con sus
números — nunca prosa generada sin datos detrás. Requisito previo: nada. Es
presentación de lo que ya se calcula. Se hará cuando una pantalla lo necesite.

---

# Addendum, 2026-09-01: el asistente en vivo (E19)

Lo anterior era la escalera. Esto es lo que pasó al **ejercitarla entera con un
draft de verdad entrando por el adaptador**, que es lo único que separa un
diseño correcto de un producto que funciona.

## Lo que se ejecutó

Un draft de **12 equipos × 15 rondas = 180 picks**, todos llegando por la API
de Sleeper (servida desde un doble en el navegador de pruebas, porque el proxy
del contenedor bloquea `api.sleeper.app`). Sin tocar nada: cero picks perdidos,
cero duplicados, **15 de 15 turnos propios detectados solos** y con lista corta,
y el estado final declarándose completo. Más 31 comprobaciones de matriz:
corrida de posición, cinco configuraciones de liga, frescura de sincronización
y rendimiento del pick manual (p95 **84 ms**).

El reloj del navegador se controla (`page.clock`). Los 180 picks reales serían
45 minutos de espera y lo que se prueba es la INGESTA, no la paciencia. El
intervalo de producción no se toca: cambiarlo para que quepa el test sería
cambiar el sistema para que pase el test.

## Los dos defectos reales que encontró

Ninguno de los dos rompía nada visible. Los dos mentían.

**1. El `status` del draft se cacheaba y no se releía nunca.** `LIVE` exige tres
condiciones y la tercera es que Sleeper diga `drafting`. El adaptador leía el
objeto del draft una vez y guardaba la copia; el sondeo de picks seguía saliendo
bien, así que un draft que **terminaba mientras mirabas** seguía diciendo `LIVE`
para siempre. Exactamente el fallo que `draftSync.js` existe para impedir,
colado por la puerta de atrás de una caché. Ahora el id del draft se pinnea —no
se salta de draft a mitad de uno— y su estado se relee en cada sondeo.

**2. El asistente enseñaba el board publicado y lo llamaba «tu liga».** El
encabezado decía *by your league's value* y la superflex de 12 daba **el mismo
orden exacto** que la PPR de 12, porque a esta pantalla nunca le llegaron los
priors del payload: `leagueBoardFrom` devolvía `null` en silencio y se caía al
board publicado. La causa no era el compilador sino la página, que pasaba un
contexto más pobre que el de `/fantasy`. Corregido, superflex pasa de **5 a 17
quarterbacks entre los 50 primeros** y media recepción cambia quién encabeza la
lista.

Los dos son el mismo patrón que este proyecto ya se había cobrado dos veces
—**dos traductores del mismo formato con distinta cobertura**— y por eso la
corrección no fue copiar el montaje sino extraerlo: `leagueBoardFrom` y
`activeBoardFrom` viven en `leagueValue.js` y los usan las DOS pantallas.

## Lo que NO se desbloqueó

`SLEEPER_LIVE_BROWSER` **sigue BLOCKED**, y pasar este laboratorio no lo sube.
Un doble prueba el código; no prueba que la red del usuario llegue a Sleeper.
Lo que sí cambia es el tamaño de lo que falta: el adaptador entero está
ejercitado, así que un draft real contesta la capacidad en una tarde.

`BEST_PICK_FOR_ME` sigue BLOCKED por lo de siempre: no hay regla de construcción
de plantilla medida ni disponibilidad futura calibrada. La lista corta se llama
**Top available** y dice de dónde salen sus números — «by your league's value»
cuando la liga se pudo compilar, **«by the published value» cuando no**. Son dos
afirmaciones distintas y no se escriben igual.

## La calificación de profundidad, que faltaba aquí

La pantalla de board avisaba de que por encima de 14 equipos E18 no sostiene la
magnitud del valor; el asistente no. La misma liga de 32 salía matizada en una
pantalla y sin matizar en la otra. Ahora el aviso vive pegado al título de la
lista corta —donde están los números que califica— y son **dos avisos distintos
que no se funden**: «no validado a esta profundidad» y «esto no es el valor de
tu liga» describen límites diferentes.

---

# Addendum 2, 2026-09-01: seguir el Draft Room de Sleeper

El corrector de este bloque: el asistente ingería picks, pero seguía siendo yo
quien tenía que darle de comer. Ahora sigue **un draft concreto** de Sleeper.

## La pregunta de arquitectura, contestada de nuevo y no repetida

La conclusión anterior («browser polling, y punto») se dio por buena sin
comprobar una cosa: **este proyecto NO tiene `output: export`.** Es una app de
Next.js en Vercel, así que las rutas de servidor SÍ están disponibles. Eso
obliga a rehacer la comparación en vez de repetirla:

| dónde | qué compra | qué cuesta |
|---|---|---|
| navegador (lo que hay) | cero infra; la CSP ya lo permite; el estado vive donde se mira | el id de liga sale del navegador (ya es público) |
| ruta de servidor | cachear entre usuarios; esconder el id | una función por sondeo, un secreto más que cuidar, y **cero** mejora de latencia para UN usuario |

Para un solo usuario la ruta de servidor no compra nada que se note y añade una
pieza que puede caerse aparte. **Se queda el navegador.**

Donde el argumento sí cambiaba era en la IDENTIDAD de los jugadores: el
catálogo de Sleeper son 5 MB y su documentación pide no bajarlo a menudo. La
solución no es una ruta de servidor: es **hornearlo**. nflverse publica
`sleeper_id` junto al `gsis_id` que ya usa el board, así que el mapa se
construye en el build desde ficheros que ya están en disco —404 entradas, 340
de los 344 del board, los 32 D/ST y 31 de 32 pateadores— y viaja en el payload.
Un pick se resuelve por identificador sin una sola petición extra.

Los 4 que faltan no se emparejan por nombre: se marcan **UNMAPPED** y se dicen
en pantalla. Es la misma regla de los dos «B.Robinson» de Atlanta — ante la
duda no se empareja — aplicada donde más caro sale.

## Estable contra vivo

```
UNA VEZ, en caché                 CADA 15 s
-----------------                 ---------
/league/{id}                      /draft/{draft_id}        (el `status`)
/league/{id}/drafts               /draft/{draft_id}/picks  (los picks)
/league/{id}/rosters
/user/{username}
/draft/{draft_id}                 (orden y puestos)
```

Dos peticiones por sondeo, cuatro por minuto. La configuración de una liga no
cambia durante su draft; el `status` sí, y es la tercera condición de `LIVE`.

## La identidad se deriva, no se teclea

    username -> user_id -> roster_id -> draft slot
                (/user)   (/rosters)   (draft_order, si no slot_to_roster_id)

Y el dueño de cada pick sale de `roster_id` —que Sleeper rellena también en los
autopicks— con `picked_by` de respaldo. Lo que no se establece queda `null` o
`UNKNOWN`: un puesto inventado produce un calendario de picks inventado.

**Lo que dice Sleeper manda sobre lo que se tecleó.** En la prueba, el
formulario decía 12 equipos, PPR y puesto 9; el proveedor decía 10, media
recepción y puesto 2. Gana el proveedor, en la cabecera y en la parrilla, y la
cabecera lleva `FROM SLEEPER` para que no haya que adivinar de dónde salió.

## Lo que Gridiron NO hace

Sleeper no publica API de escritura para drafts. El adaptador es de sólo
lectura y la pantalla lo dice donde se mira: **tú eliges en Sleeper, Gridiron se
entera.** Y no hay cuenta atrás: sin datos de tiempo fiables se escribe `ON THE
CLOCK` a secas, porque un `00:43` inventado es peor que no tener reloj.
