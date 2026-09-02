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
