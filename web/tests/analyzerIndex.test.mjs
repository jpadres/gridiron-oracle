/**
 * EL ANALIZADOR REPARTE LOS HUECOS CON EL ÍNDICE SEMANAL, Y SÓLO CON ÉSE.
 *
 * El fallo: `paraAlinear` fundía el board de resto de temporada «por debajo»
 * del índice semanal, y el board no conoce defensas — conoce proyecciones de
 * TEMPORADA. 167 de 483 filas del pool quedaban en esa escala y el start/sit
 * mandaba al banquillo al titular de verdad. Se lee el CÓDIGO: el índice del
 * reparto sale de `fullWeeklyIndex` y no hay ningún `new Map(index)` que
 * vuelva a meter el board.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const src = fs.readFileSync(new URL("../app/fantasy/analisis/AnalyzerShell.jsx", import.meta.url), "utf8");

test("paraAlinear se construye con fullWeeklyIndex (semanal + K + DEF) y nada más", () => {
  const i = src.indexOf("const paraAlinear = useMemo(");
  assert.ok(i > 0, "no existe paraAlinear");
  const cuerpo = src.slice(i, src.indexOf(");", i) + 2);
  assert.match(cuerpo, /fullWeeklyIndex\(\{\s*rankings:\s*weekly,\s*kickers:\s*weeklyKickers,\s*defenses:\s*weeklyDefenses\s*\}\)/,
    "el índice del reparto no sale de fullWeeklyIndex con las defensas");
  assert.doesNotMatch(cuerpo, /new Map\(index\)|\bindex\b/, "el board de temporada vuelve a entrar en el reparto");
});

test("la página del analizador pasa las defensas semanales", () => {
  const page = fs.readFileSync(new URL("../app/fantasy/analisis/page.jsx", import.meta.url), "utf8");
  assert.match(page, /weeklyDefenses=\{model\.fantasy_weekly\?\.defenses \?\? \[\]\}/);
});
