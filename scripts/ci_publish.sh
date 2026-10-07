#!/bin/bash
# PUBLICAR UN ARTEFACTO DESDE UN WORKFLOW, SIN PERDER EL TRABAJO.
#
#     DOS WORKFLOWS QUE EMPUJAN A LA MISMA RAMA SE PISAN.
#
# Esta rama la escriben CINCO workflows: el semanal que regenera el payload, el
# refresco diario de la jornada, el barrido de feeds (cada 6 h), el ADP (2×día)
# y el research diario. Sin rebase, el que llegue segundo ve su push RECHAZADO
# con el trabajo ya hecho y commiteado — y el job muere sin publicar.
#
# Medido el 7 de octubre de 2026: `weekly-predictions.yml` había fallado sus
# CUATRO ejecuciones programadas (9, 16, 23 y 30 de septiembre), todas en el
# push y ninguna calculando. El payload de producción llevaba ocho días
# congelado en la jornada 4 estando en la 5, y no porque la ingesta se hubiera
# detenido: porque **nunca llegó a publicar sola**. Los únicos refrescos reales
# fueron a mano.
#
# `adp.yml`, `research-feeds.yml` y `weekly-refresh.yml` ya tenían el bucle
# correcto — COPIADO TRES VECES— y los dos que no lo tenían son justo los dos
# que fallaban. Tres copias de una regla son tres coberturas distintas de la
# misma regla, que es el fallo que este repositorio lleva quince veces
# cometiendo. Una definición, y los cinco la llaman.
#
# Uso:  scripts/ci_publish.sh "<mensaje de commit>" <ruta> [<ruta>...]
set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "uso: $0 \"<mensaje>\" <ruta> [<ruta>...]" >&2
  exit 2
fi
mensaje="$1"; shift

: "${GITHUB_REF_NAME:?hace falta GITHUB_REF_NAME para saber a qué rama se empuja}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# `git add` ANTES de comparar: `git diff --quiet` NO VE UN FICHERO NUEVO —sólo
# compara lo que ya está en el índice o en HEAD—, y el artefacto de un barrido
# diario es nuevo por definición. Ese fallo dejó un barrido en VERDE sin
# publicar nada en su primera pasada real.
git add -- "$@"
if git diff --cached --quiet -- "$@"; then
  echo "Sin cambios en $*: no hay nada que publicar."
  exit 0
fi
git commit -m "$mensaje"

# Se reintenta sobre lo que haya llegado. El rebase es trivial mientras cada
# workflow toque sólo su propio artefacto; si alguna vez dos tocaran el mismo,
# el conflicto tiene que SALIR —no resolverse a ciegas— y por eso no hay
# `-X ours` ni `--strategy` aquí.
for intento in 1 2 3; do
  if git pull --rebase --autostash origin "$GITHUB_REF_NAME" && git push; then
    echo "Publicado: $mensaje"
    exit 0
  fi
  echo "push rechazado (intento $intento), reintentando..." >&2
  sleep $((intento * 5))
done

# NO se sale con 0. Un job que hizo el trabajo y no lo publicó tiene que
# ponerse ROJO: salir verde es exactamente cómo esto pasó cuatro semanas
# inadvertido.
echo "no se pudo publicar $* tras tres intentos" >&2
exit 1
