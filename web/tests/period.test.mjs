/**
 * LA REVISIÓN DE CUATRO JORNADAS.
 *
 * Los dos fallos que existen para cazar son de la misma familia y los dos
 * serían invisibles en pantalla:
 *
 *   1. CONFUNDIR LO QUE GANA EL LIBRO CON LO QUE METE EL DUEÑO. Un `+$500`
 *      que en realidad es una transferencia se lee como una buena racha. La
 *      propiedad que lo impide es una IDENTIDAD, no una inspección visual.
 *   2. RECOMENDAR DINERO PORQUE SE HA PERDIDO. Es la persecución con otro
 *      traje, y aquí el traje es respetable: «reponer la banca». La propiedad
 *      es que la recomendación NO CAMBIE según cómo se llegó a la cifra.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CASH, FUNDING, SIZEABLE, fundingAdvice, maxDrawdown, monthPlan, periodBounds, review,
} from "../app/betting/period.js";

const gana = (w, stake, dec, at) => ({ status: "WON", stake, odds: { decimal: dec }, season: 2026, week: w, settledAt: at });
const pierde = (w, stake, at) => ({ status: "LOST", stake, season: 2026, week: w, settledAt: at });
const libro = (bets, cash = [], starting = 1000) => ({ starting, bets, cash });

test("el periodo son las cuatro jornadas que terminan en la actual", () => {
  assert.deepEqual(periodBounds(2026, 8), { season: 2026, from: 5, to: 8, weeks: 4 });
  // Al principio de temporada no se inventan jornadas que no existen.
  assert.deepEqual(periodBounds(2026, 2), { season: 2026, from: 1, to: 2, weeks: 4 });
  assert.equal(periodBounds(2026, 0), null);
  assert.equal(periodBounds(2026, null), null);
});

test("FINAL = INICIAL + CAJA + RESULTADO, y los tres se publican por separado", () => {
  /* La identidad ES la separación. Si alguien vuelve a sumar el ingreso al
     resultado, deja de cuadrar por el doble del ingreso. */
  const r = review(libro(
    [gana(6, 100, 2.0, 10), pierde(7, 50, 20)],
    [{ kind: CASH.DEPOSIT, amount: 300, season: 2026, week: 6 },
     { kind: CASH.WITHDRAWAL, amount: 100, season: 2026, week: 7 }],
  ), periodBounds(2026, 8));
  assert.equal(r.realizedPL, 50);          // +100 de la ganada, −50 de la perdida
  assert.equal(r.netCash, 200);            // 300 − 100
  assert.equal(r.deposited, 300);
  assert.equal(r.withdrawn, 100);
  assert.equal(r.endingBankroll, r.startingBankroll + r.netCash + r.realizedPL);
  assert.equal(r.endingBankroll, 1250);
});

test("la caída máxima NO la tapa un ingreso", () => {
  /* Tres derrotas seguidas son una caída de 300 aunque el mismo día entren
     300 en la cuenta. Si la curva sumara la caja, la caída saldría CERO y el
     periodo se leería como plano. */
  const bets = [pierde(5, 100, 1), pierde(5, 100, 2), pierde(5, 100, 3)];
  const conIngreso = review(libro(bets, [{ kind: CASH.DEPOSIT, amount: 300, season: 2026, week: 5 }]),
    periodBounds(2026, 8));
  const sinIngreso = review(libro(bets), periodBounds(2026, 8));
  assert.equal(conIngreso.maxDrawdown.amount, 300);
  assert.deepEqual(conIngreso.maxDrawdown, sinIngreso.maxDrawdown,
    "el dinero que entra está cambiando la medida del rendimiento");
});

test("la caída se mide en orden de LIQUIDACIÓN, no de registro", () => {
  const desordenadas = [gana(5, 100, 2.0, 300), pierde(5, 400, 100), gana(5, 100, 2.0, 200)];
  // Orden real: −400, +100, +100 → pico 1000, valle 600 → caída 400.
  assert.equal(maxDrawdown(desordenadas, 1000).amount, 400);
});

test("una apuesta SIN jornada no se reparte: se cuenta aparte", () => {
  const r = review(libro([pierde(6, 50, 1), { status: "LOST", stake: 999, season: null, week: null }]),
    periodBounds(2026, 8));
  assert.equal(r.realizedPL, -50, "la apuesta sin jornada se ha colado en el resultado");
  assert.equal(r.sinJornada, 1);
});

