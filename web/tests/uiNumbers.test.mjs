// Ninguna cifra escrita a mano en la interfaz sin libro. El libro
// (docs/evidence/ui_numbers.json) dice de dónde sale y qué la comprueba — o
// dice UNVERIFIED, que es distinto de no decir nada. Un número nuevo sin
// entrada es rojo.
import assert from "node:assert/strict";
import test from "node:test";
import { found, ledger, missing } from "../tools/ui-numbers.mjs";

test("todas las cifras a mano del JSX están en el libro", () => {
  assert.ok(found().length >= 20, "el extractor tiene que encontrar cifras: si no, no vigila nada");
  const gaps = missing();
  assert.deepEqual(gaps, [], `sin libro: ${gaps.map((g) => `${g.file} ${g.value}`).join(" | ")}`);
});

test("cada entrada del libro declara su procedencia con un vocabulario cerrado", () => {
  const ok = /^(PAYLOAD|ARITHMETIC|EXPERIMENT:[A-Za-z0-9]+|CONVENTION|UNVERIFIED)$/;
  for (const e of ledger().entries) assert.match(e.source, ok, `${e.file} ${e.value}: ${e.source}`);
});

test("lo que está en el libro sigue existiendo en la pantalla (sin entradas fantasma)", () => {
  const present = new Set(found().map((e) => `${e.file}|${e.value}`));
  for (const e of ledger().entries) assert.ok(present.has(`${e.file}|${e.value}`), `${e.file} ${e.value} ya no está en el JSX: bórrala del libro`);
});
