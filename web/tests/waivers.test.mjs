/**
 * WAIVERS: la resta, la pareja y las categorías.
 *
 * Los números de los fixtures se eligen a mano para que la respuesta correcta y
 * la incorrecta caigan en sitios distintos — la lección del test del turno,
 * donde «8 picks en una liga de 4» daba lo mismo con el fallo y sin él.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MOVE, faabRange, slotPicture, waiverMoves } from "../app/fantasy/waivers.js";

const HUECOS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN"];

const p = (id, position, pts, extra = {}) => ({
  player_id: id, player_name: id, position, projected_points: pts,
  vor: pts, team: "KC", ...extra,
});

// Mi plantilla: titulares puestos salvo el TE, y un banquillo flojo.
const MI_ROSTER = [
  p("qb1", "QB", 20), p("rb1", "RB", 16), p("rb2", "RB", 12),
  p("wr1", "WR", 15), p("wr2", "WR", 13), p("flex1", "WR", 10),
  p("banca1", "RB", 4), p("banca2", "WR", 3),
];

// El pool: hay reemplazo de cada posición para que `replacementPoints` tenga
// con qué, y un TE bueno que es el movimiento evidente.
const POOL = [
  p("te_bueno", "TE", 11), p("wr_medio", "WR", 9), p("rb_medio", "RB", 8),
  p("te_malo", "TE", 5), p("wr_malo", "WR", 5), p("rb_malo", "RB", 5),
  p("qb_malo", "QB", 9),
];

test("sin estructura de plantilla NO se calcula nada", () => {
  // Suponer «12 equipos PPR» es exactamente lo que se retiró (regla 6).
  assert.equal(waiverMoves({ available: POOL, roster: MI_ROSTER, rosterPositions: [] }), null);
  assert.equal(waiverMoves({ available: POOL, roster: MI_ROSTER }), null);
});

test("el hueco de TE vacío hace del TE un titular INMEDIATO", () => {
  const r = waiverMoves({ available: POOL, roster: MI_ROSTER, rosterPositions: HUECOS });
  assert.ok(r.emptyStarterSlots.includes("TE"), "el fixture tiene el TE sin cubrir");
  const mejor = r.moves[0];
  assert.equal(mejor.add.player_id, "te_bueno");
  assert.equal(mejor.category, MOVE.IMMEDIATE_STARTER);
  assert.ok(mejor.net > 0, "llenar un hueco vacío mejora la alineación");
  assert.ok(mejor.reasons.some((m) => m.code === "OPEN_STARTER_SLOT"));
});

test("cada movimiento trae su PAREJA y la alineación antes y después", () => {
  const r = waiverMoves({
    available: POOL, roster: MI_ROSTER, rosterPositions: HUECOS, rosterLimit: 8,
  });
  const mejor = r.moves[0];
  // Plantilla llena (8 de 8): no puede haber recomendación sin corte.
  assert.equal(r.rosterFull, true);
  assert.ok(mejor.drop, "con la plantilla llena hay que cortar a alguien");
  assert.equal(
    Math.round((mejor.lineupAfter - mejor.lineupBefore) * 10) / 10, mejor.net,
    "el neto ES la resta de las dos alineaciones, no otro número"
  );
});

test("el corte elegido es el que MENOS cuesta, medido y no supuesto", () => {
  const r = waiverMoves({
    available: [p("te_bueno", "TE", 11)], roster: MI_ROSTER,
    rosterPositions: HUECOS, rosterLimit: 8,
  });
  // `banca2` (WR 3) es el más barato de cortar; `rb1` (16) sería el más caro.
  assert.equal(r.moves[0].drop.player_id, "banca2");
});

test("un titular BLOQUEADO no se propone para cortar", () => {
  /* Proponer un cambio que no se puede hacer se lee como que tu alineación está
     mal puesta — la lección que costó el candado de `lockedSlots`. */
  const r = waiverMoves({
    available: [p("te_bueno", "TE", 11)], roster: MI_ROSTER,
    rosterPositions: HUECOS, rosterLimit: 8, lockedIds: ["banca2", "banca1"],
  });
  assert.ok(!["banca2", "banca1"].includes(String(r.moves[0].drop?.player_id)));
});

