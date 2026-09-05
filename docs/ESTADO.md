# Estado del proyecto

Última actualización: 2026-09-05.

---

## Léelo antes que nada: ya se ha corrido contra datos reales

Esta base de código se escribió desde cero para reconstruir la arquitectura que
el `README.md` describe, en un entorno donde `data/raw` estaba vacío. **Eso ya
no es el estado.** El payload publicado (`web/data/model.b64.js`) trae un
backtest walk-forward sobre 3.829 partidos de 2012-2025 con desglose por
temporada: para producirlo hubo que ingerir nflverse de verdad.

Qué salió, y contra qué se compara — de los tres desenlaces que esta sección
anticipaba, el que ocurrió es **el primero**:

| | Medido aquí | Mercado (cierre) | Proyecto original |
|---|---|---|---|
| Brier | 0.2127 | 0.2119 | 0.2118 / 0.2113 |
| MAE del margen | 10.04 | 9.97 | 10.00 / 9.97 |
| Partidos | 3.829 | | 3.829 |

Dos implementaciones independientes sobre los mismos datos aterrizan en el mismo
sitio, que es la mejor señal de que ninguna tiene una fuga. Pero la diferencia
del tercer decimal **no es cosmética y va en la dirección incómoda**: la
distancia real al mercado es mayor que la que se venía publicando —0,0008 de
Brier en vez de 0,0005; 0,065 de MAE en vez de 0,03—. La tesis del proyecto no
cambia; se refuerza.

Durante meses el `README.md` y el `CLAUDE.md` siguieron publicando las cifras
del proyecto original mientras la web enseñaba las medidas, porque la web las
lee de `validation.overall` y los documentos las tenían escritas a mano.
Corregido, y con guardián: `scripts/check_headline_metrics.py`, en CI.

### Lo que sigue sin verificarse

| Afirmación | Estado |
|---|---|
| Anti-fuga temporal (pasada cronológica única) | **Verificada** (`test_features_have_no_future_information`) |
| Walk-forward sin validación cruzada aleatoria | **Verificado** (`test_walk_forward_never_trains_on_the_future`) |
| Brier / MAE del modelo de partidos | **Medido** sobre datos reales (arriba) |
| `pred_margin_free` (MAE 10.24, Brier 0.2187) | **SIN REPRODUCIR** — se calcula, pero el backtest no lo saca por separado al payload |
| Capacidades de fantasy, una por una | Ver `src/oracle/capabilities.py`: cada una lleva su experimento, su métrica y su muestra, y el test del registro no deja subir de BLOCKED sin ellos |
| Calibración del QB = 0.812 y demás constantes | **Heredadas del documento**, no reajustadas aquí |

Los 383 tests de `pytest` y los 320 de `node --test` corren sobre **datos
sintéticos** (`tests/conftest.py`): comprueban que la metodología es correcta
—que no hay fuga, que los signos son los que son, que el ensamblado no empeora a
sus componentes—, no que los números se reproduzcan. Para eso está el payload.

---

## Lo que sí está hecho

- **Paquete `oracle` completo**: ingesta, features cronológicas, Elo con HFA
  adaptativa, ratings ajustados por rival, ratings de QB, distribución discreta
  con números clave, ensamblado con cross-fitting, backtest walk-forward,
  de-vig de Shin, Kelly fraccionado, fantasy (puntuación, draft por VOR, ranking
  semanal por guion de juego).
- **CLI `oracle`** con `refresh`, `features`, `backtest`, `predict`, `bets`,
  `ratings`, y validación de entrada en todas.
- **383 tests de `pytest`** y **320 de `node --test`**, lint limpio (`ruff check src tests scripts`).
- **Web Next.js 16**: DOCE páginas estáticas, datos horneados en build time,
  cero peticiones de red en runtime, tres dependencias npm.
- **CI**: tests, lint, build de la web, cabeceras verificadas contra el servidor
  real, `npm audit` + `pip-audit`, gitleaks sobre el historial completo.
- **Workflow semanal** que regenera datos, recomprime el payload y publica.

## Lo que falta, por orden

### 1. Verificar contra datos reales
Ver arriba. Todo lo demás depende de esto.

### 2. Pendiente de la mano del dueño

Lo de importar en Vercel **ya está hecho** y llevaba semanas listado como
pendiente: el proyecto `gridiron-oracle` existe, está enlazado a
`jpadres/gridiron-oracle` y publica producción desde la rama por defecto, que en
este repo es `claude/gridiron-oracle-setup-98d7ob` — no hay `main`. Tampoco hay
un «proyecto viejo» de gridiron-oracle que borrar: sólo existe uno.

Una diferencia que sí conviene tener presente en vez de darla por hecha: vive en
el equipo **PeopleCloud**, no en una cuenta personal. Si el plan sigue siendo
moverlo, es una decisión del dueño, no una tarea pendiente de nadie más. Y los
otros dos proyectos de ese equipo (`peoplecloud-app`, `peoplecloud-conector`) no
se tocan.

Lo que sí sigue pendiente y sólo puede hacer él:

1. **Restaurar el secret `ANTHROPIC_API_KEY`** en GitHub Actions. Sin él el
   barrido diario de prensa no puede correrse solo — y desde el arreglo de
   `--require-key` sale ROJO en vez de fingir que barrió.
2. **Rotar** las dos credenciales que se filtraron en una sesión anterior.
   Rotar, no borrar: siguen vivas en el historial.

### 3. Roadmap — los tres que más valen

- **Líneas de apertura** (M2). El backtest mide contra el **cierre**, que nadie
  apuesta. Ahí está el edge real, no en más features. Es, con diferencia, el
  cambio de mayor valor esperado del roadmap entero.
- **La escala del novato contra la del veterano** (M5). Los novatos **ya están
  en el board** desde septiembre, con la previa por capital de draft
  (`ROOKIE_PRIOR`, Spearman 0,604 walk-forward). Lo que queda es que las dos
  escalas no son comparables —medido: +107,6 puntos a favor del novato a igual
  proyección— y arreglarlo pasa por el lado del VETERANO, cuya proyección supone
  15,5 partidos para todo el mundo.
- **Line shopping** (M2). Buena parte del edge no está en el modelo, está en
  apostar el mismo número donde mejor lo pagan.

### 4. Deuda conocida de esta implementación

- ~~`data/ingest.py` no se ha ejecutado nunca contra nflverse real.~~ Ya se ha
  ejecutado: el payload lo demuestra. Queda como recordatorio de que `data/raw`
  y `data/processed` **no se versionan** (~490 MB), así que tras clonar hay que
  correr `oracle refresh && oracle features` antes de tocar el modelo.
- Las curvas de edad de `fantasy/draft.py` son valores de la literatura, no
  ajustados sobre estos datos.
- El ranking semanal usa `pass_epa` del equipo como aproximación del EPA por
  dropback del QB. Es la señal disponible sin datos de seguimiento, pero
  contamina la eficiencia del QB con la de sus receptores — y es parte de por
  qué la calibración del QB necesita un multiplicador.
- ~~No hay datos de edad conectados y la corrección por curva de edad está
  inactiva.~~ Ya está cableada: `fantasy/ages.py` construye la serie y
  `scripts/fantasy_build.py` la pasa a `project_season(ages=...)`. La medición
  por valor capturado está en `docs/PREREGISTRO_edad.md`.