test("la banca inicial del periodo incluye lo que pasó ANTES", () => {
  const r = review(libro([gana(1, 100, 3.0, 1), pierde(6, 100, 2)]), periodBounds(2026, 8));
  assert.equal(r.startingBankroll, 1200, "la jornada 1 queda fuera del periodo pero no del pasado");
  assert.equal(r.realizedPL, -100);
});

/* ---------------- LA RECOMENDACIÓN NO PERSIGUE ---------------------------- */

const VALIDADO = { edgeStatus: "VALIDATED", target: { min: 1000, max: 2000 }, budgetCeiling: 500 };

test("sin ventaja validada la respuesta es CERO, esté como esté la banca", () => {
  for (const banca of [10, 500, 999, 5000]) {
    const a = fundingAdvice({ ...VALIDADO, edgeStatus: "REJECTED", currentBankroll: banca });
    assert.equal(a.addMoney, 0);
    assert.equal(a.reason, FUNDING.NO_VALIDATED_EDGE);
  }
  // Y tampoco con NOT_READY, ni sin estado declarado.
  for (const estado of ["NOT_READY", "BLOCKED", null, undefined]) {
    assert.equal(fundingAdvice({ ...VALIDADO, edgeStatus: estado, currentBankroll: 100 }).addMoney, 0);
  }
});

test("LA MISMA BANCA RECIBE LA MISMA RESPUESTA, se llegara ganando o perdiendo", () => {
  /* Ésta es la propiedad §226 entera. No se comprueba «que no suba tras
     perder» —que es la mitad que un multiplicador del 15% ya burló una vez en
     `apuestas.mjs`— sino que el CÓMO no entre en la cuenta. */
  const ganando = fundingAdvice({ ...VALIDADO, currentBankroll: 800 });
  const perdiendo = fundingAdvice({ ...VALIDADO, currentBankroll: 800 });
  assert.deepEqual(ganando, perdiendo);
  // Y la firma no admite el resultado del periodo ni por descuido: pasarlo
  // no puede cambiar nada.
  const conPL = fundingAdvice({ ...VALIDADO, currentBankroll: 800, realizedPL: -5000, lastPeriodLoss: 5000 });
  assert.deepEqual(conPL, ganando, "algo del resultado del periodo está entrando en la recomendación");
});

test("el techo del dueño es DURO", () => {
  // Faltan 900 para el mínimo y el techo son 500: se piden 500, no 900.
  const a = fundingAdvice({ ...VALIDADO, currentBankroll: 100 });
  assert.equal(a.addMoney, 500);
  assert.equal(a.reason, FUNDING.CAPPED_BY_BUDGET);
  // Con techo cero no se pide nada por muy abajo que esté.
  assert.equal(fundingAdvice({ ...VALIDADO, budgetCeiling: 0, currentBankroll: 1 }).addMoney, 0);
});

test("sin techo declarado no se recomienda nada", () => {
  for (const techo of [null, undefined, ""]) {
    const a = fundingAdvice({ ...VALIDADO, budgetCeiling: techo, currentBankroll: 100 });
    assert.equal(a.addMoney, 0);
    assert.equal(a.reason, FUNDING.NO_BUDGET_SET);
  }
});

test("por encima del objetivo se puede sugerir RETIRAR, y nunca añadir", () => {
  const a = fundingAdvice({ ...VALIDADO, currentBankroll: 2500 });
  assert.equal(a.withdraw, 500);
  assert.equal(a.addMoney, 0);
  assert.equal(a.reason, FUNDING.ABOVE_TARGET);
});

test("dentro del rango no se toca nada", () => {
  const a = fundingAdvice({ ...VALIDADO, currentBankroll: 1500 });
  assert.deepEqual([a.addMoney, a.withdraw, a.reason], [0, 0, FUNDING.AT_TARGET]);
});

/* ---------------- EL CABLEADO, no sólo la función ------------------------- */

test("la pantalla lee el estado REAL del registro, no un undefined que pasa por cero", () => {
  /* La primera versión escribió `capabilityStatus("BETTING_EDGE")?.status`, y
     `capabilityStatus` devuelve una CADENA: el `?.status` daba `undefined`.
     La recomendación seguía saliendo $0 —correcta— por la razón equivocada:
     una lectura rota disfrazada de respuesta honesta. Habría sobrevivido a
     cualquier test de la salida, porque la salida no cambia.

     Se comprueba lo que de verdad importa: que el registro conteste algo
     conocido, y que la pantalla le pase ESO. */
  const src = readFileSync(new URL("../app/betting/BettingShell.jsx", import.meta.url), "utf8");
  const i = src.indexOf("const consejo = fundingAdvice({");
  assert.ok(i > 0, "la derivación de la recomendación cambió de forma");
  const cuerpo = src.slice(i, src.indexOf("});", i));
  assert.match(cuerpo, /edgeStatus:\s*capabilityStatus\("BETTING_EDGE"\)/,
    "la recomendación no lee el registro de capacidades");
  assert.ok(!/capabilityStatus\("BETTING_EDGE"\)\s*\?\./.test(cuerpo),
    "se está pidiendo una propiedad a una cadena: siempre undefined");
  // Y la banca que se le pasa es la del periodo, no la inicial del mes.
  assert.match(cuerpo, /revision\.endingBankroll/,
    "la recomendación no mira la banca de HOY");
});

