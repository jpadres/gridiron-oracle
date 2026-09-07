/**
 * START / SIT POR LIGA: la alineación que tienes puesta en Sleeper, la de
 * mayor proyección SEMANAL, y el cambio hueco a hueco con su diferencia.
 *
 *     UNA SOLA ESCALA: LA DE ESTA SEMANA.
 *
 * El analizador mezclaba el índice semanal (20-30 puntos por jugador) con el
 * board de resto de temporada (hasta 275) como respaldo «para conocer a las
 * defensas». Medido contra el payload real: 167 de 483 filas del pool seguían
 * en escala de TEMPORADA, así que cualquier suplente sin proyección semanal
 * —un jugador en bye, sin ir más lejos— ganaba a cualquier titular con ella,
 * y «Generate best lineup» sumaba 239 puntos por un solo quarterback. Aquí el
 * pool es el índice SEMANAL y nada más: quien no tiene proyección de esta
 * semana ocupa hueco sin sumar (una defensa) o queda fuera con su motivo
 * (bye, sin fila), y se dice.
 *
 * Sin React ni red, para probarlo con `node --test`. Los huecos los reparte
 * `assignSlots`, el mismo del board, del Draft Room y del analizador — un
 * quinto modelo de flex no va a existir.
 *
 * ## Qué afirma y qué no
 *
 *   - Ordena por la proyección semanal publicada. VALIDADA para RB/WR/TE
 *     (E11) y para la proyección del pateador; NO para el orden entre
 *     quarterbacks (START_SIT_QB NOT_READY) ni para la defensa (sin modelo).
 *     La autoridad se pinta al lado de cada cambio, leída del registro.
 *   - Un cambio de menos de un par de puntos está dentro del ruido semanal,
 *     y la diferencia se enseña para que se vea.
 *   - No sabe de una baja de última hora. El estado (OUT/RISK) es la marca de
 *     prensa con su fecha de verificación, no un parte oficial de domingo.
 */

import { numberOrNull } from "../numbers.js";
import { assignSlots, SLOT_ELIGIBILITY } from "./leagueValue.js";
import { normalizeTeam } from "./rosterMark.js";
import { weeklyIndex } from "./leagueWeek.js";

const BENCH = new Set(["BN", "BE", "BENCH", "IR", "TAXI"]);
const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/**
 * El índice semanal COMPLETO: ranking + pateadores + defensas.
 *
 * En Sleeper una defensa se identifica por el código del equipo («SF», «KC»),
 * y el payload la trae con el código de nflverse («LA» para los Rams). Se
 * indexa por los dos, normalizados, para que el id que Sleeper publica en
 * `starters` encuentre su fila. La defensa NO trae proyección —no hay modelo
 * de DST validado— y por eso entra con `projected_points: null`: ocupa su
 * hueco, no suma y se cuenta aparte.
 */
export function fullWeeklyIndex({ rankings, kickers = null, defenses = null }) {
  const index = weeklyIndex(rankings, kickers);
  for (const row of defenses ?? []) {
    const team = normalizeTeam(row?.team);
    if (!team) continue;
    const fila = {
      ...row, position: "DEF", team, sid: team,
      player_name: `${team} D/ST`, player_full_name: `${team} D/ST`,
      projected_points: null,
    };
    for (const key of new Set([team, String(row.team ?? "").toUpperCase()])) {
      if (key && !index.has(key)) index.set(key, fila);
    }
  }
  return index;
}

/** Por qué un jugador de la plantilla NO entra en el reparto de titulares. */
export const EXCLUDED = Object.freeze({
  OUT: "OUT",               // marca de estado OUT, no disputada
  BYE: "BYE",               // su equipo descansa esta semana
  RESERVE: "RESERVE",       // en IR / taxi de Sleeper: no puede alinearse
  NO_PROJECTION: "NO_PROJECTION", // sin fila semanal y sin ser defensa
});

/**
 * Los huecos titulares de la liga, en el orden en que Sleeper publica
 * `starters`: `roster_positions` sin los de banquillo.
 */
export function starterSlots(rosterPositions) {
  return (rosterPositions ?? [])
    .map((raw) => String(raw ?? "").toUpperCase().trim())
    .filter((slot) => slot && !BENCH.has(slot));
}

function slotAdmits(slot, position) {
  const elegibles = SLOT_ELIGIBILITY[String(slot).toUpperCase()] ?? [];
  return elegibles.includes(String(position ?? "").toUpperCase());
}

/**
 * La alineación que Sleeper tiene PUESTA, hueco a hueco y en su orden.
 *
 * Es posicional a propósito: el hueco N de `starters` es el hueco N de
 * `roster_positions` sin banquillo. Re-repartirla con el optimizador daba
 * OTRA colocación y dos pantallas enseñaban «tu alineación actual» con dos
 * mapas de huecos distintos.
 */
