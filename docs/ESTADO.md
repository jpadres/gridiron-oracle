# Estado del proyecto

Última actualización: 2026-08-16.

---

## Léelo antes que nada: esta base de código es un andamiaje nuevo

El `README.md` y el `CLAUDE.md` de este repo describen un proyecto ya validado,
con cifras concretas: Brier 0.2118 frente al 0.2113 del mercado, MAE 10.00 frente
a 9.97, en 3.829 partidos fuera de muestra; Spearman de 0.272 a 0.513 en el
ranking semanal de fantasy.

**Este código no ha producido esas cifras.** Se escribió desde cero para
reconstruir la arquitectura que esos documentos describen, en un entorno donde
`data/raw` estaba vacío y nflverse no se llegó a descargar. Las cifras del README
provienen del proyecto original del autor y **están sin verificar contra esta
implementación**.

Aplicando la regla 3 del proyecto —reportar también lo que sale mal, y fijar el
umbral antes de ver el resultado— el estado real es:

| Afirmación | Estado en este repo |
|---|---|
| Arquitectura y garantías metodológicas | **Implementadas y cubiertas por tests** |
| Anti-fuga temporal (pasada cronológica única) | **Verificada** (`test_features_have_no_future_information`) |
| Walk-forward sin validación cruzada aleatoria | **Verificado** (`test_walk_forward_never_trains_on_the_future`) |
| Cross-fitting temporal del ensamblado | **Implementado y cubierto** |
| Dirección de Shin, frenos de Kelly, signo defensivo | **Fijados por tests** |
| Brier 0.2118 / MAE 10.00 sobre datos reales | **SIN VERIFICAR** — requiere `oracle refresh` |
| Métricas de fantasy (draft y semanal) | **SIN VERIFICAR** — mismo motivo |
| Calibración del QB = 0.812 y demás constantes | **Heredadas del documento**, no reajustadas aquí |

Los 76 tests pasan, pero corren sobre **datos sintéticos** (`tests/conftest.py`),
no sobre nflverse. Comprueban que la metodología es correcta —que no hay fuga,
que los signos son los que son, que el ensamblado no empeora a sus componentes—.
No comprueban, y no pueden comprobar, que los números publicados se reproduzcan.

### Qué hacer para cerrar esa brecha

```bash
pip install -e ".[dev]"
oracle refresh                    # ~480 MB, 3-4 min
oracle features                   # ~1 min
oracle backtest --from 2012 --json out/backtest.json
```

Y entonces comparar con lo que dice el README. Los tres desenlaces posibles, y
qué significa cada uno:

1. **Sale parecido** (Brier ~0.212, MAE ~10.0). La implementación reproduce el
   original. Se borra el aviso del README y esta sección.
2. **Sale peor.** Es lo más probable: las constantes de este código son
   razonables pero no están reajustadas sobre datos reales. Hay que recalibrar
   (`fantasy_weekly_calibrate.py` para fantasy; los `alpha` de ridge y las tasas
   de aprendizaje para el modelo de partidos) y volver a medir.
3. **Sale claramente mejor que el mercado.** La hipótesis por defecto **no** es
   que haya mejorado: es que hay fuga de información. Búscala antes de celebrar.

---

## Lo que sí está hecho

- **Paquete `oracle` completo**: ingesta, features cronológicas, Elo con HFA
  adaptativa, ratings ajustados por rival, ratings de QB, distribución discreta
  con números clave, ensamblado con cross-fitting, backtest walk-forward,
  de-vig de Shin, Kelly fraccionado, fantasy (puntuación, draft por VOR, ranking
  semanal por guion de juego).
- **CLI `oracle`** con `refresh`, `features`, `backtest`, `predict`, `bets`,
  `ratings`, y validación de entrada en todas.
- **76 tests** (`pytest -q`) y lint limpio (`ruff check src tests scripts`).
- **Web Next.js 16**: seis páginas estáticas, datos horneados en build time,
  cero peticiones de red en runtime, tres dependencias npm.
- **CI**: tests, lint, build de la web, cabeceras verificadas contra el servidor
  real, `npm audit` + `pip-audit`, gitleaks sobre el historial completo.
- **Workflow semanal** que regenera datos, recomprime el payload y publica.

## Lo que falta, por orden

### 1. Verificar contra datos reales
Ver arriba. Todo lo demás depende de esto.

### 2. Pendiente de la mano del dueño
1. Importar el repo en Vercel con **Root Directory: `web`**.
2. Borrar el proyecto viejo del equipo PeopleCloud.
3. Revisar que el dominio de la app en vivo apunta al proyecto nuevo.

### 3. Roadmap — los tres que más valen

- **Líneas de apertura** (M2). El backtest mide contra el **cierre**, que nadie
  apuesta. Ahí está el edge real, no en más features. Es, con diferencia, el
  cambio de mayor valor esperado del roadmap entero.
- **Rookies en fantasy** (M5). Hoy no aparecen: sin partidos NFL no hay
  historial. El capital de draft es el mejor predictor público que existe para
  ellos.
- **Line shopping** (M2). Buena parte del edge no está en el modelo, está en
  apostar el mismo número donde mejor lo pagan.

### 4. Deuda conocida de esta implementación

- `data/ingest.py` no se ha ejecutado nunca contra nflverse real. Los nombres de
  columna del play-by-play y de `player_stats` están tomados del esquema
  documentado; es probable que alguno haya cambiado y haya que ajustarlo en la
  primera ejecución.
- Las curvas de edad de `fantasy/draft.py` son valores de la literatura, no
  ajustados sobre estos datos.
- El ranking semanal usa `pass_epa` del equipo como aproximación del EPA por
  dropback del QB. Es la señal disponible sin datos de seguimiento, pero
  contamina la eficiencia del QB con la de sus receptores — y es parte de por
  qué la calibración del QB necesita un multiplicador.
- No hay datos de edad de jugadores conectados (`project_season(ages=...)` acepta
  la serie, pero ningún script la construye todavía). Sin eso, la corrección por
  curva de edad está inactiva.
