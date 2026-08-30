# Laboratorio de tortura — hallazgos y diseño

Bloque autónomo sobre `a9369a7`. Lo que sigue separa lo **medido** de lo
**diseñado**: nada de aquí cambia una capacidad, y lo que no se pudo establecer
queda como UNKNOWN.

---

## 1. Duplicación de hechos (fase 1)

Un mismo hecho calculado dos veces, por caminos distintos:

| Hecho | Implementación A | Implementación B |
|---|---|---|
| Cuándo me toca | `draftSync.pickSchedule` + `picksUntilMe` (Draft Board) | `draftLog.slotForOverall` + `untilMyTurn` (Draft Room) |

**62.640 comprobaciones cruzadas: coinciden en todo** — 5 tamaños de liga × 2
tipos × todos los puestos × 10 rondas × todos los estados. No es un bug hoy; es
deuda: la próxima corrección hay que hacerla en dos sitios y nada obliga a ello.

No se unifica en este bloque porque tocar la ruta del Board sin necesidad es
riesgo sin beneficio. Queda propuesto: `draftSync` delega en `draftLog`.

---

## 2. FASE 12 — el modelo de plantilla que falta

El Draft Room **no recoge `roster_positions`**, así que «MY ROSTER» no puede
dibujar huecos sin inventárselos. Hoy lo dice en pantalla en vez de fingirlo.

### Representación canónica mínima propuesta

```
slots: ["QB","RB","RB","WR","WR","WR","TE","FLEX","SUPER_FLEX","K","DEF","BN","BN",...]
```

La lista literal, en orden, como la publica Sleeper. **No** un diccionario de
conteos: el orden es lo que permite pintar la alineación como la ve el usuario
en su app, y un conteo lo pierde.

| Campo | Clasificación | Motivo |
|---|---|---|
| `teams` | REQUERIDO | sin él no hay reemplazo ni calendario |
| `draftType` | REQUERIDO | snake y linear divergen desde la ronda 2 |
| `slots` | REQUERIDO para plantilla, OPCIONAL para draftear | el Room funciona sin él; «MY ROSTER» no |
| `mySlot` | OPCIONAL | sin él, turno y dueño quedan UNKNOWN, que ya está resuelto |
| `rounds` | DERIVABLE de `slots` si trae banquillo; si no, OPCIONAL | |
| `scoring` | OPCIONAL en el Room (usa el board publicado), REQUERIDO para valor por liga | |
| `season` | REQUERIDO | forma parte de la identidad de persistencia |

Para configuraciones históricas sin estructura: **UNKNOWN**, y la plantilla
sigue sin dibujar huecos. Nunca «12 equipos PPR».

---

## 3. FASE 13 — asignación de huecos, como PRESENTACIÓN

El problema: dados mis jugadores y unos huecos flexibles, ¿qué hueco ocupa cada
uno? Es **lógica de visualización**, no estrategia.

Algoritmo determinista propuesto, en tres pasadas:

1. **Dedicados primero.** Cada jugador va a un hueco de su posición si queda.
   Entre varios candidatos, el de mayor valor publicado.
2. **Flex después**, por valor descendente entre los no colocados elegibles.
3. **Superflex al final**, que es el más permisivo.

Por qué ese orden y no el contrario: colocar primero el hueco más permisivo
puede dejar sin sitio a un jugador que sólo cabía en el dedicado. El orden
restrictivo→permisivo es el que maximiza huecos llenos sin buscar máximos.

**Casos ambiguos** —dos alineaciones válidas con los mismos huecos llenos— se
resuelven por valor publicado descendente, que es determinista. Se documenta
que es *una* alineación válida, no *la* óptima: decir «óptima» sería una
afirmación de decisión y `BEST_PICK_FOR_ME` sigue BLOCKED.

No implementado: depende de la fase 12, que necesita capturar la estructura.

---

## 4. FASE 21 — qué haría falta para mover `DEEP_LEAGUE_VALUE`

Medido esta noche (fase 20), el límite del modelo **es por posición, no por
tamaño de liga**. Rank donde la fiabilidad mediana cruza cada umbral:

