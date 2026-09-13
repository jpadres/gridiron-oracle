/**
 * RIESGO DE ESTADO TARDÍO.
 *
 * Cada test lleva el fallo que existe para cazar: la ventana calculada al
 * revés, un OUT abriendo una ventana que ya está cerrada, el plazo puesto en el
 * mejor recambio en vez de en el PRIMERO que se bloquea, y un suplente de IR
 * ofrecido como cobertura.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { inDoubt, lateStatusRisks } from "../app/fantasy/lateRisk.js";

const UNA = "2026-09-13T13:00:00-04:00";
const TARDE = "2026-09-13T16:25:00-04:00";
const NOCHE = "2026-09-13T20:20:00-04:00";
const AHORA = Date.parse("2026-09-13T09:00:00-04:00");

const jugador = (sid, extra = {}) => ({
  sid, position: "WR", projected_points: 10, kickoff_at: UNA, ...extra,
});

function liga(starters, players, roster = ["WR", "WR", "BN", "BN"]) {
  return { config: { roster }, starters, players };
}

test("un dudoso TARDÍO con recambio TEMPRANO abre una ventana", () => {
  const index = new Map([
    ["q", jugador("q", { kickoff_at: NOCHE, injury_designation: "QUESTIONABLE", projected_points: 16 })],
    ["wr2", jugador("wr2", { kickoff_at: TARDE })],
    ["sub", jugador("sub", { kickoff_at: UNA, projected_points: 9 })],
  ]);
  const r = lateStatusRisks({ league: liga(["q", "wr2"], ["q", "wr2", "sub"]), index, now: AHORA });
  assert.equal(r.length, 1);
  assert.equal(r[0].starter.sid, "q");
  assert.equal(r[0].decideBy, Date.parse(UNA), "el plazo no es el saque del recambio");
  assert.ok(r[0].msLeft > 0);
});

test("un dudoso TEMPRANO con recambio TARDÍO NO abre ventana", () => {
  /* Es la mitad que da sentido a la otra: si tu dudoso juega a la una y el
     recambio a las ocho, no hay prisa — decides con el parte de inactivos del
     temprano y todavía te queda el suplente. Sin esta comprobación, el panel
     avisaría de todo y dejaría de informar. */
  const index = new Map([
    ["q", jugador("q", { kickoff_at: UNA, injury_designation: "QUESTIONABLE" })],
    ["wr2", jugador("wr2", { kickoff_at: UNA })],
    ["sub", jugador("sub", { kickoff_at: NOCHE })],
  ]);
  assert.deepEqual(
    lateStatusRisks({ league: liga(["q", "wr2"], ["q", "wr2", "sub"]), index, now: AHORA }), []);
});

test("un OUT no abre ventana: ya está decidido", () => {
  const index = new Map([
    ["o", jugador("o", { kickoff_at: NOCHE, injury_designation: "OUT" })],
    ["wr2", jugador("wr2", { kickoff_at: TARDE })],
    ["sub", jugador("sub", { kickoff_at: UNA })],
  ]);
  assert.deepEqual(
    lateStatusRisks({ league: liga(["o", "wr2"], ["o", "wr2", "sub"]), index, now: AHORA }), [],
    "esperar a un OUT no es una decisión pendiente: es una sustitución");
});

test("el plazo lo pone el PRIMERO que se bloquea, no el mejor", () => {
  /* Si el mejor recambio juega a las 16:25 y hay otro a la una, a la UNA ya
     hay que decidir si se usa ése: esperar cuesta la opción. Poner el plazo en
     el mejor daría tres horas de más y se perdería el temprano. */
  const index = new Map([
    ["q", jugador("q", { kickoff_at: NOCHE, injury_designation: "DOUBTFUL" })],
    ["wr2", jugador("wr2", { kickoff_at: NOCHE })],
    ["bueno", jugador("bueno", { kickoff_at: TARDE, projected_points: 14 })],
    ["pronto", jugador("pronto", { kickoff_at: UNA, projected_points: 7 })],
  ]);
  const r = lateStatusRisks({
    league: liga(["q", "wr2"], ["q", "wr2", "bueno", "pronto"]), index, now: AHORA });
  assert.equal(r.length, 1);
  assert.equal(r[0].decideBy, Date.parse(UNA));
  assert.equal(r[0].options[0].sid, "bueno", "las opciones se ordenan por lo que aportan");
});

test("sólo cuenta quien CABE en ese hueco", () => {
  const index = new Map([
    ["q", { sid: "q", position: "TE", projected_points: 12, kickoff_at: NOCHE, injury_designation: "QUESTIONABLE" }],
    ["sub", jugador("sub", { kickoff_at: UNA })],   // WR: no cabe en un hueco TE
  ]);
  const r = lateStatusRisks({
    league: { config: { roster: ["TE", "BN"] }, starters: ["q"], players: ["q", "sub"] },
    index, now: AHORA });
  assert.deepEqual(r, [], "se ofreció un receptor para cubrir un hueco de ala cerrada");
});

test("quien está en IR o taxi no es un recambio", () => {
  const index = new Map([
    ["q", jugador("q", { kickoff_at: NOCHE, injury_designation: "QUESTIONABLE" })],
    ["wr2", jugador("wr2", { kickoff_at: NOCHE })],
    ["ir", jugador("ir", { kickoff_at: UNA })],
  ]);
  const r = lateStatusRisks({
    league: { ...liga(["q", "wr2"], ["q", "wr2", "ir"]), reserve: ["ir"] },
    index, now: AHORA });
  assert.deepEqual(r, [], "no se puede alinear a alguien que está en IR");
});

test("un partido que ya empezó no tiene ventana", () => {
  const index = new Map([
    ["q", jugador("q", { kickoff_at: TARDE, injury_designation: "QUESTIONABLE" })],
    ["wr2", jugador("wr2", { kickoff_at: NOCHE })],
    ["sub", jugador("sub", { kickoff_at: UNA })],
  ]);
  const despues = Date.parse("2026-09-13T17:00:00-04:00");
  assert.deepEqual(
    lateStatusRisks({ league: liga(["q", "wr2"], ["q", "wr2", "sub"]), index, now: despues }), [],
    "la decisión ya pasó");
});

test("la duda la abren las DOS capas, sin preferir una", () => {
  assert.equal(inDoubt({ injury_designation: "QUESTIONABLE" }), true);
  assert.equal(inDoubt({ injury_designation: "DOUBTFUL" }), true);
  assert.equal(inDoubt({ status_severity: "RISK" }), true, "la prensa también marca dudas");
  assert.equal(inDoubt({ status_disputed: true }), true, "un desacuerdo entre fuentes ES duda");
  assert.equal(inDoubt({ injury_designation: "OUT" }), false);
  assert.equal(inDoubt({}), false, "una marca que sale siempre no informa");
  assert.equal(inDoubt(null), false);
});
