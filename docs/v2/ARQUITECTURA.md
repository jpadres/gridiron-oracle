# Decision Lab V2 — arquitectura y grafo de dependencias

Cinco bloques (A–E). Este documento es el diseño; la implementación va después y
sólo de los bloques fundacionales de bajo riesgo.

---

## Grafo de dependencias

```
        B. SLEEPER 403  ──── RESUELTO: no era un bloqueo del producto
             │                (root cause abajo; cambia el roadmap)
             │
             ▼
   ┌─────────────────────────────────────────────────────────┐
   │  D. REGISTRO DE CAPACIDADES        (fundacional, sin riesgo)
   │     qué puede y qué no puede afirmar el producto         │
   └────────────────────────┬────────────────────────────────┘
                            │  cada capacidad -> un estado
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │  E. AUTORIDAD DE DECISIÓN          (fundacional, sin riesgo)
   │     estado -> cuánta autoridad tiene la UI para hablar   │
   └────────────────────────┬────────────────────────────────┘
                            │  autoridad -> vocabulario permitido
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │  C. EVIDENCIA COMO PRODUCTO        (bajo riesgo, contratos)
   │     MONEDA / LEVE / CLARO / MUY CLARO desde la separación│
   └─────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────┐
   │  A. COMPONENTES EN VEZ DE PUNTOS   (migración grande)
   │     el único bloqueo duro de todo lo multi-liga          │
   └────────────────────────┬────────────────────────────────┘
                            ▼
        multi-liga · start/sit por liga · waivers · traspasos
```

**Orden de ejecución:** D → E → C son contratos puros: no tocan modelos, no
tocan cálculos y sólo añaden campos al payload. **A** es una migración de datos
con riesgo real y va después, con su propio preregistro de equivalencia.

**A no depende de D/E** y podrían ir en paralelo; se ponen después porque D/E
son los que impiden que la interfaz siga prometiendo lo que el modelo no
sostiene, y eso es más urgente que el multi-liga.

---

## B. SLEEPER 403 — ROOT CAUSE

**Conclusión: no es Sleeper, no es nuestra integración, y no es un bloqueo del
producto. Es la política de red de este contenedor de desarrollo.**

### La evidencia

| destino | resultado |
|---|---|
| `api.sleeper.app/v1/state/nfl` | **403 al CONNECT** |
| `www.google.com` | **403 al CONNECT** |
| `gridiron-oracle-five.vercel.app` | **403 al CONNECT** |
| `api.github.com` | 200 |
| `pypi.org` | 200 |
| `registry.npmjs.org` | 200 |

El proxy de agente publica su lista de exenciones y contiene **sólo**
`api.anthropic.com`, los registros de paquetes (npm, PyPI, jsr, crates, go) y
localhost. Todo lo demás recibe `connect_rejected: gateway answered 403 to
CONNECT (policy denial)`.

**El dato que lo cierra:** el proxy bloquea también el **propio sitio de
producción de este proyecto**. Nadie diría que el sitio está caído. Exactamente
el mismo razonamiento aplica a Sleeper.

### Qué significa esto, endpoint por endpoint

| pregunta del espec | respuesta |
|---|---|
| qué endpoint da 403 | **todos**, y también los de Google y los nuestros |
| desde dónde | **sólo desde este contenedor de desarrollo** |
| navegador / servidor / build / local / Vercel | **no probado en ninguno de los cuatro**; la ausencia de prueba no es prueba de fallo |
| cabeceras de la petición | irrelevantes: falla en el **CONNECT**, antes de enviar una sola cabecera |
| URL | irrelevante por lo mismo |
| frecuencia | 100% y determinista |
| ¿otros endpoints funcionan? | sí: GitHub, PyPI y npm |
| ¿reproducible? | totalmente |
| ¿infraestructura nuestra? | **no** |
| ¿comportamiento de Sleeper? | **no hay ni una sola evidencia de ello** |

### Corrección de lo que reporté antes

En el informe de V1 clasifiqué Game Day, Waivers y Trades como **BLOCKED BY
EXTERNAL SOURCE**. **Eso era incorrecto.** Están bloqueados por *este entorno*,
que es una limitación mía de desarrollo, no una propiedad del producto.

