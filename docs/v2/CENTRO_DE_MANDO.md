# Centro de mando multi-liga (`/fantasy/leagues`)

La primera superficie que cruza ligas. Responde una sola pregunta:

    ¿EN CUÁL DE MIS LIGAS ESTÁ PASANDO ALGO, FACTUALMENTE?

y se niega a responder cualquier otra. **Atención no es recomendación**: cada
elemento de la cola es un hecho comprobable del estado guardado — estás en el
reloj, faltan N picks, hay huecos titulares abiertos en un draft vivo, una
estructura está sin configurar. «Roster débil», «ficha a alguien» y «liga en
riesgo» no existen aquí por construcción, porque exigirían un modelo de decisión
que nadie ha validado.

## La auditoría de capacidades, antes de dibujar nada

Se hizo primero, para no construir tarjetas alrededor de datos que no tenemos.
Lo que el producto SABE hoy, por liga y desde `localStorage`:

| Se sabe | De dónde |
|---|---|
| Identidad (plataforma, temporada, liga, draft) | la clave del registro (`parseLogKey`) |
| Picks: cuántos, cuáles míos, orden efectivo | el registro canónico (`fold`) |
| Estructura y puntuación, SI se configuró | el catálogo (`gridiron-leagues-v1`) |
| Reloj y distancia al turno, SI hay puesto y tipo | matemática de serpiente sobre el conteo |
| Huecos titulares abiertos | `assignSlots` sobre MIS picks |
| Descansos de MI plantilla | `fantasy.byes` (completo: 32/32 o nada) |

Lo que NO sabe y por eso no pinta: la semana actual de la NFL (no hay reloj de
temporada fiable en el payload), lesiones/estados de alineación, resultados de
partidos, y la configuración de cualquier liga que no se haya configurado aquí.

## El catálogo de ligas

`gridiron-leagues-v1` guarda la configuración POR IDENTIDAD (el mismo ámbito
que aísla los registros). Antes sólo persistía la liga activa del Draft Room y
cambiar de liga la sobreescribía; ahora entrar en una liga la registra sin
borrar a las demás. Un registro sin catálogo sigue siendo una liga real: se
enseña con configuración `UNKNOWN`, sin botón de abrir — no se puede activar lo
que no se conoce — y jamás se rellena con «12 equipos PPR» por defecto.

## La cola: qué entra y en qué orden

Sólo lo operativo. El orden está documentado ENTERO y no hay puntuación
inventada:

1. `ON_THE_CLOCK` — te toca ahora.
2. `PICKS_UNTIL_ME` — N ascendente.
3. `DRAFT_ACTIVE` — draft con picks y sin reloj derivable.
4. `OPEN_STARTER_SLOTS` — sólo mientras SU draft está vivo.
5. `ROSTER_CONFIG_UNKNOWN` — estructura sin configurar.

Empates: nombre de liga y después ámbito. Los DESCANSOS nunca entran en la
cola: un bye a tres meses vista es un dato de la fila de su liga, no un aviso.
El draft completado tampoco: se dice en su fila y su acción pasa a «Review
draft» (el replay).

## Autoridad visual

El CAMPO ámbar es exclusivo del reloj — el mismo acuerdo que en el Draft Room.
Un draft que se acerca lleva el raíl ámbar sin campo; configuración desconocida
viste gris; los descansos van en el micro-texto de la fila con la tinta
atenuada. La suite lo guarda con un check que estaba ROJO antes de la
corrección (el reloj y «5 picks until you» compartían fondo).

`LIVE` no se escribe en ninguna parte: nada de esta página sincroniza nada.
Las ligas manuales no tienen problema de frescura de red — su estado canónico
son los picks introducidos (regla 7 del proyecto).

## Proveedores como capacidad, no como escalafón

`providers.js` declara lo que cada proveedor SOPORTA HOY (idea tomada del
registro de capacidades de Flaim, auditado en el pase de skills): manual lo
hace todo menos sincronizar; Sleeper importa configuración y picks pero
`livePolling` está BLOCKED desde el contenedor; el tablero local no tiene liga.
Una liga manual es primera clase — no hay «modo degradado».

## Lo que queda documentado para después, sin fingirlo hoy

- **Modo domingo** (futuro): la misma página, en semana de partidos, querrá
  responder «¿qué alineaciones tengo sin cubrir?». Exige dos cosas que hoy no
  existen: semana actual fiable y alineación semanal por liga (distinta del
  draft). La arquitectura ya lo permite — sería otra familia de items de
  atención (`LINEUP_SLOT_EMPTY`, hechos, no consejos) sobre el mismo orden
  documentado — pero NO se finge: sin esas dos fuentes, no hay sección.
- **Exposición por jugador** (investigación): «a cuántas de mis ligas llevo a
  X» es un hecho cruzado calculable con lo que ya hay (`mine` por liga con ids
  canónicos). No se construyó porque su valor real aparece con lineups y
  resultados, no en agosto; cuando se haga, es un conteo, no un riesgo.

## La caza de fallos del bloque

- Colisión de identidades: `parseLogKey` devuelve `null` ante claves
  malformadas; ids sin dos puntos hacen la partición exacta (tests de storage).
- Draft viejo en temporada nueva: la temporada va en el ámbito; dynasty con el
  mismo `league_id` produce claves distintas por construcción (E14).
- Contaminación de configuración: el catálogo escribe SÓLO su ámbito; abrir
  A → volver → abrir B → volver deja cada registro byte a byte igual
  (comprobado en la suite).
- Completado marcado activo: `complete` es ternario; sin totales declarados un
  draft con picks se dice «in progress · N picks», nunca «complete».
- Replay sin picks: la entrada no existe (suite de replay).
- UNKNOWN pintado como cero: la sólo-registro dice «configuration unknown» y
  «N picks», nunca «0 huecos» ni «completa».
- Un fallo DE LA SUITE cazado y corregido: comparar los registros con
  `JSON.stringify` del volcado entero daba falso positivo porque el ORDEN de
  iteración de `localStorage` cambia tras reescribir una clave. La comparación
  es por clave ordenada. Un guardián que falla por artefactos acaba ignorado.

## Suite

`web/tools/lab/command-center.mjs`: estado vacío, fixture A (una liga
tranquila / all-clear), B (activa + completada + sin configurar, con el
aislamiento A→B→A), C (diez, con una sólo-registro), D (veinte de estrés con
la estructura de 32 equipos y una liga en el reloj; 20 filas en <3 s), y el
barrido 390/768 con objetivos de 44 px y sin desbordamiento. Capturas en el
scratchpad del laboratorio.
