/**
 * Aislamiento entre ligas. El test que tenía que existir antes del código.
 *
 * El defecto que se corrige no fallaba: producía el estado equivocado en
 * silencio. Por eso lo que se comprueba aquí no es que el módulo «funcione»,
 * sino que **no se puede** meter el estado de una liga en otra.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEGACY_KEY,
  PREFS_KEY,
  loadPrefs,
  loadScope,
  migrateLegacy,
  saveScope,
  scopeFor,
} from "../app/fantasy/draftStorage.js";

/** `localStorage` de mentira, con la misma superficie que se usa de verdad. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
    keys: () => [...map.keys()],
  };
}

const A = { season: 2026, leagueId: "111", draftId: "aaa" };
const B = { season: 2026, leagueId: "222", draftId: "bbb" };

// --- identidad --------------------------------------------------------------

test("dos ligas distintas nunca comparten clave", () => {
  assert.notEqual(scopeFor(A), scopeFor(B));
});

test("dos drafts de la misma liga en temporadas distintas no colisionan", () => {
  const y2025 = scopeFor({ season: 2025, leagueId: "111", draftId: "aaa" });
  const y2026 = scopeFor({ season: 2026, leagueId: "111", draftId: "aaa" });
  assert.notEqual(y2025, y2026);
});

test("dos drafts de la misma liga y temporada no colisionan", () => {
  const uno = scopeFor({ season: 2026, leagueId: "111", draftId: "aaa" });
  const dos = scopeFor({ season: 2026, leagueId: "111", draftId: "ccc" });
  assert.notEqual(uno, dos);
});

test("una identidad incompleta no produce clave: falla seguro", () => {
  // Perder el estado al recargar es malo. Escribirlo en una clave compartida y
  // contaminar otra liga es peor, y además no se ve.
  assert.equal(scopeFor({ season: 2026, leagueId: "111" }), null);
  assert.equal(scopeFor({ season: 2026, draftId: "aaa" }), null);
  assert.equal(scopeFor({ leagueId: "111", draftId: "aaa" }), null);
  assert.equal(scopeFor({}), null);
});

test("sin clave no se escribe nada", () => {
  const storage = fakeStorage();
  assert.equal(saveScope(null, { gone: ["x"], mine: [] }, storage), false);
  assert.equal(storage.size, 0);
});

test("el tablero manual tiene su propio ámbito por temporada", () => {
  const local = scopeFor({ platform: "local", season: 2026 });
  assert.ok(local);
  assert.notEqual(local, scopeFor(A));
  assert.equal(scopeFor({ platform: "local" }), null);
});

// --- aislamiento ------------------------------------------------------------

test("un jugador cogido en la liga A sigue libre en la B", () => {
  const storage = fakeStorage();
  saveScope(scopeFor(A), { gone: ["00-0036322"], mine: [] }, storage);
  assert.deepEqual(loadScope(scopeFor(B), storage), { gone: [], mine: [] });
});

test("la plantilla de A no aparece en B", () => {
  const storage = fakeStorage();
  saveScope(scopeFor(A), { gone: [], mine: ["00-0034796"] }, storage);
  assert.deepEqual(loadScope(scopeFor(B), storage).mine, []);
});

test("A -> B -> A devuelve cada estado intacto", () => {
  const storage = fakeStorage();
  saveScope(scopeFor(A), { gone: ["g1"], mine: ["m1"] }, storage);
  saveScope(scopeFor(B), { gone: ["g2"], mine: ["m2"] }, storage);

  assert.deepEqual(loadScope(scopeFor(A), storage), { gone: ["g1"], mine: ["m1"] });
  assert.deepEqual(loadScope(scopeFor(B), storage), { gone: ["g2"], mine: ["m2"] });
  assert.deepEqual(loadScope(scopeFor(A), storage), { gone: ["g1"], mine: ["m1"] });
});

test("un draft terminado no se mezcla con el siguiente de la misma liga", () => {
  const storage = fakeStorage();
  const terminado = scopeFor({ season: 2026, leagueId: "111", draftId: "viejo" });
  const nuevo = scopeFor({ season: 2026, leagueId: "111", draftId: "nuevo" });
  saveScope(terminado, { gone: ["a", "b", "c"], mine: ["d"] }, storage);
  assert.deepEqual(loadScope(nuevo, storage), { gone: [], mine: [] });
  // Y el terminado sigue ahí: es historia, no se pisa.
  assert.equal(loadScope(terminado, storage).gone.length, 3);
});

test("escribir en veinte ligas no toca las otras diecinueve", () => {
  const storage = fakeStorage();
  const ligas = Array.from({ length: 20 }, (_, i) => ({
    season: 2026, leagueId: `L${i}`, draftId: `D${i}`,
  }));
  ligas.forEach((liga, i) => saveScope(scopeFor(liga), { gone: [`p${i}`], mine: [] }, storage));
  ligas.forEach((liga, i) => {
    assert.deepEqual(loadScope(scopeFor(liga), storage).gone, [`p${i}`]);
  });
});

// --- datos corruptos --------------------------------------------------------

test("un almacenamiento corrupto devuelve estado vacío, no revienta", () => {
  const storage = fakeStorage({ [scopeFor(A)]: "{no es json" });
  assert.deepEqual(loadScope(scopeFor(A), storage), { gone: [], mine: [] });
});

test("se filtra lo que no sea un id de texto", () => {
  const storage = fakeStorage({
    [scopeFor(A)]: JSON.stringify({ gone: ["ok", null, 7, "", "ok"], mine: "no es lista" }),
  });
  assert.deepEqual(loadScope(scopeFor(A), storage), { gone: ["ok"], mine: [] });
});

// --- migración desde la clave global v1 -------------------------------------

test("el estado global v1 NO se atribuye a ninguna liga", () => {
  // Es la prueba central de la migración. El blob v1 no trae `draft_id`, así que
  // no se puede saber a qué draft pertenecía. Meterlo en la liga que aparece en
  // el blob parecería más útil y sería la contaminación de siempre.
  const storage = fakeStorage({
    [LEGACY_KEY]: JSON.stringify({ gone: ["x", "y"], mine: ["z"], league: "111", userId: "u1" }),
  });
  migrateLegacy(storage, 2026);

  assert.deepEqual(loadScope(scopeFor({ season: 2026, leagueId: "111", draftId: "aaa" }), storage),
                   { gone: [], mine: [] });
  assert.deepEqual(loadScope(scopeFor(B), storage), { gone: [], mine: [] });
});

test("el estado global v1 aterriza en el tablero manual de la temporada", () => {
  const storage = fakeStorage({
    [LEGACY_KEY]: JSON.stringify({ gone: ["x", "y"], mine: ["z"] }),
  });
  const result = migrateLegacy(storage, 2026);
  assert.equal(result.migrated, true);
  assert.equal(result.moved, 3);
  assert.deepEqual(loadScope(scopeFor({ platform: "local", season: 2026 }), storage),
                   { gone: ["x", "y"], mine: ["z"] });
});

test("la liga del blob v1 se conserva como PREFERENCIA, no como estado", () => {
  const storage = fakeStorage({
    [LEGACY_KEY]: JSON.stringify({ gone: [], mine: [], league: "111", userId: "u1" }),
  });
  migrateLegacy(storage, 2026);
  assert.deepEqual(loadPrefs(storage), { league: "111", userId: "u1" });
  assert.ok(storage.keys().includes(PREFS_KEY));
});

test("la clave v1 se borra: si no, cada arranque volvería a migrar", () => {
  const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify({ gone: ["x"], mine: [] }) });
  migrateLegacy(storage, 2026);
  assert.equal(storage.getItem(LEGACY_KEY), null);
  const segunda = migrateLegacy(storage, 2026);
  assert.equal(segunda.migrated, false);
});

test("migrar dos veces no duplica ni pisa lo que ya había", () => {
  const storage = fakeStorage();
  const local = scopeFor({ platform: "local", season: 2026 });
  saveScope(local, { gone: ["ya-estaba"], mine: [] }, storage);
  storage.setItem(LEGACY_KEY, JSON.stringify({ gone: ["x", "ya-estaba"], mine: [] }));
  migrateLegacy(storage, 2026);
  assert.deepEqual(loadScope(local, storage).gone.sort(), ["x", "ya-estaba"]);
});

test("un v1 ilegible se descarta sin romper el arranque", () => {
  const storage = fakeStorage({ [LEGACY_KEY]: "{roto" });
  const result = migrateLegacy(storage, 2026);
  assert.equal(result.migrated, false);
  assert.equal(storage.getItem(LEGACY_KEY), null);
});