export function currentLineup({ starters, rosterPositions, index, byes = {}, week = null }) {
  const slots = starterSlots(rosterPositions);
  const ids = Array.isArray(starters) ? starters.map((x) => String(x ?? "")) : null;
  if (!ids) return null;
  const rows = slots.map((slot, i) => {
    const sid = ids[i] ?? "";
    if (!sid || sid === "0") return { slot, sid: null, row: null, points: null, empty: true, flags: ["EMPTY"] };
    const row = index.get(sid) ?? null;
    const points = numberOrNull(row?.projected_points);
    return { slot, sid, row, points, empty: false, flags: flagsFor({ row, byes, week }) };
  });
  let total = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.points !== null) total += r.points;
    // «Sin proyección» es alguien PUESTO sin número (una defensa, un id que el
    // mapa no conoce). Un hueco vacío no es eso: se avisa aparte como vacío.
    else if (r.sid) unknown += 1;
  }
  return { rows, points: round1(total), unknown, empty: rows.filter((r) => r.empty).length, slots };
}

/** Los hechos de una fila que pesan en la decisión, sin inventar ninguno. */
function flagsFor({ row, byes, week }) {
  const flags = [];
  if (!row) { flags.push("NO_PROJECTION"); return flags; }
  if (row.status_severity === "OUT" && row.status_disputed !== true) flags.push("OUT");
  else if (row.status_severity === "RISK" || row.status_disputed === true) flags.push("RISK");
  const bye = numberOrNull(byes?.[row.team]);
  if (bye !== null && week !== null && bye === Number(week)) flags.push("BYE");
  if (row.position !== "DEF" && numberOrNull(row.projected_points) === null) flags.push("NO_PROJECTION");
  return flags;
}

/**
 * La alineación de MAYOR PROYECCIÓN SEMANAL desde toda la plantilla.
 *
 * Quedan fuera del reparto, con su motivo: quien está en IR/taxi de Sleeper
 * (no puede alinearse), quien está OUT sin disputa, quien descansa esta
 * semana, y quien no tiene proyección semanal — salvo la defensa, que no la
 * tiene por diseño y sí ocupa su hueco.
 */
export function bestLineup({ players, reserve = [], taxi = [], rosterPositions, index, byes = {}, week = null }) {
  const slots = starterSlots(rosterPositions);
  const apartados = new Set([...(reserve ?? []), ...(taxi ?? [])].map(String));
  const elegibles = [];
  const excluded = [];
  for (const raw of players ?? []) {
    const sid = String(raw ?? "");
    if (!sid || sid === "0") continue;
    const row = index.get(sid) ?? null;
    if (apartados.has(sid)) { excluded.push({ sid, row, reason: EXCLUDED.RESERVE }); continue; }
    if (!row) { excluded.push({ sid, row: null, reason: EXCLUDED.NO_PROJECTION }); continue; }
    const flags = flagsFor({ row, byes, week });
    if (flags.includes("OUT")) { excluded.push({ sid, row, reason: EXCLUDED.OUT }); continue; }
    if (flags.includes("BYE")) { excluded.push({ sid, row, reason: EXCLUDED.BYE }); continue; }
    if (flags.includes("NO_PROJECTION")) { excluded.push({ sid, row, reason: EXCLUDED.NO_PROJECTION }); continue; }
    // `assignSlots` ordena por `vor ?? projected_points`: se le da la
    // proyección de la semana como `vor`. Es el mismo repartidor midiendo otra
    // cosa. Una defensa sin proyección va con -Infinity para que nunca le
    // quite un FLEX a nadie, pero sí entre en el hueco DEF.
    const p = numberOrNull(row.projected_points);
    elegibles.push({ ...row, sid, vor: p === null ? -Infinity : p, flags });
  }
  const { slots: repartidos, unassigned } = assignSlots(elegibles, slots);
  const rows = repartidos.map((s) => ({
    slot: s.slot,
    sid: s.player?.sid ?? null,
    row: s.player ?? null,
    points: numberOrNull(s.player?.projected_points),
    empty: !s.player,
    flags: s.player?.flags ?? ["EMPTY"],
  }));
  let total = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.points !== null) total += r.points;
    else if (r.row) unknown += 1;
  }
  return { rows, points: round1(total), unknown, empty: rows.filter((r) => r.empty).length,
           bench: unassigned, excluded, slots, considered: elegibles.length };
}

/**
 * Los cambios hueco a hueco entre lo puesto y lo propuesto, con la diferencia.
 *
 * Es posicional: «en FLEX, sienta a X (9,1) y pon a Y (13,4): +4,3». Es
 * exactamente el gesto que se hace en Sleeper, hueco por hueco, y no obliga a
 * adivinar qué par forma un «entra» con un «sale». Un jugador que sólo cambia
 * de hueco (del FLEX al WR2) aparece en dos líneas, que es lo que se hace.
 * `delta` es `null` cuando alguno de los dos no tiene proyección: no se
 * inventa una resta con un cero.
 */
