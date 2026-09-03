# La cuenta de Sleeper enlazada y los mock drafts (`/fantasy/leagues`)

Desde el 2 de septiembre de 2026 el centro de mando lee una cuenta de Sleeper
entera con el nombre de usuario, y el Draft Room puede seguir un **mock draft**
por su id. Las dos cosas salen del mismo adaptador y de la misma regla:

    SLEEPER ES UN ADAPTADOR, NO EL PRODUCTO.
    UN MOCK ES UN DRAFT SIN LIGA, Y RECIBE UNA LIGA SINTÉTICA PARA AISLAR SU ESTADO.

## Qué es «linkear la cuenta» y qué no

No es iniciar sesión. La API de Sleeper es pública y de sólo lectura:

    /user/{username}                 -> user_id
    /user/{id}/leagues/nfl/{season}  -> las ligas de la temporada, con ajustes
    /user/{id}/drafts/nfl/{season}   -> los drafts sueltos: aquí viven los MOCKS
    /league/{id}/rosters             -> mi plantilla (ids de jugador, titulares, récord)
    /league/{id}/users               -> quién es cada uno
    /draft/{id}                      -> draft_order (mi puesto), huecos, puntuación de un mock

Sin OAuth, sin clave, sin contraseña. Lo único que sale del navegador es el
nombre de usuario, que ya es público en la URL de Sleeper. Se guarda en
`localStorage` (`gridiron-sleeper-account-v1`) con **identificadores y hechos**
y la hora de descarga: nunca filas del board, para que un payload nuevo no
deje una plantilla congelada con el VOR de la semana pasada.

## Dónde vive cada cosa

| Fichero | Qué hace | Red |
|---|---|---|
| `useSleeperDraft.js` | El adaptador: sondeo de UN draft (por liga o por id de mock) y `readSleeperAccount` | **Sí**, el único con `DraftMode.jsx` |
| `sleeperAccount.js` | Traducción: draft/liga -> entrada de catálogo, roster -> plantilla resuelta por id, mocks, frescura | No |
| `leagues/LeaguesShell.jsx` | La pantalla: enlace, paneles por liga, mocks, cola de hechos | Sólo por el adaptador |
| `draft/RoomShell.jsx` | Campo «Sleeper draft ID» y el enrutado del mock al adaptador | Sólo por el adaptador |
| `tests/sleeperAccount.test.mjs` | 20 tests del traductor con fixtures con la forma REAL de Sleeper | — |
| `tools/lab/cuenta.mjs` | Laboratorio en navegador: enlazar, paneles, mock seguido en vivo, recarga | Doble compartido |

CI sigue comprobando que `fetch` sólo aparece en los dos ficheros del adaptador
y que el único host de datos es `api.sleeper.app` (las fotos van aparte, por
`img-src`; ver el final).

## El panel de una liga: hechos, no consejo

Por liga se enseña lo que Sleeper dijo cuando se leyó:

- Configuración **real**: equipos, puntuación (`rulesFromSleeper`, con su
  etiqueta derivada de las reglas), titulares, mi puesto (`draft_order`), récord.
- Mi plantilla resuelta **por `sleeper_id`** contra el mapa horneado. Lo que el
  mapa no conoce se cuenta como «not in the identity map» y se enseñan los ids;
  no se adivina por nombre (los dos B.Robinson de Atlanta).
- El VOR de cada jugador **en esta liga**: el mismo compilador del Draft Room
  (`leagueBoardFrom`). Si no se puede compilar, se enseña el publicado y se dice.
- Los hechos de última ronda: cuántos de cada posición, **K y DEF cogidos o no**,
  huecos titulares abiertos (`assignSlots` sobre la plantilla).

Lo que NO hay: «roster débil», «ficha a X», «liga en riesgo». Son
recomendaciones y ninguna está validada.

## Frescura

La ventana es **de dominio**: una plantilla cambia con los waivers, o sea a
diario, no cada quince segundos como un draft. `ROSTER_STALE_MS` son seis horas;
pasadas, la cabecera dice `STALE · synced 7 h ago` y ofrece refrescar. La
pantalla **nunca escribe LIVE**: nada de ella se está sincronizando. Un draft en
curso se sigue en el Draft Room, que es el que sondea y el único sitio del
producto donde `LIVE` puede aparecer, y sólo con sondeo reciente y `drafting`.

## Los mock drafts

Un mock de Sleeper no pertenece a ninguna liga (`league_id: null`), así que no
aparece en `/league/{id}/drafts` de ninguna. Se sigue por su propio id, que es
el número de la URL `sleeper.com/draft/nfl/<id>`. Dos caminos:

1. **Desde Leagues**: enlazar la cuenta lista los mocks de la temporada con
   «Follow in the assistant».