| Posición | fiab < 0,50 | < 0,30 | fracción del valor que pone el prior (rank 25-48) |
|---|---|---|---|
| QB | **21** | 27 | 76% |
| TE | 35 | 40 | 55% |
| RB | 43 | 48 | 50% |
| WR | 71 | 75 | 41% |

Consecuencia incómoda y honesta: **una superflex de 12 equipos ya pone el ancla
del QB en el puesto 25**, pasado el cruce de 0,50. E18 pasó allí con +26,4
puntos, así que el efecto seguía siendo medible — pero el guardián actual (≤14
equipos) es un proxy grueso de una cantidad que ahora sabemos medir.

**No se toca el guardián.** Cambiarlo con datos vistos después es exactamente lo
que el preregistro existe para impedir.

### Preregistro propuesto (E19, sin ejecutar)

- **Hipótesis**: el valor por liga se sostiene mientras el ancla de reemplazo
  caiga en un rank con fiabilidad mediana ≥ U.
- **U se fija ANTES**, no se busca el que salve el resultado.
- **Métrica**: repetir las 16 propiedades de E18 en configuraciones cuyo ancla
  quede por encima y por debajo de U, y comprobar que el fallo se predice.
- **Muestra**: temporadas 2019-2025 walk-forward, no sólo 2026.
- **Umbral**: las propiedades de magnitud pasan por encima de U en ≥ 90% de las
  configuraciones y fallan por debajo en ≥ 90%. Si no separa, U no sirve.
- **Riesgo declarado**: hay una vía tentadora de encoger menos en la cola para
  que el ancla parezca informativa. Eso es tocar el modelo para salvar la
  métrica, y necesita su propia validación fuera de sample.

---

## 5. FASE 28 — grafo de dependencias de `BEST_PICK_FOR_ME`

| Componente | Estado |
|---|---|
| Valor por liga | **MODELO VALIDADO** ≤14 equipos (E18) |
| Estructura de plantilla | **DATO NO DISPONIBLE** — fase 12 |
| Escasez de huecos titulares | MODELO DISPONIBLE (reparto voraz), no validado como decisión |
| Distancia al siguiente pick | **DATO DISPONIBLE** y exacto (62.640 cruces) |
| Reemplazo por posición | MODELO VALIDADO en su rango |
| Caída de tier | MODELO DISPONIBLE, **cortes no validados** |
| Plantilla propia | DATO DISPONIBLE (registro de picks) |
| Utilidad del banquillo | **NO DISPONIBLE** — nada la mide |
| Semanas de descanso | DATO DISPONIBLE, efecto no medido |
| Incertidumbre por lesión | PARCIAL — `availability.py` (+0,24 Spearman), no es una regla de decisión |
| Capital de draft (novatos) | DATO NO DISPONIBLE en el board — los novatos no entran |
| Estrategia posicional | **NO DISPONIBLE** — nadie la ha medido |

**La versión más pequeña testable**: no «el mejor pick», sino una única
pregunta binaria y falsable — *¿coger el mejor disponible por VOR de liga bate a
coger el mejor disponible por VOR genérico, medido sobre temporadas reales?* Es
una comparación entre dos reglas que ya existen, sin inventar ninguna.

---

## 6. FASES 39-40 — adaptador de Sleeper

### Fugas actuales del proveedor hacia el producto

La frontera **PROVEEDOR → eventos canónicos → fold** se respeta en el Draft
Room: consume `draftLog`, sin saber de Sleeper. Pero `DraftMode.jsx` **sí** tiene
forma de Sleeper dentro: `resolvePick`, `buildIndex`, la URL, el sondeo y el
emparejamiento por nombre viven en el componente. El Board conoce al proveedor.

No se mueve en este bloque: es refactor de riesgo, no corrección.

### Procedimiento de validación cuando haya un draft real (preregistro futuro)

