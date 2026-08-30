# Draft Room — arquitectura independiente de plataforma

Estado: **DISEÑO. Nada implementado.** 30/8/2026.

El principio que cambia:

> **Sleeper es UN adaptador de entrada, no el producto.** El Draft Room consume
> eventos de pick canónicos. De dónde vengan es un detalle del adaptador.

---

## 1. Acoplamiento actual a Sleeper

Auditado sobre `web/app/fantasy/DraftMode.jsx` tal y como está hoy.

| Qué | Cómo está hoy | Por qué bloquea el modo manual |
|---|---|---|
| Estado | `{gone: [], mine: []}` — **dos listas de ids** | No hay pick, ni ronda, ni roster, ni hora, ni origen. La procedencia es **estructuralmente imposible** |
| Fusión | `goneSet = state.gone ∪ sync.gone` | Es una unión de conjuntos, no un registro de eventos |
| Deshacer | `undo()` quita de `state.*` | **No funciona sobre un pick sincronizado**: el sondeo lo vuelve a añadir a los 15 s. Hoy un emparejamiento erróneo de Sleeper **no se puede corregir** |
| Contexto | `draft.settings.teams/rounds`, `draft.type`, `draft_order` | Todo sale del objeto de Sleeper. Una liga manual no tiene nada |
| Reloj | `picksUntilMe({picksMade: sync.total})` | `sync.total` es el contador de Sleeper. En manual es `null` y **no hay reloj** |
| Aislamiento | `scopeFor` exige `draft.draft_id` | Sin Sleeper cae a `local:<temporada>`: **todos los drafts manuales comparten un estado**. La garantía de E14 cubre las ligas de Sleeper, no las manuales |
| Configuración | `leagueFit` sale de `fetch(/league/<id>)` | Una liga manual no puede declarar puntuación ni plantilla |
| Frescura | `syncState({connected: Boolean(league)})` | `connected` significa «hay un id de Sleeper». Un draft manual sale como **«Not connected»**, que es la lectura equivocada: no está desconectado, es la fuente de verdad |

**El hallazgo estructural**: hoy no existe el concepto de *pick*. Existe el
concepto de *jugador que ya no está*. Todo lo que el Draft Room necesita —quién
lo cogió, en qué puesto, cuándo, con qué origen— no cabe en la forma actual, y
por eso esto es un cambio de modelo y no una funcionalidad más.

---

## 2. El evento de pick canónico

```
DraftPick
  id            ULID. Ordena los eventos y deduplica
  player_id     gsis de nflverse — la clave con la que ya se cruza todo
  overall       número de pick global, o UNKNOWN
  round         derivado de `overall`, o UNKNOWN
  slot          puesto que eligió, o UNKNOWN
  roster        MINE | OPPONENT | UNKNOWN   (nunca se adivina)
  at            instante
  source        MANUAL | SLEEPER | <proveedor>
  provider_id   id del pick en el proveedor, para deduplicar
  undone_at     marca de anulación, o null
```

**Registro append-only con lápidas, no un conjunto mutable.** Es la única forma
de que deshacer funcione en modo sincronizado: si se borra la fila, el siguiente
sondeo la vuelve a poner. Una lápida es *una afirmación manual que sobrevive al
proveedor*, y se ve en el registro.

## 3. Estado del draft manual

```
ManualLeague                { id, name, platform, season, teams, scoring,
                              roster_positions, draft_type, rounds, my_slot }
DraftSession                { league_id, draft_id, picks: DraftPick[], source_mode }
```

`draft_id` en manual es un ULID local. Con eso, la clave de aislamiento deja de
depender de Sleeper:

```
gridiron-draft-v2:manual:<season>:<league_id>:<draft_id>
```

Y las ligas manuales quedan tan aisladas como las sincronizadas, que hoy **no lo
están**.

## 4. De dónde sale el pick actual

```
overall_actual = (picks vivos) + 1
round, slot    = pickSchedule(teams, type)   ← ya existe, ya tiene tests
```

No hace falta Sleeper: sale del recuento local y de la configuración de la liga.
Una subasta no tiene turno y devuelve lista vacía, como ya hace hoy.

## 5. Cómo se identifica MI pick

Tres niveles, en orden, y **el tercero no se salta**:

1. **Derivado.** Si `my_slot` y `draft_type` son conocidos, el pick `overall`
   es mío si `slot(overall) == my_slot`. Determinista.
2. **Declarado.** El usuario pulsa «Drafted by me» o «Someone took him».
3. **UNKNOWN.** Un pick sin roster cuenta como fuera del board y **no entra en
   mi plantilla**.

