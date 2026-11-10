/**
 * ¿ES ESPAÑOL? Los MISMOS casos que prueba el gemelo de Python.
 *
 * `tools/spanish.mjs` (la puerta de CI) y `oracle.narrative.sweep.looks_spanish`
 * (el filtro del barrido de prensa) son la misma regla en dos lenguajes. Ya se
 * comprobaba que compartieran la lista de palabras; no bastó: discrepaban en la
 * tilde, el barrido publicó un titular con «Audric Estimé» y la puerta lo
 * rechazó. El fichero de casos es uno solo y lo leen los dos lados
 * (`tests/test_sweep.py` es el otro).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { esEspanol } from "../tools/spanish.mjs";

const CASOS = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/spanish_cases.json", import.meta.url), "utf8"));

test("hay casos de los dos lados", () => {
  assert.ok(CASOS.length >= 10, "sin casos, lo de abajo pasaría sin comparar nada");
  assert.ok(CASOS.some((c) => c.spanish) && CASOS.some((c) => !c.spanish));
});

test("el veredicto es el del fichero de casos, uno a uno", () => {
  for (const caso of CASOS) {
    assert.equal(esEspanol(caso.text), caso.spanish, `«${caso.text}» — ${caso.why}`);
  }
});

test("una tilde en un nombre propio no convierte una frase inglesa en española", () => {
  // El caso que dejó CI en rojo, aislado: sin él, alguien «endurece» la regla
  // de la tilde y el paso de idioma vuelve a apagar los seis que van detrás.
  assert.equal(esEspanol("RB Audric Estimé is active"), false);
  assert.equal(esEspanol("Estimé"), false);
  // Y la otra dirección: la tilde de una palabra COMÚN sigue siendo concluyente.
  assert.equal(esEspanol("coverage más profunda"), true);
});

test("una etiqueta suelta de interfaz sigue cayendo por la lista literal", () => {
  assert.equal(esEspanol("SIN EQUIPO"), true);
  assert.equal(esEspanol("5 LEFT"), false);
  // Con frontera de palabra: un identificador que la contiene no es la frase.
  assert.equal(esEspanol("misTitulares"), false);
});

test("la auditoría usa ESTE detector y no una copia", () => {
  const audit = readFileSync(new URL("../tools/audit-spanish.mjs", import.meta.url), "utf8");
  assert.match(audit, /import \{ esEspanol \} from "\.\/spanish\.mjs";/);
  assert.doesNotMatch(audit, /function esEspanol\(/, "la auditoría ha vuelto a definir su propio detector");
  assert.doesNotMatch(audit, /const FUNCIONALES\s*=/, "y su propia lista de palabras");
});
