/**
 * La frescura de un dato no se toma prestada del build.
 *
 * `BettingShell` decía que las líneas eran «as of this build». No lo son: basta
 * un commit de documentación para recompilar el sitio sin tocar una cuota, y el
 * 5 de septiembre había NUEVE commits sin datos desde la última regeneración —
 * el pie decía «built» seis horas y media más tarde de lo que databan las
 * cuotas. Es la regla 5 aplicada al reloj de compilación: convertir la hora de
 * descarga en actualidad es cómo se fabrica una afirmación falsamente actual, y
 * aquí encima sobre el dato que caduca antes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { dataDate } from "../data/model.js";

const RAIZ = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, RAIZ), "utf8");

test("dataDate devuelve null cuando el payload no fecha la sección", () => {
  // NULL y no undefined, y desde luego no una fecha de repuesto: quien lo pinte
  // tiene que poder distinguir «no lo sé» para escribirlo.
  assert.equal(dataDate("seccion-que-no-existe"), null);
});

test("dataDate no acepta un valor vacío como fecha", () => {
  // Una cadena vacía es exactamente el fallo del `Number(null)` de este repo:
  // un hueco que pasa por dato. Tiene que salir null.
  assert.equal(dataDate(""), null);
});

test("ninguna pantalla atribuye al build la frescura de un dato", () => {
  // Estrecho a propósito, como `no-undef.mjs`: la frase concreta que ocurrió.
  const pantallas = [
    "app/betting/BettingShell.jsx",
    "app/betting/page.jsx",
    "app/layout.jsx",
  ];
  for (const ruta of pantallas) {
    const fuente = leer(ruta);
    // Se mira el JSX que se PINTA, no los comentarios, que explican el fallo.
    const sinComentarios = fuente
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/as of this build/i.test(sinComentarios),
      `${ruta} atribuye al build la frescura del dato`,
    );
  }
});

test("la página de apuestas pasa la fecha de las líneas, y sale de los datos", () => {
  const page = leer("app/betting/page.jsx");
  assert.match(page, /linesDate:\s*dataDate\("markets"\)/,
    "la fecha de las líneas tiene que salir de dataDate, no de un reloj");
  const shell = leer("app/betting/BettingShell.jsx");
  assert.match(shell, /context\?\.linesDate/,
    "la pantalla tiene que leer la fecha que le pasan");
  assert.match(shell, /unknown date/,
    "sin fecha hay que decirlo: UNKNOWN antes que una frescura prestada");
});

test("el pie deja claro que fecha la COMPILACIÓN y no los datos", () => {
  const layout = leer("app/layout.jsx");
  assert.match(layout, /Site build/, "el sello tiene que decir que es del sitio");
  assert.match(layout, /not data freshness/,
    "y decirlo con todas las letras, que es como se leyó mal");
});
