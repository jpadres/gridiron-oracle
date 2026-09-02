"use client";

/**
 * Draft Room: el compañero de draft, independiente de plataforma.
 *
 * ## Qué es y qué no
 *
 * No es un tablero de rankings del que van desapareciendo nombres. Es una
 * pantalla de decisión que **reacciona a cada pick**: cambia quién queda, cuánto
 * queda de cada tier, a cuántos picks estás y qué te falta de plantilla.
 *
 * Consume **eventos de pick canónicos** (`draftLog.js`). De dónde vengan es un
 * detalle del adaptador: hoy los pone el usuario a mano, y ese modo funciona en
 * Sleeper, ESPN, Yahoo, en la app que sea y en un draft presencial. Cuando la
 * sincronización automática esté comprobada, emitirá los mismos eventos y esta
 * pantalla no se entera.
 *
 * ## La regla de velocidad
 *
 *     VER JUGADOR → UN TOQUE → FUERA.
 *
 * Sin modal, sin confirmación, sin formulario. Deshacer aparece en el sitio.
 * Todo el estado es local: **ninguna petición de red entra en la ruta de un
 * pick**, así que la pantalla responde igual con la red caída.
 *
 * ## Lo que NO dice
 *
 * `BEST_PICK_FOR_ME` está BLOCKED: ordenar por «lo que le conviene a mi
 * plantilla» exige valor por liga y una regla de construcción que nadie ha
 * medido. Aquí se enseña BEST AVAILABLE —el board validado— con el contexto de
 * plantilla **al lado**, no fundido dentro. Los dos datos son útiles; mezclarlos
 * sería afirmar una tercera cosa que no está.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { num } from "../../data/model.js";
import { TeamMark, teamVars } from "../sports.jsx";
import { Headshot } from "../headshot.jsx";
import {
  ROSTER, SOURCE, fold, isMyTurn, pickLabel, providerEvents, replayState, slotForOverall,
  takeEvent, undoEvent, untilMyTurn,
} from "./draftLog.js";
import { loadOrMigrateLog, logScopeFor, saveLog } from "./draftStorage.js";
import {
  assignSlots, PRIOR_SHARE_VISIBLE, priorShare, VALIDATED_MAX_TEAMS, valueConfidence,
} from "./leagueValue.js";
import { candidates as buildCandidates } from "./candidates.js";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
// El board de VOR sólo ordena estas cuatro. K y DST son FICHABLES —existen en
// la liga y sus picks se registran— pero llegan sin proyección ni VOR: sus
// filas enseñan hechos de la temporada anterior y nada más.
const RANKED_POSITIONS = ["QB", "RB", "WR", "TE"];
const SPECIAL_POSITIONS = ["K", "DST"];

/**
 * Cuántos jugadores de un tier siguen libres.
 *
 * Es un CONTEO, no una predicción. «Quedan 2 en el tier 3 de WR» es un hecho
 * comprobable; «probablemente aguante hasta tu turno» sería una probabilidad que
 * nadie ha calibrado.
 */
/**
 * Lo que hay que saber para leer el número de un novato, en una línea.
 *
 * El valor sale de la previa por capital de draft (E9, Spearman 0,604
 * walk-forward), no de partidos NFL que no existen. Por eso viaja siempre con
 * su intervalo OBSERVADO y su muestra: la celda del quarterback de segunda
 * ronda promedia 63,4 puntos con mediana 15,9 —o juega o no juega— y enseñar
 * sólo la media describiría a casi ninguno de ellos.
 */
function rookieBrief(row) {
  if (!row?.rookie) return "";
  const round = Number(row.rookie_round);
  const capital = row.draft_pick
    ? `pick ${row.draft_pick}`
    : Number.isFinite(round) && round >= 8 ? "undrafted" : "draft capital UNKNOWN";
  const band = ["rookie_p25", "rookie_p50", "rookie_p75"].every((k) => Number.isFinite(row[k]))
    ? ` Past rookies in this cell scored ${Math.round(row.rookie_p25)}–`
      + `${Math.round(row.rookie_p50)}–${Math.round(row.rookie_p75)} points `
      + `(25th/median/75th, n=${row.rookie_sample}).`
    : "";
  const split = row.rookie_bimodal
    ? " That cell splits: most score near zero and a few carry the average."
    : "";
  return `Rookie — ${capital}. Value comes from draft capital, not NFL games.${band}${split}`
    + " No risk, absence or bust signal: those need NFL history.";
}

/**
 * El estado de un jugador en una línea, con su fecha y su fuente.
 *
 * Las dos fechas hacen cosas distintas y por eso se enseñan las dos: el estado
 * empezó el `effective_at` y se comprobó por última vez el `verified_at`. Una
 * suspensión no envejece sola —sigue en vigor hasta que la levanten— pero
 * nuestra comprobación sí, y pasada la ventana esto deja de afirmarse como
 * actual y dice «last verified». UNKNOWN > STALE PRESENTADO COMO ACTUAL.
 */
function statusBrief(row) {
  if (!row?.status_label) return "";
  const checked = row.status_freshness === "CURRENT"
    ? `Verified ${row.status_verified_at}.`
    : `LAST VERIFIED ${row.status_verified_at} — not re-checked since.`;
  const since = row.status_effective_at ? ` In effect since ${row.status_effective_at}.` : "";
  const games = Number.isFinite(row.status_games_out)
    ? ` At least ${row.status_games_out} games.` : "";
  const outlets = (row.status_sources ?? []).map((s) => s.outlet).filter(Boolean).join(", ");
  return `${row.status_label} — ${row.status_detail}${since}${games} ${checked}`
    + (outlets ? ` Source: ${outlets}.` : "")
    + " This changes no number on this row: the projection and VOR are untouched.";
}

/**
 * El aviso de que un número es sobre todo el prior de su posición.
 *
 * Devuelve `null` cuando el jugador tiene historial suficiente para que el
 * número sea suyo. No es una alarma de riesgo —eso es otra cosa, y `risk_label`
 * daba «Normal» a un corredor cuyo 97% era el ancla— sino una etiqueta sobre el
 * ORIGEN del número.
 */
function priorNote(row) {
  const share = priorShare(row);
  if (share === null || share < PRIOR_SHARE_VISIBLE) return null;
  const wg = Number(row.weighted_games ?? row.wg);
  return {
    pct: Math.round(share * 100),
    title: `${Math.round(share * 100)}% of this projection is the positional average, `
      + `not him: ${wg.toFixed(1)} weighted games of NFL history. `
      + (wg < 3
        ? "Below three he is kept off the shortlist — the number is the anchor, not a projection."
        : "Treat the number as a floor-shaped guess, not a read on his role."),
  };
}

