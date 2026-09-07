/**
 * START / SIT POR LIGA — el motor puro.
 *
 * Cada test lleva el fallo que existe para cazar:
 *   - la escala de temporada colándose en la alineación semanal (239 puntos
 *     por un quarterback);
 *   - un OUT, un IR o un jugador en bye propuestos como titulares;
 *   - la defensa contando cero (hunde a todo el que la alinea) o dejando el
 *     hueco vacío (la pantalla decía «empty» con una defensa puesta);
 *   - «tu alineación actual» re-repartida en vez de leída en su orden;
 *   - una resta inventada con un cero cuando falta la proyección.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXCLUDED, bestLineup, closestCalls, currentLineup, fullWeeklyIndex,
  leagueStartSit, slotSwaps, starterSlots, swapAuthority,
} from "../app/fantasy/startSit.js";

const ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN", "BN"];
const w = (sid, position, projected_points, extra = {}) => ({
  sid, player_id: `g${sid}`, player_name: `${position} ${sid}`, position, team: extra.team ?? "KC",
  projected_points, ...extra,
});

/** Un índice semanal con lo justo: dos QB, tres RB, tres WR, dos TE, K, dos DEF. */
function indexBasico() {
  const rankings = [
    w("qb1", "QB", 20.1), w("qb2", "QB", 17.4),
    w("rb1", "RB", 15.2), w("rb2", "RB", 11.0), w("rb3", "RB", 12.6),
    w("wr1", "WR", 14.8), w("wr2", "WR", 9.1), w("wr3", "WR", 13.4),
    w("te1", "TE", 8.3), w("te2", "TE", 7.9),
  ];
  const kickers = [w("k1", "K", 8.0)];
  const defenses = [{ team: "LA", opponent_implied: 20 }, { team: "SF", opponent_implied: 24 }];
  return fullWeeklyIndex({ rankings, kickers, defenses });
}

