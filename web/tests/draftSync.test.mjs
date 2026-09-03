/**
 * Frescura y contexto del draft. Cada test reproduce una forma concreta de
 * decir «LIVE» sobre algo que no lo está.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CURRENT_MS,
  DRAFT_STATUS,
  LIVE_MS,
  RECENT_MS,
  agoLabel,
  clockLabel,
  reconciliation,
  freshness,
  mySlot,
  pickClock,
  pickSchedule,
  picksUntilMe,
  syncState,
} from "../app/fantasy/draftSync.js";

const NOW = 1_800_000_000_000;
const drafting = { connected: true, draftStatus: DRAFT_STATUS.DRAFTING, now: NOW };

// --- frescura ---------------------------------------------------------------

test("sin ningún sondeo correcto la frescura es UNKNOWN", () => {
  assert.equal(freshness(null, NOW), "UNKNOWN");
});

test("un sondeo con éxito envejece: no se queda LIVE para siempre", () => {
  assert.equal(freshness(NOW - 5_000, NOW), "LIVE");
  assert.equal(freshness(NOW - 60_000, NOW), "CURRENT");
  assert.equal(freshness(NOW - 300_000, NOW), "RECENT");
  assert.equal(freshness(NOW - 900_000, NOW), "STALE");
});

test("un `at` en el futuro no es fresquísimo", () => {
  // La comparación ingenua daría edad negativa y por tanto LIVE. Significa
  // reloj mal puesto, no que acabe de pasar.
  assert.equal(freshness(NOW + 60_000, NOW), "UNKNOWN");
});

test("la etiqueta observa, no promete", () => {
  assert.equal(agoLabel(NOW - 8_000, NOW), "8s ago");
  assert.equal(agoLabel(NOW - 240_000, NOW), "4 min ago");
  assert.equal(agoLabel(null, NOW), "never");
});

// --- LIVE exige las tres condiciones ---------------------------------------

test("LIVE sólo con sondeo reciente Y draft en curso", () => {
  const state = syncState({ ...drafting, lastSyncAt: NOW - 5_000 });
  assert.equal(state.level, "LIVE");
  assert.equal(state.detail, "Synced 5s ago");
});

test("la pestaña al fondo envejece a un estado que lo dice", () => {
  // El caso real: el navegador estrangula el intervalo y deja de sondear.
  const state = syncState({ ...drafting, lastSyncAt: NOW - 300_000 });
  assert.notEqual(state.level, "LIVE");
  assert.match(state.label, /Last sync/);
});

test("un estado viejo prohíbe recomendar un pick", () => {
  const state = syncState({ ...drafting, lastSyncAt: NOW - 900_000 });
  assert.equal(state.level, "STALE");
  assert.equal(state.canRecommend, false);
  assert.match(state.detail, /Refresh before picking/);
});

test("un draft terminado NO se sondea como si estuviera vivo", () => {
  const state = syncState({
    connected: true, draftStatus: DRAFT_STATUS.COMPLETE, lastSyncAt: NOW - 1_000, now: NOW,
  });
  assert.equal(state.level, "COMPLETE");
  assert.equal(state.canRecommend, false);
});

test("un draft sin empezar se dice, no se pinta como vacío", () => {
  const state = syncState({
    connected: true, draftStatus: DRAFT_STATUS.PRE, lastSyncAt: NOW - 1_000, now: NOW,
  });
  assert.equal(state.level, "PRE");
});

test("estado desconocido de Sleeper no se convierte en LIVE", () => {
  const state = syncState({
    connected: true, draftStatus: undefined, lastSyncAt: NOW - 1_000, now: NOW,
  });
  assert.notEqual(state.level, "LIVE");
});

test("un sondeo con éxito y luego ninguno acaba en STALE", () => {
  let state = syncState({ ...drafting, lastSyncAt: NOW - 1_000 });
  assert.equal(state.level, "LIVE");
  state = syncState({ ...drafting, lastSyncAt: NOW - 1_000, now: NOW + RECENT_MS + 1_000 });
  assert.equal(state.level, "STALE");
});

test("un error de sondeo no borra el tablero manual", () => {
  const state = syncState({ connected: true, error: "network", now: NOW });
  assert.equal(state.level, "ERROR");
  assert.equal(state.canRecommend, true);
});

test("sin conectar no se habla de sincronización", () => {
  assert.equal(syncState({ connected: false, now: NOW }).level, "OFFLINE");
});

test("conectado pero sin ningún sondeo correcto: no verificado", () => {
  const state = syncState({ ...drafting, lastSyncAt: null });
  assert.equal(state.level, "UNKNOWN");
  assert.equal(state.canRecommend, false);
});

test("las ventanas coinciden con Domain.DRAFT_STATE de freshness.py", () => {
  // Duplicadas a propósito —el navegador no importa Python— y por eso se
  // comprueban: si allí se cambian y aquí no, la interfaz miente.
  assert.equal(LIVE_MS, 30_000);
  assert.equal(CURRENT_MS, 120_000);
  assert.equal(RECENT_MS, 600_000);
});

// --- puesto de draft --------------------------------------------------------

test("el puesto sale de draft_order", () => {
  const draft = { draft_order: { u1: 8, u2: 3 } };
  assert.equal(mySlot({ draft, userId: "u1" }), 8);
});

test("el puesto sale de slot_to_roster_id cuando se conoce el roster", () => {
  const draft = { slot_to_roster_id: { 1: 4, 2: 7, 3: 9 } };
  assert.equal(mySlot({ draft, rosterId: 7 }), 2);
});

test("puesto desconocido devuelve null, no 1", () => {
  // Un puesto inventado produce un calendario de picks inventado.
  assert.equal(mySlot({ draft: {}, userId: "u1" }), null);
  assert.equal(mySlot({ draft: null }), null);
  assert.equal(mySlot({ draft: { draft_order: { otro: 5 } }, userId: "u1" }), null);
});

// --- calendario de picks ----------------------------------------------------

test("snake invierte en las rondas pares", () => {
  const picks = pickSchedule({ slot: 8, teams: 12, rounds: 4, type: "snake" });
  assert.deepEqual(picks.map((p) => p.label), ["1.08", "2.05", "3.08", "4.05"]);
  assert.deepEqual(picks.map((p) => p.overall), [8, 17, 32, 41]);
});

test("linear no invierte, y por eso el tipo se lee en vez de suponerse", () => {
  const picks = pickSchedule({ slot: 8, teams: 12, rounds: 4, type: "linear" });
  assert.deepEqual(picks.map((p) => p.label), ["1.08", "2.08", "3.08", "4.08"]);
});

test("una subasta no tiene turno: lista vacía, no un número", () => {
  assert.deepEqual(pickSchedule({ slot: 8, teams: 12, rounds: 4, type: "auction" }), []);
});

test("sin puesto, tamaño o rondas no hay calendario", () => {
  assert.deepEqual(pickSchedule({ teams: 12, rounds: 15, type: "snake" }), []);
  assert.deepEqual(pickSchedule({ slot: 8, rounds: 15, type: "snake" }), []);
  assert.deepEqual(pickSchedule({ slot: 8, teams: 12, type: "snake" }), []);
});

test("picks hasta mi turno se cuenta sobre los picks reales hechos", () => {
  const schedule = pickSchedule({ slot: 8, teams: 12, rounds: 4, type: "snake" });
  assert.deepEqual(picksUntilMe({ schedule, picksMade: 5 }), { ...schedule[0], away: 2 });
  assert.equal(picksUntilMe({ schedule, picksMade: 41 }), null);
});

test("sin calendario no se inventa una cuenta atrás", () => {
  assert.equal(picksUntilMe({ schedule: [], picksMade: 5 }), null);
  assert.equal(picksUntilMe({ schedule: [{ overall: 8 }], picksMade: null }), null);
});

// --- el reloj del pick ---------------------------------------------------

test("el reloj se deriva de last_picked y pick_timer, y nunca baja de cero", () => {
  const draft = { last_picked: NOW - 47_000, settings: { pick_timer: 90 } };
  assert.deepEqual(pickClock({ draft, now: NOW }), { remaining: 43, total: 90, expired: false });
  assert.deepEqual(pickClock({ draft, now: NOW + 100_000 }), { remaining: 0, total: 90, expired: true });
});

test("sin last_picked o sin pick_timer no hay reloj: null, no 90", () => {
  assert.equal(pickClock({ draft: { settings: { pick_timer: 90 } }, now: NOW }), null);
  assert.equal(pickClock({ draft: { last_picked: NOW }, now: NOW }), null);
  assert.equal(pickClock({ draft: null, now: NOW }), null);
});

test("un last_picked en el futuro (reloj adelantado) da el tiempo completo, no negativo", () => {
  const draft = { last_picked: NOW + 5_000, settings: { pick_timer: 60 } };
  assert.equal(pickClock({ draft, now: NOW }).remaining, 60);
});

test("la etiqueta del reloj es m:ss", () => {
  assert.equal(clockLabel(43), "0:43");
  assert.equal(clockLabel(125), "2:05");
  assert.equal(clockLabel(-3), "0:00");
});

/* ── LEÍDOS ≠ APLICADOS ──────────────────────────────────────────────────
   El fallo del draft real: Sleeper contestaba, la pantalla decía «N picks
   read» y el tablero no tachaba nada. Cada test de aquí falla si se vuelve a
   publicar el número de leídos sin restarle los aplicados. */
test("sin picks leídos no hay nada que decir", () => {
  assert.equal(reconciliation({ total: 0, applied: 0, unmapped: 0 }), null);
  assert.equal(reconciliation({}), null);
});

test("leídos con CERO aplicados es un fallo, y se nombra", () => {
  const r = reconciliation({ total: 47, applied: 0, unmapped: 47 });
  assert.equal(r.level, "NONE");
  assert.match(r.label, /47 picks read · 0 applied/);
  assert.match(r.detail, /nothing was crossed off/);
});

test("aplicados a medias: se dicen los dos números", () => {
  const r = reconciliation({ total: 20, applied: 18, unmapped: 2 });
  assert.equal(r.level, "PARTIAL");
  assert.match(r.label, /18 of 20 picks applied · 2 unmatched/);
});

test("todo aplicado no arma ruido", () => {
  const r = reconciliation({ total: 20, applied: 20, unmapped: 0 });
  assert.equal(r.level, "OK");
  assert.equal(r.detail, null);
  assert.match(r.label, /20 picks applied/);
});

test("un solo pick se dice en singular", () => {
  assert.match(reconciliation({ total: 1, applied: 1 }).label, /1 pick applied/);
});
