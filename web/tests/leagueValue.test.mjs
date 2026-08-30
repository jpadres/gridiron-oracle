/**
 * E18 en el navegador: el valor por liga, y la paridad con Python.
 *
 * El riesgo que cubre esto no es que la función esté mal: es que esté **un poco
 * distinta** de la de Python. Dos implementaciones del mismo reparto que
 * discrepan en un puesto producen dos boards que casi coinciden, y «casi» aquí
 * significa que la pantalla y el artefacto publicado no hablan de la misma liga.
 *
 * Por eso el fixture lo genera Python sobre las 861 proyecciones reales y aquí
 * se exige IGUALDAD, no parecido.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  VALIDATED_MAX_TEAMS, buildLeagueBoard, greedyReplacement, rosterContext, valueConfidence,
} from "../app/fantasy/leagueValue.js";

const PARITY = JSON.parse(
  readFileSync(new URL("./fixtures/greedy_parity.json", import.meta.url))
);

test("E18 · paridad exacta con Python en las siete plantillas", () => {
  for (const [name, expected] of Object.entries(PARITY.cases)) {
    const context = rosterContext(expected.roster, expected.teams);
    assert.equal(context.supported, true, name);
    assert.equal(context.slots, expected.slots, `${name}: huecos`);
    const got = greedyReplacement(PARITY.points, context);
    assert.equal(got.consumed, expected.consumed, `${name}: huecos consumidos`);
    assert.deepEqual(got.rank, expected.rank, `${name}: rank de reemplazo`);
    for (const [position, value] of Object.entries(expected.replacement)) {
      assert.ok(Math.abs(got.replacement[position] - value) < 1e-6,
                `${name} ${position}: ${got.replacement[position]} vs ${value}`);
    }
  }
});

test("E18 · el voraz consume exactamente los huecos titulares", () => {
  for (const [name, expected] of Object.entries(PARITY.cases)) {
    const context = rosterContext(expected.roster, expected.teams);
    const { consumed } = greedyReplacement(PARITY.points, context);
    assert.equal(consumed, context.slots, `${name}`);
  }
});

test("E18 · superflex profundiza el reemplazo del QB", () => {
  const one = rosterContext(PARITY.cases.base12.roster, 12);
  const sf = rosterContext(PARITY.cases.superflex12.roster, 12);
  const a = greedyReplacement(PARITY.points, one);
  const b = greedyReplacement(PARITY.points, sf);
  assert.ok(b.rank.QB / a.rank.QB >= 1.8, `${a.rank.QB} -> ${b.rank.QB}`);
  assert.ok(b.replacement.QB < a.replacement.QB, "y el reemplazo vale menos");
  // Y no toca a las demás: el superflex sólo compite por quarterbacks.
  assert.equal(b.rank.RB, a.rank.RB);
  assert.equal(b.rank.WR, a.rank.WR);
});

test("E18 · una posición agotada sale en `short`, no con un VOR inventado", () => {
  // Pool deliberadamente corto: 5 QB para una liga que necesita 24.
  const context = rosterContext(PARITY.cases.superflex12.roster, 12);
  const { short } = greedyReplacement(
    { QB: [300, 290, 280, 270, 260], RB: PARITY.points.RB,
      WR: PARITY.points.WR, TE: PARITY.points.TE },
    context
  );
  assert.ok(short.includes("QB"), "el QB se agota y se dice");
});

test("E18 · un board con posición corta no publica VOR de esa posición", () => {
  const context = rosterContext(PARITY.cases.superflex12.roster, 12);
  const players = [
    ...[300, 290, 280].map((p, i) => ({ player_id: `qb${i}`, position: "QB", components: {}, projected: p })),
    ...PARITY.points.RB.slice(0, 60).map((p, i) => ({ player_id: `rb${i}`, position: "RB", components: {}, projected: p })),
  ];
  const { rows, short } = buildLeagueBoard({
    players, rules: {}, context, games: 1,
    // `compilePoints` de mentira: devuelve el valor ya puesto, para probar el
    // reparto y no la compilación (que ya prueba E15).
    compilePoints: (_c, _r, _p) => 0,
    priors: null,
  });
  void rows;
  assert.ok(short.includes("QB"));
  const qb = rows.filter((r) => r.position === "QB");
  assert.ok(qb.every((r) => r.vor === null && r.value_known === false),
            "ningún QB recibe VOR cuando su reemplazo cae fuera del pool");
});

test("E18 · plantilla no soportada: no hay board, y se dice por qué", () => {
  const bad = rosterContext(["QB", "RB", "LB", "BN"], 12);
  assert.equal(bad.supported, false);
  assert.match(bad.reason, /LB/);
  assert.equal(rosterContext(["QB", "RB"], null).supported, false);
  assert.equal(rosterContext([], 12).supported, false);
});

test("E18 · cero titulares en una posición no se convierte en el valor por defecto", () => {
  const context = rosterContext(["QB", "RB", "RB", "WR", "WR", "WR", "FLEX", "BN"], 12);
  assert.equal(context.supported, true);
  assert.equal(context.dedicated.TE, 0, "no se inventa un ala cerrada titular");
});

test("E18b · el valor no se afirma en ligas muy profundas", () => {
  const reducido = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];
  for (const teams of [10, 12, 14]) {
    assert.equal(valueConfidence(rosterContext(reducido, teams)), "VALIDATED", `${teams}`);
  }
  for (const teams of [16, 20, 32]) {
    assert.equal(valueConfidence(rosterContext(reducido, teams)), "UNVALIDATED_DEPTH", `${teams}`);
  }
  assert.equal(VALIDATED_MAX_TEAMS, 14);
});

test("E18b · una liga de 32 sigue calculando: no se afirma, no se bloquea", () => {
  // La distinción que importa. `UNVALIDATED_DEPTH` etiqueta; no vacía el board.
  const roster = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];
  const context = rosterContext(roster, 32);
  assert.equal(context.supported, true);
  const { consumed, rank } = greedyReplacement(PARITY.points, context);
  assert.equal(consumed, context.slots, "el reparto cuadra igual que a 12");
  assert.ok(rank.QB > 30, `el reemplazo se profundiza: QB${rank.QB}`);
});
