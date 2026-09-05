# Qué corre en CI, y cuándo

## Por commit (`ci.yml`) — REQUERIDO

| Job | Qué |
|---|---|
| python | ruff, pytest, contraste WCAG, cifras de portada contra el payload |
| web | `next build`, idioma, identificadores huérfanos, `node --test`, simulación de draft (3 ligas), cabeceras, CSP y `fetch` acotado |
| browser | **desde 2026-09-05**: `tools/lab/ci-required.mjs` → `headshot-shots` (Draft Assistant con cuenta, fotos, marcas), `smoke` (doce páginas × tres anchos), `apuestas` (NO BET dicho con motivo, signo del handicap, plan), `movil` (geometría 390/360, claro y oscuro), `controles` (control por control con y sin cuenta) |
| dependencies | pip-audit y npm audit, con reintento y rojo si no se pudo auditar |
| secrets | gitleaks |

El runner de navegador falla por: cualquier `FALLA`, código de salida distinto
de cero, ausencia de veredicto, o **menos comprobaciones de las que ese
laboratorio ejecuta cuando la página carga** (cero `ok` es rojo, no verde).
Chromium se instala con `npx playwright install --with-deps chromium`; la ruta
la resuelve `tools/lab/browser.mjs`, no cada laboratorio.

## De madrugada (`labs-nightly.yml`) — PROFUNDO

`live-assistant` (180 picks por el adaptador), `cuenta`, `conectar`,
`storage-blocked`, `live-assistant-matrix` (reloj controlado), `replay`,
`roster-isolation`. Además `draft-torture.yml` (780 drafts sin navegador) sigue
en su propio horario y en cada push que toque el motor de decisión.

## Sólo en local

`draft-quality` (E23: necesita `data/processed`), `headshot-shots` con
capturas, y el simulacro `scripts/injection_drill.sh` (modifica ficheros).

## Presupuesto

Medido el 2026-09-05 en el contenedor de desarrollo (ver
`docs/evidence/ci_browser_budget.md` cuando exista la medición en CI): el
runner requerido son cinco laboratorios sobre un `next start` ya construido.
Si el job de navegador supera los 25 minutos, se mueve `controles` al
nocturno antes que relajar ninguna comprobación.
