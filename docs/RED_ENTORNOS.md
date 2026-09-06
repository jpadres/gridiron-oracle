# Qué red hay en cada sitio — medido, no supuesto

**Medido el 2026-09-06.** «No hay internet» es una conclusión que este proyecto
ya sacó de más: el contenedor de desarrollo bloquea el CONNECT a los dominios de
prensa, y de ahí se dio por hecho que tampoco se podía refrescar nflverse. Sí se
podía. El refresco llevaba tres semanas sin correr por una suposición.

La regla que queda: **la red se prueba por destino y por entorno, y el resultado
se escribe aquí con su fecha.**

## Contenedor de desarrollo (esta sesión)

Salida por un proxy con lista blanca. Lo que contesta, comprobado a mano:

| Destino | Qué es | Resultado |
|---|---|---|
| `github.com/.../releases/download/...` | los parquet de nflverse | **200** — el refresco funciona |
| `raw.githubusercontent.com` | `games.csv` (calendario y líneas) | **200** |
| clon anónimo de un repo público | historial de `nflverse/nfldata` | **disponible** (lectura git) |
| `api.github.com` de un repo ajeno | fecha del último commit | **403** — el proxy acota la API a los repos de la sesión |
| `api.sleeper.app` | ligas, plantillas, picks | **CONNECT 403** |
| `espn.com`, `nfl.com`, `rotoballer.com`, … | prensa | **CONNECT 403**, los 101 dominios |

Consecuencias, sin adornos:

- **nflverse se puede refrescar desde aquí.** Es lo que hace que el board de
  hoy tenga las plantillas de después de los cortes.
- **Ningún feed de prensa se puede leer desde aquí.** El registro de fuentes
  sigue sin un solo feed verificado, y eso es un hecho del ENTORNO, no de los
  sitios: la ficha técnica dice `BLOCKED_FROM_DEV_ENV` y no `SITE_REFUSED`.
- **La API de Sleeper tampoco.** No importa para el producto: quien la llama es
  el NAVEGADOR del dueño, que sí tiene red. Lo que sí impide es probar la
  sincronización real desde aquí — para eso está el doble de `sleeper-double.mjs`.

## GitHub Actions

Los runners de GitHub tienen salida general. Es el entorno donde un barrido
determinista de feeds SÍ puede correr, y por eso el trabajo de ingesta vive
allí y no aquí (`.github/workflows/research-feeds.yml`).

**No se marca ninguna fuente como verificada por haberlo supuesto.** Ya pasó una
vez: `reachable_from_ci: true` se escribió tras un 200 desde la sesión de
desarrollo, que es otra red. Una fuente sólo pasa a `FEED_READ` cuando el
artefacto de un job que corrió de verdad lo demuestra.

## Navegador del dueño

Red completa. Es quien habla con `api.sleeper.app` en el modo draft, y el único
sitio donde la sincronización en vivo puede decir `LIVE`.

## Qué hacer con esto

1. Antes de decir «no se puede», probar el destino concreto desde el entorno
   concreto y anotarlo aquí.
2. Un 403 de CONNECT es política de salida, no un sitio caído.
3. Lo que necesita red de prensa se diseña para correr en CI y publicar un
   artefacto; el contenedor lo consume, no lo descarga.