La CSP del sitio ya permite `connect-src 'self' https://api.sleeper.app`, así
que el camino desde el navegador está abierto por diseño. `DraftMode.jsx` ya lo
usa en producción.

### Lo que NO se sabe, y cómo se sabría

No hay evidencia positiva de que Sleeper responda desde el navegador, desde
Vercel o desde GitHub Actions — **nadie lo ha ejecutado nunca**, porque no se ha
hecho la primera sincronización real.

**La prueba barata:** un workflow manual de GitHub Actions que pida
`/v1/state/nfl` y publique el código de estado. Los runners de Actions tienen
internet abierto, tarda diez segundos y responde de una vez si la integración
sirve. Va como primer entregable de bajo riesgo de este bloque.

### Qué necesita de verdad cada función

| función | necesita en vivo | puede ser sincronización periódica | ya está cacheado |
|---|---|---|---|
| **Draft War Room** | picks del draft (cada ~90 s) | — | board, catálogo de jugadores |
| **Game Day** | inactivos y cambios de titular (T-90 a kickoff) | rosters, matchups | proyecciones, riesgo |
| **Waivers** | nada | rosters + transacciones, 1×/día | board, ranking semanal |
| **Trades** | nada | rosters, 1×/día | proyecciones ROS |
| **Multi-liga** | nada | ligas y reglas, 1×/semana | todo lo demás |

**Sólo el modo draft y el Game Day necesitan tiempo real.** Waivers, traspasos y
multi-liga funcionan con una sincronización diaria, y eso se puede hacer desde
GitHub Actions escribiendo un artefacto — sin depender del navegador y sin que
este contenedor tenga que llegar a Sleeper nunca.

**Regla que queda escrita:** no se construye Game Day sobre la integración en
vivo hasta que exista una comprobación verde desde un entorno real.

---

## A. COMPONENTES EN VEZ DE PUNTOS

### El problema, con precisión

El payload publica `projected_points`: un número **ya cocinado con unas reglas
concretas**. Con eso no se puede repuntuar para una segunda liga, porque la
información de cómo se llegó a ese número se perdió.

Hoy `fantasy_weekly.rankings` trae `projected_points`, `model_points` y
`baseline_points`. Los tres son puntos PPR. Para una liga estándar habría que
volver a correr el modelo entero.

### La cadena que se quiere

```
COMPONENTES CRUDOS DE FÚTBOL          recepciones, yardas, TDs, intercepciones...
        │                              (lo que el modelo ya calcula por dentro)
        ▼
COMPONENTES CANÓNICOS PROYECTADOS      un contrato estable, independiente de reglas
        │
        ▼
COMPILADOR DE PUNTUACIÓN DE LIGA       ScoringRules  (ya existe y funciona)
        │
        ▼
PUNTOS DE FANTASY DE ESA LIGA          se calcula al leer, no se almacena
        │
        ▼
RANKING DE ESA LIGA  →  DECISIÓN DE ESA LIGA
```

### El contrato de componentes

```python
@dataclass(frozen=True)
class ProjectedComponents:
    player_id: str
    season: int
    week: int          # 0 = temporada completa
    # Pase
    pass_attempts: float
    pass_yards: float
    pass_tds: float
    interceptions: float
    # Carrera
    carries: float
    rush_yards: float
    rush_tds: float
    # Recepción
    targets: float
    receptions: float
    rec_yards: float
    rec_tds: float
    # Comunes
    fumbles_lost: float
    two_point: float
```

Catorce números por jugador-semana. `score_components(components, rules)`
devuelve los puntos de cualquier liga, y **es la misma función que ya existe**
para estadísticas reales: `ScoringRules` no necesita cambiar.

### Por qué esto no rompe el board actual

`projected_points` **se queda en el payload**, calculado a partir de los
componentes con las reglas por defecto. La web actual no se entera. La migración
es aditiva y verificable con un test de equivalencia.

### El preregistro que hará falta

`|puntos_desde_componentes − projected_points| < 0,01` para los 256 jugadores del
ranking semanal y los 250 del board. **Si no cuadra, la migración no entra**: una
descomposición que no reconstruye el número original está mal hecha, y publicar
las dos versiones sería publicar dos verdades.

### Coste real

