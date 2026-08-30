# Multi-liga y draft en directo — auditoría

Estado: **AUDITORÍA. Nada implementado.** 30/8/2026.
Contexto temporal verificado al empezar: hoy es **2026-08-30**, temporada
**2026**, jornada **1**, cuyo primer kickoff es el **9 de septiembre**. No se
dedujo del entrenamiento ni de un artículo: sale de `data/raw/games.csv` y del
payload publicado.

El principio que gobierna todo lo que sigue:

> **UNA LIGA = UN CONTEXTO INDEPENDIENTE. UN DRAFT = UN ESTADO INDEPENDIENTE.**

---

## 1. Qué hay hoy, campo por campo

### Datos de liga

| Dato | Estado | Dónde |
|---|---|---|
| Puntuación (`scoring_settings`) | **AVAILABLE** | `sleeper.scoring_from`, 15 claves traducidas, `strict=True` levanta ante lo desconocido |
| Nº de equipos (`total_rosters`) | **AVAILABLE** | `sleeper.league_settings_from` |
| Posiciones de plantilla | **PARCIAL** | se leen QB/RB/WR/TE, FLEX y SUPER_FLEX; **el banquillo, K, DEF e IDP se descartan** |
| Nombre de la liga | **NO SE USA** | viene en la respuesta y no se guarda |
| Temporada | **NO SE USA** | idem |
| Lista de mis ligas | **AVAILABLE, SIN USAR** | `sleeper.leagues(user_id, season)` existe y no la llama nada |
| Mi `roster_id` / equipo | **NO SE USA** | `sleeper.rosters()` existe y no la llama nada |

### Datos de draft

| Dato | Estado | Dónde |
|---|---|---|
| Lista de drafts | **AVAILABLE** | `sleeper.drafts(league_id)` |
| Picks | **AVAILABLE** | `sleeper.draft_picks(draft_id)` |
| Emparejamiento con el board | **AVAILABLE y exacto** | vía `gsis_id`, que es el mismo id de nflverse. Sin adivinar por nombre |
| `draft.status` | **NO SE LEE** | `pre_draft` / `drafting` / `complete` viene y se ignora |
| `draft.type` | **NO SE LEE** | snake / linear / auction |
| `draft_order` / `slot_to_roster_id` | **NO SE LEE** | es de donde saldría MI PUESTO |
| Nº de rondas | **NO SE LEE** | |
| Puesto de draft | **NOT AVAILABLE hoy** | derivable de `draft_order`, no implementado |
| Picks hasta mi turno | **NOT AVAILABLE hoy** | derivable de puesto + tamaño + tipo |
| Historial por liga | **NOT AVAILABLE** | no se guarda nada |

### Lo que Sleeper expone y no usamos

`GET /league/{id}/drafts` trae `status`, `type`, `settings.rounds`,
`draft_order`, `slot_to_roster_id`, `start_time`, `last_picked`.
`GET /draft/{id}/picks` trae `round`, `pick_no`, `draft_slot`, `picked_by`.
**Nada de esto se lee hoy** más allá de `draft_id` y `player_id`.

---

## 2. Los cuatro defectos reales

Estos no son «faltan funciones»: son cosas que hoy pueden dar una respuesta
falsa.

### 2.1 El estado de draft es GLOBAL

```js
const STORAGE_KEY = "gridiron-draft-v1";      // DraftMode.jsx:46
useState({ gone: [], mine: [], league: "", userId: "" });
```

Una sola clave de `localStorage` para todas las ligas. Cambiar de liga
**sobrescribe** el estado de la anterior: los jugadores tachados en la liga A
siguen tachados en la B, y la plantilla de la A aparece como plantilla de la B.
Es exactamente la contaminación que la regla prohíbe, y hoy ocurre siempre.

### 2.2 La interfaz dice `live` sin comprobar que lo sea

```js
setStatus({ state: "live", at: Date.now(), … });   // DraftMode.jsx:191
```

