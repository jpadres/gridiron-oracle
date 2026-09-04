/**
 * El modelo de atención: hechos, orden determinista y cero consejo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attentionItems, labelFor, leagueSnapshot, sortAttention, sortLeagues,
} from "../app/fantasy/attention.js";
import { ROSTER, providerEvents, takeEvent } from "../app/fantasy/draftLog.js";
import { PROVIDER_CAPABILITIES, can } from "../app/fantasy/providers.js";

function storageWith(logs) {
  const map = new Map(Object.entries(logs));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

const T0 = 1_800_000_000_000;
const log = (n, mineEvery = 4) => JSON.stringify(
  Array.from({ length: n }, (_, i) => takeEvent({
    playerId: `p${i}`, at: T0 + i,
    roster: i % mineEvery === 0 ? ROSTER.MINE : ROSTER.OPPONENT,
  }))
);
const BOARD = Array.from({ length: 60 }, (_, i) => ({
  player_id: `p${i}`, player_name: `J${i}`,
  position: ["QB", "RB", "WR", "TE"][i % 4], team: ["BUF", "KC", "MIA"][i % 3], vor: 60 - i,
}));
const entry = (scope, config, hasLog = true) => ({
  scope, identity: { platform: "manual", season: 2026,
    leagueId: scope.split(":")[3], draftId: scope.split(":")[4] }, config, hasLog,
});
const CFG = (over = {}) => ({ name: "Liga", platform: "manual", season: 2026,
  leagueId: "L1", draftId: "D1", teams: 4, rounds: 6, draftType: "snake", mySlot: 1,
  roster: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"], ...over });

test("en el reloj: el hecho más fuerte, con su destino", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(8) });
  // 8 picks, teams=4 snake, slot 1: el pick 9 (ronda 3, casilla 1) es mío.
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  assert.equal(snap.onClock, true);
  const items = attentionItems(snap);
  assert.equal(items[0].type, "ON_THE_CLOCK");
  assert.equal(items[0].action, "Open draft");
});

test("faltan N picks: activo, con N y la casilla", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(9) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  assert.equal(snap.onClock, false);
  const item = attentionItems(snap).find((i) => i.type === "PICKS_UNTIL_ME");
  assert.ok(item && item.away >= 1);
  assert.match(item.detail, /you're up at \d+\.\d+/);
});

test("draft completo: ni activo ni en la cola", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(24) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  assert.equal(snap.complete, true);
  assert.equal(snap.active, false);
  assert.deepEqual(attentionItems(snap).filter((i) => i.category === "ACTIVE"), []);
});

test("sin tamaño ni rondas, `complete` es null: no se afirma", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(24) });
  const snap = leagueSnapshot(
    entry("gridiron-draft-v2:manual:2026:L1:D1", CFG({ teams: null, rounds: null })),
    { storage, board: BOARD });
  assert.equal(snap.complete, null);
  assert.equal(snap.active, true, "con picks y sin totales, sigue siendo un draft con picks");
});

test("huecos abiertos: sólo con draft ACTIVO, y como conteo", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(8) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  const item = attentionItems(snap).find((i) => i.type === "OPEN_STARTER_SLOTS");
  assert.ok(item, "draft activo con huecos: aparece");
  assert.match(item.message, /^\d+ starter slots? open$/);

  const done = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1",
    CFG({ teams: 2, rounds: 4 })), { storage, board: BOARD });
  assert.equal(done.complete, true);
  assert.equal(attentionItems(done).find((i) => i.type === "OPEN_STARTER_SLOTS"), undefined,
    "draft acabado: los huecos son un dato de la fila, no un aviso");
});

test("estructura desconocida se dice; y UNKNOWN no es cero", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(3) });
  const snap = leagueSnapshot(
    entry("gridiron-draft-v2:manual:2026:L1:D1", CFG({ roster: null })), { storage, board: BOARD });
  assert.equal(snap.openStarters, null, "sin estructura no hay conteo, ni cero");
  assert.ok(attentionItems(snap).some((i) => i.type === "ROSTER_CONFIG_UNKNOWN"));
});

test("una liga sólo-registro existe con configuración UNKNOWN y sin inventos", () => {
  const storage = storageWith({ "gridiron-draft-v2:sleeper:2026:999:888:log": log(5) });
  const snap = leagueSnapshot(
    { scope: "gridiron-draft-v2:sleeper:2026:999:888",
      identity: { platform: "sleeper", season: 2026, leagueId: "999", draftId: "888" },
      config: null, hasLog: true },
    { storage, board: BOARD });
  assert.equal(snap.name, null);
  assert.equal(snap.rosterKnown, false);
  assert.equal(snap.openStarters, null);
  assert.match(labelFor(snap), /sleeper league 999/);
  // Sin config no hay items de SETUP («configúrala» apunta a una liga que este
  // producto no configura) ni de reloj: sólo el hecho del draft con picks.
  const items = attentionItems(snap);
  assert.ok(items.every((i) => i.type === "DRAFT_ACTIVE"), JSON.stringify(items));
});

test("los descansos se agrupan como dato y JAMÁS entran en la cola", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(8) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()),
    { storage, board: BOARD, byes: { BUF: 7, KC: 10, MIA: 11 } });
  assert.ok(snap.byeGroups && Object.keys(snap.byeGroups).length > 0);
  assert.ok(attentionItems(snap).every((i) => !/bye/i.test(i.type) && !/bye/i.test(i.message)));
});

test("la ordenación es la documentada y sin pesos secretos", () => {
  const items = [
    { type: "ROSTER_CONFIG_UNKNOWN", league: "A", scope: "s1", away: Infinity },
    { type: "PICKS_UNTIL_ME", league: "B", scope: "s2", away: 5 },
    { type: "ON_THE_CLOCK", league: "C", scope: "s3", away: 0 },
    { type: "PICKS_UNTIL_ME", league: "A", scope: "s4", away: 2 },
    { type: "OPEN_STARTER_SLOTS", league: "Z", scope: "s5", away: Infinity },
  ];
  const sorted = sortAttention(items);
  assert.deepEqual(sorted.map((i) => i.type), [
    "ON_THE_CLOCK", "PICKS_UNTIL_ME", "PICKS_UNTIL_ME", "OPEN_STARTER_SLOTS", "ROSTER_CONFIG_UNKNOWN",
  ]);
  assert.equal(sorted[1].away, 2, "N ascendente entre iguales");
  // Determinista: dos pasadas, mismo orden.
  assert.deepEqual(sortAttention(items), sorted);
});

test("cero vocabulario de consejo en ningún mensaje posible", () => {
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": log(8) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG({ roster: null })),
    { storage, board: BOARD, byes: { BUF: 7 } });
  const text = JSON.stringify(attentionItems(snap));
  assert.ok(!/need|should|must|weak|risk|urgent|add player|optimi|improve|fix now/i.test(text), text);
});

test("el mapa de proveedores declara sólo soporte actual", () => {
  assert.equal(can("sleeper", "livePolling"), false, "BLOCKED es false, no true futuro");
  assert.equal(can("manual", "livePolling"), null, "no aplica no es lo mismo que bloqueado");
  assert.equal(can("manual", "draftState"), true);
  assert.equal(can("desconocido", "draftState"), null);
  for (const [name, caps] of Object.entries(PROVIDER_CAPABILITIES)) {
    for (const [cap, value] of Object.entries(caps)) {
      if (cap === "label") continue;
      assert.ok([true, false, "config", null].includes(value), `${name}.${cap}=${value}`);
    }
  }
});

test("sortLeagues: reloj, cercanía, activo, quietas, completadas — y estable", () => {
  const mk = (name, over) => ({ name, scope: `s-${name}`, identity: { platform: "manual" },
    onClock: null, next: null, active: false, complete: false, ...over });
  const list = [
    mk("Done", { complete: true }),
    mk("Quiet", {}),
    mk("Near", { active: true, next: { away: 2 } }),
    mk("Clock", { active: true, onClock: true }),
    mk("Far", { active: true, next: { away: 9 } }),
  ];
  assert.deepEqual(sortLeagues(list).map((s) => s.name), ["Clock", "Near", "Far", "Quiet", "Done"]);
});


/* ── un pick sin emparejar no atrasa el turno ────────────────────────────────
 *
 * Esta instantánea se arma SÓLO desde el almacenamiento —sirve a todas las
 * ligas a la vez y no tiene la respuesta del proveedor delante—, así que no
 * podía usar `sync.total` para saber por dónde va el draft. Sí tiene el NÚMERO
 * del último pick, y ésa es la señal: contando picks resueltos, un draft con un
 * hueco decía «te toca» dos turnos tarde y podía darse por terminado sin serlo.
 */

