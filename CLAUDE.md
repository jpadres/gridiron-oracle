# Gridiron Oracle — contexto para Claude Code

Modelo de pronóstico NFL + rankings de fantasy football. **Un solo usuario** (el
dueño del repo). Sin cuentas, sin base de datos, sin backend.

**App en vivo:** https://gridiron-oracle-five.vercel.app

---

## Lo primero que hay que entender

**El modelo iguala a la línea de cierre del mercado; no la bate.** Brier 0.2118
frente a 0.2113, MAE 10.00 frente a 9.97, en 3.829 partidos fuera de muestra.

Ese resultado es correcto y está bien medido. La línea de cierre de la NFL agrega
el dinero de todos los modelos privados que existen. Si en algún momento un
cambio hace que el modelo *aparente* batirla con holgura, la hipótesis por
defecto no es "mejoró": es **fuga de información**. Búscala antes de celebrar.

Ese escepticismo ya pagó una vez. Durante el desarrollo el ensamblado ajustaba
sus pesos con predicciones dentro de muestra — la fuga de stacking clásica.
Parecía bien y costaba 0,6 puntos de MAE; el modelo combinado era *peor* que sus
componentes. Está corregido con cross-fitting temporal en
`models/predictor.py::MarketAwareModel.fit`.

---

## Reglas duras

Estas no son preferencias de estilo. Romper cualquiera invalida los resultados.

### 1. Cero información del futuro

Los features se construyen en **una única pasada cronológica**
(`data/features.py`), con una máquina de estados que sólo se actualiza *después*
de emitir la fila de ese partido. No uses `groupby().shift()` ni ventanas de
pandas: son fáciles de romper sin darte cuenta.

Hay un test que lo protege:
`tests/test_model.py::test_features_have_no_future_information`. Recalcula las
features truncando el historial y verifica que las filas anteriores al corte no
cambian. Si tocas `features.py`, ese test es la red.

### 2. Validación walk-forward, nunca cruzada aleatoria

Para predecir la temporada S sólo se usan temporadas < S. Todo: modelo,
distribución de márgenes, calibración y pesos de ensamblado. Barajar 2015 y 2023
en el mismo fold filtra futuro a través de los ratings de equipo y sobreestima el
rendimiento de forma masiva.

### 3. Reportar también lo que sale mal

El README y la web dicen abiertamente que el modelo no bate al mercado, que el
registro contra el spread no es significativo, y qué no sabe el modelo de
fantasy. Eso es una característica del proyecto, no un descuido. Si evalúas un
cambio, **fija el umbral de aceptación antes de ver el resultado** y publica el
resultado aunque sea negativo.

### 4. Nada de seguridad de adorno

El sitio no tiene endpoints, formularios, cookies, sesiones, base de datos ni
peticiones de red en runtime. No añadas auth, rate limiting, sanitización de
entrada de usuario ni RLS: no hay usuarios ni datos que proteger. Lo que sí se
mantiene está en la sección de Seguridad del README y verificado en CI.

---

## Arquitectura

```
src/oracle/
  data/ingest.py         descarga nflverse -> parquet equipo-partido
  data/features.py       PASADA CRONOLÓGICA ÚNICA (garantía anti-fuga)
  data/stadiums.py       coordenadas, husos horarios, altitud
  models/elo.py          Elo con margen, HFA adaptativa
  models/ratings.py      eficiencia ajustada por rival + ratings de QB
  models/distribution.py distribución discreta con números clave (3 y 7)
  models/predictor.py    ensamblado con cross-fitting temporal
  backtest/              walk-forward y métricas
  betting/               de-vig (Shin), EV, Kelly fraccionado
  fantasy/               puntuación, proyecciones de draft, ranking semanal
  pipeline.py            Oracle.train() -> predict() -> value_bets()
  cli.py                 comando `oracle`
web/                     Next.js 16, 6 páginas estáticas, datos horneados
scripts/                 generación de artefactos y utilidades
```

**El flujo de datos de la web:** los scripts de Python generan
`web/data/model.json`, que se comprime a `web/data/model.b64.js` (gzip+base64,
~24 KB). `web/data/model.js` lo descomprime en el servidor **en build time**. Por
eso las 6 páginas son estáticas y el sitio no hace ni una petición de red.