| Qué | Cómo |
|---|---|
| Cadencia | sondeo cada 15 s; medir retraso entre pick real y pick visible |
| Retraso del proveedor | comparar hora del pick en Sleeper con la de aparición |
| Eventos duplicados | reenvío completo de la lista; el fold no puede duplicar |
| Corrección del comisionado | pick rehecho; documentar que el UNDO manual lo suprime |
| Fin del draft | `status: complete`; la interfaz deja de hablar en presente |
| Pérdida de red | offline a mitad; el modo manual sigue |
| Reanudación | vuelta de red; el estado converge sin duplicar |
| Límite de peticiones | 240 peticiones en dos horas contra endpoint público |
| Restricciones del navegador | CSP con un solo destino; sin credenciales |

**Umbral a fijar antes**: cero duplicados, cero picks perdidos, y `LIVE` sólo
mientras el sondeo funcione de verdad.

---

## 7. FASE 41 — Draft Replay: ya funciona

Probado: `fold(eventos.slice(0, n))` reconstruye estado válido en **cualquier**
punto — pool disponible, plantilla propia, numeración y recuento. Sin una línea
de código nueva.

```
fold(primeros   1) →   1 picks, 343 disponibles
fold(primeros  60) →  54 picks, 290 disponibles
fold(primeros 204) → 180 picks, 164 disponibles
```

Es consecuencia directa del registro de eventos, no una funcionalidad que haya
que construir. Lo que faltaría es interfaz: un deslizador sobre `seq`.

---

## 8. FASE 42-43 — modo demo y correcciones

**Demo**: el laboratorio de bots ya genera drafts deterministas contra el motor
real. Un modo demo sería conectar esa fuente a la misma ruta canónica de eventos
con `source: "DEMO"`. Aislarlo es trivial —es una fuente más— pero exige que
nada de demo se persista en un ámbito de liga real.

**Corrección**: TAKE/UNDO ya cubre misclic, reversión y dueño equivocado.
Lo que **no** se puede representar hoy: reordenar picks (cambiar el `overall` de
un pick sin deshacer los siguientes) y un pick con dos dueños en disputa. Ninguno
apareció como necesario en la tortura.

---

## 9. FASE 56 — oportunidades ya habilitadas

| Oportunidad | Clasificación |
|---|---|
| Draft Replay | **YA POSIBLE** — probado, sólo falta interfaz |
| Modo demo | **CONSTRUCCIÓN PEQUEÑA** — el laboratorio ya lo genera |
| Vista de huecos de plantilla | **NECESITA DATO** — fase 12 |
| Liga manual configurable | **CONSTRUCCIÓN PEQUEÑA** — el modelo está diseñado arriba |
| Historial de drafts | **YA POSIBLE** — los registros persisten por identidad |
| Resumen compartible | CONSTRUCCIÓN PEQUEÑA, sin afirmaciones |
| Presets de configuración | CONSTRUCCIÓN PEQUEÑA |
| Buscador de rondas tardías | **YA POSIBLE** — filtro sobre el pool |
| Monitor de rachas (factual) | **YA POSIBLE** — contar posiciones en los últimos N picks |
| Corte de tier | **YA HECHO** esta noche |
| Panel multi-liga | CONSTRUCCIÓN PEQUEÑA — los registros ya están separados |

---

## 10. FASE 57 — lo que NO se puede construir todavía

Sin evidencia, ninguna de estas puede aparecer en la interfaz, ni con otro
nombre:

- AI BEST PICK / SMART PICK / PICK RECOMENDADO
- WIN PROBABILITY
- DRAFT GRADE
- VALUE EDGE
- SAFE TO WAIT / PUEDES ESPERAR
- «este jugador seguirá disponible en tu próximo turno»
- PREDICCIÓN DE RACHA POSICIONAL
- PROBABILIDAD DE ENFRENTAMIENTO
- ESTRATEGIA ÓPTIMA
- CONFIANZA / ESTRELLAS / SEMÁFORO sobre un jugador

La distinción que las separa de lo permitido: **contar es factual, anticipar no
lo es**. «Quedan 2 en este tier» se puede comprobar. «Aguantará hasta tu turno»
es una probabilidad que nadie ha calibrado.


---

## 11. Corrección autoritativa — plantilla NORMAL frente a la especial de 32

El dueño confirmó su plantilla estándar. **No es** la de la captura de 32
equipos, que es una liga de excepción.

```
NORMAL      QB · RB · RB · WR · WR · TE · FLEX · DEF · K     (9 huecos)
ESPECIAL    RB · WR · FLEX · FLEX · FLEX · SUPER_FLEX        (6 huecos)
```