test("un OUT en mi plantilla convierte el fichaje en INJURY_REPLACEMENT", () => {
  const conLesionado = MI_ROSTER.map((x) =>
    x.player_id === "rb1" ? { ...x, injury_designation: "OUT" } : x);
  const r = waiverMoves({
    available: [p("rb_medio", "RB", 8)], roster: conLesionado, rosterPositions: HUECOS,
  });
  const m = r.moves[0];
  assert.equal(m.category, MOVE.INJURY_REPLACEMENT);
  assert.ok(m.reasons.some((x) => x.code === "ROSTERED_OUT"));
});

test("un DOUBTFUL NO cuenta como OUT", () => {
  /* Decidir el inactivo por el club es adivinarlo: la misma regla que
     `injuries.py::excludes_from_lineup`. */
  const dudoso = MI_ROSTER.map((x) =>
    x.player_id === "rb1" ? { ...x, injury_designation: "DOUBTFUL" } : x);
  const r = waiverMoves({
    available: [p("rb_medio", "RB", 8)], roster: dudoso, rosterPositions: HUECOS,
  });
  assert.notEqual(r.moves[0].category, MOVE.INJURY_REPLACEMENT);
});

test("un jugador que no entra en mi alineación se marca BENCH_DEPTH, con su cero", () => {
  /* No se esconde y no se le infla: se enseña con lo que añade y la pantalla
     decide. Un +0 bajo un rótulo que promete mejora serían dos frases que se
     contradicen. */
  const r = waiverMoves({
    available: [p("wr_malo", "WR", 5)], roster: MI_ROSTER, rosterPositions: HUECOS,
  });
  const m = r.moves[0];
  assert.equal(m.category, MOVE.BENCH_DEPTH);
  assert.equal(m.improves, false);
  assert.equal(m.net, 0);
});

test("si NADIE mejora la alineación, se dice", () => {
  const r = waiverMoves({
    available: [p("wr_malo", "WR", 5), p("rb_malo", "RB", 5)],
    roster: MI_ROSTER, rosterPositions: HUECOS,
  });
  assert.equal(r.anyImproves, false);
});

test("FAAB: sin presupuesto declarado NO se sugiere una puja", () => {
  assert.equal(faabRange({ net: 9, remaining: null }).status, "NO_BUDGET_DECLARED");
  assert.equal(faabRange({ net: 9, remaining: undefined }).status, "NO_BUDGET_DECLARED");
});

test("FAAB: es un TRAMO declarado como convención, no un bid", () => {
  const f = faabRange({ net: 9, remaining: 100 });
  assert.equal(f.status, "HEURISTIC_RANGE");
  assert.equal(f.basis, "CONVENTION");
  assert.ok(Array.isArray(f.pct) && f.pct.length === 2, "es un rango, no un número");
  assert.match(f.note, /no validated FAAB model/);
  // Y sobre lo que QUEDA, no sobre el inicial.
  assert.equal(f.of, 100);
});

test("FAAB: un movimiento que no mejora no gasta presupuesto", () => {
  assert.deepEqual(faabRange({ net: 0, remaining: 100 }).pct, [0, 0]);
});

test("el reparto de huecos se le pregunta al MISMO repartidor", () => {
  const foto = slotPicture({ roster: MI_ROSTER, rosterPositions: HUECOS });
  assert.deepEqual(foto.empty, ["TE"]);
  // Siete huecos titulares en HUECOS, seis cubiertos por los ocho jugadores.
  assert.equal(foto.slots.length, 7);
});

test("la ventana acota cuánto se ORDENA, no si alguien es elegible", () => {
  /* Bajo presión de pool el que te sirve está en el puesto cuarenta: es el fallo
     que ya costó una iteración en `candidates.js`. */
  const relleno = Array.from({ length: 55 }, (_, i) => p(`relleno${i}`, "WR", 1));
  const r = waiverMoves({
    available: [...relleno, p("te_bueno", "TE", 11)], roster: MI_ROSTER,
    rosterPositions: HUECOS, window: 60,
  });
  assert.equal(r.moves[0].add.player_id, "te_bueno");
});
