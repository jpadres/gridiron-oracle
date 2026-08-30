/**
 * E17 — un solo estado canónico de draft.
 *
 * Lo que se comprueba no es que las dos pantallas «se sincronicen»: es que **no
 * hay dos estados** que sincronizar. Board y Draft Room derivan su ámbito de la
 * misma función, migran por la misma función y pliegan por la misma función, así
 * que un pick es un resultado y no dos.
 *
 * Los escenarios están fijados en `docs/PREREGISTRO_convergencia.md`, escritos
 * antes de tocar el código.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ROSTER, SOURCE, fold, providerEvents, takeEvent, undoEvent,
} from "../app/fantasy/draftLog.js";
import {
  LEGACY_KEY, loadLog, loadOrMigrateLog, logScopeFor, migrateLegacy, saveLog, saveScope,
  scopeFor,
} from "../app/fantasy/draftStorage.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

const A = { season: 2026, leagueId: "111", draftId: "d111" };
const B = { season: 2026, leagueId: "222", draftId: "d222" };
const T0 = 1_800_000_000_000;

/* --- 1-4: el mismo estado, vengan de donde vengan los eventos ------------- */

test("E17.1 — un TAKE del board y otro del Room caen en el mismo estado", () => {
  // El board declara el dueño; el Room lo deriva del turno. Formas distintas de
  // producir el evento, un único fold.
  const desdeBoard = takeEvent({
    playerId: "a", roster: ROSTER.OPPONENT, rosterSource: "DECLARED", at: T0,
  });
  const desdeRoom = takeEvent({
    playerId: "b", roster: ROSTER.MINE, rosterSource: "DERIVED", at: T0 + 5,
  });
  const state = fold([desdeBoard, desdeRoom]);
  assert.equal(state.count, 2);
  assert.deepEqual(state.picks.map((p) => p.overall), [1, 2]);
  assert.deepEqual([...state.mine], ["b"]);
});

test("E17.2 — deshacer desde una pantalla libera un pick registrado en la otra", () => {
  const events = [
    takeEvent({ playerId: "a", roster: ROSTER.MINE, at: T0 }),
    takeEvent({ playerId: "b", roster: ROSTER.OPPONENT, at: T0 + 1 }),
    undoEvent({ playerId: "a", at: T0 + 2 }),
  ];
  const state = fold(events);
  assert.equal(state.byPlayer.has("a"), false);
  assert.equal(state.count, 1);
  // Y lo que venía detrás se renumera solo: el recuento no se queda con un hueco.
  assert.equal(state.picks[0].overall, 1);
});

test("E17.3 — un UNDO manual aguanta aunque el proveedor reenvíe su lista entera", () => {
  // Éste es el fallo de los quince segundos: con `{gone, mine}` el sondeo volvía
  // a meter al jugador en el conjunto y deshacer no servía de nada.
  const picks = [
    { playerId: "a", roster: ROSTER.OPPONENT, pickNo: 1 },
    { playerId: "b", roster: ROSTER.OPPONENT, pickNo: 2 },
  ];
  const persistido = [undoEvent({ playerId: "a", at: T0 })];

  const primera = fold([...persistido, ...providerEvents(picks)]);
  assert.equal(primera.byPlayer.has("a"), false, "deshecho tras el primer sondeo");

  // Segundo sondeo, misma lista, eventos nuevos: sigue deshecho.
  const segunda = fold([...persistido, ...providerEvents(picks)]);
  assert.equal(segunda.byPlayer.has("a"), false, "sigue deshecho tras reenviar");
  assert.equal(segunda.byPlayer.has("b"), true, "y el resto de la lista sí entra");
});

test("E17.4 — un TAKE manual corrige el dueño de un pick del proveedor sin moverlo", () => {
  const provider = providerEvents([
    { playerId: "a", roster: ROSTER.OPPONENT, pickNo: 1 },
    { playerId: "b", roster: ROSTER.OPPONENT, pickNo: 2 },
  ]);
  const correccion = takeEvent({
    playerId: "a", roster: ROSTER.MINE, rosterSource: "DECLARED",
    source: SOURCE.MANUAL, at: T0,
  });
  const state = fold([...provider, correccion]);

  assert.deepEqual([...state.mine], ["a"], "el dueño se corrige");
  assert.equal(state.count, 2, "y no se duplica");
  assert.deepEqual(
    state.picks.map((p) => p.playerId), ["a", "b"],
    "el pick no se va al final del draft por una corrección de atribución"
  );
});

