#!/bin/bash
# SIMULACRO DE INYECCIÓN: 85 fallos conocidos, 85 guardianes que TIENEN
# que ponerse rojos. Se corre en local con el árbol limpio —modifica ficheros y
# los restaura—, y cada línea dice dos cosas: si el guardián se puso ROJO con
# el fallo puesto, y si volvió a VERDE al quitarlo. «VERDE (NO ES GUARDIÁN)»
# es el resultado que importa: significa que algo que creíamos vigilado no lo
# está. Así salió el 2026-09-05 la cuarta copia del Brier de portada.
#
#     Todo guardián nuevo se prueba INYECTANDO el fallo que existe para cazar.
#
cd "$(dirname "$0")/.." || exit 1

# SIN BYTECODE EN CACHÉ. Python invalida un `.pyc` comparando (mtime, TAMAÑO)
# del fuente, y este simulacro escribe y restaura el mismo fichero en
# milisegundos. Cuando el reemplazo tiene EXACTAMENTE los mismos bytes que el
# original —«        if raras:» y «        if False:» miden 17 los dos— y las
# dos escrituras caen en el mismo segundo, el `.pyc` de la versión INYECTADA
# sigue pareciendo válido para la restaurada: el guardián vuelve a fallar y el
# informe escribe «SIGUE ROJO TRAS RESTAURAR» acusando al guardián de un fallo
# que es del simulacro. Pasó dos veces, las dos en la inyección 63, que es la
# única con reemplazo del mismo largo. No se reproduce a voluntad —hace falta
# que las dos pasadas caigan en el mismo segundo— así que en vez de perseguir
# la carrera se quita la caché entera, que es barato y no deja el modo de
# fallo abierto.
export PYTHONDONTWRITEBYTECODE=1