`_project_player` ya calcula los catorce números por dentro y los suma antes de
devolverlos. **La migración es dejar de sumar demasiado pronto.** El riesgo no
está en el cálculo sino en el payload: pasa de 5 campos por fila a 19, unos
+40 KB antes de comprimir sobre los 86 KB actuales.

---

## C. EVIDENCIA COMO PRODUCTO

De E12, medido sobre 89.114 pares:

| separación proyectada | etiqueta | acierto medido | n |
|---|---|---|---|
| < 1 punto | **MONEDA AL AIRE** | 50,6% [49,5–51,7] | 15.837 |
| 1 – 3 puntos | **LEVE** | 53,0–55,8% | 26.517 |
| 3 – 5 puntos | **CLARO** | 59,8% [59,1–60,5] | 19.682 |
| > 5 puntos | **MUY CLARO** | 66,7% [66,2–67,3] | 27.078 |

**No son probabilidades y el contrato lo impide por tipo.** Son frecuencias
históricas de acierto del sistema en decisiones de esa dificultad. Convertirlas
en «A tiene un 60% de superar a B» exigiría calibración por par, que es otro
experimento.

Reglas por posición que se derivan de lo medido:

- **QB** → `UNVALIDATED`. Pierde contra la media de seis partidos por tres vías
  independientes. La UI puede enseñar sus números; no puede recomendarlo.
- **K** → sin orden ordinal. Grupo de streaming, nunca K1…K12.
- **ROOKIES** → previa validada, con intervalo y tamaño de muestra visibles.
- **DST** → sólo diseño hasta que exista modelo.
- **CLIMA** → evidencia histórica descriptiva. **Nunca predictivo** hasta que
  exista dato en tiempo de pronóstico y pase validación prospectiva.

---

## D. REGISTRO DE CAPACIDADES

Una fuente central legible por máquina que dice qué puede afirmar el producto.

```
capability_id
status          VALIDATED | NOT_READY | REJECTED | BLOCKED | DESIGN_ONLY
evidence        una frase con el número
experiment_id   E1…E12
metric          nombre y valor
sample_size
limitations     lista
last_validated
model_version
```

Viaja en el payload. **La UI no puede presentar una capacidad con más autoridad
de la que permite el registro**, y eso se comprueba con un test, no con
disciplina.

---

## E. AUTORIDAD DE DECISIÓN

```
SALIDA DEL MODELO  →  ESTADO DE VALIDACIÓN  →  AUTORIDAD  →  PRESENTACIÓN
```

| estado | autoridad | qué puede hacer la interfaz |
|---|---|---|
| `VALIDATED` | **RECOMMEND** | «Alinea a X», con la evidencia al lado |
| `NOT_READY` | **INFORM** | enseñar el número, comparar, **no** recomendar |
| `REJECTED` | **DATA_ONLY** | enseñar el dato crudo, sin orden ni juicio |
| `BLOCKED` | **HIDE** | no se enseña |
| `DESIGN_ONLY` | **HIDE** | ídem |

El caso que motiva todo esto: **el modelo de QB genera proyecciones perfectamente
utilizables y la capacidad `START_SIT_QB` no está validada.** Las dos cosas a la
vez. La interfaz puede enseñar «T.Lawrence 22,6 · sus últimos seis 25,7» y **no
puede** decir «alinea a Lawrence».

Es sistémico y no está cableado por pantalla: la autoridad se deriva del estado,
el estado del registro, y el registro de los experimentos.

---

## Cambio de orden en el roadmap — 30/8/2026

El Draft Room **deja de depender de Sleeper** y adelanta su posición:

    ANTES:  Sleeper Live Browser  →  Draft Room
    AHORA:  Draft Room (manual)   →  adaptador de Sleeper

El motivo es que el orden anterior ataba un producto entero a un camino de red
sin comprobar. Con el orden nuevo hay Draft Room aunque la sincronización desde
el navegador no funcione nunca — y si funciona, automatiza exactamente los
mismos eventos.

Diseño completo en `docs/v2/DRAFT_ROOM.md`. Capacidades nuevas:
`LIVE_DRAFT_ROOM` (DESIGN_ONLY) y `BEST_PICK_FOR_ME` (BLOCKED).
