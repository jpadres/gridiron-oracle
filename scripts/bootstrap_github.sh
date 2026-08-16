#!/usr/bin/env bash
#
# Sube el repo a GitHub y crea los issues del roadmap.
#
# Uso:
#   ./scripts/bootstrap_github.sh jpadres/gridiron-oracle --public
#   ./scripts/bootstrap_github.sh jpadres/gridiron-oracle --private --no-issues
#
# Requiere `gh` autenticado (`gh auth login`). El script es idempotente: si el
# repo o los issues ya existen, los salta en vez de fallar.

set -euo pipefail

REPO="${1:-}"
VISIBILITY="--public"
CREATE_ISSUES=1

if [[ -z "$REPO" ]]; then
  echo "Uso: $0 <owner/repo> [--public|--private] [--no-issues]" >&2
  exit 1
fi
shift

for arg in "$@"; do
  case "$arg" in
    --public|--private) VISIBILITY="$arg" ;;
    --no-issues) CREATE_ISSUES=0 ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 1 ;;
  esac
done

command -v gh >/dev/null || { echo "Falta el CLI 'gh'." >&2; exit 1; }

cd "$(dirname "$0")/.."

# Comprobación previa: los datos NO deben subirse. Son ~490 MB y están en
# .gitignore, pero si alguien los añadió a mano el push tardaría media hora y
# GitHub lo rechazaría por tamaño de fichero.
if git ls-files --error-unmatch data/raw >/dev/null 2>&1; then
  echo "ERROR: data/raw está versionado. Sácalo del índice antes de subir." >&2
  exit 1
fi

if [[ ! -d .git ]]; then
  git init -b main
fi

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Creando $REPO ($VISIBILITY)..."
  gh repo create "$REPO" "$VISIBILITY" --source=. --remote=origin --push
else
  echo "El repo $REPO ya existe."
  git remote get-url origin >/dev/null 2>&1 || \
    git remote add origin "https://github.com/$REPO.git"
  git push -u origin HEAD
fi

if [[ "$CREATE_ISSUES" -eq 0 ]]; then
  exit 0
fi

echo "Creando los issues del roadmap..."

# Los tres primeros son los que más valen. El resto están ordenados por
# milestone, no por valor esperado.
create_issue() {
  local title="$1" body="$2" labels="$3"
  if gh issue list --repo "$REPO" --state all --search "\"$title\" in:title" \
       --json title --jq '.[].title' | grep -Fxq "$title"; then
    echo "  (ya existe) $title"
    return
  fi
  gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels" \
    >/dev/null && echo "  creado: $title"
}

gh label create "roadmap" --repo "$REPO" --color "0E8A16" 2>/dev/null || true
gh label create "validación" --repo "$REPO" --color "1D76DB" 2>/dev/null || true
gh label create "fantasy" --repo "$REPO" --color "5319E7" 2>/dev/null || true

create_issue "M0: verificar el backtest contra datos reales" \
"El código actual es una reconstrucción y **no se ha ejecutado nunca contra nflverse**.
Ver \`docs/ESTADO.md\`.

\`\`\`
oracle refresh && oracle features
oracle backtest --from 2012 --json out/backtest.json
\`\`\`

Umbral de aceptación, fijado antes de mirar: Brier dentro de ±0.005 del mercado y
MAE dentro de ±0.3. Si sale claramente mejor que el mercado, la hipótesis por
defecto es fuga de información, no mejora." \
"roadmap,validación"

create_issue "M2: líneas de apertura" \
"El backtest se valida contra la línea de **cierre**, que nadie apuesta. El edge
real está contra la apertura, contra libros lentos y con noticias que el mercado
aún no ha digerido.

Es el cambio de mayor valor esperado del roadmap entero — más que cualquier
feature nueva." \
"roadmap"

create_issue "M2: line shopping entre casas" \
"Buena parte del edge no está en el modelo: está en apostar el mismo número donde
mejor lo pagan. Requiere líneas de varias casas, no sólo el consenso de nfldata." \
"roadmap"

create_issue "M5: rookies en el board de fantasy" \
"Hoy no aparecen: sin partidos NFL no hay historial que proyectar. El capital de
draft (ronda y puesto) es el mejor predictor público que existe para ellos." \
"roadmap,fantasy"

create_issue "Conectar la edad de los jugadores a la curva de edad" \
"\`project_season(ages=...)\` acepta la serie de edades, pero ningún script la
construye. Sin eso la corrección por curva de edad está inactiva, incluido el
acantilado del running back a partir de los 28." \
"fantasy"

create_issue "Recalibrar las constantes sobre datos reales" \
"Las tasas de aprendizaje, los alpha de ridge y los multiplicadores de fantasy son
valores razonables pero no están ajustados sobre nflverse. Recalibrar tras M0, con
el umbral fijado antes de medir." \
"validación"

echo
echo "Listo. Siguiente paso manual: importar en Vercel con Root Directory: web"
