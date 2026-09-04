/**
 * El ajuste a la plantilla. La propiedad que se prueba no es «da un número
 * razonable»: es que con la plantilla VACÍA el marginal sea EXACTAMENTE el VOR
 * publicado, y que sólo se separe de él cuando tú llenas un hueco.
 *
 * Ésa es la comprobación de que no se ha inventado nada. Si el marginal del
 * primer pick no es el VOR, es que hay una regla nueva escondida.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { lineupFloor, replacementPoints, rosterFit, slotFloor } from "../app/fantasy/rosterFit.js";

/* Niveles de reemplazo elegidos para parecerse a los reales del board:
   QB 233, RB 131, WR 132, TE 113 — el QB es el más alto, que es justo lo que
   hace que ordenar por PUNTOS ponga a los quarterbacks arriba (regla 6b). */
const REP = { QB: 233, RB: 131, WR: 132, TE: 113 };
const p = (id, position, proj) => ({
  player_id: id, player_name: id, position,
  projected_points: proj, vor: proj - REP[position],
});

const ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN"];

const QB1 = p("qb1", "QB", 330);   // vor  97
const QB2 = p("qb2", "QB", 320);   // vor  87
const RB1 = p("rb1", "RB", 260);   // vor 129
const RB2 = p("rb2", "RB", 240);   // vor 109
const WR1 = p("wr1", "WR", 250);   // vor 118
const TE1 = p("te1", "TE", 215);   // vor 102
const TE2 = p("te2", "TE", 210);   // vor  97

/* ── el nivel de reemplazo se LEE, no se recalcula ───────────────────────── */

test("el reemplazo sale de la identidad proj − vor de las propias filas", () => {
  const leido = replacementPoints([QB1, QB2, RB1, RB2, WR1, TE1, TE2]);
  assert.deepEqual(leido, REP);
});

test("una fila incompleta no puede mover el suelo de su posición", () => {
  const leido = replacementPoints([TE1, TE2, { position: "TE", projected_points: 200, vor: null }]);
  assert.equal(leido.TE, 113);
});

test("un FLEX vacío vale el mejor reemplazo que quepa, no cero", () => {
  assert.equal(slotFloor("FLEX", REP), 132);      // el receptor, no el ala cerrada
  assert.equal(slotFloor("TE", REP), 113);
  assert.equal(slotFloor("SUPER_FLEX", REP), 233);
  assert.equal(slotFloor("K", REP), null);        // sin número suyo: fuera de la cuenta
});

/* ── LA propiedad ────────────────────────────────────────────────────────── */

test("con la plantilla VACÍA el marginal es EXACTAMENTE el VOR publicado", () => {
  const fit = rosterFit({
    candidates: [QB1, RB1, WR1, TE1], roster: [], rosterPositions: ROSTER, replacement: REP,
  });
  for (const f of fit) {
    assert.equal(f.marginal, f.vor, `${f.player_id}: marginal ${f.marginal} ≠ vor ${f.vor}`);
    assert.equal(f.kept, 1);
  }
});

test("y por eso el primer pick NO se ordena por puntos: el QB no encabeza", () => {
  const fit = rosterFit({
    candidates: [QB1, RB1], roster: [], rosterPositions: ROSTER, replacement: REP,
  });
  const [qb, rb] = fit;
  assert.ok(qb.marginal < rb.marginal,
    "el QB suma 330 y el corredor 260; si el marginal lo pusiera arriba, sería la regla 6b rota");
});

/* ── lo que el dueño pidió: que deje de ofrecer lo que ya tienes ─────────── */

test("con el ala cerrada YA cogida, el segundo TE se desploma", () => {
  const fit = rosterFit({
    candidates: [TE2], roster: [TE1], rosterPositions: ROSTER, replacement: REP,
  });
  const [te] = fit;
  // El hueco de TE está ocupado por uno mejor; TE2 sólo puede entrar por el
  // FLEX, donde compite con el reemplazo del receptor (132), no con el del
  // ala cerrada (113). 210 − 132 = 78, contra los 97 que dice el board.
  assert.equal(te.vor, 97);
  assert.equal(te.marginal, 78);
  assert.ok(te.marginal < te.vor, "tener ya un TE no puede dejar al siguiente igual de valioso");
});

test("con el QB YA cogido, el segundo QB vale CERO — y ésta es la queja original", () => {
  const fit = rosterFit({
    candidates: [QB2, RB2], roster: [QB1], rosterPositions: ROSTER, replacement: REP,
  });
  const porId = Object.fromEntries(fit.map((f) => [f.player_id, f]));
  assert.equal(porId.qb2.marginal, 0, "sin segundo hueco de QB no añade nada a la alineación");
  assert.equal(porId.qb2.kept, 0);
  // Y el corredor, que sí tiene hueco, mantiene su valor entero.
  assert.equal(porId.rb2.marginal, porId.rb2.vor);
  assert.ok(porId.rb2.marginal > porId.qb2.marginal,
    "con el QB cogido, el board tiene que ofrecer el corredor antes que otro QB");
});

test("en SUPERFLEX el segundo QB SÍ vale, porque ahí hay hueco para él", () => {
  const superflex = ["QB", "RB", "RB", "WR", "WR", "TE", "SUPER_FLEX", "BN"];
  const fit = rosterFit({
    candidates: [QB2], roster: [QB1], rosterPositions: superflex, replacement: REP,
  });
  // Entra por el SUPER_FLEX, cuyo suelo es el reemplazo del QB: 320 − 233 = 87.
  assert.equal(fit[0].marginal, 87);
  assert.equal(fit[0].marginal, fit[0].vor);
});

test("el desplazamiento lo resuelve el repartidor, no una previsión escrita aquí", () => {
  // Con dos corredores puestos, un tercero mejor entra de titular y empuja al
  // peor al FLEX. Lo que añade es la diferencia contra el suelo del FLEX.
  const RB3 = p("rb3", "RB", 280);
  const fit = rosterFit({
    candidates: [RB3], roster: [RB1, RB2], rosterPositions: ROSTER, replacement: REP,
  });
  // Antes: 260 + 240 + FLEX vacío (132). Después: 280 + 260 + 240 en el FLEX.
  assert.equal(fit[0].marginal, (280 + 260 + 240) - (260 + 240 + 132));
});

/* ── los bordes ──────────────────────────────────────────────────────────── */

test("sin estructura de plantilla NO se calcula nada: no se supone una", () => {
  assert.equal(rosterFit({ candidates: [RB1], roster: [], rosterPositions: [], replacement: REP }), null);
  assert.equal(rosterFit({ candidates: [RB1], roster: [], rosterPositions: null, replacement: REP }), null);
});

test("una plantilla que es SÓLO banquillo tampoco tiene alineación que valorar", () => {
  assert.equal(lineupFloor({ players: [], rosterPositions: ["BN", "BN"], replacement: REP }), null);
});

test("un titular sin proyección ocupa su hueco y NO cobra el suelo del hueco", () => {
  const mudo = { player_id: "x", position: "TE", projected_points: null, vor: null };
  const suelo = lineupFloor({ players: [mudo], rosterPositions: ["TE"], replacement: REP });
  assert.equal(suelo, 0, "si cobrara el suelo, tener un jugador sin número valdría lo mismo que no tenerlo");
});
