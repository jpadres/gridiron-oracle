/**
 * El bankroll mensual: la aritmética del dinero no admite «casi».
 *
 * El corazón es el escenario del bloque: $10.000, cuatro apuestas, una ganada,
 * una perdida, un push y una abierta — y cada cifra derivada cuadrando a
 * centavo. Después, lo estructural: aislamiento entre meses, snapshot
 * inmutable, y estados de una sola vía.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BET_STATUS, addBet, createMonth, decimalFromAmerican, exposure, limitWarnings,
  loadMonth, loadMonths, placeBets, removeBet, saveMonth, settleBet, summary,
  updateBet,
} from "../app/betting/bankroll.js";
import { gameLeans, propLean, rankedLeans } from "../app/betting/leans.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
  };
}

test("cuotas americanas: -110 y +150 exactas; basura es null, no un invento", () => {
  assert.ok(Math.abs(decimalFromAmerican(-110) - 1.9091) < 0.0001);
  assert.equal(decimalFromAmerican(150), 2.5);
  assert.equal(decimalFromAmerican(0), null);
  assert.equal(decimalFromAmerican("EVEN"), null);
  assert.equal(decimalFromAmerican(50), null); // |cuota| < 100 no es americana
});

test("el escenario de los $10.000, de punta a punta y a centavo", () => {
  const storage = memoryStorage();
  let month = createMonth("2026-09", 10000, storage);
  assert.ok(month);

  // Cuatro al slip: spread, total y dos props. Stakes elegidos por el usuario.
  month = addBet(month, { market: "SPREAD", label: "BUF -2.5", selection: "BUF",
    line: -2.5, odds: -105, stake: 150, gameId: "G1", team: "BUF",
    snapshot: { model: 4.3, market: 2.5, modelVersion: "2026.08.29" } });
  month = addBet(month, { market: "TOTAL", label: "BUF-MIA O47.5", selection: "OVER",
    line: 47.5, odds: -110, stake: 100, gameId: "G1",
    snapshot: { model: 50.5, market: 47.5 } });
  month = addBet(month, { market: "PROP_PASS_YDS", label: "J.Allen O267.5 pass yds",
    selection: "OVER", line: 267.5, odds: -110, stake: 100, gameId: "G1",
    playerId: "00-QB", team: "BUF", snapshot: { model: 286.4, market: 267.5 } });
  month = addBet(month, { market: "PROP_REC", label: "S.Diggs O6.5 rec",
    selection: "OVER", line: 6.5, odds: -115, stake: 100, gameId: "G2",
    playerId: "00-WR", team: "HOU", snapshot: { model: 7.4, market: 6.5 } });

  // En el slip nada expone dinero todavía.
  let s = summary(month);
  assert.equal(s.openExposure, 0);
  assert.equal(s.available, 10000);

  const ids = month.bets.map((b) => b.id);
  month = placeBets(month, ids, { at: 1000 });
  s = summary(month);
  assert.equal(s.openExposure, 450);
  assert.equal(s.available, 9550);
  assert.equal(s.current, 10000);
  assert.equal(s.openCount, 4);

  // Liquidación: gana el spread (-105), pierde el total, push el de Allen.
  month = settleBet(month, ids[0], BET_STATUS.WON, { at: 2000 });
  month = settleBet(month, ids[1], BET_STATUS.LOST, { at: 2001 });
  month = settleBet(month, ids[2], BET_STATUS.PUSH, { at: 2002 });
  s = summary(month);
  const wonProfit = 150 * (100 / 105);           // 142.857…
  assert.ok(Math.abs(s.settledPL - (wonProfit - 100)) < 0.01);
  assert.equal(s.openExposure, 100);             // sólo queda Diggs abierta
  assert.ok(Math.abs(s.available - (10000 + s.settledPL - 100)) < 1e-9);
  assert.ok(Math.abs(s.current - (10000 + s.settledPL)) < 1e-9);
  assert.ok(Math.abs(s.roi - s.settledPL / 10000) < 1e-12);
  assert.equal(s.wins, 1); assert.equal(s.losses, 1); assert.equal(s.pushes, 1);
  assert.equal(s.totalStaked, 450);
  assert.equal(s.unitDollars, 100);              // 1u = 1% de 10.000 por defecto

  // Persistir y releer: byte a byte el mismo dinero.
  saveMonth(month, storage);
  const back = loadMonth("2026-09", storage);
  assert.deepEqual(summary(back), s);

  // Segundo mes: banca nueva, historia aparte, sin arrastre automático.
  const october = createMonth("2026-10", 8000, storage);
  assert.ok(october);
  assert.equal(summary(october).available, 8000);
  assert.equal(summary(loadMonth("2026-09", storage)).openExposure, 100);
  assert.deepEqual(loadMonths(storage), ["2026-09", "2026-10"]);
  // Y un mes existente NO se puede recrear encima.
  assert.equal(createMonth("2026-09", 99999, storage), null);
});

test("colocar exige stake y cuota; lo colocado no se edita ni se borra", () => {
  const storage = memoryStorage();
  let month = createMonth("2026-11", 5000, storage);
  month = addBet(month, { market: "SPREAD", label: "KC -3", stake: 0, odds: -110 });
  month = addBet(month, { market: "SPREAD", label: "SF -7", stake: 50, odds: "?" });
  const [sinStake, sinCuota] = month.bets.map((b) => b.id);
  month = placeBets(month, [sinStake, sinCuota]);
  assert.ok(month.bets.every((b) => b.status === BET_STATUS.CONSIDERING));

  month = updateBet(month, sinStake, { stake: 50, odds: -110 });
  month = placeBets(month, [sinStake], { at: 5 });
  const placed = month.bets.find((b) => b.id === sinStake);
  assert.equal(placed.status, BET_STATUS.PLACED);
  assert.equal(placed.placedAt, 5);

  // Editar o borrar una colocada es un no-op; su snapshot no se toca.
  const before = JSON.stringify(placed);
  month = updateBet(month, sinStake, { stake: 9999, snapshot: { model: 0 } });
  month = removeBet(month, sinStake);
  assert.equal(JSON.stringify(month.bets.find((b) => b.id === sinStake)), before);

  // Liquidar dos veces tampoco: WON no pasa a LOST.
  month = settleBet(month, sinStake, BET_STATUS.WON);
  month = settleBet(month, sinStake, BET_STATUS.LOST);
  assert.equal(month.bets.find((b) => b.id === sinStake).status, BET_STATUS.WON);
});

test("VOID devuelve el stake sin P/L", () => {
  const storage = memoryStorage();
  let month = createMonth("2026-12", 1000, storage);
  month = addBet(month, { market: "TOTAL", label: "O44", stake: 100, odds: -110 });
  month = placeBets(month, [month.bets[0].id]);
  month = settleBet(month, month.bets[0].id, BET_STATUS.VOID);
  const s = summary(month);
  assert.equal(s.settledPL, 0);
  assert.equal(s.available, 1000);
  assert.equal(s.voids, 1);
});

test("la exposición se agrupa por partido, equipo, jugador y mercado", () => {
  const storage = memoryStorage();
  let month = createMonth("2027-01", 10000, storage);
  for (const bet of [
    { market: "SPREAD", label: "a", stake: 100, odds: -110, gameId: "G1", team: "BUF" },
    { market: "TOTAL", label: "b", stake: 50, odds: -110, gameId: "G1" },
    { market: "PROP_REC", label: "c", stake: 25, odds: -110, gameId: "G1", playerId: "P1", team: "BUF" },
    { market: "SPREAD", label: "d", stake: 60, odds: -110, gameId: "G2", team: "KC" },
  ]) month = addBet(month, bet);
  month = placeBets(month, month.bets.map((b) => b.id));
  const grouped = exposure(month);
  assert.deepEqual(grouped.byGame[0], { key: "G1", amount: 175 });
  assert.deepEqual(grouped.byTeam[0], { key: "BUF", amount: 125 });
  assert.deepEqual(grouped.byMarket.map((m) => m.key), ["SPREAD", "TOTAL", "PROP_REC"]);
});

test("los límites son del usuario y avisan sin bloquear", () => {
  const storage = memoryStorage();
  let month = createMonth("2027-02", 10000, storage);
  month = { ...month, limits: { maxStakePct: 2, maxOpenPct: 10, maxGamePct: 3 } };
  month = addBet(month, { market: "SPREAD", label: "a", stake: 250, odds: -110, gameId: "G1" });
  month = placeBets(month, [month.bets[0].id]);
  const warnings = limitWarnings(month, { stake: 250, gameId: "G1" });
  assert.equal(warnings.length, 2); // stake 2,5% > 2% y el partido 5% > 3%
  assert.ok(warnings[0].includes("your 2%"));
});

/* --- leans ---------------------------------------------------------------- */

