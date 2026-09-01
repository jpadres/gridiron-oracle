/**
 * La lista corta: qué se recomienda y, sobre todo, qué NO.
 *
 * Los dos casos que esto vigila no fallan solos. Un agente libre y un jugador
 * apartado por la liga llegan al board con su número intacto —la proyección
 * salió de lo que produjeron cuando jugaban— así que encabezan la lista sin que
 * nada chirríe. La diferencia entre «lo mejor disponible» y «lo mejor
 * disponible que además va a jugar» es toda la utilidad del asistente en la
 * primera ronda.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { candidates } from "../app/fantasy/candidates.js";

const fila = (id, vor, extra = {}) => ({
  player_id: id, player_name: id, position: "RB", team: "GB", vor, tier: 1, ...extra,
});

test("el primero por VOR encabeza la lista", () => {
  const out = candidates([fila("a", 40), fila("b", 30)], { limit: 2 });
  assert.equal(out[0].row.player_id, "a");
  assert.ok(out[0].reasons.some((r) => r.kind === "TOP"));
});

test("un jugador APARTADO no se recomienda, aunque sea el de más VOR", () => {
  // El caso real: Josh Jacobs, puesto 38 del board, en la Lista de Exentos del
  // Comisionado sin fecha de vuelta y figurando ACT en Green Bay.
  const pool = [
    fila("exento", 40, { status_severity: "OUT", status_label: "EXEMPT LIST" }),
    fila("sano", 30),
  ];
  const out = candidates(pool, { limit: 4 });
  assert.equal(out.length, 1);
  assert.equal(out[0].row.player_id, "sano");
});

test("una DUDA sí se recomienda, marcada: no se decide por quien draftea", () => {
  const pool = [
    fila("duda", 40, { status_severity: "RISK", status_label: "PUP" }),
    fila("sano", 30),
  ];
  const out = candidates(pool, { limit: 4 });
  assert.equal(out.length, 2);
  assert.equal(out[0].row.player_id, "duda");
});

test("un agente libre tampoco encabeza la lista", () => {
  const out = candidates([fila("libre", 40, { rostered: false }), fila("sano", 30)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].row.player_id, "sano");
});

test("el conteo del tier se hace sobre el pool RECOMENDABLE, no sobre el board", () => {
  // Si los apartados contaran, «quedan 3 de este tier» incluiría a quien no
  // puede jugar — un número que se lee como abundancia y no lo es.
  const pool = [
    fila("sano", 30),
    fila("out1", 29, { status_severity: "OUT", status_label: "IR" }),
    fila("out2", 28, { status_severity: "OUT", status_label: "IR" }),
  ];
  const [primero] = candidates(pool, { limit: 1 });
  assert.equal(primero.sameTier, 1, "sólo queda uno de verdad");
});
