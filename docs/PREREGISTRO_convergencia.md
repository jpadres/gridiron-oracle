# Preregistro — E17: un solo estado canónico de draft

Escrito **antes** de implementar la convergencia y **antes** de ejecutar
`web/tools/qa-convergence.mjs`. 30/8/2026.

## El defecto que esto corrige

Hay dos pantallas que hablan del mismo draft y **no comparten estado**:

- `/fantasy` (Draft Board) guarda `{gone: [id], mine: [id]}` bajo
  `gridiron-draft-v2:<identidad>`.
- `/fantasy/draft` (Draft Room) guarda un registro de eventos bajo
  `gridiron-draft-v2:<identidad>:log`.

Son dos claves distintas. Tachar a un jugador en una pantalla no lo tacha en la
otra, y deshacerlo en una no lo deshace en la otra. Para el usuario es **un
draft**: un jugador cogido está cogido, mire donde mire.

La forma vieja además no puede representar lo que hace falta. `{gone, mine}` es
un conjunto de ids, no una lista de picks: no hay hora, ni orden, ni procedencia.
De ahí sale un fallo concreto y reproducible — **deshacer no funcionaba sobre un
pick sincronizado**: se quitaba del conjunto y el siguiente sondeo lo volvía a
meter quince segundos después, sin que nada lo dijera.

## Qué se afirma, y qué no

Se afirma **convergencia y corrección**: que las dos pantallas leen y escriben el
mismo estado, que un pick es un resultado y no dos, que deshacer funciona desde
cualquiera de las dos, y que la migración no inventa ni pierde nada.

**No** se afirma nada nuevo sobre el valor de las decisiones.
`LEAGUE_SPECIFIC_VALUE` sigue NOT_READY y `BEST_PICK_FOR_ME` sigue BLOCKED. Esto
es un cambio de representación del estado, no un modelo.

## La regla que no se toca

    PROPIEDAD DESCONOCIDA > PROPIEDAD PLAUSIBLE PERO EQUIVOCADA.

Las marcas heredadas de la forma vieja **no traen** número de pick ni hora ni,
en el caso de `gone`, dueño real. Se migran diciéndolo (`rosterSource:
MIGRATED`, `overall: null`) y **nunca** se inyectan en el ámbito de una liga
conectada: el blob v1 no trae `draft_id`, así que su destino sigue siendo el
ámbito LOCAL de la temporada. E14 depende de eso y se vuelve a comprobar entero.

## Escenarios, fijados antes de medir

### Unitarios (`node --test`)

1. Un TAKE del board y un TAKE del Room caen en el mismo estado: un jugador, un
   pick, sin duplicar.
2. Un UNDO emitido desde el board libera un pick registrado en el Room.
3. Un TAKE de proveedor seguido de un UNDO manual **sigue deshecho** aunque el
   proveedor reenvíe su lista entera (el fallo de los quince segundos).
4. Un TAKE manual sobre un jugador que ya trajo el proveedor **corrige el dueño**
   sin mover el pick de sitio.
5. La migración marcas→registro es idempotente: ejecutarla dos veces da el mismo
   registro, y la clave vieja desaparece.
6. La migración conserva la distinción: `mine` → MINE, `gone` → OPPONENT, las
   dos con `rosterSource: MIGRATED` y `overall: null`.
7. El estado v1 sigue sin poder aterrizar en el registro de una liga.
8. Dos ligas tienen claves de registro distintas y no se leen entre sí.
9. Identidad incompleta → sin clave → no se persiste nada.
10. `count` no cuenta dos veces a un jugador que está en el proveedor y a mano.

### Navegador (`web/tools/qa-convergence.mjs`, Chromium real)

11. Tachar en el board y abrir el Room: el jugador ya no está allí.
12. Draftear en el Room y volver al board: tampoco está, y el recuento coincide.
13. «Mine» en el board → aparece en la plantilla del Room. «Gone» → **no**.
14. Deshacer en el Room → el board lo devuelve a disponible.
15. Deshacer en el board → el Room lo devuelve a disponible.
16. El contador «off the board» del board es igual al recuento de picks del Room.
17. «Start over» vacía las dos pantallas **y no desconecta la liga**.
18. Recargar conserva el estado compartido en las dos.
19. Los picks de la liga A no aparecen en el Room de la liga B.

### Regresión

20. E14 sigue en 19/19.
21. E16 sigue en 27/27.

## Umbral

**21 de 21.** Ni uno menos. Un estado de draft que converge «casi siempre» es
peor que dos estados separados y declarados: separados sabes que lo están.

Latencia: registrar un pick sigue por debajo de **150 ms** en las dos pantallas,
sin ninguna petición de red en la ruta del pick.