test("starterSlots quita el banquillo y conserva el ORDEN de Sleeper", () => {
  assert.deepEqual(starterSlots(ROSTER), ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"]);
  assert.deepEqual(starterSlots(["BN", "IR", "TAXI"]), []);
});

test("la defensa entra por el código de Sleeper y por el de nflverse, sin proyección", () => {
  const idx = indexBasico();
  assert.equal(idx.get("LAR").position, "DEF", "LAR (Sleeper) tiene que resolver");
  assert.equal(idx.get("LA").position, "DEF", "LA (nflverse) también");
  assert.equal(idx.get("LAR").projected_points, null, "una defensa no proyecta: no hay modelo");
  assert.equal(idx.get("SF").team, "SF");
});

test("una fila de TEMPORADA (239 puntos) no puede entrar en el pool semanal", () => {
  // El fallo del analizador: el board de resto de temporada como respaldo.
  const idx = indexBasico();
  const boardRow = { sid: "qbros", position: "QB", projected_points: 239.3, player_name: "J.Daniels" };
  // Si alguien vuelve a fundir el board en el índice, este id existiría.
  assert.equal(idx.get("qbros"), undefined);
  const best = bestLineup({ players: ["qb1", "qbros", "rb1", "rb2", "wr1", "wr2", "te1", "LAR", "k1"],
                            rosterPositions: ROSTER, index: idx });
  assert.equal(best.rows[0].sid, "qb1", "el QB titular es el de la proyección SEMANAL");
  assert.ok(best.excluded.some((e) => e.sid === "qbros" && e.reason === EXCLUDED.NO_PROJECTION),
            "quien no tiene fila semanal queda fuera y se dice por qué");
  assert.ok(best.points < 120, `la suma es de escala semanal, no ${best.points}`);
  void boardRow;
});

test("OUT, IR/taxi y bye NO se proponen como titulares, cada uno con su motivo", () => {
  const idx = indexBasico();
  idx.set("rbout", w("rbout", "RB", 19.9, { status_severity: "OUT", status_label: "IR" }));
  idx.set("wrbye", w("wrbye", "WR", 18.0, { team: "SF" }));
  const best = bestLineup({
    players: ["qb1", "rb1", "rb2", "rb3", "rbout", "wr1", "wr2", "wr3", "wrbye", "te1", "SF", "k1", "rbir"],
    reserve: ["rbir"], rosterPositions: ROSTER, index: idx,
    byes: { SF: 7 }, week: 7,
  });
  const titulares = new Set(best.rows.map((r) => r.sid));
  assert.ok(!titulares.has("rbout"), "un OUT no puede ser titular aunque proyecte más");
  assert.ok(!titulares.has("wrbye"), "un jugador en bye no puede ser titular");
  assert.ok(!titulares.has("rbir"), "un jugador en IR de Sleeper no puede alinearse");
  const motivo = (sid) => best.excluded.find((e) => e.sid === sid)?.reason;
  assert.equal(motivo("rbout"), EXCLUDED.OUT);
  assert.equal(motivo("wrbye"), EXCLUDED.BYE);
  assert.equal(motivo("rbir"), EXCLUDED.RESERVE);
  // Y el mejor legal ocupa el hueco: RB1 y RB3 (12,6) por delante de RB2 (11,0).
  assert.deepEqual(best.rows.slice(1, 3).map((r) => r.sid), ["rb1", "rb3"]);
});

test("un OUT en DISPUTA (registro oficial lo contradice) sigue siendo elegible", () => {
  const idx = indexBasico();
  idx.set("rbd", w("rbd", "RB", 19.9, { status_severity: "OUT", status_disputed: true }));
  const best = bestLineup({ players: ["rbd", "rb1", "rb2"], rosterPositions: ["RB", "RB", "BN"], index: idx });
  assert.equal(best.rows[0].sid, "rbd");
});

test("la defensa OCUPA su hueco, no suma y no roba un FLEX", () => {
  const idx = indexBasico();
  const best = bestLineup({ players: ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2", "wr3", "te1", "SF", "k1"],
                            rosterPositions: ROSTER, index: idx });
  const def = best.rows.find((r) => r.slot === "DEF");
  assert.equal(def.sid, "SF", "la defensa está en su hueco, no «empty»");
  assert.equal(def.points, null);
  assert.equal(best.unknown, 1, "se cuenta como sin proyección, no como cero");
  const flex = best.rows.find((r) => r.slot === "FLEX");
  assert.ok(["rb3", "wr3", "rb2", "wr2"].includes(flex.sid), `el FLEX es de un jugador, no ${flex.sid}`);
  // Suma exacta: 20.1 + 15.2 + 12.6 + 14.8 + 13.4 + 8.3 + FLEX(11.0) + K 8.0
  assert.equal(best.points, 103.4);
});

test("la alineación ACTUAL se lee en el orden de Sleeper, hueco a hueco", () => {
  const idx = indexBasico();
  const cur = currentLineup({
    starters: ["qb2", "rb2", "rb1", "wr2", "wr1", "te2", "wr3", "SF", "0"],
    rosterPositions: ROSTER, index: idx,
  });
  assert.deepEqual(cur.rows.map((r) => r.sid), ["qb2", "rb2", "rb1", "wr2", "wr1", "te2", "wr3", "SF", null]);
  assert.equal(cur.rows[8].empty, true, "un «0» de Sleeper es un hueco VACÍO, no un jugador");
  assert.equal(cur.unknown, 1, "la defensa no suma: es alguien PUESTO sin proyección");
  assert.equal(cur.empty, 1, "el hueco vacío se cuenta aparte, no como «sin proyección»");
  assert.equal(cur.points, 88.8, "17.4+11.0+15.2+9.1+14.8+7.9+13.4");
});

test("los cambios son por hueco con su diferencia, y null sin proyección", () => {
  const idx = indexBasico();
  const league = {
    config: { roster: ROSTER },
    players: ["qb1", "qb2", "rb1", "rb2", "rb3", "wr1", "wr2", "wr3", "te1", "te2", "SF", "LAR", "k1"],
    starters: ["qb2", "rb1", "rb2", "wr1", "wr2", "te1", "wr3", "LAR", "k1"],
  };
  const out = leagueStartSit({ league, index: idx });
  assert.ok(out.swaps.length >= 3, "hay cambios: QB, RB2->RB3 o FLEX, WR2");
  const qb = out.swaps.find((s) => s.slot === "QB");
  assert.equal(qb.out.sid, "qb2");
  assert.equal(qb.in.sid, "qb1");
  assert.equal(qb.delta, 2.7, "20.1 − 17.4");
  // La defensa: LAR puesta, SF propuesta (misma proyección: ninguna). Sin
  // proyección no hay resta: delta null, no cero.
  const def = out.swaps.find((s) => s.slot === "DEF");
  if (def) assert.equal(def.delta, null);
  assert.equal(out.gain, 6.2, "103.4 − 97.2 en escala semanal");
  assert.equal(out.unchanged, false);
});

test("con la alineación ya óptima se dice que no hay cambios en vez de inventar uno", () => {
  const idx = indexBasico();
  const league = {
    config: { roster: ["QB", "RB", "WR", "BN"] },
    players: ["qb1", "qb2", "rb1", "wr1"],
    starters: ["qb1", "rb1", "wr1"],
  };
  const out = leagueStartSit({ league, index: idx });
  assert.equal(out.unchanged, true);
  assert.deepEqual(out.swaps, []);
});

test("sin titulares publicados no se propone un cambio sobre una alineación inventada", () => {
  const idx = indexBasico();
  const out = leagueStartSit({ league: { config: { roster: ROSTER }, players: ["qb1"], starters: null }, index: idx });
  assert.equal(out.current, null);
  assert.deepEqual(out.swaps, []);
  assert.equal(out.gain, null);
});

test("sin huecos declarados no hay alineación: null, no una estándar", () => {
  assert.equal(leagueStartSit({ league: { config: { roster: null }, players: ["qb1"] }, index: indexBasico() }), null);
});

test("las decisiones apretadas: el mejor suplente que cabe en cada hueco y cuánto le falta", () => {
  const idx = indexBasico();
  const best = bestLineup({ players: ["qb1", "qb2", "rb1", "rb2", "rb3", "wr1", "wr2", "wr3", "te1", "te2"],
                            rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"], index: idx });
  const calls = closestCalls(best);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c, i) => i === 0 || c.gap >= calls[i - 1].gap), "ordenadas de más apretada a menos");
  const te = calls.find((c) => c.slot === "TE");
  assert.equal(te.bench.sid, "te2");
  assert.equal(te.gap, 0.4, "8.3 − 7.9");
  // Un QB suplente sólo puede sustituir al QB: nunca aparece como alternativa de un WR.
  for (const c of calls) if (c.slot === "WR") assert.notEqual(c.bench.position, "QB");
});