test("el estado del registro es uno de los declarados", async () => {
  const { capabilityStatus } = await import("../data/model.js");
  const estado = capabilityStatus("BETTING_EDGE");
  assert.equal(typeof estado, "string",
    "si esto deja de ser una cadena, la pantalla la lee mal en silencio");
  assert.ok(["VALIDATED", "REJECTED", "NOT_READY", "BLOCKED", "PARTIAL"].includes(estado),
    `estado desconocido: ${estado}`);
  // Y hoy, el hecho: E4 lo rechazó. Si alguien lo mueve, este test lo dice —
  // no para impedirlo, sino para que no pase sin que nadie lo note.
  assert.equal(estado, "REJECTED",
    "BETTING_EDGE ha cambiado de estado: revisa que el experimento lo sostenga");
});

/* ---------------- EL CALENDARIO DE CUATRO JORNADAS ------------------------ */

test("todo es la MISMA fracción de la banca, arriba y abajo", () => {
  /* La propiedad de 6c, aplicada al mes entero. No se comprueba «baja cuando
     vas abajo» —que un multiplicador de recuperación del 15% ya burló una vez
     en el libro— sino que la FRACCIÓN no se mueva. */
  const a = monthPlan({ startingBank: 1000, weekPct: 5, unitPct: 1 });
  const b = monthPlan({ startingBank: 2000, weekPct: 5, unitPct: 1 });
  assert.equal(a.schedule[0].weekBudget / 1000, b.schedule[0].weekBudget / 2000);
  assert.equal(a.schedule[0].perBet / 1000, b.schedule[0].perBet / 2000);
  // Y el número de apuestas que caben NO depende del tamaño de la banca.
  assert.equal(a.schedule[0].maxBets, b.schedule[0].maxBets);
});

test("el freno RECORTA y nunca amplía", () => {
  const p = monthPlan({ startingBank: 1000, weekPct: 5, unitPct: 1 });
  const plano = p.scenarios.find((s) => s.label === "flat");
  const abajo = p.scenarios.find((s) => s.label.startsWith("down"));
  const arriba = p.scenarios.find((s) => s.label.startsWith("up"));
  assert.ok(abajo.braking, "por debajo del umbral no está frenando");
  assert.ok(abajo.perBet < plano.perBet * 0.8,
    "abajo tiene que cortar MÁS que la propia caída de la banca");
  assert.ok(!arriba.braking, "una racha buena no puede activar el freno");
  // Arriba NO hay factor de ampliación: es la fracción de siempre.
  assert.equal(arriba.perBet / arriba.bank, plano.perBet / plano.bank);
});

test("el techo del mes es el tope semanal por las semanas, y nada más", () => {
  const p = monthPlan({ startingBank: 500, weekPct: 5, unitPct: 1, weeks: 4 });
  assert.equal(p.monthCeilingPct, 20);
  assert.equal(p.schedule.length, 4);
  // Sólo la primera trae números: las otras tres son la REGLA, porque la banca
  // de la jornada 3 exigiría suponer un resultado.
  assert.equal(p.schedule[0].known, true);
  assert.ok(p.schedule.slice(1).every((s) => !s.known && s.weekBudget === undefined),
    "se está proyectando una banca futura: eso es un pronóstico, no una regla");
});

test("una banca que no existe no produce plan", () => {
  for (const malo of [0, -100, null, undefined, "", NaN, "abc"]) {
    assert.equal(monthPlan({ startingBank: malo }), null);
  }
});

test("los props NO son dimensionables, y eso es un hecho de los datos", () => {
  /* Sin cuota no hay probabilidad de mercado, y sin ella no hay Kelly. Las
     líneas de props no viajan en este payload: la pantalla te pide la de tu
     casa. Darles una fracción fija sería inventarse la medición. */
  assert.equal(SIZEABLE.prop, false);
  assert.equal(SIZEABLE.spread, true);
  assert.equal(SIZEABLE.moneyline, true);
});