/** El registro de un draft del proveedor, saltándose los picks de `faltan`. */
const logProveedor = (hasta, faltan = []) => JSON.stringify(
  providerEvents(
    Array.from({ length: hasta }, (_, i) => i + 1)
      .filter((no) => !faltan.includes(no))
      .map((no) => ({
        playerId: `p${no - 1}`, pickNo: no, providerId: `s${no}`,
        roster: no % 4 === 1 ? ROSTER.MINE : ROSTER.OPPONENT,
      }))
  )
);

test("con un pick sin emparejar el turno se sitúa por el NÚMERO, no por el recuento", () => {
  /* Los números importan y se eligen a mano. Con 4 equipos en snake y el puesto
     1, mis picks son el 1, 8, 9, 16, 17… Van 15 picks con el 3 sin emparejar:
     14 resueltos. El siguiente es el 16, que es MÍO; contando resueltos creería
     ir por el 15 y el 16º sería el pick 15, que es del puesto 2.

     La primera versión de este test usaba 8 picks, y pasaba con el fallo puesto:
     el 8 y el 9 son los dos míos porque ahí está la vuelta del snake, así que no
     distinguía nada. Un guardián que no puede separar las dos respuestas no es
     un guardián — el mismo cuidado que el `conAjuste.length > 0`. */
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": logProveedor(15, [3]) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  assert.equal(snap.onClock, true, "contando resueltos creería que va por el 15, que es del puesto 2");
});

test("y un draft con huecos NO se da por terminado antes de tiempo", () => {
  // 4 x 6 = 24 picks. Llegan hasta el 24 con dos sin emparejar: 22 resueltos.
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": logProveedor(24, [5, 11]) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  assert.equal(snap.complete, true, "el pick 24 existe y es el último: el draft SÍ terminó");
});

test("a mitad de draft, «cuántos faltan para mí» cuenta desde el número real", () => {
  // Van 5 picks con el 3 perdido (4 resueltos). Mi siguiente turno es el 8.
  const storage = storageWith({ "gridiron-draft-v2:manual:2026:L1:D1:log": logProveedor(5, [3]) });
  const snap = leagueSnapshot(entry("gridiron-draft-v2:manual:2026:L1:D1", CFG()), { storage, board: BOARD });
  assert.equal(snap.onClock, false);
  assert.equal(snap.next.overall, 8, "el 6 y el 7 son de otros; el 8 vuelve a ser mío");
  assert.equal(snap.next.away, 2);
});