test("E17.10 — un jugador en el proveedor y a mano cuenta una sola vez", () => {
  const manual = takeEvent({ playerId: "a", roster: ROSTER.MINE, at: T0 });
  const provider = providerEvents([{ playerId: "a", roster: ROSTER.OPPONENT, pickNo: 1 }]);
  assert.equal(fold([manual, ...provider]).count, 1);
});

/* --- 5-9: la migración y el aislamiento ---------------------------------- */

test("E17.5 — migrar marcas al registro es idempotente y borra la clave vieja", () => {
  const marcas = scopeFor(A);
  const log = logScopeFor(A);
  const storage = fakeStorage();
  saveScope(marcas, { gone: ["g1", "g2"], mine: ["m1"] }, storage);

  const primera = loadOrMigrateLog(log, storage);
  assert.equal(primera.length, 3);
  assert.equal(storage.getItem(marcas), null, "la clave v2 desaparece al migrar");

  const segunda = loadOrMigrateLog(log, storage);
  assert.deepEqual(segunda, primera, "la segunda pasada no duplica nada");

  // Y el reinicio reinicia de verdad: sin borrar la clave vieja, vaciar el
  // registro habría hecho volver las tres marcas en la siguiente carga.
  saveLog(log, [], storage);
  assert.deepEqual(loadOrMigrateLog(log, storage), []);
});

test("E17.6 — la migración conserva la distinción y dice lo que no sabe", () => {
  const storage = fakeStorage();
  saveScope(scopeFor(A), { gone: ["g1"], mine: ["m1"] }, storage);
  const events = loadOrMigrateLog(logScopeFor(A), storage);

  const porJugador = Object.fromEntries(events.map((e) => [e.playerId, e]));
  assert.equal(porJugador.m1.roster, "MINE");
  assert.equal(porJugador.g1.roster, "OPPONENT");
  for (const event of events) {
    assert.equal(event.rosterSource, "MIGRATED", "se dice que viene de la forma vieja");
    assert.equal(event.overall, null, "no se inventa un número de pick que nadie guardó");
  }
});

test("E17.7 — el estado v1 sigue sin poder aterrizar en el registro de una liga", () => {
  // La regla que no se toca: propiedad desconocida antes que propiedad
  // plausible pero equivocada. El blob v1 no trae `draft_id`.
  const storage = fakeStorage({
    [LEGACY_KEY]: JSON.stringify({
      gone: ["v1a", "v1b"], mine: ["v1m"], league: "111", userId: "u1",
    }),
  });
  migrateLegacy(storage, 2026);

  assert.deepEqual(loadOrMigrateLog(logScopeFor(A), storage), [],
    "la liga 111 NO hereda nada, aunque el blob la nombre");

  const local = loadOrMigrateLog(logScopeFor({ platform: "local", season: 2026 }), storage);
  assert.equal(local.length, 3, "va entero al ámbito local");
});

test("E17.8 — dos ligas tienen registros distintos y no se leen entre sí", () => {
  const storage = fakeStorage();
  saveLog(logScopeFor(A), [takeEvent({ playerId: "a", at: T0 })], storage);

  assert.notEqual(logScopeFor(A), logScopeFor(B));
  assert.deepEqual(loadOrMigrateLog(logScopeFor(B), storage), []);
  assert.equal(fold(loadOrMigrateLog(logScopeFor(A), storage)).count, 1);
});

test("E17.9 — identidad incompleta: sin clave y sin persistir", () => {
  const storage = fakeStorage();
  for (const rota of [
    { season: 2026, leagueId: "111" },            // sin draft
    { season: 2026, draftId: "d111" },            // sin liga
    { leagueId: "111", draftId: "d111" },         // sin temporada
  ]) {
    assert.equal(logScopeFor(rota), null);
  }
  assert.equal(saveLog(null, [takeEvent({ playerId: "a" })], storage), false);
  assert.deepEqual(storage.keys(), [], "no se ha escrito ni una clave");
  assert.deepEqual(loadLog(null, storage), []);
});
