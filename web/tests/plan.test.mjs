/**
 * El plan de la semana. Lo que se prueba aquí no es «que dé un número
 * razonable»: es que el número BAJE cuando la banca baja y que NO suba para
 * recuperar, que es la única propiedad por la que existe el fichero.
 *
 * Escenario base: 10.000 $ de banca, unidad del 1%, tope semanal del 5%.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BET_STATUS, addBet, exportBook, importBook, loadMonth, placeBets, saveMonth, settleBet,
} from "../app/betting/bankroll.js";
import {
  DRAWDOWN_BRAKE, DRAWDOWN_BRAKE_PCT, bankPath, betProfit, careerSummary,
  weekLedger, weekPlan,
} from "../app/betting/plan.js";

/** Un `localStorage` de mentira, igual que el de `bankroll.test.mjs`. */
function memoria() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const mes = (starting = 10000) =>
  ({ month: "2026-09", starting, unitIsPercent: true, unitValue: 1, limits: {}, bets: [] });

/** Registra una apuesta ya colocada, y opcionalmente la liquida. */
function apostar(record, { stake, odds = -110, week = 1, result = null, at = 1 }) {
  let next = addBet(record, { market: "SPREAD", label: `w${week} ${stake}`, stake, odds, week, season: 2026 });
  const id = next.bets[next.bets.length - 1].id;
  next = placeBets(next, [id], { at });
  if (result) next = settleBet(next, id, BET_STATUS[result], { at: at + 1 });
  return next;
}

/* ── el tamaño sigue a la banca, en las dos direcciones ─────────────────── */

test("con la banca intacta, la unidad de hoy es la del principio", () => {
  const plan = weekPlan({ record: mes(), week: 1 });
  assert.equal(plan.state, "EVEN");
  assert.equal(plan.unitAtStart, 100);
  assert.equal(plan.unitNow, 100);
  assert.equal(plan.budget, 500);          // 5% de 10.000
  assert.equal(plan.remaining, 500);
});

test("vas ABAJO: la unidad baja sola, sin ninguna regla nueva", () => {
  // Una perdida de 1.000 deja la banca en 9.000 -> unidad 90 $.
  const record = apostar(mes(), { stake: 1000, result: "LOST" });
  const plan = weekPlan({ record, week: 2 });
  assert.equal(plan.state, "DOWN");
  assert.equal(plan.bank, 9000);
  assert.equal(plan.unitNow, 90);
  assert.ok(plan.unitNow < plan.unitAtStart, "una banca menor NO puede dar una unidad mayor");
  assert.equal(plan.budget, 450);
});

test("vas ARRIBA: sube igual de sola, y por la misma aritmética", () => {
  // 1.000 a +200 gana 2.000 -> banca 12.000 -> unidad 120 $.
  const record = apostar(mes(), { stake: 1000, odds: 200, result: "WON" });
  const plan = weekPlan({ record, week: 2 });
  assert.equal(plan.state, "UP");
  assert.equal(plan.bank, 12000);
  assert.equal(plan.unitNow, 120);
  assert.equal(plan.budget, 600);
});

test("NO PERSEGUIR: por debajo del umbral el plan FRENA, no amplía", () => {
  // Una caída del 25% cruza el umbral del 20%.
  const record = apostar(mes(), { stake: 2500, result: "LOST" });
  const plan = weekPlan({ record, week: 2 });
  assert.equal(plan.braking, true);
  assert.equal(plan.swingPct, -25);
  assert.ok(plan.swingPct <= -DRAWDOWN_BRAKE_PCT);
  assert.equal(plan.brakeFactor, DRAWDOWN_BRAKE);
  // 7.500 de banca, 5% = 375, recortado a la mitad.
  assert.equal(plan.budget, 187.5);
  assert.equal(plan.perBet, 37.5);         // 1% de 7.500, frenado
  // Y lo esencial: menos que cuando la banca estaba entera. Nunca más.
  const intacto = weekPlan({ record: mes(), week: 2 });
  assert.ok(plan.perBet < intacto.perBet, "perder no puede agrandar la apuesta siguiente");
  assert.ok(plan.budget < intacto.budget);
});

test("el tope de la semana descuenta lo ya comprometido EN ESA semana", () => {
  let record = apostar(mes(), { stake: 200, week: 3 });          // abierta
  record = apostar(record, { stake: 100, week: 3, result: "LOST" });
  record = apostar(record, { stake: 400, week: 4 });             // otra semana
  const plan = weekPlan({ record, week: 3 });
  assert.equal(plan.committed, 300);
  // Banca 9.900 tras la perdida de 100 -> tope 495.
  assert.equal(plan.budget, 495);
  assert.equal(plan.remaining, 195);
});

test("lo que está en el slip ya cuenta contra el tope", () => {
  let record = addBet(mes(), { market: "SPREAD", label: "slip", stake: 480, odds: -110, week: 3 });
  const plan = weekPlan({ record, week: 3 });
  assert.equal(plan.inSlip, 480);
  assert.equal(plan.remaining, 20);
  record = addBet(record, { market: "SPREAD", label: "otra", stake: 100, odds: -110, week: 3 });
  const plan2 = weekPlan({ record, week: 3 });
  assert.equal(plan2.over, true);
  assert.equal(plan2.remaining, 0);        // nunca negativo: se dice «pasado», no −80
});