2. **Desde la antesala del Draft Room**: pegar la URL o el id en «Sleeper draft
   ID».

El adaptador pide `/draft/{id}`; la configuración sale del propio draft
(`settings.slots_*` para los huecos, `metadata.scoring_type` para la
puntuación: `ppr`, `half_ppr`, `std`; cualquier otro queda UNKNOWN) y mi puesto
de `draft_order`. Un mock no tiene rosters, así que mis picks se reconocen por
`picked_by`. Su estado se guarda bajo la liga sintética `draft-<id>` (regla 6:
una clave por contexto).

**Por qué importa:** el mock es la única forma de probar el asistente en vivo
sin esperar al draft de verdad, y es lo que contesta lo que `SLEEPER_LIVE_BROWSER`
tiene pendiente desde agosto: el runner de CI llega a Sleeper (workflow
`Comprobar Sleeper`, verde el 30/08); el navegador de una persona real, todavía
nadie lo ha visto. El primer mock seguido de verdad cierra esa pregunta.

## Lo que se probó en el laboratorio (`tools/lab/cuenta.mjs`)

Con el doble compartido (`sleeper-double.mjs`, ahora con `/user/.../leagues`,
`/user/.../drafts`, `/league/.../users`, rosters con `players` y un `crearMock`):

- Un nombre que no existe da error visible y no guarda nada.
- Dos ligas (12 PPR y 10 Half PPR) salen con su configuración, su puesto y su
  récord; la plantilla de la primera resuelve cinco filas por id, con la
  defensa y el pateador, y dice «K taken · DEF taken»; la segunda, «not yet».
- El VOR es el de cada liga (`12-team · PPR`), la frescura dice «synced … ago»
  y la página entera no escribe LIVE.
- El mock aparece una vez (un draft de liga no puede ser además un mock),
  «Follow in the assistant» abre el Draft Room con parrilla 15×12, mi columna en
  el puesto 4, el enlace al draft en Sleeper, y cuatro picks entran por el
  adaptador —el cuarto mío por `picked_by`— con la conexión en LIVE.
- Al recargar, los paneles salen del almacenamiento sin pedir nada.

## Lo que sigue sin comprobar

- Un draft de Sleeper visto desde el navegador de una persona real
  (`SLEEPER_LIVE_BROWSER`). El primer mock lo contesta.
- Que `/user/{id}/drafts/nfl/{season}` devuelva los mocks creados desde la app
  con la forma que asume el doble (`league_id: null`, `settings.slots_*`,
  `metadata.scoring_type`). Si Sleeper omitiera algo, el producto dice UNKNOWN
  en ese campo y sigue; no inventa 12 equipos PPR.
- Transacciones, alineaciones y enfrentamientos siguen `false` en
  `providers.js`: la API los publica y nadie los ha validado aquí.

## Las fotos de los jugadores (`headshot.jsx`, 2 de septiembre)

Por **identificador**, no por nombre: `data/model.js` invierte el mapa
`sleeper_ids` en el build y deja `row.sid` en cada fila del board, de los
especialistas y del ranking semanal. La miniatura es
`sleepercdn.com/content/nfl/players/thumb/<sid>.jpg`; una defensa lleva el
escudo `images/team_logos/nfl/<equipo>.png`. Sin `sid` (los novatos del fondo
del board que el mapa no cubre) se pintan las iniciales, nunca la cara de otro.

Lo que cuesta: `sleepercdn.com` es el **segundo dominio externo** del sitio, y
sólo puede estar en `img-src`. La CSP y CI lo listan como lista blanca de dos
destinos, cada uno en su directiva, y CI falla si aparece un tercero o uno de
los dos fuera de su sitio. La imagen se pide sin referrer y sin credenciales;
si el CDN no responde, `onError` cambia la foto por las iniciales.

Lo que NO se pudo comprobar desde el contenedor de desarrollo: el proxy bloquea
`sleepercdn.com`, así que los laboratorios ven las iniciales de respaldo, no las
fotos. El patrón de URL es el público de Sleeper; la primera visita desde un
navegador real lo confirma o el `onError` lo tapa.

## La semana de una liga (2 de septiembre, tarde)

La instantánea guarda ahora **todas** las plantillas de cada liga (ids, dueño,
récord) y el enfrentamiento de la semana del payload
(`/league/{id}/matchups/{week}`). Con eso, tres cosas nuevas, todas hechos:

- **El semanal por liga** (`/fantasy/semanal`): un selector de liga y una marca
  por fila resuelta por `sleeper_id` — `MINE`, `FA` (nadie lo tiene en esa
  liga) o el nombre del dueño. K y DEF incluidos; la defensa se posee por
  código de equipo, que es su id en Sleeper.
