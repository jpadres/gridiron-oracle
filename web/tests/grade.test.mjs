/**
 * LIQUIDAR CONTRA EL MARCADOR. Los bordes son el test, no el caso fácil.
 *
 * El push exacto, el handicap con el signo contrario al margen y el hueco
 * presente-y-nulo son los tres sitios por donde esto se rompe, y los tres ya
 * han costado una iteración en este repositorio con otra cara.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { GRADE, UNDECIDED_REASON, gradeBet, resultsIndex } from "../app/betting/grade.js";

/** NE 10 @ SEA 13: el local gana por 3, el total es 23. */
const INDEX = resultsIndex([
  { game_id: "g1", home_team: "SEA", away_team: "NE", home_score: 13, away_score: 10 },
  { game_id: "sin", home_team: "BUF", away_team: "MIA", home_score: null, away_score: null },
]);

const g = (bet) => gradeBet({ gameId: "g1", ...bet }, INDEX);

test("el no favorito cubre perdiendo por menos que su handicap", () => {
  assert.equal(g({ market: "SPREAD", selection: "NE", line: 3.5 }).grade, GRADE.WON);
});

test("el favorito no cubre ganando por menos que su handicap", () => {
  assert.equal(g({ market: "SPREAD", selection: "SEA", line: -3.5 }).grade, GRADE.LOST);
});

test("el handicap EXACTO es push, no una victoria del favorito", () => {
  // El borde: 13-10 con SEA -3. Es el caso que un `>` mal puesto convierte en
  // dinero que no se ganó.
  assert.equal(g({ market: "SPREAD", selection: "SEA", line: -3 }).grade, GRADE.PUSH);
  assert.equal(g({ market: "SPREAD", selection: "NE", line: 3 }).grade, GRADE.PUSH);
});

test("el signo del handicap es el CONTRARIO al del margen", () => {
  // Ya costó una iteración («MIA -3.5» para un MIA que recibía 3,5): un
  // favorito se guarda en negativo y se SUMA al margen.
  assert.equal(g({ market: "SPREAD", selection: "SEA", line: -2.5 }).grade, GRADE.WON);
  assert.equal(g({ market: "SPREAD", selection: "NE", line: 2.5 }).grade, GRADE.LOST);
});

test("el total exacto es push", () => {
  assert.equal(g({ market: "TOTAL", selection: "OVER", line: 23 }).grade, GRADE.PUSH);
  assert.equal(g({ market: "TOTAL", selection: "UNDER", line: 23 }).grade, GRADE.PUSH);
});

test("over y under son respuestas OPUESTAS sobre el mismo total", () => {
  const over = g({ market: "TOTAL", selection: "OVER", line: 22.5 }).grade;
  const under = g({ market: "TOTAL", selection: "UNDER", line: 22.5 }).grade;
  assert.equal(over, GRADE.WON);
  assert.equal(under, GRADE.LOST);
  assert.notEqual(over, under, "los dos lados no pueden ganar");
});

test("el moneyline no necesita línea", () => {
  assert.equal(g({ market: "MONEYLINE", selection: "SEA" }).grade, GRADE.WON);
  assert.equal(g({ market: "MONEYLINE", selection: "NE" }).grade, GRADE.LOST);
});

test("un partido SIN marcador no se liquida como 0-0", () => {
  // `Number(null)` vale CERO y es finito: por ahí un partido sin jugar habría
  // salido empate, y un empate declara PUSH en cada spread de 0. Cuarta forma
  // del mismo fallo en este repositorio.
  const r = gradeBet({ gameId: "sin", market: "SPREAD", selection: "BUF", line: 0 }, INDEX);
  assert.equal(r.grade, GRADE.UNDECIDED);
  assert.equal(r.reason, UNDECIDED_REASON.NOT_FINAL);
});

