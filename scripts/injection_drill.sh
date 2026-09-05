#!/bin/bash
# SIMULACRO DE INYECCIÓN: nueve fallos conocidos, nueve guardianes que TIENEN
# que ponerse rojos. Se corre en local con el árbol limpio —modifica ficheros y
# los restaura—, y cada línea dice dos cosas: si el guardián se puso ROJO con
# el fallo puesto, y si volvió a VERDE al quitarlo. «VERDE (NO ES GUARDIÁN)»
# es el resultado que importa: significa que algo que creíamos vigilado no lo
# está. Así salió el 2026-09-05 la cuarta copia del Brier de portada.
#
#     Todo guardián nuevo se prueba INYECTANDO el fallo que existe para cazar.
#
cd "$(dirname "$0")/.." || exit 1
BAK=$(mktemp)
run() { # nombre | fichero | sed-expr | comando guardián
  local nombre="$1" f="$2" expr="$3" cmd="$4"
  cp "$f" $BAK
  python - "$f" "$expr" <<'PY'
import sys; p,expr=sys.argv[1],sys.argv[2]; old,new=expr.split("|||"); s=open(p).read()
assert old in s, f"no encuentro la línea a inyectar en {p}: {old[:60]}"
open(p,"w").write(s.replace(old,new,1))
PY
  if bash -c "$cmd" >/dev/null 2>&1; then res="VERDE (NO ES GUARDIÁN)"; else res="ROJO"; fi
  cp $BAK "$f"
  if bash -c "$cmd" >/dev/null 2>&1; then back="verde tras restaurar"; else back="SIGUE ROJO TRAS RESTAURAR"; fi
  printf "%-42s %-24s %s\n" "$nombre" "$res" "$back"
}
run "1 mentira de frescura (mtime -> hoy)" scripts/export_web_data.py \
  "cuando = dt.datetime.fromtimestamp(info.st_mtime, dt.timezone.utc)|||cuando = dt.datetime.now(dt.timezone.utc)" \
  "python -m pytest -q tests/test_data_dates.py"
run "2 OUT drafteable en /fantasy" web/app/fantasy/DraftMode.jsx \
  "const { available, unavailable, untaken } = useMemo(
    () => splitAvailable(activeBoard, state.byPlayer),|||const available = useMemo(
    () => activeBoard.filter((row) => !state.byPlayer.has(row.player_id)),
    [activeBoard, state]
  );
  const { unavailable, untaken } = useMemo(
    () => splitAvailable(activeBoard, state.byPlayer)," \
  "cd web && node --test tests/availablePool.test.mjs"
run "3 cupo de plantilla filtrando a quien mejora" web/app/fantasy/candidates.js \
  "let mejoran = rows.filter((row) => MEJORA(byId.get(row.player_id)));|||let mejoran = rows.filter((row) => MEJORA(byId.get(row.player_id)) && puedeJugar(row));" \
  "cd web && node --test tests/bestForMe.test.mjs"
run "4 fecha de descarga como publicación" web/app/research/dates.js \
  'word: "seen"|||word: "published"' \
  "cd web && node --test tests/researchDate.test.mjs"
run "5 Brier de portada a mano" README.md \
  "0.2127|||0.2118" \
  "python scripts/check_headline_metrics.py"
run "6 cuota americana negativa mal convertida" web/app/betting/bankroll.js \
  "return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);|||return 1 + Math.abs(n) / 100;" \
  "cd web && node --test tests/bankroll.test.mjs"
run "7 LIVE falso (sin evidencia)" web/app/fantasy/draftSync.js \
  '  const age = now - lastSyncAt;|||  return "LIVE"; const age = now - lastSyncAt;' \
  "cd web && node --test tests/draftSync.test.mjs"
run "8 ranking K1..K12 sin registro que lo respalde" web/app/fantasy/semanal/WeeklyExplorer.jsx \
  'kickerRankStatus === "REJECTED"|||false' \
  "cd web && node --test tests/capabilities.test.mjs"
run "9 liquidación paga stake x decimal" web/app/betting/bankroll.js \
  "return decimal === null ? 0 : bet.stake * (decimal - 1);|||return decimal === null ? 0 : bet.stake * decimal;" \
  "cd web && node --test tests/bankroll.test.mjs"
