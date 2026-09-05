// §17 — Pools ADVERSARIOS para el reparto de huecos compartidos.
//
// E18 probó la paridad con Python sobre siete plantillas y un pool realista.
// Esto ataca al reparto con pools construidos para que el flex tenga que
// irse ENTERO a una posición, y comprueba lo que un board de verdad exige:
//
//   · el reemplazo es el PRIMERO que no es titular, en cada posición;
//   · los huecos consumidos son exactamente los que la liga declara;
//   · el orden de entrada del pool no cambia nada;
//   · una posición inflada (TE premium) se lleva el flex, y una hundida no;
//   · el superflex va al mejor DISPONIBLE, no al mejor QB por definición.
import assert from "node:assert/strict";
import test from "node:test";
import { greedyReplacement, rosterContext } from "../app/fantasy/leagueValue.js";

const desc = (n, top, step) => Array.from({ length: n }, (_, i) => top - i * step);
const STD = rosterContext(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"], 12);

test("RB profundo y WR llano: los doce flex van al WR y el reemplazo del RB es el 25", () => {
  // Los RB caen 6 puntos por puesto: tras los 24 titulares, el RB25 vale 106.
  // Los WR caen 1 punto: tras los 36 titulares, el WR37 vale 214 > 106.
  const pool = { QB: desc(40, 350, 5), RB: desc(80, 250, 6), WR: desc(120, 250, 1), TE: desc(40, 150, 4) };
  const { rank, consumed, short } = greedyReplacement(pool, STD);
  assert.deepEqual(short, []);
  assert.equal(consumed, STD.slots);
  assert.equal(rank.RB, 25, "ningún flex fue al RB");
  assert.equal(rank.WR, 49, "los doce flex fueron al WR");
  assert.equal(rank.TE, 13);
  assert.equal(rank.QB, 13);
});

test("WR profundo y RB llano: el espejo exacto", () => {
  const pool = { QB: desc(40, 350, 5), RB: desc(80, 250, 1), WR: desc(120, 250, 6), TE: desc(40, 150, 4) };
  const { rank, consumed } = greedyReplacement(pool, STD);
  assert.equal(consumed, STD.slots);
  assert.equal(rank.RB, 37);
  assert.equal(rank.WR, 37);
});

test("TE premium: cuando los TE valen más que el resto, el flex se llena de TE", () => {
  const pool = { QB: desc(40, 350, 5), RB: desc(80, 200, 3), WR: desc(120, 200, 2), TE: desc(40, 400, 2) };
  const { rank, consumed } = greedyReplacement(pool, STD);
  assert.equal(consumed, STD.slots);
  assert.equal(rank.TE, 25, "doce huecos de TE + doce flex");
  assert.equal(rank.RB, 25);
  assert.equal(rank.WR, 37);
});

test("el reemplazo es el PRIMERO que no es titular: rank = consumidos de esa posición + 1", () => {
  const pool = { QB: desc(40, 350, 5), RB: desc(80, 250, 3), WR: desc(120, 240, 2), TE: desc(40, 150, 4) };
  const { rank, consumed } = greedyReplacement(pool, STD);
  const takenTotal = Object.values(rank).reduce((a, r) => a + (r - 1), 0);
  assert.equal(takenTotal, consumed);
  assert.equal(consumed, STD.slots);
});

test("el orden de entrada del pool es irrelevante", () => {
  const pool = { QB: desc(40, 350, 5), RB: desc(80, 250, 3), WR: desc(120, 240, 2), TE: desc(40, 150, 4) };
  const shuffled = Object.fromEntries(Object.entries(pool).map(([p, v]) => [p, [...v].reverse()]));
  const a = greedyReplacement(pool, STD);
  const b = greedyReplacement(shuffled, STD);
  assert.deepEqual(a.replacement, b.replacement);
  assert.deepEqual(a.rank, b.rank);
});

test("superflex: va al QB mientras el QB disponible valga más, y deja de ir cuando no", () => {
  const SF = rosterContext(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"], 12);
  assert.equal(SF.isSuperflex, true);
  // QB13..QB24 valen más que cualquier RB/WR disponible: los doce SF son QB.
  const rich = { QB: desc(40, 350, 3), RB: desc(80, 200, 3), WR: desc(120, 200, 2), TE: desc(40, 150, 4) };
  assert.equal(greedyReplacement(rich, SF).rank.QB, 25);
  // Sólo hay 14 QB proyectados por encima del mejor RB libre: 12 dedicados +
  // 2 al superflex, y los otros diez SF se van a quien vale más.
  const thin = { QB: [...desc(14, 350, 3), ...desc(26, 100, 1)], RB: desc(80, 200, 1), WR: desc(120, 200, 1), TE: desc(40, 150, 4) };
  const { rank, consumed } = greedyReplacement(thin, SF);
  assert.equal(rank.QB, 15, "el SF no es «un QB por definición»: es el mejor disponible");
  assert.equal(consumed, SF.slots);
});

test("una posición SIN pool no recibe reemplazo y el consumo lo delata", () => {
  const pool = { QB: desc(40, 350, 5), RB: desc(80, 250, 3), WR: desc(120, 240, 2), TE: [] };
  const { replacement, consumed } = greedyReplacement(pool, STD);
  assert.equal(replacement.TE, undefined);
  assert.equal(consumed, STD.slots - 12, "los doce huecos de TE no se pudieron llenar");
});

test("liga de 32 con tres flex: el reparto sigue cuadrando aunque el valor no se afirme", () => {
  const BIG = rosterContext(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX", "BN"], 32);
  const pool = { QB: desc(64, 350, 3), RB: desc(200, 250, 1), WR: desc(260, 240, 1), TE: desc(90, 150, 2) };
  const { rank, consumed, short } = greedyReplacement(pool, BIG);
  assert.equal(consumed, BIG.slots);
  assert.deepEqual(short, []);
  const takenTotal = Object.values(rank).reduce((a, r) => a + (r - 1), 0);
  assert.equal(takenTotal, consumed);
});