Las dos viven en `league.py` como `NORMAL_ROSTER` y `DEEP_32_ROSTER`, y el
fichero dice en su cabecera lo único que importa: **un preset es una comodidad,
no lo que tiene una liga desconocida**. Una liga externa sin estructura leída
sigue levantando `UnsupportedRoster`; hay un test que lo fija.

### Nueve huecos, siete de reparto

Distinción que hay que tener presente y que el test separa: la plantilla normal
declara **9 huecos**, pero sólo **7 entran en el reparto de VOR**. El pateador y
la defensa existen en la liga y hay que poder draftearlos, pero el modelo no los
proyecta, así que no consumen hueco de asignación.

    SELECCIONABLE ≠ RANKEABLE.

`KICKER_ORDINAL_RANKING` sigue REJECTED y `DST_STREAMING` sigue DESIGN_ONLY. Que
la liga exija una defensa no sube la autoridad de nada.

### Asignación de huecos, ya implementada como PRESENTACIÓN

`league.assign_slots` reparte jugadores en huecos para pintarlos. Tres reglas:

1. **Restrictivo antes que permisivo**: dedicados → FLEX → SUPER_FLEX. Al revés,
   un jugador que sólo cabía en su hueco dedicado puede quedarse fuera porque un
   flexible se lo llevó, y la plantilla enseñaría un hueco abierto con un
   jugador sobrante que sí encajaba.
2. Entre elegibles, mayor valor publicado. Determinista, que es lo único que se
   le exige.
3. Un hueco abierto es un **hecho**. `RB — OPEN` sí; «te falta un corredor» no.

No está conectada a la interfaz: para eso hace falta capturar la estructura de
la liga, que es la fase 12 y sigue pendiente.

### Aislamiento, probado en navegador

Ciclo normal → 32 → normal con picks en medio: la normal vuelve con sus cuatro
picks, su identidad y su reloj de 12 equipos intactos; la especial conserva los
suyos; dos claves de registro separadas. 12 comprobaciones, cero fugas.

---

## 12. Auditoría de skills de deportes y fantasy

Lo que hay clonado en el entorno, leído en origen: código, licencia y —lo que de
verdad decide— **términos de la fuente de datos**, que no son la licencia del
código.

| Fuente | Licencia código | Datos reales | Veredicto |
|---|---|---|---|
| `machina-sports/sports-skills` → `nfl-data` | MIT | mitad **ESPN no oficial**, mitad **nflverse** | **Sólo referencia** |
| `jdguggs10/flaim` → `fantasy-mcp`, `sleeper-client` | MIT | ESPN / Yahoo / Sleeper con credenciales | **Sólo referencia de arquitectura** |

### Por qué `nfl-data` no entra en producción

Su propia referencia lo dice:

> «Player IDs are not portable between the two backends: ESPN athlete IDs and
> nflverse GSIS IDs are unrelated and there is no crosswalk. **Match on name plus
> team**.»

Emparejar por nombre y equipo es exactamente lo que produjo el problema de los
dos «B.Robinson» de Atlanta y lo que la regla de identidad de este proyecto
prohíbe. La mitad ESPN es **arquitectónicamente incompatible** con el board, que
va por `gsis_id`.

Y la mitad nflverse **es la fuente que Gridiron ya usa directamente**. Añadir un
intermediario para llegar al mismo sitio suma dependencia y no suma dato.

Lo que sí aporta como referencia: `get_depth_chart`, `get_injuries` y
`get_transactions` son datos que Gridiron no tiene y que serían INFORMACIÓN
válida — pero vienen de endpoints no oficiales de ESPN, sin garantía de
estabilidad ni términos claros. Eso es una decisión de riesgo, no técnica.

### Lo que sí vale de `flaim`: el mapa de capacidades por proveedor

```ts
const ROSTER_SELECTOR_CAPABILITIES = {
  espn:    { football: 'week', baseball: 'date', ... },
  sleeper: { football: 'week', basketball: 'week' },   // sin baseball ni hockey
};
```