function tierDepth(available, position) {
  const rows = available.filter((row) => row.position === position);
  if (rows.length === 0) return null;
  const tier = rows[0].tier;
  return { tier, left: rows.filter((row) => row.tier === tier).length, total: rows.length };
}

/**
 * Profundidad de cada posición. CONTEO, no consejo.
 *
 * Se llama PROFUNDIDAD y no «¿puedo esperar?» a propósito: cuántos quedan en el
 * tier de arriba es un hecho comprobable; si conviene esperar sería una regla de
 * decisión que nadie ha validado.
 */
function positionDepth(available) {
  return ["QB", "RB", "WR", "TE"]
    .map((position) => ({ position, ...(tierDepth(available, position) ?? {}) }))
    .filter((entry) => entry.total > 0);
}

/**
 * `sync` llega desde arriba y no se pide aquí. La configuración de la liga —de
 * dónde salen el tamaño, las rondas y mi puesto— y el VALOR de la liga tienen
 * que salir de la misma resolución: si esta pantalla sondeara por su cuenta,
 * habría dos respuestas a «cuántos equipos tiene» y las dos con razón. Es el
 * fallo de los dos traductores, que en este proyecto ya ha aparecido tres veces.
 */
export default function DraftRoom({ board, context, league, leagueValue = null, sync }) {
  const [events, setEvents] = useState([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  // Filtro MULTI-selección: el conjunto vacío es ALL. «RB+WR» es una pregunta
  // real de draft (¿mi flex?) y un modelo de pestaña única no puede hacerla.
  // El estado sobrevive a cada pick a propósito: re-filtrar tras cada registro
  // costaría un gesto por pick, que es exactamente el presupuesto que no hay.
  const [picked, setPicked] = useState(() => new Set());
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);

  /**
   * INGESTA AUTOMÁTICA. El adaptador sondea Sleeper en el navegador y emite
   * picks canónicos; aquí se convierten en eventos EFÍMEROS que se pliegan
   * junto a los manuales. No se persisten: la verdad del proveedor se vuelve a
   * derivar en cada sondeo, así que guardarlos duplicaría el estado — que es
   * exactamente lo que E17 prohíbe.
   *
   * `league.leagueId` sólo alimenta esto cuando la liga es de Sleeper. Una liga
   * manual no sondea nada y el modo manual sigue siendo el que funciona en
   * todas partes.
   */
  const sleeperLeague = league?.platform === "sleeper" ? String(league.leagueId ?? "") : "";

  const teams = league?.teams ?? null;
  // Sólo con el tamaño declarado. Sin tamaño no se avisa de profundidad:
  // sería inventar una configuración que el usuario no ha dado.
  const deepLeague = Boolean(teams) && valueConfidence({ teams }) === "UNVALIDATED_DEPTH";
  // ¿Los números que se pintan son de ESTA liga? Es lo que decide qué puede
  // decir el encabezado de la lista corta, y hasta ahora decía «tu liga»
  // siempre porque nadie se lo preguntaba.
  const leagueCompiled = Boolean(leagueValue?.board);
  const type = league?.draftType ?? null;
  const mySlot = league?.mySlot ?? null;
  const rounds = league?.rounds ?? null;

  const scope = useMemo(
    () => logScopeFor({
      platform: league?.platform ?? "local",
      season: context.season,
      leagueId: league?.leagueId,
      draftId: league?.draftId,
    }),
    [league, context.season]
  );

  // Se lee después de montar: en el servidor no hay `localStorage`, y pintar
  // cosas distintas en los dos sitios rompe la hidratación.
  useEffect(() => {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    // La MISMA carga que hace el board, y por eso está en `draftStorage`. Antes
    // cada pantalla decidía por su cuenta qué heredar de las marcas v2, así que
    // cada una se construía su propia versión del mismo draft.
    setEvents(loadOrMigrateLog(scope, storage));
    setReady(true);
  }, [scope]);

  useEffect(() => {
    if (!ready) return;
    saveLog(scope, events, typeof window === "undefined" ? null : window.localStorage);
  }, [scope, events, ready]);

  // K y DST fichables, aparte del board de VOR: no tienen valor calculado y no
  // se les inventa uno mezclándolos en la lista ordenada.
  const specialists = useMemo(() => {
    const s = context.specialists;
    return [...(s?.kickers ?? []), ...(s?.defenses ?? [])];
  }, [context.specialists]);
  // El POOL completo — para plantilla, feed y búsqueda. `available` (la lista
  // ordenada por VOR) sigue siendo sólo el board.
  /* NOVATOS. Existen y se pueden draftear aunque el modelo no los proyecte.
     Van en su propio cubo, como K y DST, porque comparten exactamente la misma
     propiedad: identidad resuelta, valor UNKNOWN. Mezclarlos en `available`
     —la lista ORDENADA por VOR— exigiría darles un número, y no lo tienen. */
  const rookies = useMemo(() => context.rookies ?? [], [context.rookies]);
  const pool = useMemo(
    () => board.concat(specialists, rookies), [board, specialists, rookies]
  );

  // Un solo pliegue para las dos fuentes. El orden lo resuelve `fold`, que ya
  // sabe que a igualdad de instante manda MANUAL sobre SLEEPER: una corrección
  // tuya nunca la pisa el proveedor.
  const state = useMemo(
    () => fold([...events, ...providerEvents(sync.canonical ?? [], { source: SOURCE.SLEEPER })]),
    [events, sync.canonical]
  );

  /**
   * REPLAY. `null` = en vivo; un número = «después del pick N».
   *
   * El cursor es estado del componente y NADA más: no se persiste, no toca el
   * registro, y el efecto que guarda `events` ni se entera de que existe. El
   * replay es estado derivado de sólo lectura — volver al vivo es volver a
   * derivar del mismo registro de siempre.
   */
  const [replayCursor, setReplayCursor] = useState(null);
  const replaying = replayCursor !== null;
  const replayCursorRef = useRef(null);
  replayCursorRef.current = replayCursor;
  const effective = useMemo(
    () => (replaying ? replayState(state, replayCursor) : state),
    [state, replayCursor, replaying]
  );

  // TODO lo que se pinta deriva del estado EFECTIVO: board disponible,
  // plantilla, feed, cortes de tier y profundidad. Un solo interruptor aguas
  // arriba, y ninguna vista puede mezclar el presente con el pasado.
  const available = useMemo(
    () => board.filter((row) => !effective.byPlayer.has(row.player_id)),
    [board, effective]
  );
  const availableSpecialists = useMemo(
    () => specialists.filter((row) => !effective.byPlayer.has(row.player_id)),
    [specialists, effective]
  );
  const availableRookies = useMemo(
    () => rookies.filter((row) => !effective.byPlayer.has(row.player_id)),
    [rookies, effective]
  );
  const roster = useMemo(
    () => pool.filter((row) => effective.mine.has(row.player_id)),
    [pool, effective]
  );

  const enterReplay = useCallback(() => {
    setReplayCursor(state.count);
    // Una entrada de historial: el botón Atrás del navegador sale del replay en
    // vez de sacarte de la página en mitad de un draft.
    try { window.history.pushState({ gridironReplay: true }, ""); } catch { /* SSR */ }
  }, [state.count]);
  const exitReplay = useCallback(() => {
    setReplayCursor(null);
    try {
      if (window.history.state?.gridironReplay) window.history.back();
    } catch { /* da igual */ }
  }, []);
  useEffect(() => {
    const onPop = () => setReplayCursor(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // La CONSTRUCCIÓN de la plantilla: mis jugadores repartidos en los huecos que
  // la liga declara. Derivada en cada render del registro plegado más la
  // configuración — los picks son la historia canónica y esta disposición es
  // presentación, así que corregir la configuración a mitad de draft recoloca
  // sin tocar ni un pick. Sin estructura configurada queda null y la vista dice
  // que no la hay, en vez de dibujar una alineación estándar que nadie declaró.
  const construction = useMemo(() => {
    if (!Array.isArray(league?.roster) || league.roster.length === 0) return null;
    const { slots, unassigned } = assignSlots(roster, league.roster);
    const benchSize = league.roster.filter((slot) =>
      ["BN", "BE", "BENCH"].includes(String(slot).toUpperCase())).length;
    return { slots, unassigned, benchSize };
  }, [league, roster]);

  /**
   * LA LISTA CORTA. Se recalcula desde `available`, así que si alguien ficha al
   * primer candidato mientras miras, desaparece solo: no hay estado propio que
   * pueda quedarse viejo. Ése es el requisito de «sin candidato rancio», y se
   * cumple por construcción y no por un efecto que haya que acordarse de poner.
   */
  const shortlist = useMemo(
    () => buildCandidates(available, { slots: construction?.slots ?? null, limit: 4 }),
    [available, construction]
  );

  const onClock = isMyTurn({ overall: state.count + 1, teams, type, mySlot });
  /* DÓNDE VA EL DRAFT lo dice el PROVEEDOR, no cuántos picks pudimos resolver.
     Un novato de 2026 no está en el board publicado, así que su pick entra
     UNMAPPED y no produce evento canónico. Contando sólo lo resuelto, «picks
     until me» se quedaba corto un pick por cada novato elegido — y en un draft
     de 2026 eso son varios. El tablero sigue derivando de lo resuelto; la
     POSICIÓN del draft, de lo que el proveedor dice que ya se eligió. */
  const providerPicks = sleeperLeague && sync.state === "ok" ? (sync.total ?? 0) : 0;
  const draftCount = Math.max(state.count, providerPicks);
  const next = untilMyTurn({ count: draftCount, teams, type, mySlot, rounds });

  /**
   * Registrar un pick. **Una sola interacción.**
   *
   * El roster se deriva del puesto cuando se puede y se declara cuando no. Si no
   * se puede establecer, queda `UNKNOWN`: el jugador sale del board y **no entra
   * en la plantilla de nadie**. Asignarlo mal corrompe todas las decisiones
   * siguientes, así que aquí no se adivina.
   */
  const record = useCallback((row, declared) => {
    if (replayCursorRef.current !== null) return;   // el pasado no se edita
    const derived = isMyTurn({ overall: state.count + 1, teams, type, mySlot });
    const roster = declared ?? (derived === null
      ? ROSTER.UNKNOWN
      : derived ? ROSTER.MINE : ROSTER.OPPONENT);
    setEvents((previous) => [
      ...previous,
      takeEvent({
        playerId: row.player_id,
        roster,
        rosterSource: declared ? "DECLARED" : derived === null ? "UNKNOWN" : "DERIVED",
        source: SOURCE.MANUAL,
      }),
    ]);
    setQuery("");
    setFlash({ row, roster });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 6000);
  }, [state.count, teams, type, mySlot]);

  const undo = useCallback((playerId) => {
    if (replayCursorRef.current !== null) return;   // el pasado no se edita
    setEvents((previous) => [...previous, undoEvent({ playerId, source: SOURCE.MANUAL })]);
    setFlash(null);
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const all = picked.size === 0;
  const togglePosition = useCallback((chip) => {
    setPicked((prev) => {
      if (chip === "ALL") return new Set();
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      // Marcarlo todo a mano equivale a ALL: se normaliza para que el estado
      // «sin filtro» tenga una sola representación.
      if (next.size === POSITIONS.length - 1) return new Set();
      return next;
    });
  }, []);

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    const rankedWanted = new Set(all ? RANKED_POSITIONS : RANKED_POSITIONS.filter((p) => picked.has(p)));
    const specialWanted = new Set(all ? SPECIAL_POSITIONS : SPECIAL_POSITIONS.filter((p) => picked.has(p)));
    // Los especialistas van DETRÁS de la lista de VOR: no tienen valor con el
    // que competir por un puesto en el orden. En ALL quedan fuera de la ventana
    // de 60 salvo búsqueda — con su filtro se ven enteros.
    let rows = available.filter((r) => rankedWanted.has(r.position))
      .concat(availableSpecialists.filter((r) => specialWanted.has(r.position)))
      // Los novatos, detrás de los que sí tienen valor. En ALL caen fuera de la
      // ventana de 60 y por eso la BÚSQUEDA es su vía principal: si sé a quién
      // quiero, tengo que encontrarlo, y esta noche eso es lo que importa.
      .concat(availableRookies.filter((r) => rankedWanted.has(r.position)));
    if (text.length >= 2) {
      rows = rows.filter(
        (row) =>
          (row.player_full_name ?? row.player_name).toLowerCase().includes(text) ||
          row.player_name.toLowerCase().includes(text) ||
          row.team?.toLowerCase() === text
      );
    }
    return rows.slice(0, 60);
  }, [available, availableSpecialists, availableRookies, picked, all, query]);

  const best = available[0] ?? null;
  const depth = useMemo(() => positionDepth(available), [available]);

  // El contexto del board publicado. Los valores NO son de la liga del usuario:
  // salen del board horneado, y la etiqueta lo dice en vez de dejarlo suponer.
  const boardContext = [context.scoring, context.teams ? `${context.teams}-team` : null]
    .filter(Boolean).join(" · ");
  const leagueDiffers = Boolean(teams && context.teams && teams !== context.teams);

  // Filas con separador de tier: el corte se ve al escanear, sin convertir cada
  // tier en un panel. Sólo cuando la lista está ordenada por valor — con una
  // búsqueda activa el orden es otro y un separador mentiría.
  const rows = useMemo(() => {
    const out = [];
    let previous = null;
    const marking = query.trim().length < 2;
    // El recuento del tier sale del pool DISPONIBLE de esa vista, no de las 60
    // filas que se pintan. Contarlo sobre lo visible decía «3 left» cuando
    // quedaban doce: el corte caía dentro de la ventana y el resto del tier
    // estaba fuera. Un número que se lee como escasez y que era un artefacto
    // del scroll.
    const rankedWanted = new Set(all ? RANKED_POSITIONS : RANKED_POSITIONS.filter((p) => picked.has(p)));
    const tierPool = available.filter((r) => rankedWanted.has(r.position));
    // Los tiers salen de los huecos del board PUBLICADO y la lista se ordena por
    // el VOR de TU liga. Arriba las dos ordenaciones coinciden; en la cola dejan
    // de hacerlo, y entonces el separador repetía el mismo tier —«TIER 12» tres
    // veces— con la misma `key`, así que React se comía las filas de en medio.
    //
    // El arreglo no es sólo la key: un separador afirma «de aquí para abajo,
    // otro escalón», y en cuanto el tier RETROCEDE esa afirmación es falsa. Así
    // que se marca mientras la secuencia no decrezca y se deja de marcar en
    // cuanto lo hace. El tier de cada fila sigue ahí — es un hecho del jugador;
    // lo que se retira es el corte, que es una afirmación sobre el orden.
    let monotonic = true;
    for (const row of shown) {
      // Los especialistas no tienen tier y no generan cortes: un separador
      // «Tier null» sería un tier inventado con nombre técnico.
      if (Number.isFinite(row.tier) && previous !== null && row.tier < previous) {
        monotonic = false;
      }
      if (marking && monotonic && Number.isFinite(row.tier) && row.tier !== previous) {
        const left = tierPool.filter((r) => r.tier === row.tier).length;
        out.push({ kind: "tier", tier: row.tier, left, key: `t${row.tier}` });
      }
      if (Number.isFinite(row.tier)) previous = row.tier;
      out.push({ kind: "player", row, key: row.player_id });
    }
    return out;
  }, [shown, query, available, picked, all]);

  if (!ready) return <p className="caption">Loading draft room&hellip;</p>;

  // En replay manda el cursor; en vivo, la posición autoritativa del proveedor.
  const overall = (replaying ? effective.count : draftCount) + 1;
  const here = slotForOverall(overall, teams, type);
  // Completo sólo si la liga declaró tamaño y rondas: sin ellos no se afirma.
  const complete = Boolean(teams && rounds && draftCount >= teams * rounds);
  // Dónde está el cursor, en lenguaje de draft: el pick N y su casilla.
  const cursorHere = replaying && replayCursor > 0
    ? slotForOverall(replayCursor, teams, type)
    : null;

  return (
    <div className={replaying ? "room room--replaying" : "room"}>
      {/* --- BANDA DE ESTADO -----------------------------------------------
          Lo más fuerte de la pantalla, con tipografía y no con tamaño de caja.
          Lleva DÓNDE estamos (ronda y pick) además de cuánto falta: sin la
          ronda, «2 picks» no sitúa a nadie en el draft. */}
      {replaying ? (
        /* --- REPLAY: inconfundiblemente histórico ------------------------
           Sin ámbar, sin reloj, sin «on the clock»: un marco de archivo con el
           cursor en lenguaje de draft. Nada de lo de abajo puede confundirse
           con un estado en vivo. */
        <section className="room-state room-state--replay" aria-live="polite">
          <p className="room-replay-tag">Replay</p>
          <p className="room-until">
            <span className="room-until-n">{replayCursor}</span>
            <span className="room-until-t">
              {replayCursor === 0 ? "before the draft" : replayCursor === 1 ? "pick made" : "picks made"}
              <small>
                {replayCursor === 0
                  ? "the board as it started"
                  : cursorHere
                    ? `last: round ${cursorHere.round}, pick ${cursorHere.inRound}`
                    : `of ${state.count} recorded`}
              </small>
            </span>
          </p>
          <button type="button" className="room-undo" onClick={exitReplay}>
            Back to live
          </button>
        </section>
      ) : (
      <section className={onClock ? "room-state room-state--clock" : "room-state"}
               aria-live="polite">
        {/* ESTADO DE CONEXIÓN. `syncState` ya decide cuándo se puede escribir
            LIVE: exige sondeo reciente Y que Sleeper diga que el draft está en
            curso. Sin liga de Sleeper el estado es MANUAL, que no es un fallo
            ni un modo degradado — es el que funciona en todas partes. */}
        <p className={`room-link room-link--${sleeperLeague ? sync.view.level.toLowerCase() : "manual"}`}>
          <b>{sleeperLeague ? sync.view.label : "Manual"}</b>
          {sleeperLeague && sync.view.detail ? <small>{sync.view.detail}</small> : null}
          {!sleeperLeague ? <small>Record picks as they happen — works anywhere</small> : null}
        </p>
        {/* EL ALCANCE, visible. Qué draft exactamente, y el límite del producto:
            Sleeper no publica API de escritura para drafts, así que Gridiron
            NUNCA ficha por ti. Decirlo aquí y no en un pie evita la única
            confusión cara que tiene esta pantalla — creer que has fichado. */}
        {sleeperLeague && sync.stable?.draftId ? (
          <p className="room-scope">
            <span className="room-scope-k">Following</span>
            <a className="room-scope-link"
               href={`https://sleeper.com/draft/nfl/${sync.stable.draftId}`}
               target="_blank" rel="noreferrer noopener">
              draft {sync.stable.draftId}
              {sync.stable.season ? ` · ${sync.stable.season}` : ""}
            </a>
            <span className="room-scope-note">
              You pick in Sleeper — Gridiron watches and never drafts for you
            </span>
            {sync.unmapped?.length ? (
              /* Un pick que no se pudo resolver POR ID se dice, no se resuelve
                 por nombre. Callarlo dejaría a un jugador fichado apareciendo
                 como disponible sin que nada lo indicara. */
              <span className="room-scope-warn">
                {sync.unmapped.length} pick{sync.unmapped.length === 1 ? "" : "s"} UNMAPPED
                — not in the published pool, still on the board
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="room-where">
          {here ? (
            <>Round <b>{here.round}</b> · Pick <b>{here.inRound}</b></>
          ) : (
            <>Pick <b>{overall}</b></>
          )}
          <span className="room-where-sep" aria-hidden="true">·</span>
          <span className="room-count">
            <strong>{state.count}</strong> recorded
          </span>
          <span className="room-where-sep" aria-hidden="true">·</span>
          {/* RANKEADOS != DRAFTEABLES. Enseñar sólo 344 hacía parecer que el
              universo del draft eran los jugadores con VOR, y los novatos y los
              especialistas quedaban fuera de esa cuenta sin dejar rastro. */}
          <span className="room-pool">
            <strong>{available.length}</strong> ranked
            <small>
              of {available.length + availableSpecialists.length + availableRookies.length} draftable
            </small>
          </span>
        </p>

        {complete ? (
          /* Un draft terminado no habla en presente: sin reloj, sin «until
             you». Revisarlo pasa a ser la acción natural. */
          <p className="room-done">Draft complete</p>
        ) : onClock === true ? (
          <p className="room-clock">On the clock</p>
        ) : next ? (
          <p className="room-until">
            <span className="room-until-n">{next.away}</span>
            <span className="room-until-t">
              {next.away === 1 ? "pick until you" : "picks until you"}
              <small>you&rsquo;re up at {next.round}.{String(next.inRound).padStart(2, "0")}</small>
            </span>
          </p>
        ) : (
          <p className="room-until room-until--unknown">
            <span className="room-until-n">—</span>
            <span className="room-until-t">
              Draft slot UNKNOWN
              <small>set your slot to see whose pick it is</small>
            </span>
          </p>
        )}
        {state.count > 0 ? (
          <button type="button"
                  className={complete ? "room-replay-enter room-replay-enter--loud" : "room-replay-enter"}
                  onClick={enterReplay}>
            {complete ? "Review the draft" : "Replay"}
          </button>
        ) : null}
      </section>
      )}

      {/* --- el control del cursor: al principio, atrás, barra, adelante, al
             final. La barra salta a cualquier pick, rondas incluidas. -------- */}
      {replaying ? (
        <div className="room-replay-bar" role="group" aria-label="Replay position">
          <button type="button" onClick={() => setReplayCursor(0)}
                  disabled={replayCursor === 0} aria-label="Jump to start">&#171;</button>
          <button type="button" onClick={() => setReplayCursor((c) => Math.max(0, c - 1))}
                  disabled={replayCursor === 0} aria-label="Previous pick">&#8249;</button>
          <input type="range" min="0" max={state.count} step="1" value={replayCursor}
                 aria-label={`Draft position: after pick ${replayCursor} of ${state.count}`}
                 onChange={(event) => setReplayCursor(Number(event.target.value))} />
          <button type="button" onClick={() => setReplayCursor((c) => Math.min(state.count, c + 1))}
                  disabled={replayCursor === state.count} aria-label="Next pick">&#8250;</button>
          <button type="button" onClick={() => setReplayCursor(state.count)}
                  disabled={replayCursor === state.count} aria-label="Jump to end">&#187;</button>
        </div>
      ) : null}

      {/* --- LA LISTA CORTA -------------------------------------------------
             Sólo cuando es tu turno y el draft sigue vivo. Fuera del turno
             ocuparía el sitio de lo que sí importa entonces: el board.

             Se llama TOP AVAILABLE y no «tu mejor pick» porque eso es lo que
             es: los primeros por valor de TU liga (E18), con hechos al lado.
             `BEST_PICK_FOR_ME` sigue BLOCKED y esta pantalla no lo desbloquea
             por necesitar algo que enseñar. -------------------------------- */}
      {onClock && !replaying && !complete && shortlist.length > 0 ? (
        <section className="room-shortlist" aria-label="Top available">
          <h2 className="room-h">
            Top available
            <small>
              by {leagueCompiled ? "your league\u2019s" : "the published"} value — not a
              personalised recommendation
            </small>
          </h2>
          {/* La profundidad CALIFICA la lista, no la esconde. El board del
              modo draft ya lo decía y esta pantalla no: la misma liga de 32
              enseñaba VOR sin matizar aquí y matizado allí. E18 validó la
              MAGNITUD hasta 14 equipos; la estructura responde más allá. */}
          {/* Dos avisos DISTINTOS, y no se funden: uno dice que el valor sí es
              de tu liga pero a esta profundidad no está validado en magnitud;
              el otro, que no se pudo compilar y estos números son del board
              publicado. Decir «not validated» cuando además no es tu board
              sería juntar dos límites en una frase que no describe ninguno. */}
          {!leagueCompiled ? (
            <p className="room-depth-warn">
              Published board — not your league&rsquo;s value
              <small>
                {leagueValue?.reason
                  ? `Could not compile this league: ${leagueValue.reason}.`
                  : "This league's value could not be compiled."}{" "}
                Ordering is the published {context.teams}-team {context.scoring} board.
              </small>
            </p>
          ) : deepLeague ? (
            <p className="room-depth-warn">
              {teams} teams · value not validated past {VALIDATED_MAX_TEAMS}
              <small>
                E18 holds the magnitude to 10-14 teams. The order still responds to
                your settings; how big the gaps are does not hold up this deep.
              </small>
            </p>
          ) : null}
          <ol className="room-cands">
            {shortlist.map((entry, index) => (
              <li key={entry.row.player_id} style={teamVars(entry.row.team)}
                  className={index === 0 ? "is-top" : undefined}>
                <button type="button" className="room-cand" onClick={() => record(entry.row)}>
                  <span className="room-cand-rank">{entry.row.overall_rank}</span>
                  <span className="room-cand-who hs-who">
                    <Headshot sid={entry.row.sid} team={entry.row.team} position={entry.row.position} name={entry.row.player_full_name ?? entry.row.player_name} size={40} />
                    <span className="nm">{entry.row.player_full_name ?? entry.row.player_name}</span>
                    <span className="meta">
                      <TeamMark abbr={entry.row.team} />
                      <span className={`ptag ptag--${entry.row.position.toLowerCase()}`}>
                        {entry.row.position}{entry.row.position_rank}
                      </span>
                      {Number.isFinite(entry.row.tier) ? <span>Tier {entry.row.tier}</span> : null}
                      {context.byes?.[entry.row.team] ? (
                        <span>Bye {context.byes[entry.row.team]}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="room-cand-vor">{num(entry.row.vor, 1)}<small>VOR</small></span>
                </button>
                {/* El «why» son HECHOS compuestos, no prosa: el primero por
                    valor, el hueco elegible abierto y el conteo de su tier.
                    Nada de «suelo seguro» ni «gran techo». */}
                <ul className="room-why">
                  {entry.row.status_severity ? (
                    <li className={entry.row.status_severity === "OUT"
                      ? "room-why-out" : "room-why-risk"}>
                      <b>{entry.row.status_label}</b> {entry.row.status_detail}
                    </li>
                  ) : null}
                  {entry.row.rostered === false && entry.row.status_severity !== "OUT" ? (
                    <li className="room-why-noteam"><b>No NFL team</b> — free agent</li>
                  ) : null}
                  {entry.row.rookie ? (
                    /* Un novato en la lista corta tiene que llegar con su
                       intervalo. El valor de al lado es la media encogida de su
                       celda y las celdas son anchas: sin el rango, un número
                       solo sugiere una precisión que la previa no tiene. */
                    <li className="room-why-rookie" title={rookieBrief(entry.row)}>
                      <b>Rookie</b>
                      {Number.isFinite(entry.row.rookie_p25)
                        ? ` — past rookies here: ${Math.round(entry.row.rookie_p25)}–`
                          + `${Math.round(entry.row.rookie_p75)} pts (n=${entry.row.rookie_sample})`
                        : " — value from draft capital, no NFL games yet"}
                    </li>
                  ) : null}
                  {entry.reasons.map((reason) => (
                    <li key={reason.kind}>{reason.text}</li>
                  ))}
                  {context.briefs?.[entry.row.player_id] ? (
                    /* El contexto actual va con los hechos, marcado como lo que
                       es. No entra en el VOR ni reordena la lista. */
                    <li className="room-why-news">
                      <b>News</b> {context.briefs[entry.row.player_id]}
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Deshacer: temporal y discreto. No compite con la banda de estado. */}
      {flash && !replaying ? (
        <p className="room-flash" role="status">
          <strong>{flash.row.player_full_name ?? flash.row.player_name}</strong>
          <span>
            {flash.roster === ROSTER.MINE
              ? "yours"
              : flash.roster === ROSTER.UNKNOWN ? "taken · roster unknown" : "taken"}
          </span>
          <button type="button" className="room-undo" onClick={() => undo(flash.row.player_id)}>
            Undo
          </button>
        </p>
      ) : null}

      <div className="room-grid">
        {/* --- tablero disponible ------------------------------------------ */}
        <section className="room-board" aria-label="Available players">
          {/* Los novatos CON previa están en el board, ordenados como todos.
              Aquí quedan sólo aquéllos a los que no se les puede aplicar
              ninguna celda —posición fuera de las cuatro, o sin muestra— y de
              ésos el modelo sigue sin opinar. Excluirlos del orden es correcto;
              CALLARLO no, porque se leería como «no hay nadie más». */}
          {availableRookies.length > 0 ? (
            <p className="room-rookie-note">
              {availableRookies.length} rookies available without validated model value —
              search by name to draft one
            </p>
          ) : null}
          <div className="room-tools">
            <input
              type="search"
              className="draft-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a player"
              aria-label="Search available players"
            />
            <div className="pos-filter" role="group" aria-label="Filter by position">
              {POSITIONS.map((entry) => (
                <button key={entry} type="button" className="pos-option"
                        aria-pressed={entry === "ALL" ? all : picked.has(entry)}
                        onClick={() => togglePosition(entry)}>
                  {entry}
                </button>
              ))}
            </div>
          </div>
          {!all && SPECIAL_POSITIONS.some((p) => picked.has(p)) ? (
            /* K y DST existen y se fichan, pero NO tienen valor calculado: el
               orden de pateadores está rechazado (E8b) y el modelo de defensa
               no existe. Sus filas llevan hechos de la temporada anterior. */
            <p className="room-note">
              K and DST are draftable, not ranked: no projection exists for them,
              so their rows carry last season&rsquo;s facts only.
            </p>
          ) : null}
          <ol className="room-list">
              {rows.map((entry) =>
                entry.kind === "tier" ? (
                  /* El corte de tier, visible al escanear y sin ser un panel.
                     Es un CONTEO: cuántos quedan de ese tier en esta vista. */
                  <li key={entry.key} className="room-tier" aria-hidden="true">
                    <span>Tier {entry.tier}</span>
                    <span className="room-tier-left">{entry.left} left</span>
                  </li>
                ) : (
                  <li key={entry.key} style={teamVars(entry.row.team)}
                      className={entry.row === best ? "is-best" : undefined}>
                    {/* Toda la fila es el botón: el objetivo táctil es la fila
                        entera, que es lo que hace que un pick sea un toque. */}
                    <button type="button" className="room-row" disabled={replaying}
                            onClick={() => record(entry.row)}>
                      <span className="room-row-rank">{entry.row.overall_rank ?? "—"}</span>
                      <span className="room-row-who hs-who">
                        <Headshot sid={entry.row.sid} team={entry.row.team} position={entry.row.position} name={entry.row.player_full_name ?? entry.row.player_name} size={32} />
                        <span className="nm">
                          {entry.row.player_full_name ?? entry.row.player_name}
                        </span>
                        <span className="meta">
                          <TeamMark abbr={entry.row.team} />
                          <span className={`ptag ptag--${entry.row.position.toLowerCase()}`}>
                            {entry.row.position}{entry.row.position_rank ?? ""}
                          </span>
                          {/* Especialistas: HECHOS de la temporada anterior en
                              vez del VOR que no tienen. */}
                          {entry.row.position === "K" ? (
                            <span>{entry.row.fg_made}/{entry.row.fg_att} FG last yr</span>
                          ) : entry.row.position === "DST" ? (
                            <span>{num(entry.row.points_allowed_pg, 1)} PA/g last yr</span>
                          ) : null}
                        </span>
                      </span>
                      {context.briefs?.[entry.row.player_id] ? (
                        /* NOTICIA, no penalización. Se ve y no mueve el orden:
                           el VOR de al lado es el mismo con marca y sin ella.
                           Convertir una nota de prensa en un número es
                           exactamente lo que la regla 8 prohíbe. */
                        <span className="room-row-news" title={context.briefs[entry.row.player_id]}>
                          NEWS
                        </span>
                      ) : null}
                      {entry.row.status_severity === "OUT" ? (
                        /* NO VA A JUGAR, y los datos de plantilla no lo saben:
                           un suspendido o un exento figura ACT en su equipo.
                           Va la primera de todas las marcas porque es la que
                           cambia la decisión — el número de al lado sigue
                           siendo el mismo, y por eso hace falta decirlo. */
                        <span className="room-row-out" title={statusBrief(entry.row)}>
                          {entry.row.status_label}
                        </span>
                      ) : entry.row.status_severity === "RISK" ? (
                        <span className="room-row-risk" title={statusBrief(entry.row)}>
                          {entry.row.status_label}
                        </span>
                      ) : null}
                      {entry.row.rostered === false && entry.row.status_severity !== "OUT" ? (
                        /* SIN EQUIPO. Va antes que cualquier otra marca porque
                           invalida el número de al lado: la proyección salió de
                           lo que hizo en un equipo en el que ya no está. Si ya
                           hay una marca de OUT no se repite: «FREE AGENT» y
                           «SIN EQUIPO» juntos dicen lo mismo dos veces. */
                        <span className="room-row-noteam"
                              title="Not on any 2026 NFL roster. The projection comes from his production with a team he is no longer on.">
                          SIN EQUIPO
                        </span>
                      ) : null}
                      {priorNote(entry.row) ? (
                        /* DE DÓNDE SALE EL NÚMERO. Un jugador con muestra
                           mínima recibe casi toda su proyección de la media de
                           su posición, y hasta hoy eso no se veía en ninguna
                           parte: `risk_label` decía «Normal» sobre un 97% de
                           ancla. La marca describe el cálculo — no predice. */
                        <span className="room-row-prior" title={priorNote(entry.row).title}>
                          {priorNote(entry.row).pct}% PRIOR
                        </span>
                      ) : null}
                      {entry.row.rookie ? (
                        /* ROOKIE, y desde agosto de 2026 CON número: la previa
                           por capital de draft está validada walk-forward (E9).
                           Sin alarma —no es un aviso, es de dónde sale el
                           valor— y con el intervalo observado de su celda en el
                           título, porque una previa de novato sin su dispersión
                           es justo el número que la capacidad prohíbe publicar
                           solo: el QB de segunda ronda promedia 63 y su mediana
                           es 16. */
                        <span className="room-row-rookie" title={rookieBrief(entry.row)}>
                          ROOKIE
                        </span>
                      ) : null}
                      <span className="room-row-vor">
                        {entry.row.vor === null || entry.row.vor === undefined
                          ? (entry.row.rookie ? "UNKNOWN" : "—") : num(entry.row.vor, 1)}
                      </span>
                    </button>
                  </li>
                )
              )}
              {rows.length === 0 ? (
                /* Board AGOTADO y búsqueda SIN RESULTADOS son cosas distintas y
                   decían lo mismo. En una liga de 32 con banquillo profundo el
                   pool publicado se acaba de verdad —480 huecos contra 344
                   jugadores— y «no player matches that» mandaba a buscar un
                   fallo de filtro donde no lo había. */
                <li className="room-empty">
                  {available.length === 0 ? (
                    <>
                      <strong>Board exhausted.</strong> Every published player is off the
                      board. The published pool is {board.length} deep; a league this size
                      drafts past it.
                    </>
                  ) : query.trim().length >= 2 ? (
                    <>No available player matches &ldquo;{query.trim()}&rdquo;.</>
                  ) : (
                    <>No {[...picked].join(" or ")} left on the board.</>
                  )}
                </li>
              ) : null}
            </ol>
        </section>

        {/* --- contexto: profundidad, plantilla y ticker -------------------- */}
        <aside className="room-side">
          {/* PROFUNDIDAD, no «¿puedo esperar?». Cuántos quedan en el tier de
              arriba es comprobable; si conviene esperar sería una regla de
              decisión que nadie ha validado. */}
          {depth.length > 0 ? (
            <section aria-label="Position depth">
              <h2 className="room-h">Position depth</h2>
              <ul className="room-depth">
                {depth.map((entry) => (
                  <li key={entry.position}>
                    <span className={`ptag ptag--${entry.position.toLowerCase()}`}>
                      {entry.position}
                    </span>
                    <span className="room-depth-tier">Tier {entry.tier}</span>
                    <span className="room-depth-left">
                      <b>{entry.left}</b> left
                    </span>
                    <span className="room-depth-total">{entry.total} on board</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="My roster">
            <h2 className="room-h">
              My roster <span className="room-h-n">{roster.length}</span>
            </h2>
            {construction ? (
              <>
                {/* Los huecos que la liga DECLARA, con quién los ocupa. Un
                    hueco abierto es un hecho — «RB · Open» — y se queda en
                    hecho: nada de «necesitas un corredor», que sería una
                    recomendación sin validar. El reparto es presentación
                    derivada: los picks son la historia y esto se recoloca solo
                    si la configuración cambia. */}
                <ul className="room-roster room-roster--slots">
                  {construction.slots.map((entry) => (
                    <li key={entry.index}
                        className={entry.player ? undefined : "is-open"}
                        style={entry.player ? teamVars(entry.player.team) : undefined}>
                      <span className={`slot-tag ${entry.player ? "" : "slot-tag--open"} ptag ptag--${entry.slot === "SUPER_FLEX" ? "sflx" : entry.slot.toLowerCase()}`}>
                        {entry.slot === "SUPER_FLEX" ? "SFLX" : entry.slot}
                      </span>
                      {entry.player ? (
                        <>
                          <Headshot sid={entry.player.sid} team={entry.player.team} position={entry.player.position} name={entry.player.player_full_name ?? entry.player.player_name} size={24} />
                          <span className="nm">
                            {entry.player.player_full_name ?? entry.player.player_name}
                            {/* En un hueco flexible, la posición REAL del
                                jugador sigue visible: el hueco es FLEX pero el
                                jugador no deja de ser corredor por ocuparlo. */}
                            {["FLEX", "SUPER_FLEX"].includes(entry.slot) ? (
                              <small className="slot-pos">{entry.player.position}</small>
                            ) : null}
                          </span>
                          <TeamMark abbr={entry.player.team} />
                          {context.byes?.[entry.player.team] ? (
                            <span className="room-bye">Bye {context.byes[entry.player.team]}</span>
                          ) : null}
                          <button type="button" className="room-x"
                                  aria-label={`Undo ${entry.player.player_full_name ?? entry.player.player_name}`}
                                  onClick={() => undo(entry.player.player_id)}>
                            &times;
                          </button>
                        </>
                      ) : (
                        <span className="nm nm--open">Open</span>
                      )}
                    </li>
                  ))}
                </ul>
                {construction.unassigned.length > 0 || construction.benchSize > 0 ? (
                  <>
                    <h3 className="room-h room-h--sub">
                      Bench
                      {construction.benchSize > 0 ? (
                        <span className="room-h-n">
                          {construction.unassigned.length}/{construction.benchSize}
                        </span>
                      ) : (
                        <span className="room-h-n">{construction.unassigned.length}</span>
                      )}
                    </h3>
                    {construction.unassigned.length === 0 ? (
                      <p className="room-empty">Empty.</p>
                    ) : (
                      <ul className="room-roster">
                        {construction.unassigned.map((row) => (
                          <li key={row.player_id} style={teamVars(row.team)}>
                            <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                              {row.position}
                            </span>
                            <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={24} />
                            <span className="nm">{row.player_full_name ?? row.player_name}</span>
                            <TeamMark abbr={row.team} />
                            {context.byes?.[row.team] ? (
                              <span className="room-bye">Bye {context.byes[row.team]}</span>
                            ) : null}
                            <button type="button" className="room-x"
                                    aria-label={`Undo ${row.player_full_name ?? row.player_name}`}
                                    onClick={() => undo(row.player_id)}>
                              &times;
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : null}
              </>
            ) : (
              <>
                {roster.length === 0 ? (
                  <p className="room-empty">Nothing yet.</p>
                ) : (
                  <ul className="room-roster">
                    {roster.map((row) => (
                      <li key={row.player_id} style={teamVars(row.team)}>
                        <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                          {row.position}
                        </span>
                        <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={24} />
                        <span className="nm">{row.player_full_name ?? row.player_name}</span>
                        <TeamMark abbr={row.team} />
                        {context.byes?.[row.team] ? (
                          <span className="room-bye">Bye {context.byes[row.team]}</span>
                        ) : null}
                        <button type="button" className="room-x"
                                aria-label={`Undo ${row.player_full_name ?? row.player_name}`}
                                onClick={() => undo(row.player_id)}>
                          &times;
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Sin estructura no se dibuja una: se dice que falta y por
                    dónde se configura. UNKNOWN sigue siendo UNKNOWN, y el
                    draft manual funciona igual sin ella. */}
                <p className="room-note">
                  Roster structure not configured — slots are not drawn because
                  they are not known. Add it under <b>edit</b> in the header.
                </p>
              </>
            )}
          </section>

          {/* --- LA PARRILLA ---------------------------------------------
                 Del MISMO estado plegado que todo lo demás: no hay una
                 segunda verdad del draft. Se pinta sólo si la liga declaró
                 tamaño y rondas; sin eso no se sabe dónde cae cada pick y
                 dibujar una rejilla sería inventarse la estructura. ------- */}
          {teams && rounds && type ? (
            <section aria-label="Draft board">
              <h2 className="room-h">Draft board</h2>
              <div className="room-grid" style={{ "--cols": teams }}>
                {Array.from({ length: rounds }, (_, r) => (
                  <div className="room-grid-row" key={r}>
                    {Array.from({ length: teams }, (_, c) => {
                      const inRound = c + 1;
                      const slot = type === "snake" && (r + 1) % 2 === 0 ? teams - inRound + 1 : inRound;
                      const no = r * teams + inRound;
                      const pick = effective.picks.find((x) => x.overall === no) ?? null;
                      const row = pick ? pool.find((x) => x.player_id === pick.playerId) : null;
                      const isMine = mySlot && slot === mySlot;
                      const isNow = no === effective.count + 1 && !complete;
                      return (
                        <span key={c} style={teamVars(row?.team)}
                              className={[
                                "room-cell",
                                pick ? "is-taken" : "",
                                isMine ? "is-mine" : "",
                                isNow ? "is-now" : "",
                              ].filter(Boolean).join(" ")}
                              title={row ? `${no}: ${row.player_full_name ?? row.player_name}` : `Pick ${no}`}>
                          {row ? (
                            <>
                              <b>{(row.player_full_name ?? row.player_name).split(" ").pop()}</b>
                              <small>{row.position}</small>
                            </>
                          ) : (
                            <small>{r + 1}.{String(inRound).padStart(2, "0")}</small>
                          )}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="caption">
                Your slot is outlined; the current pick is marked. Same folded state as
                everything else on this screen.
              </p>
            </section>
          ) : null}

          <section aria-label="Recent picks">
            <h2 className="room-h">Recent picks</h2>
            {state.picks.length === 0 ? (
              <p className="room-empty">The feed fills as you record picks.</p>
            ) : (
              <ol className="room-feed">
                {[...effective.picks].reverse().slice(0, 12).map((pick) => {
                  const row = pool.find((r) => r.player_id === pick.playerId);
                  const name = row?.player_full_name ?? row?.player_name ?? pick.playerId;
                  return (
                    <li key={pick.playerId} style={teamVars(row?.team)}
                        className={pick.roster === ROSTER.MINE ? "is-mine" : undefined}>
                      <span className="feed-pick">{pickLabel(pick.overall, teams, type)}</span>
                      <span className="feed-who">{name}</span>
                      {row ? (
                        <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                          {row.position}
                        </span>
                      ) : null}
                      {/* Deshacer está, y no compite: un aspa recesiva con su
                          etiqueta accesible, no un botón por cada pick pasado. */}
                      <button type="button" className="room-x"
                              aria-label={`Undo ${name}`}
                              onClick={() => undo(pick.playerId)}>
                        &times;
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* La metodología, detrás de una divulgación progresiva. Nadie en
              mitad de un draft debe leer prosa de validación antes de ver
              jugadores. */}
          <details className="room-method">
            <summary>What these numbers are</summary>
            <p>
              {leagueCompiled ? (
                <>
                  Values are recompiled for <strong>this league</strong> ({teams}-team
                  {leagueValue?.label ? ` · ${leagueValue.label}` : ""}) — points, replacement
                  level and VOR, by the same compiler the board screen uses.
                </>
              ) : (
                <>
                  Values come from the published board{boardContext ? ` (${boardContext})` : ""}.
                </>
              )}{" "}
              Best available by VOR, <strong>not</strong> a recommendation tuned to your
              roster. Your roster context sits beside it, never folded into it.
            </p>
            {leagueCompiled ? (
              <p>
                Tiers are <strong>not</strong> recompiled. They come from gaps in the
                published board&rsquo;s VOR; nobody has validated that those cuts mean
                anything in a different league, so the global tier is what is shown.
              </p>
            ) : null}
            {leagueDiffers && !leagueCompiled ? (
              <p>
                Your league has <strong>{teams} teams</strong> and the published board is
                built for {context.teams}. Replacement level moves with league size, so
                treat the ordering as a starting point, not your league&rsquo;s board.
              </p>
            ) : null}
          </details>
        </aside>
      </div>
    </div>
  );
}
