#!/bin/bash
# SIMULACRO DE INYECCIÓN: 41 fallos conocidos, 41 guardianes que TIENEN
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
run "10 playoffs colándose (fail-open al faltar la columna)" src/oracle/fantasy/scoring.py \
  '    if "season_type" not in player_weeks.columns:
        raise SeasonStageUnknown(|||    if "season_type" not in player_weeks.columns:
        return player_weeks  # INYECCIÓN
        raise SeasonStageUnknown(' \
  "python -m pytest -q tests/test_regular_season.py"
run "11 NO BET en el borde exacto del mínimo" src/oracle/betting/kelly.py \
  "    if edge < config.min_edge:|||    if edge <= config.min_edge:" \
  "python -m pytest -q tests/test_no_bet_decision.py"
run "12 una fecha ilegible se convierte en HOY" src/oracle/narrative/research.py \
  '        except (ValueError, OverflowError, TypeError):
            return None|||        except (ValueError, OverflowError, TypeError):
            return (now or datetime.now(timezone.utc)).isoformat()  # INYECCIÓN' \
  "python -m pytest -q tests/test_publication_date.py"
run "13 colisión de jugador resuelta al primero" src/oracle/narrative/matching.py \
  "    if _is_abbreviated(name):
        return candidates[0][1] if len(candidates) == 1 else None|||    if _is_abbreviated(name):
        return candidates[0][1]" \
  "python -m pytest -q tests/test_claims_identity.py tests/test_identity_redteam.py"
run "14 el runner de CI con CERO comprobaciones" web/tools/lab/smoke.mjs \
  'const PAGINAS = [|||const PAGINAS = [] || [' \
  "cd web && SKIP_BUILD=1 LABS=smoke.mjs node tools/lab/ci-required.mjs"
run "15 fantasy_build carga los playoffs (sin regular_season al leer)" scripts/fantasy_build.py \
  "    players = regular_season(pd.read_parquet(paths.player_weeks))|||    players = pd.read_parquet(paths.player_weeks)" \
  "python -m pytest -q tests/test_regular_season.py"
run "16 ids del barrido emparejados por posición" src/oracle/narrative/claims.py \
  "    ids = sweep_ids if len(sweep_ids) == len(players) else []|||    ids = sweep_ids" \
  "python -m pytest -q tests/test_claims_identity.py"
run "17 una fecha sin día toma el día de HOY" src/oracle/narrative/research.py \
  "        if (first.year, first.month, first.day) != (second.year, second.month, second.day):
            return None|||        pass" \
  "python -m pytest -q tests/test_publication_date.py"
run "18 un cortado contando como que tiene equipo" src/oracle/fantasy/roster_status.py \
  "NO_TEAM = frozenset({NOT_ON_ROSTER})|||NO_TEAM = frozenset()" \
  "python -m pytest -q tests/test_roster_status.py"
run "19 una situación de plantilla desconocida pasa por ACTIVA" src/oracle/fantasy/roster_status.py \
  "    desconocidos = sorted(set(frame[\"status\"].dropna().unique()) - set(FROM_NFLVERSE))|||    desconocidos = []" \
  "python -m pytest -q tests/test_roster_status.py"
run "20 el conteo de tier cuenta a quien no tiene equipo NFL" web/app/fantasy/availablePool.js \
  "  return (rows ?? []).filter((row) => row?.rostered !== false);|||  return rows ?? [];" \
  "cd web && node --test tests/rosterMark.test.mjs"
run "21 LAR y LA como equipos distintos" src/oracle/fantasy/roster_status.py \
  "            team=normalize_team(str(row[\"team\"])) if row.get(\"team\") else None,|||            team=str(row[\"team\"]) if row.get(\"team\") else None," \
  "python -m pytest -q tests/test_roster_status.py"
run "22 un artefacto de feeds VACÍO se publica igual" src/oracle/narrative/feed_fetch.py \
  "    return collected.sources_ok > 0 and len(collected.entries) > 0|||    return True" \
  "python -m pytest -q tests/test_feed_fetch.py"
run "24 los especialistas sin comprobar su plantilla" scripts/fantasy_build.py \
  "        roster_status.attach(kickers, entries)|||        pass  # INYECCIÓN" \
  "python -m pytest -q tests/test_roster_status.py"
run "25 el mismo hecho dicho dos veces en la fila" web/app/fantasy/rosterMark.js \
  "  if (dicenLoMismo(row)) return null;|||  if (false) return null;" \
  "cd web && node --test tests/rosterMark.test.mjs"
run "26 sin equipo, invisible en la tabla principal" web/app/fantasy/rosterMark.js \
  "  NOT_ON_ROSTER: { text: \"NO NFL TEAM\", tone: \"out\" },|||" \
  "cd web && node --test tests/rosterMark.test.mjs"
run "23 la hora de descarga como fecha de publicación del origen" scripts/source_date_repair.py \
  "    published = commit_date(url, clone_dir)
    if published is None:|||    published = commit_date(url, clone_dir)
    if False:" \
  "python -m pytest -q tests/test_source_date_repair.py"

# ── El motor con contexto de plantilla (§140-149 del encargo del 6-sep) ─────
# Diez fallos que ya se han pedido por escrito y diez guardianes rápidos que
# TIENEN que ponerse rojos. Van aquí y no sólo en la tortura de madrugada
# porque el draft es mañana y lo que sólo se comprueba de noche no protege una
# tarde.
run "27 QB2 encabeza en 1QB con titulares abiertos" web/app/fantasy/rosterFit.js \
  "      : tuvoDedicado ? POSITION_STATE.STARTER_FILLED|||      : tuvoDedicado ? POSITION_STATE.OPEN_STARTER" \
  "cd web && node --test tests/engineRegressions.test.mjs"
run "28 el FLEX deja de admitir a quien admite" web/app/fantasy/rosterFit.js \
  "    const flexAbierto = open.some((s) => !s.dedicated && s.eligible.includes(pos));|||    const flexAbierto = false;" \
  "cd web && node --test tests/engineRegressions.test.mjs"
run "29 la saturación de 1QB aplicada a la superflex" web/app/fantasy/rosterFit.js \
  "    byPosition[pos] = dedicadoAbierto ? POSITION_STATE.OPEN_STARTER|||    if (pos === \"QB\" && (roster ?? []).some((r) => r.position === \"QB\")) { byPosition[pos] = POSITION_STATE.STARTER_FILLED; continue; }
    byPosition[pos] = dedicadoAbierto ? POSITION_STATE.OPEN_STARTER" \
  "cd web && node --test tests/engineRegressions.test.mjs"
run "30 el cupo escondiendo una mejora de +93" web/app/fantasy/candidates.js \
  "  let mejoran = rows.filter((row) => MEJORA(byId.get(row.player_id)));|||  let mejoran = rows.filter((row) => MEJORA(byId.get(row.player_id)) && puedeJugar(row));" \
  "cd web && node --test tests/engineRegressions.test.mjs"
run "31 el filtro de la interfaz acotando el motor" web/app/fantasy/DraftMode.jsx \
  "    () => bestForMe(poolParaElMotor, {|||    () => bestForMe(suggestions, {" \
  "cd web && node --test tests/candidates.test.mjs"
run "37 el motor sin pateadores ni defensas en su pool" web/app/fantasy/DraftRoom.jsx \
  "    () => available.concat(availableSpecialists),|||    () => available," \
  "cd web && node --test tests/candidates.test.mjs"
run "32 una marca de prensa moviendo el VOR" src/oracle/narrative/status.py \
  "        row[\"status_severity\"] = entry.severity|||        row[\"status_severity\"] = entry.severity
        row[\"vor\"] = float(row.get(\"vor\") or 0.0) - 20.0  # INYECCIÓN" \
  "python -m pytest -q tests/test_status.py"
run "33 el aviso de plantilla escondido del candidato" web/app/fantasy/rosterMark.js \
  "  if (yaDiceSinEquipo && row?.roster_state === \"NOT_ON_ROSTER\" && row?.rostered === false) {|||  if (yaDiceSinEquipo && row?.roster_state === \"NOT_ON_ROSTER\") {" \
  "cd web && node --test tests/rosterMark.test.mjs"
run "34 los huecos de K/DST sin llenar al final" web/app/fantasy/candidates.js \
  "  if (urgeEspecialista(state, picksLeftForMe)) {|||  if (false) {" \
  "cd web && node --test tests/engineRegressions.test.mjs"
run "35 la previa del novato leída como «sin muestra»" web/app/fantasy/candidates.js \
  "          || row.rookie || !hasNumber(row.weighted_games ?? row.wg)|||          || !hasNumber(row.weighted_games ?? row.wg)" \
  "cd web && node --test tests/engineRegressions.test.mjs"
run "36 una defensa afirmada como «sin equipo NFL»" src/oracle/fantasy/roster_status.py \
  "        if str(row.get(\"position\") or \"\").upper() in TEAM_UNIT_POSITIONS:|||        if False:" \
  "python -m pytest -q tests/test_roster_status.py"
run "38 el parche de fechas borrando la del research" scripts/data_dates_patch.py \
  "    payload[\"data_dates\"] = {**antes, **fechas}|||    payload[\"data_dates\"] = fechas" \
  "python -m pytest -q tests/test_data_dates.py"
run "39 una mención de prensa pisando al parte médico" web/data/model.js \
  "  return briefs;
}

function firstSentence|||  for (const [id, items] of Object.entries(research?.press?.by_player ?? {})) {
    const last = items?.[0];
    if (last?.title && last?.published_at) briefs[id] = last.title;
  }
  return briefs;
}

function firstSentence" \
  "cd web && node --test tests/press.test.mjs"
run "40 un tocayo universitario colgado del jugador del board" src/oracle/narrative/press.py \
  "            if not _corrobora(entrada, equipo, texto):|||            if False:" \
  "python -m pytest -q tests/test_press.py"
run "41 dos nombres iguales emparejados con el primero" src/oracle/narrative/press.py \
  "    return {k: v[0] for k, v in vistos.items() if len(v) == 1}|||    return {k: v[0] for k, v in vistos.items()}" \
  "python -m pytest -q tests/test_press.py"