Declara **qué sabe hacer cada proveedor** en vez de suponer que todos responden
a la misma forma de pregunta, y normaliza la petición contra esa tabla. Es la
idea que a Gridiron le falta: hoy la forma de Sleeper vive dentro de
`DraftMode.jsx` —`resolvePick`, `buildIndex`, la URL, el sondeo— así que el
Board conoce al proveedor. El Draft Room ya está limpio; el Board no.

Se copia **la idea**, no el código: una tabla de capacidades por adaptador, y la
frontera PROVEEDOR → eventos canónicos → fold para todos.

### Decisión

**Ninguno se instala.** Uno es incompatible con la regla de identidad y duplica
una fuente que ya tenemos; el otro es un producto de otro dominio del que
interesa un patrón de veinte líneas.

    UNA DEPENDENCIA QUE NO APORTA DATO NUEVO ES SUPERFICIE SIN CONTRAPARTIDA.


---

## 13. Mapa de datos, verificado contra el repositorio

No de memoria: leído de los parquet que hay.

### Lo que HAY, con identidad GSIS y sin red

| Dato | Dónde | Cobertura |
|---|---|---|
| Semanas-jugador | `player_weeks.parquet` | 476.158 filas, 150 columnas, 1999-2026 |
| Volumen | mismo | intentos, acarreos, objetivos, recepciones |
| Cuota de uso | mismo | `target_share`, `air_yards_share` |
| Yardas aéreas | mismo | `passing_air_yards`, `receiving_air_yards` |
| Calendario | `games.parquet` | 7.548 partidos; **2026 completo con 272 de regular** |
| Contexto de partido | mismo | techo, descanso, QB titular, línea, moneyline |
| **Descansos** | derivado | **32 de 32, exacto** |

### Lo que NO hay, y no se puede fingir

Snaps · rutas · uso en zona roja · depth charts · **lesiones** · participación en
entrenamiento · inactivos · ADP conectado · proyecciones ajenas · propiedad ·
actividad de waivers.

La búsqueda de columnas de lesión devolvió **cero**. No es que estén incompletas:
no existen en el dato local.

### El límite duro, que no es de licencia

`adp.py` ya documenta que desde este entorno el CONNECT devuelve 403 para
fantasyfootballcalculator, api.sleeper.app y api.fantasypros por igual. Y el
crosswalk: Gridiron va por `gsis_id`, Sleeper mapea a GSIS, **ESPN no mapea a
nada**. Cualquier fuente que exija emparejar por nombre y equipo queda fuera por
la regla de identidad. Eso restringe más que cualquier licencia.

---

## 14. El primitivo elegido: semanas de descanso

De los candidatos —config de plantilla, crosswalk, descansos, snapshot de
decisión, replay— gana el descanso por eliminación honesta:

| Candidato | Por qué no |
|---|---|
| Crosswalk de identidad | necesita red que está bloqueada |
| Config de plantilla | es una funcionalidad de interfaz, no un primitivo |
| Snapshot de decisión | especulativo hasta que haya decisiones que guardar |
| Draft Replay | **ya funciona**, sólo le falta interfaz |
| **Descansos** | determinista, dato local completo, cero autoridad de modelo |

`fantasy/schedule.py` deriva el descanso por ausencia en temporada regular, y
mantiene **tres estados separados** que es donde estaba el riesgo:

    DESCANSA ≠ ELIMINADO ≠ NO SE SABE.

Un equipo ausente en playoffs está eliminado, no descansando. Un equipo al que
le faltan dos semanas no tiene descanso derivable y **no se afirma ninguno** —
elegir una de las dos sería inventar cuál.

Publicado al payload sólo si el calendario está completo: media verdad sobre
descansos produce el aviso falso que no queremos. 32 entradas, 748 bytes.

En pantalla es un dato junto al jugador —`Bye 11`— **sin color de alarma**. Hay
un test que comprueba que no usa el tono de `--live`: cuándo descansa un jugador
no dice qué hacer con él, y teñirlo de rojo lo convertiría en un consejo.

Lo que desbloquea sin validar nada: alineación incompleta por descanso,
concentración de descansos en una plantilla, y la primera pieza real de un
centro de mando semanal.