test("un prop NO se liquida con el marcador, y se dice", () => {
  const r = g({ market: "PROP_PASS_YDS", selection: "OVER", line: 250 });
  assert.equal(r.grade, GRADE.UNDECIDED);
  assert.equal(r.reason, UNDECIDED_REASON.NO_SETTLEMENT_SOURCE);
});

test("una apuesta de spread sin línea queda sin decidir, no perdida", () => {
  const r = g({ market: "SPREAD", selection: "NE", line: null });
  assert.equal(r.grade, GRADE.UNDECIDED);
  assert.equal(r.reason, UNDECIDED_REASON.NO_LINE);
});

test("un lado que no es ninguno de los dos equipos no se adivina", () => {
  assert.equal(g({ market: "SPREAD", selection: "KC", line: -3 }).reason,
               UNDECIDED_REASON.NO_SELECTION);
  assert.equal(g({ market: "TOTAL", selection: "SEA", line: 40 }).reason,
               UNDECIDED_REASON.NO_SELECTION);
});

test("un partido que no está en los resultados no se liquida", () => {
  assert.equal(gradeBet({ gameId: "zzz", market: "SPREAD", selection: "NE", line: 3 }, INDEX).reason,
               UNDECIDED_REASON.NO_RESULT);
});

test("lo decidido lleva SIEMPRE el marcador que lo sostiene", () => {
  for (const bet of [
    { market: "SPREAD", selection: "NE", line: 3.5 },
    { market: "TOTAL", selection: "UNDER", line: 30 },
    { market: "MONEYLINE", selection: "SEA" },
  ]) {
    const r = g(bet);
    assert.notEqual(r.grade, GRADE.UNDECIDED);
    assert.match(r.basis, /13/, "un veredicto sin marcador no se puede discutir");
  }
});

// --- lo que la PANTALLA tiene que hacer con eso -----------------------------

const SHELL = readFileSync(new URL("../app/betting/BettingShell.jsx", import.meta.url), "utf8");

test("la pantalla de apuestas liquida desde el marcador", () => {
  assert.match(SHELL, /gradeBet/, "nadie llama a la regla de liquidación");
  assert.match(SHELL, /results = \[\]/, "la pantalla no recibe los marcadores");
});

test("liquidar desde el marcador es una ACCIÓN, no un efecto silencioso", () => {
  // Una apuesta liquidada es un hecho del dueño: sobrescribirla desde un
  // marcador le quita el último voto sobre su propio dinero (una cancelación,
  // una línea distinta a la que le dieron, un VOID de la casa).
  assert.doesNotMatch(
    SHELL,
    /useEffect\([^)]*\n?[^}]*settleBet/,
    "la liquidación automática no puede ocurrir dentro de un efecto",
  );
  assert.match(SHELL, /Settle \{liquidables\.length\} from the score/);
});

test("lo que no se puede liquidar dice POR QUÉ", () => {
  assert.match(SHELL, /NO_SETTLEMENT_SOURCE/);
  assert.match(SHELL, /a final score does not contain a player stat/);
});

// --- y lo que este producto NO publica --------------------------------------

test("no se publica ningún EV de apuesta combinada", () => {
  /* El EV de un parlay es el PRODUCTO de los de sus patas, así que combinar
     patas de EV negativo a precio de casa siempre empeora — y la pantalla
     enseñaría un número grande al lado de una decisión peor. Aquí no existe
     ninguna, y esto es lo que lo mantiene así: la comprobación es la promesa.
     Si algún día se añade, este test se pone rojo y hay que medirla antes. */
  for (const archivo of ["grade.js", "noBet.js", "plan.js", "leans.js", "bankroll.js"]) {
    const fuente = readFileSync(new URL(`../app/betting/${archivo}`, import.meta.url), "utf8");
    assert.doesNotMatch(fuente, /parlay|accumulator|multi[-_]?leg/i,
                        `${archivo} habla de combinadas: hay que medir su EV antes de publicarlo`);
  }
  assert.doesNotMatch(SHELL, /parlay|accumulator|multi[-_]?leg/i);
});