- **El matchup** en el panel de cada liga: mi alineación contra la del rival,
  con la proyección semanal publicada de cada titular sumada. Lo que no tiene
  proyección (defensa, hueco vacío, id desconocido) se cuenta y no puntúa. Una
  suma de proyecciones no es un pronóstico validado del enfrentamiento y la
  página lo dice.
- **La profundidad por equipo** (plegable): cuántos tiene cada equipo en cada
  posición y cuánto proyectan sus mejores N esta semana, con N = titulares
  dedicados de la liga y el mío marcado. Es el dato con el que se piensa un
  trade —dónde sobra y dónde falta—; «ofrécele X» no se escribe porque nadie
  lo ha validado.

`leagueWeek.js` (puro, con tests) hace las cuentas; el doble sirve
`/matchups/{week}` y el laboratorio comprueba el matchup, la profundidad de los
doce y las marcas del semanal en dos ligas.

## «Sync details» en el Draft Room

Plegado bajo la banda de conexión: qué draft se sigue (y si es un mock), qué
dice Sleeper del estado, último sondeo bueno y picks leídos, último error, la
identidad derivada (usuario, roster, puesto y de dónde salió) y los picks sin
resolver por id con el nombre que Sleeper les da — enseñado como dato, nunca
usado para resolver. Cuando el asistente «se comporta raro» en un draft real,
lo que se copia de ahí es lo que hace falta para diagnosticarlo. El workflow
manual `Inspeccionar Sleeper` (`sleeper-inspect.yml`) vuelca desde CI la forma
real de la cuenta y del draft, para comparar con el doble.

## El analizador de la liga (`/fantasy/analisis`, 3 de septiembre)

Cuatro paneles, y ninguno recomienda nada:

- **Power rankings.** El valor de la MEJOR alineación legal de cada equipo,
  repartiendo el VOR del board entre las jornadas que quedan. Los huecos los
  llena `assignSlots`, el mismo que pinta la plantilla y espejo del de Python.
  No es un pronóstico de clasificación y la página lo dice: no sabe del
  calendario, de quién alinea bien ni de los waivers. K y DEF quedan fuera —el
  board no les calcula valor— y lo que el mapa de identidad no conoce se cuenta
  como `unknown`, nunca como cero.
- **Cara a cara por posición** contra cualquiera de la liga, con el rival de la
  jornada por defecto. Las filas son los huecos DEDICADOS, así que no suman la
  diferencia total: el flex no es de ninguna posición y eso se advierte.
- **Huecos opuestos.** Pares de equipos donde a uno le sobra por encima de la
  mediana justo donde al otro le falta. Es un hecho de dos plantillas, no un
  intercambio recomendado: nadie ha medido aquí lo que vale un jugador en un
  trade.
- **Mi alineación**, para poder auditar de dónde sale el número de arriba.

La comparación es contra la **mediana** de la liga, no la media: un solo
receptor descomunal mueve la media lo suficiente para que media liga aparezca
«débil», y la mediana no se entera de él.

**La liga activa es UNA** (`gridiron-active-league-v1`): la que eliges en el
semanal es la que abre el analizador. Antes cada pantalla recordaba la suya, que
es el mismo fallo del estado de draft por pantalla.

Dos defectos que cazó el laboratorio y no la vista:

1. Los huecos se leen de `snapshot.config.roster`. Con `snapshot.roster` —que no
   existe— la tabla salía con doce ceros.
2. `.rank-table .who` es `sticky` con `left: 2.6rem` para ir detrás de la
   columna de orden. En una tabla SIN esa columna la celda se desplazaba hasta
   ese `left` y, con fondo y `z-index`, **tapaba la columna siguiente**: mi
   propia columna del cara a cara salía en blanco. Ahora `:first-child` la fija
   en cero, y el laboratorio comprueba la geometría —que una celda no pise a la
   siguiente—, que es lo único que distingue «está en el DOM» de «se ve».


## Una cuenta, una liga activa, en todas las pantallas (3 de septiembre)

    ELIGES UNA VEZ Y EL RESTO DEL PRODUCTO TE SIGUE.

Antes cada pantalla se las arreglaba sola y enlazar la cuenta sólo se podía
hacer en Leagues: descubrir el ranking semanal por liga pasaba por irse a otra
página, teclear el usuario y volver. Ahora:

- `LeagueBar.jsx` es la misma barra en el semanal y en el analizador (y la
  puede usar cualquier pantalla nueva): selector de liga, quién está enlazado,
  cuánto hace de la última lectura —con `STALE` pasada la ventana de seis
  horas—, refrescar y un enlace a Leagues. **Nunca escribe LIVE**: nada de ella
  se está sincronizando.
