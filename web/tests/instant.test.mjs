/**
 * UN INSTANTE ESCRITO PARA LEERSE, sin inventar nada por el camino.
 *
 * `instantLabel` convierte el ISO del payload en algo que cabe en un teléfono.
 * Lo que se guarda aquí es lo que NO puede hacer: cambiar el instante, quitarle
 * el año o la zona, ni rellenar un hueco.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { instantLabel } from "../app/instant.js";

test("una fecha sola se escribe con su año", () => {
  assert.equal(instantLabel("2026-10-14"), "Oct 14, 2026");
  assert.equal(instantLabel("2026-01-05"), "Jan 5, 2026");
});

test("un instante se escribe en UTC, con la zona y con el año", () => {
  assert.equal(instantLabel("2026-10-14T13:59:16Z"), "Oct 14, 2026 · 13:59 UTC");
  assert.equal(instantLabel("2026-10-14T13:59:16.123456+00:00"), "Oct 14, 2026 · 13:59 UTC");
});

test("un instante con otra zona es EL MISMO instante, no la misma hora de pared", () => {
  // Las 20:20 del Este del día 14 son las 00:20 UTC del 15: cambia el DÍA.
  assert.equal(instantLabel("2026-10-14T20:20:00-04:00"), "Oct 15, 2026 · 00:20 UTC");
});

test("sin zona no es un instante y no se adivina", () => {
  // `Date.parse` lo leería en la hora local de quien ejecuta: el build y el
  // navegador pintarían dos horas distintas rotuladas las dos «UTC».
  assert.equal(instantLabel("2026-10-14T13:59:16"), "2026-10-14T13:59:16");
  assert.equal(instantLabel("2026-10-14T13:59"), "2026-10-14T13:59");
});

test("lo que no es una fecha se devuelve tal cual, y un hueco sigue siendo un hueco", () => {
  assert.equal(instantLabel("last Tuesday"), "last Tuesday");
  assert.equal(instantLabel("2026-13-40"), "2026-13-40");
  for (const hueco of [null, undefined, ""]) assert.equal(instantLabel(hueco), null);
});

test("el resultado no depende de la zona de quien lo ejecuta", () => {
  const src = readFileSync(new URL("../app/instant.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /toLocale|getHours\(|getDate\(|getMonth\(|getFullYear\(|Date\.now/,
    "instant.js lee la hora LOCAL o el reloj: el servidor y el navegador no pintarían lo mismo");
});

test("las pantallas que pintan un instante del payload pasan por aquí", () => {
  for (const ruta of ["../app/salud/HealthTable.jsx", "../app/salud/HealthBoard.jsx",
                      "../app/fantasy/waivers/WaiversShell.jsx"]) {
    const src = readFileSync(new URL(ruta, import.meta.url), "utf8");
    assert.match(src, /instantLabel\(/, `${ruta} pinta el ISO en crudo`);
  }
});