BAK=$(mktemp)
run() { # nombre | fichero | sed-expr | comando guardián
  local nombre="$1" f="$2" expr="$3" cmd="$4"
  cp "$f" $BAK
  # UNA INYECCIÓN QUE NO INYECTA NO ES UN GUARDIÁN VERDE: ES UN SIMULACRO ROTO.
  #
  # Cuando la línea se mueve —un refactor la lleva a otro fichero, como pasó el
  # 13 de septiembre de 2026 al compartir el candado entre los dos motores de
  # alineación—, el reemplazo no encuentra nada, no cambia nada, el guardián
  # pasa y el informe escribía «VERDE (NO ES GUARDIÁN)» acusando al guardián de
  # un fallo que era de la inyección. Las dos cosas se distinguen ahora.
  if ! python - "$f" "$expr" <<'PY'
import sys; p,expr=sys.argv[1],sys.argv[2]; old,new=expr.split("|||"); s=open(p).read()
if old not in s:
    raise SystemExit(3)
open(p,"w").write(s.replace(old,new,1))
PY
  then
    printf "%-42s %-24s %s\n" "$nombre" "INYECCIÓN ROTA" "la línea a inyectar ya no existe"
    cp $BAK "$f"
    return
  fi
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
run "42 el cambio de equipo escondido en la lista del board" web/app/fantasy/DraftRoom.jsx \
  "                      {teamChangeMark(entry.row) ? (|||                      {false ? (" \
  "cd web && node --test tests/rosterMark.test.mjs"
run "43 un OUT propuesto como titular de la semana" web/app/fantasy/startSit.js \
  "    if (flags.includes(\"OUT\")) { excluded.push({ sid, row, reason: EXCLUDED.OUT }); continue; }|||    // INYECCIÓN: el OUT vuelve al reparto" \
  "cd web && node --test tests/startSit.test.mjs"
run "44 el board de TEMPORADA otra vez bajo el índice semanal del analizador" web/app/fantasy/analisis/AnalyzerShell.jsx \
  "    () => fullWeeklyIndex({ rankings: weekly, kickers: weeklyKickers, defenses: weeklyDefenses }),|||    () => { const m = new Map(index); for (const [k, v] of fullWeeklyIndex({ rankings: weekly, kickers: weeklyKickers, defenses: weeklyDefenses })) m.set(k, v); return m; }," \
  "cd web && node --test tests/analyzerIndex.test.mjs"
run "45 la línea publicada un build por detrás" scripts/export_web_data.py \
  "    if desacuerdos:|||    if False:" \
  "python -m pytest -q tests/test_data_dates.py"
run "46 el precio del handicap vuelve al relleno -110" src/oracle/betting/value.py \
  "    if pd.notna(home_odds) and pd.notna(away_odds):|||    if False:" \
  "python -m pytest -q tests/test_betting.py"
run "47 un partido con resultado ofrecido como mercado" src/oracle/betting/value.py \
  "        if bool(final):|||        if False:" \
  "python -m pytest -q tests/test_betting.py"
run "48 el precio del mercado se cae de las features" src/oracle/data/features.py \
  "                \"home_moneyline\": game.get(\"home_moneyline\"),|||                # INYECCIÓN: la columna se queda en el camino" \
  "python -m pytest -q tests/test_data.py"
run "49 el board de draft se va a la temporada SIGUIENTE" src/oracle/fantasy/schedule.py \
  "    return SeasonPoint(int(primero[\"season\"]), int(primero[\"week\"]), True)|||    return SeasonPoint(int(primero[\"season\"]) + 1, int(primero[\"week\"]), True)" \
  "python -m pytest -q tests/test_schedule.py"
run "50 fechar el board con la temporada que NO lee" scripts/export_web_data.py \
  "    stats = _stats_que_lee_el_board(paths)|||    stats = _fecha_de(_mas_nuevo(paths.raw, \"player_stats_*.parquet\"))" \
  "python -m pytest -q tests/test_data_dates.py"
run "51 una etiqueta de plantilla nueva colada como activo" src/oracle/fantasy/roster_status.py \
  "    if desconocidos:|||    if False:" \
  "python -m pytest -q tests/test_roster_status.py"
run "52 la moneyline fuera de la pantalla de mercados" web/app/betting/BettingShell.jsx \
  "                  const sides = markets.filter((m) => m.game_id === game.game_id);|||                  const sides = markets.filter((m) => m.game_id === game.game_id && String(m.market).startsWith(\"spread\"));" \
  "cd web && node --test tests/noBet.test.mjs"
run "53 la tarjeta deja de decir que el partido acabó" web/app/sports.jsx \
  "  const isFinal = game.final === true && finalScoreHome !== null && finalScoreAway !== null;|||  const isFinal = false;" \
  "cd web && node --test tests/noBet.test.mjs"
run "54 un titular que ya jugó, propuesto para el banquillo" web/app/fantasy/lineup.js \
  "    if (row && hasStarted(row, now)) congelados.set(i, sid);|||    if (false) congelados.set(i, sid);" \
  "cd web && node --test tests/startSit.test.mjs"
run "55 un suplente que ya jugó, propuesto como titular" web/app/fantasy/startSit.js \
  "    if (flags.includes(\"LOCKED\")) { excluded.push({ sid, row, reason: EXCLUDED.GAME_FINAL }); continue; }|||    // INYECCIÓN: vuelve al reparto" \
  "cd web && node --test tests/startSit.test.mjs"
run "56 la marca del partido jugado, fuera de la tabla principal" web/app/ui.jsx \
  "                      {gameFinalMark(row) ? (|||                      {false ? (" \
  "cd web && node --test tests/rosterMark.test.mjs"
run "57 el estado del partido tomado de OTRA jornada" scripts/export_web_data.py \
  "    games = games[(games[\"season\"] == season) & (games[\"week\"] == week)]|||    pass  # INYECCIÓN" \
  "python -m pytest -q tests/test_data_dates.py"
run "58 el analizador no dice qué tiene puesto" web/app/fantasy/analisis/AnalyzerShell.jsx \
  "      starters: misTitulares,|||      // INYECCIÓN" \
  "cd web && node --test tests/lineup.test.mjs"
run "59 el OTRO motor de alineación deja de congelar" web/app/fantasy/lineup.js \
  "  const congelados = lockedSlots({ starters, slots: huecos, index, now });|||  const congelados = new Map();" \
  "cd web && node --test tests/lineup.test.mjs"
run "60 la pantalla de apuestas sin reloj" web/app/betting/BettingShell.jsx \
  "    setNow(Date.now());|||    // INYECCIÓN: la pantalla se queda sin reloj" \
  "cd web && node --test tests/noBet.test.mjs"
run "61 un mismo predicado para apostar y para congelar" web/app/gameClock.js \
  "  return estado === GAME.FINAL || estado === GAME.IN_PROGRESS;|||  return gameState(row, now) !== GAME.SCHEDULED;" \
  "cd web && node --test tests/startSit.test.mjs tests/gameClock.test.mjs"
run "62 un comentario JSX que se traga la prosa de debajo" web/tools/ui-numbers.mjs \
  "    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, \" \")|||    .replace(/\\{\\/\\*[\\s\\S]*?\\*\\/\\}/g, \" \")" \
  "cd web && node --test tests/uiNumbers.test.mjs"
run "63 una designación de lesión nueva colada como «juega»" src/oracle/fantasy/injuries.py \
  "        if raras:|||        if False:" \
  "python -m pytest -q tests/test_injuries.py"
run "64 un DOUBTFUL tratado como descartado" src/oracle/fantasy/injuries.py \
  "        return self.designation == OUT|||        return self.designation in (OUT, DOUBTFUL)" \
  "python -m pytest -q tests/test_injuries.py"
run "65 el parte tocando un número del board" src/oracle/fantasy/injuries.py \
  "        row[\"injury_designation\"] = entrada.designation|||        row[\"injury_designation\"] = entrada.designation
        row[\"projected_points\"] = 0.0" \
  "python -m pytest -q tests/test_injuries.py"
run "66 la ventana de decisión calculada al revés" web/app/fantasy/lateRisk.js \
  "      .filter((b) => b.kickoff !== null && b.kickoff < suyo)|||      .filter((b) => b.kickoff !== null && b.kickoff > suyo)" \
  "cd web && node --test tests/lateRisk.test.mjs"
run "67 el plazo en el MEJOR recambio y no en el primero" web/app/fantasy/lateRisk.js \
  "    const cierre = Math.min(...recambios.map((r) => r.kickoff));|||    const cierre = recambios[0].kickoff;" \
  "cd web && node --test tests/lateRisk.test.mjs"
run "68 un token de CSS que no existe" web/app/system.css \
  "  --flag-ink: #a33b3b;|||  --flag-ink-RENOMBRADO: #a33b3b;" \
  "cd web && node --test tests/css.test.mjs"
run "69 los props ofreciendo un partido terminado" web/app/betting/BettingShell.jsx \
  "    const abiertos = delPuesto.filter((r) => isOpen(r, now));|||    const abiertos = delPuesto;" \
  "cd web && node --test tests/noBet.test.mjs"
run "70 un plan de recuperación tras perder" web/app/betting/period.js \
  "  const hueco = min - banca;|||  const hueco = min - banca + Number(arguments[0].lastPeriodLoss || 0);" \
  "cd web && node --test tests/period.test.mjs"
run "71 el ingreso contado como rendimiento del libro" web/app/betting/period.js \
  "  const resultado = liquidadas.reduce((s, b) => s + beneficio(b), 0);|||  const resultado = liquidadas.reduce((s, b) => s + beneficio(b), 0) + depositado;" \
  "cd web && node --test tests/period.test.mjs tests/bankroll.test.mjs"
run "72 la caída máxima tapada por un ingreso" web/app/betting/period.js \
  "    maxDrawdown: maxDrawdown(liquidadas, inicial),|||    maxDrawdown: maxDrawdown(liquidadas, inicial + cajaNeta),"  \
  "cd web && node --test tests/period.test.mjs"
run "73 el barrido determinista inventando el juicio" src/oracle/narrative/sweep.py \
  "            \"schema_version\": 2,|||            \"schema_version\": 2,
            \"confidence\": \"rumor\",
            \"impact\": \"neutro\"," \
  "python -m pytest -q tests/test_sweep.py"
run "74 la hora de descarga fechando la publicación" src/oracle/narrative/sweep.py \
  "            \"published_at\": publicado,|||            \"published_at\": publicado or entry.get(\"first_seen_at\")," \
  "python -m pytest -q tests/test_sweep.py"
run "75 el barrido ordenando por DÍA y no por instante" src/oracle/narrative/sweep.py \
  "        candidatas.append((bool(suyos), publicado or \"\", ficha))|||        candidatas.append((bool(suyos), dia or \"\", ficha))" \
  "python -m pytest -q tests/test_sweep.py"
run "76 un equipo atribuido con dos equipos nombrados" src/oracle/narrative/sweep.py \
  "    derivado = {u: next(iter(t)) for u, t in equipos.items() if len(t) == 1}|||    derivado = {u: sorted(t)[0] for u, t in equipos.items()}" \
  "python -m pytest -q tests/test_sweep.py"
run "77 una ficha sin juicio publicada como «rumor»" web/app/research/Briefs.jsx \
  "  const confidence = CONFIDENCE[item.confidence] ?? null;|||  const confidence = CONFIDENCE[item.confidence] ?? CONFIDENCE.rumor;" \
  "cd web && node --test tests/briefs.test.mjs"
run "78 un impacto ausente pintado como neutro" web/app/ui.jsx \
  "  if (!IMPACT[impact]) return null;|||  if (false) return null;" \
  "cd web && node --test tests/briefs.test.mjs"
run "79 una ficha en español en una interfaz en inglés" src/oracle/narrative/sweep.py \
  "        if looks_spanish(f'{ficha[\"headline\"]} {ficha[\"summary\"]}'):|||        if False:" \
  "python -m pytest -q tests/test_sweep.py"
run "80 las dos listas de español separándose" web/tools/audit-spanish.mjs \
  "(el|la|los|las|un|||(el|la|los|un|" \
  "python -m pytest -q tests/test_sweep.py"
run "81 las entidades HTML pintadas crudas" src/oracle/narrative/feeds.py \
    "    return clean_text(found.text)|||    return (found.text or \"\").strip()" \
  "python -m pytest -q tests/test_feeds.py"
run "82 el optimizador ignorando el parte oficial" web/app/fantasy/startSit.js \
  "  if (reportOut(row)) flags.push(\"OUT\");|||  if (false) flags.push(\"OUT\");" \
  "cd web && node --test tests/startSit.test.mjs"
run "83 un DOUBTFUL descartado de la alineación" web/app/fantasy/startSit.js \
  "  return String(row?.injury_designation ?? \"\") === \"OUT\";|||  return [\"OUT\", \"DOUBTFUL\"].includes(String(row?.injury_designation ?? \"\"));" \
  "cd web && node --test tests/startSit.test.mjs"
run "84 una clase nueva pisando a una que ya existía" web/app/betting/BettingShell.jsx \
  "className=\"bk-ahead\">|||className=\"bk-month\">" \
  "cd web && node --test tests/css.test.mjs"
run "85 el plan del mes ampliando la fracción tras perder" web/app/betting/period.js \
  "    const f = frenado ? brakeFactor : 1;|||    const f = frenado ? 1.15 : 1;" \
  "cd web && node --test tests/period.test.mjs"