- Sin cuenta, la barra ofrece enlazarla ahí mismo, y dice donde se teclea que es
  de sólo lectura y sin contraseña: lo único que sale del navegador es el nombre
  de usuario, que ya está en la URL de tu perfil.
- `linkAccount.js` es la lectura y la traducción, compartidas. Vivían dentro de
  `LeaguesShell.jsx`; copiarlas habría sido la quinta vez que dos traductores
  del mismo formato divergen en este proyecto, y aquí decidiría qué ligas ves.
  `accountFrom` es la mitad pura y tiene seis tests.
- La liga activa es UNA clave (`gridiron-active-league-v1`, con respaldo de la
  vieja del semanal).
- **El Draft Room arranca en la liga activa** cuando no tiene ya una suya. Sólo
  entonces: cambiarle la liga a un draft en curso porque en otra pestaña miraste
  otra sería peor que preguntar — el registro de picks va por contexto.

El laboratorio recorre el camino entero en un contexto limpio: enlazar desde el
semanal, elegir liga, comprobar que el analizador abre en la misma, cambiarla
allí, comprobar que el semanal la respeta, y entrar al Draft Room sin antesala.


## Una liga a la vez, y por qué no se puede fichar desde aquí (3 de septiembre)

**El centro de mando abre en la liga ACTIVA.** Con cinco ligas enlazadas
pintaba cinco paneles completos —plantilla, VOR por liga, matchup, profundidad
de doce equipos cada uno— y llegar a la que interesa era bajar por todo. Ahora
abre una, con un selector para cambiarla y un conmutador para verlas todas. La
liga elegida es la MISMA que abren el semanal, el analizador y el Draft Room.

**Y no, no se puede hacer el movimiento desde aquí.** Sleeper no publica una
API de escritura: su API es de sólo lectura y ninguna aplicación fuera de la
suya puede fichar, soltar ni proponer un cambio en tu nombre. No es una decisión
de este proyecto y no hay forma de rodearlo que no sea automatizar su app, que
sería frágil, contrario a sus términos y una manera excelente de que te cierren
la cuenta.

Lo que sí se hace: dejarte a un toque de la pantalla donde se hace. El panel de
agentes libres del semanal enlaza a tu liga en Sleeper y **dice por qué** el
botón no ficha él. Un producto que pareciera capaz de hacerlo y fallara en
silencio sería peor que uno que lo explica.


## «Sign in with Sleeper» y la alineación de la semana (3 de septiembre, tarde)

**La entrada es una sesión, no un campo suelto.** La barra sin cuenta enseña
ahora una tarjeta «Sign in with Sleeper» con la promesa escrita donde se pulsa:
*sólo lectura, sin contraseña*. No es OAuth y no se disfraza de OAuth — Sleeper
no publica uno—, pero con la cuenta enlazada la barra trae el **avatar** de
Sleeper, el nombre y **Sign out**. El avatar viene de `sleepercdn.com`, que ya
estaba en `img-src` por las fotos de los jugadores: no añade un tercer dominio,
y la marca es un SVG dibujado en el propio componente por lo mismo.

**El enfrentamiento de la semana, en paralelo.** En el analizador, los dos
equipos lado a lado hueco por hueco con la proyección semanal de cada titular,
el total de cada uno y la diferencia. El emparejamiento es POSICIONAL y es
exacto porque las dos alineaciones se reparten con los mismos huecos de la liga.
Contra el rival de la jornada se enseña **su alineación puesta**; contra
cualquier otro equipo, la que más proyecta de su plantilla — y se dice cuál de
las dos se está viendo.

**«Generate best lineup» es un optimizador, no un oráculo.** Reparte tu
plantilla en los huecos que tu liga declara y se queda con la suma mayor. La
pantalla dice donde se pulsa lo que eso no es: no es «la mejor», es la de mayor
proyección; una diferencia de un punto o dos está DENTRO del ruido semanal; no
sabe de un descarte de última hora ni de que necesites varianza porque vas
último. Y **no envía nada a Sleeper**, porque no se puede.

El start/sit sale de comparar esa alineación con la que Sleeper dice que tienes
puesta. Sin titulares publicados no se propone nada: proponer un cambio sobre
una alineación inventada es peor que no proponer.

Una defensa titular OCUPA su hueco y no suma. Son tres cosas distintas —existe,
está puesta, no tiene proyección— y antes se veían como un hueco vacío con un id
crudo al lado. No hay modelo de DST validado en este sitio y por eso no hay
número; contarlo como cero hundiría a todo el que alinea defensa, que es todo el
mundo.

El laboratorio comprueba lo que no puede fallar: una fila por hueco, que la
alineación generada **nunca proyecte menos** que la puesta, que se pueda volver
atrás, y que los dos avisos —«mayor proyección, no la mejor» y «esto no envía
nada»— estén en pantalla.