test("los avisos nombran al titular OUT, en bye, vacío o sin proyección", () => {
  const idx = indexBasico();
  idx.set("rbout", w("rbout", "RB", 19.9, { status_severity: "OUT", status_label: "SUSPENDED" }));
  idx.set("wrbye", w("wrbye", "WR", 18.0, { team: "SF" }));
  const league = {
    config: { roster: ["QB", "RB", "WR", "WR", "BN"] },
    players: ["qb1", "rbout", "rb1", "wrbye", "wr1", "wr2", "desconocido"],
    starters: ["qb1", "rbout", "wrbye", "desconocido"],
  };
  const out = leagueStartSit({ league, index: idx, byes: { SF: 7 }, week: 7 });
  const kinds = out.warnings.map((x) => `${x.kind}@${x.slot}`);
  assert.ok(kinds.includes("OUT@RB"), kinds.join(" "));
  assert.ok(kinds.includes("BYE@WR"), kinds.join(" "));
  assert.ok(kinds.some((k) => k.startsWith("NO_PROJECTION@WR") || k.startsWith("UNKNOWN_ID@WR")), kinds.join(" "));
});

test("la autoridad de un cambio sale del registro y no de la posición a mano", () => {
  const statusOf = (id) => ({ START_SIT_QB: "NOT_READY", START_SIT_RB: "VALIDATED",
                              KICKER_ORDINAL_RANKING: "REJECTED" })[id] ?? null;
  assert.deepEqual(swapAuthority("QB", statusOf), { id: "START_SIT_QB", status: "NOT_READY" });
  assert.deepEqual(swapAuthority("RB", statusOf), { id: "START_SIT_RB", status: "VALIDATED" });
  assert.deepEqual(swapAuthority("K", statusOf), { id: "KICKER_ORDINAL_RANKING", status: "REJECTED" });
  assert.equal(swapAuthority("WR", statusOf).status, null, "sin estado declarado, null: no se afirma");
  assert.equal(swapAuthority("XX", statusOf), null);
  assert.equal(slotSwaps(null, null).length, 0);
});
