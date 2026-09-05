// §37 — 500 casos al azar generados por Python: el compilador de JS tiene que
// decir exactamente lo mismo. Si un coeficiente se renombra en un lado y no en
// el otro, aquí sale.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compilePoints } from "../app/fantasy/scoring.js";

const { cases } = JSON.parse(readFileSync(new URL("./fixtures/scoring_parity.json", import.meta.url), "utf8"));

test("paridad Python ↔ JS del compilador de puntos sobre 500 casos al azar", () => {
  assert.ok(cases.length >= 500);
  let worst = 0;
  for (const c of cases) {
    const js = compilePoints(c.components, c.rules, c.position);
    const diff = Math.abs(js - c.points);
    worst = Math.max(worst, diff);
    assert.ok(diff < 1e-9, `${c.position}: JS ${js} vs Python ${c.points} (dif ${diff})`);
  }
  assert.ok(worst < 1e-9);
});
