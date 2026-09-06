/**
 * BEST AVAILABLE dice, fila a fila, lo que ese jugador añade a TU alineación.
 *
 * El fallo que existe para cazar es el del draft real del 6 de septiembre: con
 * el TE ya puesto, la fila de Bowers decía «Last TE in tier 8» y nada más, y
 * en un teléfono esa lista es lo primero que se ve. La lista NO se reordena
 * —sigue en VOR puro—; lo que se exige es que cada fila lleve el segundo
 * término de la resta, leído del MISMO `byId` del motor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const src = fs.readFileSync(new URL("../app/fantasy/DraftRoom.jsx", import.meta.url), "utf8");

test("cada fila de Best available pinta la frase de ajuste a la plantilla", () => {
  const i = src.indexOf('aria-label="Top available"');
  assert.ok(i > 0, "no encuentro la sección Best available");
  const bloque = src.slice(i, src.indexOf("room-flash", i));
  assert.match(bloque, /\{fitLine\(entry\.row\)\s*\?\s*\(/, "las filas no llaman a fitLine");
});

test("la frase sale del byId del motor y dice «adds nothing» con el titular ya puesto", () => {
  const i = src.indexOf("const fitLine = useCallback(");
  assert.ok(i > 0, "no existe fitLine");
  const cuerpo = src.slice(i, src.indexOf("}, [forMe]);", i));
  assert.match(cuerpo, /forMe\?\.byId\?\.get\?\.\(row\.player_id\)/, "no lee el byId del motor");
  assert.match(cuerpo, /Adds nothing to your lineup/, "no dice que no añade nada");
  assert.match(cuerpo, /STARTER_FILLED/, "no distingue el titular ya puesto");
  assert.doesNotMatch(cuerpo, /\.sort\(|orderByFit\(/, "la frase no puede reordenar la lista");
});
