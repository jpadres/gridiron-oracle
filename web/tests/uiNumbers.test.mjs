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

test("el extractor no se queda ciego a partir de una comparación en el código", () => {
  /* EL SUELO DE 20 ERA EL «suma >= pintadas» OTRA VEZ.
     El extractor quitaba etiquetas con `<[^>]+>`, y ese patrón cruza saltos de
     línea: un `<` de comparación (`row.wg + 10 >= 0.6`) se traga desde ahí
     hasta el siguiente `>`. En `app/fantasy/page.jsx` sobrevivían 2.470 de
     29.848 caracteres — el 8% — y el guardián decía «todos los números tienen
     libro» sobre ese 8%. Con el suelo en 20 y 31 encontradas, seguía verde.

     La propiedad que sí distingue las dos versiones no es un conteo: es que
     cifras CONCRETAS de tramos que caen después de una comparación estén ahí.
     Con el extractor viejo ninguna de estas tres aparece. */
  const hay = new Set(found().map((e) => `${e.file}|${e.value}`));
  for (const clave of [
    "app/fantasy/page.jsx|129 points",   // detrás de varias comparaciones del fichero
    "app/fantasy/page.jsx|n=123",        // y además cierra en `{" "}`, no en `<`
    "app/modelo/page.jsx|47.8%",
  ]) {
    assert.ok(hay.has(clave), `el extractor no ve ${clave}: se está quedando ciego`);
  }
});

test("un tamaño de muestra escrito a mano también necesita libro", () => {
  // «n=128» convivió meses con una medición que decía 123, y no era rojo
  // porque el patrón sólo miraba decimales. Un entero con unidad o un `n=`
  // no admiten otra lectura que «esto es una medición».
  const libro = new Set(ledger().entries.map((e) => `${e.file}|${e.value}`));
  assert.ok(libro.has("app/fantasy/page.jsx|n=123"));
  assert.ok(libro.has("app/fantasy/page.jsx|129 points"));
});
