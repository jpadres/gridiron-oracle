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