`live` se fija en **cualquier** sondeo con éxito y **no caduca nunca**. El
`at` se guarda y **no se pinta en ninguna parte**. Si la pestaña se va al fondo y
el intervalo se ralentiza —lo que hacen todos los navegadores—, la pantalla sigue
diciendo `live` sobre datos de hace minutos. En un draft en directo, dos minutos
son cuatro picks.

Lo que se enseña hoy es `Refreshes every 15 seconds`: una **promesa**, no una
observación. Debe ser `Last sync 8s ago`, que es un hecho comprobable.

### 2.3 Un draft terminado puede presentarse como en curso

```js
drafts.sort(…); draftId = drafts[0].draft_id;      // DraftMode.jsx:170
```

Se coge el draft de la temporada más alta **sin mirar `status`**. Un draft
`complete` de hace tres semanas se sondea igual y se pinta igual que uno vivo.

### 2.4 `SLEEPER_SYNC_PERIODIC` no es `SLEEPER_LIVE_BROWSER`

El registro de capacidades ya las separa, y bien:

| Capacidad | Estado | Qué demostró E13 |
|---|---|---|
| `SLEEPER_SYNC_PERIODIC` | VALIDATED | `state/nfl` y `user/<id>` responden 200 desde un runner de GitHub Actions |
| `SLEEPER_LIVE_BROWSER` | **BLOCKED** | nada. El camino navegador → Sleeper **no está comprobado** |

Que un runner alcance la API no demuestra que el navegador de un usuario lo haga:
son CORS, es la CSP, es la red del móvil en un sofá. **El modo directo tiene que
seguir cerrado hasta que se compruebe de verdad.** Nota incómoda: el sondeo de
`DraftMode` ya está en producción usando ese camino sin comprobar, y por eso el
apartado 2.2 importa el doble.

---

## 3. Qué es global hoy y tiene que pasar a ser de la liga

| Hoy global | Debe ser por liga |
|---|---|
| `gone` / `mine` en una clave | un estado por `(league_id, draft_id)` |
| `league` / `userId` únicos | catálogo de ligas, cada una con su usuario |
| Puntuación PPR del payload | la puntuación **de esa liga** |
| 12 equipos supuestos | `total_rosters` **de esa liga** |
| `SLOTS = {QB:1,RB:2,WR:3,TE:1}` codificado | `roster_positions` **de esa liga** |
| Un board de VOR | un board por puntuación y tamaño |

El último es el que más trabajo esconde: **VOR depende del nivel de reemplazo, y
el nivel de reemplazo depende del tamaño de la liga y de los huecos de
titular**. Dos ligas distintas no comparten board, comparten proyecciones. Eso
enlaza con el bloque A de V2 (`MULTI_LEAGUE_SCORING`, hoy BLOCKED) y no se puede
resolver sólo en el cliente: el payload publica puntos ya cocinados, no
componentes.

---

## 4. Qué puede funcionar con sincronización periódica y qué no

| Función | Basta periódico | Requiere navegador en directo |
|---|---|---|
| Catálogo de mis ligas | **sí** | |
| Configuración de la liga | **sí** | |
| Mi puesto de draft | **sí** (antes del draft) | |
| Plan pre-draft | **sí** | |
| Picks ya hechos, pre-draft | **sí** | |
| Historial de drafts | **sí** | |
| Feed de picks en vivo | | **sí** |
| «Estás en el reloj» | | **sí** |
| Picks hasta tu turno, en vivo | | **sí** |

Casi todo el valor está en la columna de la izquierda. El modo directo es la
guinda, no el producto.

---

## 5. Modelo de estado propuesto

```
LeagueCatalog                  { user_id, season, leagues[], synced_at }
  League                       { league_id, name, season, platform,
                                 total_rosters | UNKNOWN,
                                 scoring | UNKNOWN,
                                 roster_positions | UNKNOWN,
                                 my_roster_id | UNKNOWN, synced_at }
    Draft                      { draft_id, status, type, rounds,
                                 my_slot | UNKNOWN, start_time, synced_at }
      DraftSession             { picks[], available[], my_roster[],
                                 source, last_sync_at, freshness }
```

