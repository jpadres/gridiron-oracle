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