/* ── el libro ───────────────────────────────────────────────────────────── */

test("PUSH y VOID devuelven el stake: no mueven la banca", () => {
  assert.equal(betProfit({ status: BET_STATUS.PUSH, stake: 500, odds: -110 }), 0);
  assert.equal(betProfit({ status: BET_STATUS.VOID, stake: 500, odds: -110 }), 0);
  assert.equal(betProfit({ status: BET_STATUS.LOST, stake: 500, odds: -110 }), -500);
  assert.ok(Math.abs(betProfit({ status: BET_STATUS.WON, stake: 110, odds: -110 }) - 100) < 0.001);
});

test("la curva de banca arranca en la inicial y avanza por liquidación", () => {
  let record = apostar(mes(), { stake: 100, result: "LOST", at: 10 });
  record = apostar(record, { stake: 110, result: "WON", at: 20 });
  record = apostar(record, { stake: 500 });                       // abierta: no está en la curva
  const path = bankPath(record);
  assert.equal(path.length, 3);
  assert.equal(path[0].bank, 10000);
  assert.equal(path[1].bank, 9900);
  assert.equal(path[2].bank, 10000);
});

test("el libro por jornada agrupa, cuadra y arrastra la banca", () => {
  let record = apostar(mes(), { stake: 100, week: 1, result: "LOST" });
  record = apostar(record, { stake: 110, week: 1, result: "WON" });
  record = apostar(record, { stake: 200, week: 2, result: "LOST" });
  const semanas = weekLedger(record);
  assert.deepEqual(semanas.map((r) => r.week), [1, 2]);
  assert.equal(semanas[0].staked, 210);
  assert.equal(semanas[0].profit, 0);          // −100 +100
  assert.equal(semanas[0].bankAfter, 10000);
  assert.equal(semanas[1].profit, -200);
  assert.equal(semanas[1].bankAfter, 9800);
});

test("una apuesta sin jornada NO se reparte por fecha: se agrupa como desconocida", () => {
  const record = apostar(mes(), { stake: 100, week: null, result: "LOST" });
  const semanas = weekLedger(record);
  assert.equal(semanas.length, 1);
  assert.equal(semanas[0].week, null);
  assert.equal(semanas[0].bankAfter, null);    // no se sabe dónde va: no se coloca
});

test("el slip no es historia: no aparece en el libro de la semana", () => {
  const record = addBet(mes(), { market: "SPREAD", label: "x", stake: 50, odds: -110, week: 1 });
  assert.deepEqual(weekLedger(record), []);
});

/* ── el registro de todos los meses ─────────────────────────────────────── */

test("la ficha de siempre suma meses con bancas distintas por lo APOSTADO", () => {
  const sep = apostar(mes(10000), { stake: 100, week: 1, result: "WON", odds: 100 });
  const oct = apostar(mes(500), { stake: 50, week: 5, result: "LOST" });
  const total = careerSummary([sep, oct]);
  assert.equal(total.months, 2);
  assert.equal(total.bets, 2);
  assert.equal(total.staked, 150);
  assert.equal(total.profit, 50);              // +100 −50
  assert.equal(total.wins, 1);
  assert.equal(total.losses, 1);
  assert.ok(Math.abs(total.roi - 50 / 150) < 1e-9);
});

/* ── la copia de seguridad ───────────────────────────────────────────────── */

test("el libro se exporta entero y vuelve a entrar", () => {
  const storage = memoria();
  const sep = apostar(mes(10000), { stake: 100, week: 1, result: "WON", odds: 100 });
  saveMonth(sep, storage);
  const texto = exportBook(storage);

  const vacio = memoria();
  const r = importBook(texto, vacio);
  assert.deepEqual(r.added, ["2026-09"]);
  const vuelto = loadMonth("2026-09", vacio);
  assert.equal(vuelto.starting, 10000);
  assert.equal(vuelto.bets.length, 1);
  assert.equal(vuelto.bets[0].status, "WON");
  assert.equal(vuelto.bets[0].week, 1);
});

test("importar NO pisa un mes que ya existe: la historia es inmutable", () => {
  const storage = memoria();
  saveMonth(apostar(mes(10000), { stake: 100, week: 1, result: "WON" }), storage);
  const texto = exportBook(storage);
  // Ahora el mes local tiene DOS apuestas; el fichero, una sola y más vieja.
  saveMonth(apostar(loadMonth("2026-09", storage), { stake: 50, week: 2, result: "LOST" }), storage);
  const r = importBook(texto, storage);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.skipped, ["2026-09"]);
  assert.equal(loadMonth("2026-09", storage).bets.length, 2, "no puede haber perdido la segunda");
});

test("un texto que no es el export se rechaza con su motivo, sin tocar nada", () => {
  const storage = memoria();
  saveMonth(mes(10000), storage);
  assert.ok(importBook("no soy json", storage).error);
  assert.ok(importBook(JSON.stringify({ kind: "otra cosa" }), storage).error);
  assert.equal(loadMonth("2026-09", storage).starting, 10000);
});