Clave de almacenamiento `gridiron-draft-v2:<league_id>:<draft_id>`, nunca una
global. Cambiar de liga **lee otra clave**; no puede contaminar porque no
comparte espacio.

`UNKNOWN` es un valor de primera clase en cada campo. Hoy el código supone 12
equipos y PPR cuando no sabe; eso es inventarse la configuración de una liga
ajena, y una liga superflex con esos valores da un board sencillamente falso.

## 6. Modelo de frescura del draft

Ya implementado en `src/oracle/freshness.py` con `Domain.DRAFT_STATE`:

| Antigüedad | Etiqueta | Qué puede decir la interfaz |
|---|---|---|
| ≤ 30 s | `LIVE` | «En directo», y sólo aquí |
| ≤ 2 min | `CURRENT` | «Última sincronización hace 1 min» |
| ≤ 10 min | `RECENT` | igual, con aviso visible |
| > 10 min | `STALE` | «Estado antiguo — sincronizar» y **no** se recomienda pick |
| sin fecha | `UNKNOWN` | nunca se presenta como actual |

Y `LIVE` sólo se pinta si además `draft.status === "drafting"` **y** el último
sondeo fue correcto. Las tres condiciones, no una.

## 7. UX propuesta (sin implementar)

**MIS LIGAS** — una fila por liga con marca de equipo, nombre, tamaño ·
puntuación, estado del draft y fecha. Lo desconocido dice `UNKNOWN`, no un valor
por defecto.

**PRE-DRAFT** — «Eliges 8º», los picks de las cuatro primeras rondas derivados
del tipo real de draft (no snake codificado), y los acantilados de tier que caen
antes de tu siguiente turno. Sin porcentajes de disponibilidad: no están
calibrados. Se enseña ADP y tier, que son hechos.

**EN DIRECTO** — selector de liga siempre visible, feed compacto de los últimos
picks, «faltan 3 para ti», y la decisión dominando la pantalla.

**EN EL RELOJ** — las tres preguntas separadas, que hoy están colapsadas en una:
*mejor disponible* (el board), *mejor para mi equipo* (board + mi plantilla + mi
puntuación) y *¿puedo esperar?* (conteo de tier y picks hasta mi turno, **nunca**
una probabilidad inventada).

En móvil, por orden: reloj/turno → mejor pick → mejor disponible → corte de tier
→ filtro → mi plantilla → picks recientes.

## 8. Plan de pruebas

Aislamiento (lo primero, y bloqueante): dos ligas a la vez; el mismo jugador
cogido en A y libre en B; A → B → A sin fuga; puntuaciones, tamaños y plantillas
distintos; recarga durante un draft; navegación atrás y adelante.

Draft: sin empezar, en curso, pausado, terminado; puesto desconocido; snake y no
snake; pick duplicado; pick corregido; identidad de jugador que no empareja.

Frescura: conexión perdida a mitad; estado viejo presentado como `LIVE` (debe
fallar); sondeo con error; reloj del cliente adelantado.

**Falla cerrado**: sin poder establecer el estado actual del draft, no se
recomienda un pick. Se enseña el último estado verificado **con su hora** y se
dice que está viejo.

## 9. Riesgos

1. **Fuga entre ligas.** Es el peor y es el estado actual. Se cierra con la clave
   compuesta y un test que lo demuestre, antes que cualquier otra cosa.
2. **`LIVE` mentiroso.** Cerrado por la ventana de 30 s + `status` + último
   sondeo correcto.
3. **Configuración supuesta.** Un board de superflex calculado como 1QB no está
   «un poco mal»: está mal en el orden entero. `UNKNOWN` en vez de un valor por
   defecto.
4. **Un board por liga es caro.** Recalcular VOR por puntuación y tamaño es
   trabajo de servidor, no de cliente. Depende del bloque A de V2.
5. **Comprobar el camino del navegador es un experimento**, no una tarde: hay que
   medirlo desde un navegador real, en una red real, durante un draft real.
