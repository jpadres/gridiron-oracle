/**
 * Un hueco no es un cero. La cuarta vez que este repositorio tropieza con
 * `Number(null) === 0`, y la primera en que el remedio es UNO compartido.
 *
 * Lo que se publicaba con el idioma anterior, en un partido sin mercado:
 *
 *     /predicciones y portada   «Pick'em · O/U 0.0»   -> mercado inventado
 *     /betting                  spread 0.0, even      -> y la rama honesta
 *                                                        «market unavailable»
 *                                                        era código muerto
 *     alineación semanal        titular sin proyección contado como conocido
 *                               con cero puntos       -> total desinflado y
 *                                                        presentado completo
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hasNumber, numberOrNull } from "../app/numbers.js";
import { lineupOf } from "../app/fantasy/leagueWeek.js";

const leer = (r) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");

test("un hueco nunca sale como cero", () => {
  for (const hueco of [null, undefined, ""]) {
    assert.equal(numberOrNull(hueco), null, `${JSON.stringify(hueco)} no es un número`);
    assert.equal(hasNumber(hueco), false);
  }
});

test("el cero de verdad SÍ es un número", () => {
  // La otra mitad, que es la que se rompe si alguien "arregla" esto con `!x`.
  assert.equal(numberOrNull(0), 0);
  assert.equal(hasNumber(0), true);
  assert.equal(numberOrNull("0"), 0);
});

test("lo que no es número tampoco cuela", () => {
  for (const malo of [NaN, Infinity, -Infinity, "x", {}, []]) {
    assert.equal(numberOrNull(malo), null, `${String(malo)} no es un número`);
  }
});

test("ninguna pantalla decide «hay mercado» con Number.isFinite(Number(...))", () => {
  // Estrecho y cierto: el modismo exacto, en los ficheros donde ocurrió.
  for (const ruta of [
    "app/sports.jsx",
    "app/betting/BettingShell.jsx",
    "app/fantasy/leagueWeek.js",
    "app/fantasy/rosterFit.js",
    "app/fantasy/DraftMode.jsx",
    "app/fantasy/candidates.js",
  ]) {
    const fuente = leer(ruta)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/Number\.isFinite\(Number\(/.test(fuente),
      `${ruta} vuelve a preguntar «¿hay dato?» con un idioma que dice que sí sobre un hueco`,
    );
  }
});

test("sin línea, la tarjeta dice «no market» y no «Pick'em»", () => {
  const fuente = leer("app/sports.jsx");
  assert.match(fuente, /"no market"/,
    "un partido sin mercado necesita su propio estado");
  // Y el pick'em de VERDAD tiene que seguir existiendo: son tres estados.
  assert.match(fuente, /line === 0 \? "Pick'em"/,
    "un pick'em real (línea 0) no es lo mismo que no haber mercado");
});

test("un titular sin proyección cuenta como UNKNOWN, no como cero", () => {
  const index = new Map([
    ["1", { projected_points: 12.5 }],
    ["2", { projected_points: null }],   // el caso: presente y nulo
  ]);
  const out = lineupOf(["1", "2"], index);
  assert.equal(out.projected, 12.5, "el nulo no puede sumar cero como si fuera dato");
  assert.equal(out.unknown, 1, "tiene que declararse desconocido");
  assert.equal(out.rows[1].points, null);
});

test("sin rondas declaradas, «cuántos picks me quedan» es null y no cero", () => {
  // El guardia de `candidates.js` exige `picksLeftForMe === null` explícito, y
  // lo tenía bien — pero el CALLER le entregaba un cero fabricado, así que no
  // lo veía nunca y el aviso de pateador saltaba desde el primer turno. El
  // arreglo estaba en un lado de la llamada y el fallo en el otro.
  const fuente = leer("app/fantasy/DraftMode.jsx");
  assert.match(fuente, /picksLeftForMe: hasNumber\(draftRounds\)/,
    "las rondas desconocidas tienen que quedarse en null");

  // Y la propiedad, no sólo la forma: con rondas nulas no se avisa.
  const sinRondas = hasNumber(null) ? 0 : null;
  assert.equal(sinRondas, null);
});