> **Nunca se asigna un jugador a una plantilla equivocada en silencio.** Cuando
> la derivación decide, la interfaz enseña a qué roster lo asignó, para que un
> error se vea en el momento y no tres rondas después.

## 6. Deshacer y corregir

Deshacer emite un evento, no borra uno:

```
UNDO(player_id, at)  →  lápida
```

Regla determinista, y cubre los cinco casos que se pidieron:

1. El estado canónico es un *fold* sobre el registro ordenado por `at`, `id`.
2. El adaptador sólo emite eventos para picks que **no existen ya** (dedupe por
   `provider_id`, y si no lo hay, por `player_id` + `overall`).
3. Una lápida manual **ignora los eventos del proveedor anteriores** a ella.
4. Un evento del proveedor **posterior** a la lápida vuelve a tomar al jugador —
   es el caso del comisionado que rehace el pick, y tiene que ganar.
5. A igual instante, `MANUAL` gana a `SLEEPER`. Es el desempate, y es el único.

Nada se pierde: la corrección queda en el registro con su hora y su origen.

## 7. Manual frente a sincronizado, y la frescura

**Un draft manual no tiene problema de frescura de red.** Su estado canónico son
los picks que se han introducido. Marcarlo `STALE` porque Sleeper no ha
sincronizado sería aplicar el modelo equivocado.

| Modo | Lo que dice la interfaz |
|---|---|
| Manual | `MANUAL · 42 picks recorded` |
| Sincronizado, sondeo reciente y `drafting` | `LIVE` |
| Sincronizado, sondeo viejo | `LAST SYNC 4 min ago` / `STALE` |
| Sincronizado, error | `SYNC ERROR` — y el tablero manual sigue |

Esto exige un nivel nuevo en `draftSync.js`: hoy `connected: false` produce
`OFFLINE / "Not connected"`, que en modo manual es literalmente falso.

## 8. Sin conexión

El sitio es estático y el payload viaja en el bundle: board, componentes,
`position_priors`, tiers y research ya están descargados cuando la página carga.
El **único** destino de red en runtime es el adaptador de Sleeper.

Consecuencia: **el Draft Room manual funciona sin conexión hoy**, sin trabajo
extra. Lo que hay que evitar es introducir una dependencia nueva que lo rompa —
ninguna llamada de research puede bloquear la pantalla de decisión.

## 9. Qué se recalcula con cada pick

| Cambia | No cambia |
|---|---|
| Jugadores disponibles | **El VOR** |
| Profundidad por posición | El nivel de reemplazo |
| Cuántos quedan en el tier | Los tiers en sí |
| Picks hasta mi turno | La proyección |
| Mi plantilla y mis huecos | |
| El orden ajustado por plantilla (`BENCH_VALUE`) | |

**El VOR no se recalcula durante el draft, y decirlo importa.** El nivel de
reemplazo es una propiedad de la estructura de la liga —equipos × titulares—, no
del avance del draft. Recalcularlo según se van los jugadores sería *otra
métrica*, sin validar, con el mismo nombre. Lo que sí cambia es quién queda.

---

## 10. Lo que se puede construir ya

Con las capacidades actuales, sin inventar nada:

- Draft Room manual completo: introducir picks, deshacer, plantilla, huecos.
- Reloj y turno derivados de la configuración de la liga.
- **Best Available** — es el board, que está validado.
- Cortes de tier y cuántos quedan: es un **conteo**, no una predicción.
- Profundidad por posición.
- Picks recientes con su origen.
- Ligas manuales con su propia configuración y su propio aislamiento.
- Funcionamiento sin conexión.

## 11. Lo que necesita `MULTI_LEAGUE_SCORING`

El board por liga. Hoy `LEAGUE_SPECIFIC_VALUE` está en NOT_READY: el compilador
es correcto (E15) pero el board publicado sigue siendo 12 equipos PPR. Hasta que
se aplique, el Draft Room manual enseña el board canónico y **lo dice**.

## 12. Lo que necesita `SLEEPER_LIVE_BROWSER`

**Sólo la automatización.** Esta es la distinción que cambia, y es permanente:

| Bloquea | No bloquea |
|---|---|
| Que los picks lleguen solos desde Sleeper | El Draft Room |
| Decir `LIVE` sobre datos de Sleeper | El modo manual |
| | El reloj, el turno, los tiers, Best Available |

## 13. Lo que sigue sin validar: BEST PICK FOR ME

