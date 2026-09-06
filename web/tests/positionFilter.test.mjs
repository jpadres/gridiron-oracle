/**
 * El filtro por posición: una lente sobre lo que se pinta, nunca sobre el motor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  POSITION_FILTERS, isBoardFilter, matchesFilter, positionsOf,
} from "../app/fantasy/positionFilter.js";

test("las cuatro combinaciones que se piden existen y cubren lo que dicen", () => {
  for (const combo of ["RB+WR", "WR+TE", "QB+TE", "K+DST"]) {
    assert.ok(POSITION_FILTERS.includes(combo), `falta ${combo}`);
  }
  assert.deepEqual(positionsOf("RB+WR"), ["RB", "WR"]);
  assert.ok(matchesFilter({ position: "WR" }, "RB+WR"));
  assert.ok(matchesFilter({ position: "RB" }, "RB+WR"));
  assert.ok(!matchesFilter({ position: "TE" }, "RB+WR"));
});

test("ALL no acota nada, y eso NO es lo mismo que una lista vacía", () => {
  assert.equal(positionsOf("ALL"), null);
  assert.ok(matchesFilter({ position: "DST" }, "ALL"));
  assert.ok(matchesFilter({ position: "QB" }, null));
});

test("una combinación con pateador o defensa no va al board de VOR", () => {
  // Mezclar en la misma tabla lo que tiene VOR con lo que no ordenaría dos
  // cosas distintas bajo una sola cabecera.
  assert.equal(isBoardFilter("RB+WR"), true);
  assert.equal(isBoardFilter("QB+TE"), true);
  assert.equal(isBoardFilter("K+DST"), false);
  assert.equal(isBoardFilter("K"), false);
  assert.equal(isBoardFilter("ALL"), true);
});

test("las dos pantallas leen el MISMO reparto, no una copia cada una", () => {
  for (const ruta of ["app/fantasy/BoardShell.jsx", "app/fantasy/DraftMode.jsx"]) {
    const fuente = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(fuente, /from "\.\/positionFilter\.js"/, `${ruta} no usa el reparto compartido`);
    assert.ok(
      !/POSITION_FILTERS\s*=\s*\[/.test(fuente),
      `${ruta} vuelve a declarar la lista: dos copias del mismo reparto`,
    );
  }
});