Si regeneras los datos, **hay que recomprimir**. El paso está en
`.github/workflows/weekly-predictions.yml`; cópialo de ahí si lo haces a mano.

---

## Comandos

```bash
pip install -e ".[dev]"

oracle refresh          # descarga nflverse: ~480 MB, 3-4 min
oracle features         # pasada cronológica: ~1 min
oracle backtest --from 2012      # walk-forward: ~4 min
oracle predict --season 2026 --week 1
oracle bets --season 2026 --week 1 --bankroll 1000

python scripts/fantasy_build.py                # rankings de draft: ~5 min
python scripts/fantasy_weekly_build.py --season 2026 --week 1
python scripts/fantasy_weekly_calibrate.py     # recalibra y valida: ~7 min
python scripts/export_web_data.py              # regenera el payload de la web
python scripts/make_report.py                  # informe HTML de validación

pytest -q          # 76 tests, sobre datos sintéticos (no requieren `oracle refresh`)
ruff check src tests scripts
cd web && npx next build
```

**Tras clonar el repo, `data/raw` y `data/processed` están vacíos** (van en
`.gitignore`, son ~490 MB). Hay que correr `oracle refresh && oracle features`
antes de cualquier cosa que toque el modelo. Los scripts largos conviene lanzarlos
en segundo plano y revisar el log.

---

## Errores ya cometidos — no los repitas

Cada uno de estos costó una iteración de depuración. Están corregidos; el
comentario está para que no los reintroduzcas.

| Qué pasó | Dónde | Lección |
|---|---|---|
| Pesos de ensamblado ajustados en muestra | `predictor.py` | Fuga de stacking: +0,6 MAE, combinado peor que sus partes |
| Signo invertido en el rating defensivo | `ratings.py` | `dfn` **alto** = defensa permisiva. Ataque esperado = `off[equipo] + dfn[rival]`, con **suma** |
| La media de liga absorbía la primera observación | `ratings.py` | Sin `mean_prior_n`, el residuo salía 0 y el rating nunca despegaba |
| QB proyectado 28% alto en fantasy | `fantasy/weekly.py` | Los dropbacks del equipo **no** son los intentos del QB: descuenta capturas y escapadas |
| Suplentes proyectados como titulares | `fantasy/weekly.py` | Un equipo tiene **un** titular. Sin esa restricción, cualquiera que arrancó dos partidos hereda el volumen completo |
| Cuotas calculadas con el equipo del año pasado | `fantasy/weekly.py` | El roster se aplica **antes** de calcular target share, no después |
| `AZ` vs `ARI` entre fuentes | `data/ingest.py` | nflverse no es consistente entre datasets. Todo pasa por `normalize_team` |
| Shin al revés | `betting/devig.py` | Shin da **menos** probabilidad al no favorito, no más (sesgo favorito-longshot) |

---

## Estado actual y qué sigue

**Funcionando:** modelo de partidos validado, board de draft de fantasy, ranking
semanal por posición, web desplegada, CI con tests + lint + escaneo de
dependencias + verificación de cabeceras, workflow semanal que regenera y publica.

**Pendiente de la mano del dueño** (ver `docs/ESTADO.md`):
1. Subir el repo a GitHub — `./scripts/bootstrap_github.sh jpadres/gridiron-oracle --public`
2. Importar en su Vercel personal con **Root Directory: `web`**
3. Borrar el proyecto viejo del equipo PeopleCloud

**Roadmap** (18 issues los crea el script de bootstrap). Los tres que más valen:

- **Líneas de apertura** (M2). El backtest mide contra el **cierre**, que nadie
  apuesta. Ahí es donde está el edge real, no en más features.
- **Rookies en fantasy** (M5). Hoy no aparecen: sin partidos NFL no hay historial.
  El capital de draft es el mejor predictor público que existe para ellos.
- **Line shopping** (M2). Buena parte del edge no está en el modelo, está en
  apostar el mismo número donde mejor lo pagan.

---

## Estilo

Comentarios y documentación **en español**. Nombres de código en inglés.

Los comentarios explican **por qué**, no qué. Si un número es raro (`0.812` de
calibración del QB, `DEF_STRENGTH = 0.45`), el comentario dice de dónde salió y
qué pasa si lo cambias. Esos números se ajustaron con datos y se validaron fuera
de muestra — no son a ojo, y cambiarlos sin revalidar rompe el modelo en silencio.
