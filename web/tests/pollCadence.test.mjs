// §35 — El sondeo retrocede cuando Sleeper falla.
//
// Un 429 es «más despacio». Hasta 2026-09-05 se contestaba con otra petición
// a los cuatro segundos en pleno draft. La regla es pura y vive en
// `draftSync.js`; el hook sólo la llama con el conteo de fallos consecutivos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DRAFT_STATUS, POLL_BACKOFF_MAX_MS, POLL_IDLE_MS, POLL_LIVE_MS, POLL_MS, nextCadence,
} from "../app/fantasy/draftSync.js";

test("sin fallos, la cadencia sigue al estado del draft", () => {
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING }), POLL_LIVE_MS);
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.PRE }), POLL_MS);
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.COMPLETE }), POLL_IDLE_MS);
  assert.equal(nextCadence({ draftStatus: undefined }), POLL_MS);
});

test("el primer fallo no cuesta nada; a partir del segundo se dobla", () => {
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING, failures: 1 }), POLL_LIVE_MS);
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING, failures: 2 }), POLL_LIVE_MS * 2);
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING, failures: 3 }), POLL_LIVE_MS * 4);
});

test("el retroceso es ESTRICTAMENTE creciente hasta el tope, y nunca lo pasa", () => {
  let previous = 0;
  for (let n = 1; n <= 12; n += 1) {
    const ms = nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING, failures: n });
    assert.ok(ms >= previous, `fallo ${n}: ${ms} < ${previous}`);
    assert.ok(ms <= POLL_BACKOFF_MAX_MS);
    previous = ms;
  }
  assert.equal(previous, POLL_BACKOFF_MAX_MS);
  // La inyección que lo cazó: sin retroceso, diez fallos seguidos siguen a 4 s.
  assert.ok(nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING, failures: 10 }) > POLL_LIVE_MS);
});

test("una respuesta buena vuelve a la cadencia del estado", () => {
  assert.equal(nextCadence({ draftStatus: DRAFT_STATUS.DRAFTING, failures: 0 }), POLL_LIVE_MS);
});

test("el hook cuenta fallos consecutivos y los pasa a nextCadence, y los pone a cero al acertar", () => {
  const src = readFileSync(new URL("../app/fantasy/useSleeperDraft.js", import.meta.url), "utf8");
  assert.match(src, /fallos \+= 1;\s*\n\s*cadencia\.current = nextCadence\(\{[^}]*failures: fallos/);
  assert.match(src, /fallos = 0;\s*\n\s*cadencia\.current = nextCadence\(\{[^}]*failures: 0/);
  // Y no queda ninguna cadencia calculada a mano fuera de la regla.
  assert.doesNotMatch(src, /cadencia\.current = draft\?\.status ===/);
});
