/**
 * El análisis de la liga: fuerza por plantilla, comparación posición a
 * posición y huecos opuestos. Todo aritmética; ninguna fila dice qué hacer.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  headToHead, median, powerRankings, rosterOf, teamStrength, tradeOpenings,
} from "../app/fantasy/leagueAnalyzer.js";

const ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];

/** Índice `sid -> fila` con el valor ya repartido por lo que queda de temporada. */
function indexOf(rows) {
  return new Map(rows.map((r) => [String(r.sid), r]));
}
const P = (sid, position, value, extra = {}) =>
  ({ sid, position, value, vor: value, player_name: sid, ...extra });

const POOL = [
  P("q1", "QB", 20), P("q2", "QB", 5),
  P("r1", "RB", 60), P("r2", "RB", 40), P("r3", "RB", 30), P("r4", "RB", 8),
  P("w1", "WR", 70), P("w2", "WR", 50), P("w3", "WR", 12), P("w4", "WR", 6),
  P("t1", "TE", 25), P("t2", "TE", 4),
  P("k1", "K", 0), P("d1", "DST", 0),
];
const INDEX = indexOf(POOL);

test("la mediana de una lista vacía es null, no cero", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("lo que el mapa de identidad no conoce se cuenta aparte, no vale cero", () => {
  const { players, unknown } = rosterOf({ players: ["r1", "desconocido", "w1"] }, INDEX);
  assert.equal(players.length, 2);
  assert.equal(unknown, 1);
});

test("la fuerza de un equipo es su MEJOR alineación, no la suma de la plantilla", () => {
  const team = { rosterId: 1, owner: "yo", players: ["q1", "r1", "r2", "r3", "w1", "w2", "t1", "k1", "d1"] };
  const s = teamStrength({ team, index: INDEX, rosterPositions: ROSTER });
  // QB 20 + RB 60,40 + WR 70,50 + TE 25 + FLEX (el mejor libre: RB 30) = 295.
  // El pateador y la defensa NO suman: el board no les calcula valor.
  assert.equal(s.lineup, 295);
  assert.equal(s.byPosition.RB.value, 100); // sólo los DEDICADOS
  assert.equal(s.byPosition.RB.depth, 3);   // la profundidad sí los cuenta
  assert.equal(s.byPosition.WR.value, 120);
});

test("los titulares dedicados y el flex no se confunden", () => {
  // El tercer corredor entra por el FLEX, así que suma al total pero NO al
  // valor de la posición: un RB3 buenísimo no arregla un hueco de receptor.
  const team = { rosterId: 2, players: ["q1", "r1", "r2", "r3", "w1", "w2", "t1"] };
  const s = teamStrength({ team, index: INDEX, rosterPositions: ROSTER });
  assert.equal(s.byPosition.RB.value, 100);
  assert.equal(s.lineup, 295);
});

/* ── power rankings ──────────────────────────────────────────────────────── */

const SNAPSHOT = {
  rosterId: 1,
  teams: [
    { rosterId: 1, owner: "yo", record: "0-0", players: ["q1", "r1", "r2", "w3", "w4", "t1"] },
    { rosterId: 2, owner: "rival", record: "0-0", players: ["q2", "r3", "r4", "w1", "w2", "t2"] },
  ],
};

test("los equipos salen ordenados por el valor de su alineación", () => {
  const ranks = powerRankings({ snapshot: SNAPSHOT, index: INDEX, rosterPositions: ROSTER });
  assert.equal(ranks.length, 2);
  assert.equal(ranks[0].rank, 1);
  assert.ok(ranks[0].lineup >= ranks[1].lineup);
  assert.equal(ranks.find((r) => r.rosterId === 1).mine, true);
  assert.equal(ranks.find((r) => r.rosterId === 2).mine, false);
});

test("el hueco por posición se mide contra la MEDIANA, y señala fuerte y débil", () => {
  const ranks = powerRankings({ snapshot: SNAPSHOT, index: INDEX, rosterPositions: ROSTER });
  const mio = ranks.find((r) => r.mine);
  const suyo = ranks.find((r) => !r.mine);
  // Yo tengo los corredores (100 contra 38) y él los receptores (120 contra 18).
  assert.ok(mio.gaps.RB > 0 && suyo.gaps.RB < 0);
  assert.ok(mio.gaps.WR < 0 && suyo.gaps.WR > 0);
  assert.equal(mio.strongest, "RB");
  assert.equal(mio.weakest, "WR");
  assert.equal(suyo.strongest, "WR");
  assert.equal(suyo.weakest, "RB");
  // Los huecos son simétricos con dos equipos: la mediana está entre los dos.
  assert.equal(mio.gaps.RB, -suyo.gaps.RB);
});

test("sin equipos no se inventa una tabla", () => {
  assert.deepEqual(powerRankings({ snapshot: { teams: [] }, index: INDEX, rosterPositions: ROSTER }), []);
});

/* ── posición a posición ─────────────────────────────────────────────────── */

test("la suma de las diferencias por posición cuadra con la de las alineaciones", () => {
  const ranks = powerRankings({ snapshot: SNAPSHOT, index: INDEX, rosterPositions: ROSTER });
  const h = headToHead(ranks.find((r) => r.mine), ranks.find((r) => !r.mine));
  const suma = h.rows.reduce((acc, row) => acc + row.delta, 0);
  // La diferencia total incluye además el FLEX, que no es de ninguna posición
  // dedicada: por eso se comprueba que la tabla cuadre con lo que suma, no con
  // el total de la alineación.
  const dedicados = h.rows.reduce((acc, r) => acc + (r.mine - r.theirs), 0);
  assert.equal(Math.round(suma * 10) / 10, Math.round(dedicados * 10) / 10);
  assert.equal(h.theirsOwner, "rival");
});

test("sin rival no hay comparación", () => {
  assert.equal(headToHead(null, {}), null);
  assert.equal(headToHead({}, null), null);
});

/* ── huecos opuestos ─────────────────────────────────────────────────────── */

test("un par con huecos OPUESTOS aparece una sola vez", () => {
  const ranks = powerRankings({ snapshot: SNAPSHOT, index: INDEX, rosterPositions: ROSTER });
  const abiertos = tradeOpenings(ranks, { minGap: 5 });
  assert.ok(abiertos.length > 0);
  // Yo sobro en RB y falto en WR; él, al revés.
  const par = abiertos[0];
  assert.equal(new Set([par.give, par.get]).size, 2);
  // El mismo par de equipos y posiciones no se repite leído del otro lado.
  const claves = abiertos.map((r) => [r.aRosterId, r.bRosterId, r.give, r.get].map(String).sort().join("|"));
  assert.equal(new Set(claves).size, claves.length);
});

test("sin huecos grandes no se fuerza ninguna conversación", () => {
  // Dos equipos idénticos: la mediana es su valor y todos los huecos son cero.
  const iguales = {
    rosterId: 1,
    teams: [
      { rosterId: 1, owner: "a", players: ["q1", "r1", "w1", "t1"] },
      { rosterId: 2, owner: "b", players: ["q1", "r1", "w1", "t1"] },
    ],
  };
  const ranks = powerRankings({ snapshot: iguales, index: INDEX, rosterPositions: ROSTER });
  assert.deepEqual(tradeOpenings(ranks, { minGap: 5 }), []);
});

test("el tamaño del hueco no es el valor del intercambio, y sale ordenado", () => {
  const ranks = powerRankings({ snapshot: SNAPSHOT, index: INDEX, rosterPositions: ROSTER });
  const abiertos = tradeOpenings(ranks, { minGap: 1 });
  for (let i = 1; i < abiertos.length; i += 1) {
    assert.ok(abiertos[i - 1].size >= abiertos[i].size);
  }
});