export function slotSwaps(current, best) {
  if (!current || !best) return [];
  const swaps = [];
  const n = Math.max(current.rows.length, best.rows.length);
  for (let i = 0; i < n; i += 1) {
    const a = current.rows[i] ?? null;
    const b = best.rows[i] ?? null;
    if ((a?.sid ?? null) === (b?.sid ?? null)) continue;
    const delta = a?.points !== null && a?.points !== undefined && b?.points !== null && b?.points !== undefined
      ? round1(b.points - a.points) : null;
    swaps.push({ slot: b?.slot ?? a?.slot ?? "", out: a, in: b, delta });
  }
  return swaps;
}

/**
 * La alternativa de banquillo más cercana a cada titular propuesto: el mejor
 * suplente que CABRÍA en ese hueco y cuánto le falta. Sirve para ver dónde la
 * decisión está apretada, que es donde la proyección no decide sola.
 */
export function closestCalls(best) {
  if (!best) return [];
  const bench = (best.bench ?? []).filter((r) => numberOrNull(r.projected_points) !== null);
  const calls = [];
  for (const r of best.rows) {
    if (!r.row || r.points === null) continue;
    let mejor = null;
    for (const b of bench) {
      if (!slotAdmits(r.slot, b.position)) continue;
      const p = numberOrNull(b.projected_points);
      if (mejor === null || p > numberOrNull(mejor.projected_points)) mejor = b;
    }
    if (!mejor) continue;
    calls.push({ slot: r.slot, starter: r.row, bench: mejor,
                 gap: round1(r.points - numberOrNull(mejor.projected_points)) });
  }
  return calls.sort((x, y) => x.gap - y.gap);
}

/**
 * Todo lo de una liga para una semana, en un objeto que la pantalla pinta.
 * `null` si la liga no declara huecos: sin estructura no hay alineación.
 */
export function leagueStartSit({ league, index, byes = {}, week = null }) {
  const rosterPositions = league?.config?.roster ?? null;
  if (!Array.isArray(rosterPositions) || starterSlots(rosterPositions).length === 0) return null;
  const current = currentLineup({
    starters: league?.starters ?? null, rosterPositions, index, byes, week,
  });
  const best = bestLineup({
    players: league?.players ?? [], reserve: league?.reserve ?? [], taxi: league?.taxi ?? [],
    rosterPositions, index, byes, week,
  });
  const swaps = slotSwaps(current, best);
  const gain = current && current.points !== null && best.points !== null
    ? round1(best.points - current.points) : null;
  const warnings = [];
  (current?.rows ?? []).forEach((r, i) => {
    if (r.empty) warnings.push({ kind: "EMPTY", slot: r.slot, row: null, index: i });
    else if (r.flags.includes("OUT")) warnings.push({ kind: "OUT", slot: r.slot, row: r.row });
    else if (r.flags.includes("BYE")) warnings.push({ kind: "BYE", slot: r.slot, row: r.row });
    else if (r.flags.includes("NO_PROJECTION") && r.row?.position !== "DEF") {
      warnings.push({ kind: "NO_PROJECTION", slot: r.slot, row: r.row, sid: r.sid });
    } else if (!r.row) warnings.push({ kind: "UNKNOWN_ID", slot: r.slot, row: null, sid: r.sid });
  });
  best.rows.forEach((r, i) => {
    if (!r.empty) return;
    // El mismo hueco vacío en Sleeper Y sin nadie que lo llene es UN aviso, no
    // dos: se funden en el de «nadie cabe», que es el que dice qué hacer.
    const previo = warnings.find((wn) => wn.kind === "EMPTY" && wn.index === i);
    if (previo) { previo.kind = "EMPTY_NO_ONE_FITS"; return; }
    warnings.push({ kind: "NO_ONE_FITS", slot: r.slot, row: null, index: i });
  });
  return {
    current, best, swaps, gain,
    unchanged: current !== null && swaps.length === 0,
    // Sin un solo jugador en la plantilla no hay «no change» que valga: hay
    // una plantilla vacía, y se dice eso.
    emptyRoster: (league?.players ?? []).filter((x) => x && String(x) !== "0").length === 0,
    closest: closestCalls(best),
    warnings,
    excluded: best.excluded,
  };
}

/**
 * El estado de autoridad de un cambio, por la posición del que ENTRA (o del
 * que sale si el hueco queda vacío). `statusOf` es `capabilityStatus` del
 * payload; sin estado declarado se devuelve `null` y la pantalla no afirma.
 */
export function swapAuthority(position, statusOf) {
  const pos = String(position ?? "").toUpperCase();
  if (pos === "QB") return { id: "START_SIT_QB", status: statusOf?.("START_SIT_QB") ?? null };
  if (pos === "RB") return { id: "START_SIT_RB", status: statusOf?.("START_SIT_RB") ?? null };
  if (pos === "WR") return { id: "START_SIT_WR", status: statusOf?.("START_SIT_WR") ?? null };
  if (pos === "TE") return { id: "START_SIT_TE", status: statusOf?.("START_SIT_TE") ?? null };
  if (pos === "K") return { id: "KICKER_ORDINAL_RANKING", status: statusOf?.("KICKER_ORDINAL_RANKING") ?? null };
  if (pos === "DEF" || pos === "DST") return { id: "DST_STREAMING", status: statusOf?.("DST_STREAMING") ?? null };
  return null;
}