test("los leans de partido nombran el lado y no comparan familias en crudo", () => {
  const predictions = [
    { game_id: "A", home_team: "BUF", away_team: "MIA", spread_line: 2.5,
      pred_margin: 4.3, total_line: 47.5, pred_total: 50.5 },
    { game_id: "B", home_team: "DAL", away_team: "PHI", spread_line: -1.0,
      pred_margin: -1.5, total_line: 44.0, pred_total: 43.6 },
  ];
  const rows = gameLeans(predictions);
  const spreadA = rows.find((r) => r.family === "SPREAD" && r.gameId === "A");
  assert.equal(spreadA.lean, "BUF -2.5");     // el modelo da MÁS que la línea: lado local
  assert.equal(spreadA.gap, 1.8);
  const totalA = rows.find((r) => r.family === "TOTAL" && r.gameId === "A");
  assert.equal(totalA.lean, "OVER 47.5");
  const spreadB = rows.find((r) => r.family === "SPREAD" && r.gameId === "B");
  // Margen −1,5 contra línea −1,0: el modelo ve a DAL perdiendo por MÁS de lo
  // que pide el mercado, así que el lean es el visitante dando el punto.
  assert.equal(spreadB.lean, "PHI -1.0");

  const ranked = rankedLeans(rows);
  assert.ok(ranked.every((r) => Number.isFinite(r.sigmas)));
  // El orden es por sigmas de SU familia, no por puntos crudos entre familias.
  assert.ok(ranked[0].sigmas >= ranked[ranked.length - 1].sigmas);
});

test("el lean de prop exige una línea; sin línea no hay dirección", () => {
  assert.equal(propLean(286.4, null), null);
  assert.equal(propLean(undefined, 267.5), null);
  assert.deepEqual(propLean(286.4, 267.5), { side: "OVER", gap: 18.9 });
  assert.deepEqual(propLean(5.8, 6.5), { side: "UNDER", gap: 0.7 });
  assert.deepEqual(propLean(7, 7), { side: "PUSH", gap: 0 });
});