No se construye todavía. Ordenar por «lo que le conviene a mi plantilla» exige
valor por liga (bloqueado) **y** una regla de construcción de plantilla que nadie
ha medido. Mientras tanto la pantalla enseña, sin fingir:

    BEST AVAILABLE      ← el board validado
    TIER CONTEXT        ← conteo
    ROSTER CONTEXT      ← hecho
    POSITIONAL DEPTH    ← conteo

La arquitectura deja el hueco de `BEST PICK FOR ME` preparado. El hueco se queda
vacío hasta que haya evidencia.

---

## 14. UX propuesta

**Zona de decisión persistente**, y siempre en este orden:

```
3 PICKS UNTIL YOU          ← turno, derivado
BEST AVAILABLE             ← board validado
  Garrett Wilson  WR · NYJ
CONTEXT                    ← hechos, no consejo
  2 left in WR tier 3
  Your roster: 1 WR, 2 RB
  RB depth: 14 left in tier
[ TAKEN ]  [ I TOOK HIM ]  ← dos acciones, 44px
```

Un jugador se marca en **una interacción**: pulsar la fila. Sin modal, sin
confirmación. Deshacer aparece en el sitio durante unos segundos:

```
TAKEN · Ja'Marr Chase        [UNDO]
```

Búsqueda siempre accesible, con la primera coincidencia marcable desde el
teclado. En escritorio, atajo para marcar y para deshacer.

## 15. Móvil a 390

Por orden, y el orden es la parte que no se negocia:

1. Turno / picks hasta ti — fijo arriba
2. Best available con sus dos acciones
3. Corte de tier
4. Búsqueda
5. Mi plantilla — plegable
6. Picks recientes — plegable
7. Lista completa

La zona de decisión ocupa la primera pantalla entera. Todo lo demás está por
debajo o plegado. La regla medida sigue valiendo: el pick tiene que verse sin
scroll.

## 16. Riesgos

1. **Asignar un pick al roster equivocado.** El peor, porque corrompe la
   plantilla y las decisiones siguientes. Mitigación: `UNKNOWN` es un valor de
   primera clase y la derivación siempre enseña lo que decidió.
2. **Deshacer que no deshace.** Es el estado actual en modo sincronizado.
   Mitigación: lápidas, no borrados.
3. **Introducir una llamada de red en la ruta de decisión.** Hoy el modo manual
   funciona sin conexión por construcción; es fácil perderlo sin darse cuenta.
4. **Que el modo manual parezca el plan B.** Es el modo que funciona en todas
   las plataformas y en un draft presencial. La interfaz no debe presentarlo
   como una degradación.

## 17. Convergencia — un solo estado (E17, hecho)

Al entregar el Draft Room quedó un hueco declarado: las dos pantallas guardaban
su estado por separado. `/fantasy` escribía `{gone, mine}` bajo la clave de su
ámbito; `/fantasy/draft` escribía eventos bajo `<ámbito>:log`. Para el usuario
era **un draft**, y para el código eran dos, cada uno con razón.

Lo que hace la convergencia:

| Pieza | Antes | Ahora |
|---|---|---|
| Identidad | cada pantalla resolvía la suya | `activeIdentity` — sondeo de Sleeper > liga del Room > tablero local |
| Persistencia | dos claves distintas | una: `<ámbito>:log` |
| Migración | cada pantalla heredaba las marcas por su cuenta | `loadOrMigrateLog`, y borra la clave vieja |
| Estado | dos listas de ids / un fold | un `fold`, en las dos |
| Picks del proveedor | dos listas fundidas al leer | eventos canónicos efímeros, por el mismo fold |

Y tres cosas que sólo se pudieron arreglar aquí, porque antes no cabían en la
forma del estado:

1. **Deshacer aguanta al sondeo.** El `UNDO` lleva reloj y el evento del
   proveedor lleva un ordinal, así que lo manual siempre es posterior. Antes el
   jugador volvía quince segundos después.
2. **El recuento cuenta lo sincronizado.** `state.count` sale del fold, no de
   sumar las dos listas manuales.
3. **«Start over» ya no desconecta la liga.** El botón vaciaba el objeto de
   estado entero y las preferencias iban dentro.

Lo que NO cambia: `LEAGUE_SPECIFIC_VALUE` sigue NOT_READY, `BEST_PICK_FOR_ME`
sigue BLOCKED, `SLEEPER_LIVE_BROWSER` sigue BLOCKED. Esto es representación del
estado, no un resultado.

El riesgo 2 de la sección anterior —«deshacer que no deshace»— queda cerrado.
