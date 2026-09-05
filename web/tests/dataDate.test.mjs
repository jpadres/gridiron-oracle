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

import { dataDate, dateFrom, model } from "../data/model.js";

const RAIZ = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, RAIZ), "utf8");

test("dataDate devuelve null cuando el payload no fecha la sección", () => {
  // NULL y no undefined, y desde luego no una fecha de repuesto: quien lo pinte
  // tiene que poder distinguir «no lo sé» para escribirlo.
  assert.equal(dataDate("seccion-que-no-existe"), null);
});

test("una fecha VACÍA en el payload no es una fecha", () => {
  /* La versión anterior de esta prueba llamaba a `dataDate("")` y daba null
     porque la CLAVE no existía — o sea, comprobaba lo mismo que la prueba de
     arriba y la rama del valor vacío no se ejercitaba nunca. Pasaba en vacío.
     `dateFrom` recibe el diccionario, así que el caso se puede construir. */
  assert.equal(dateFrom({ markets: "" }, "markets"), null);
  assert.equal(dateFrom({ markets: "   " }, "markets"), null, "espacios tampoco");
  assert.equal(dateFrom({ markets: null }, "markets"), null);
  assert.equal(dateFrom({ markets: 20260905 }, "markets"), null, "un número no es la fecha");
  assert.equal(dateFrom({ markets: "2026-09-05" }, "markets"), "2026-09-05");
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


test("el pie promete que CADA sección fecha lo suyo, y las cuatro lo hacen", () => {
  /* EL GUARDIÁN DE UNA PROMESA DEL PIE.
     «Compilation time, not data freshness — each section states its own date»
     era FALSO: sólo `/betting` leía una fecha, y `/predicciones` publicaba las
     MISMAS líneas sin ninguna. Una promesa que ninguna pantalla cumple es peor
     que no prometer nada, porque deja la sensación de que algo fecha.

     Se comprueba por SECCIÓN del payload y no por lista de ficheros: si mañana
     aparece una cuarta clave en `data_dates` y nadie la pinta, esto se pone
     rojo en vez de seguir prometiendo de más. */
  const consumidores = {
    markets: ["app/betting/page.jsx", "app/predicciones/page.jsx"],
    model: ["app/modelo/page.jsx"],
    fantasy: ["app/fantasy/page.jsx"],
  };
  const secciones = Object.keys(model?.data_dates ?? {});
  assert.ok(secciones.length > 0, "el payload tiene que traer data_dates");
  for (const seccion of secciones) {
    const donde = consumidores[seccion];
    assert.ok(donde, `nadie pinta la fecha de la sección «${seccion}»`);
    for (const ruta of donde) {
      assert.match(leer(ruta), new RegExp(`dataDate\\("${seccion}"\\)`),
        `${ruta} tendría que leer dataDate("${seccion}")`);
    }
  }
});

test("y quien la pinta dice UNKNOWN cuando no la hay", () => {
  // Nunca el sello de build de repuesto: eso es la falsa actualidad otra vez.
  for (const ruta of ["app/ui.jsx", "app/fantasy/BoardShell.jsx",
                      "app/betting/BettingShell.jsx"]) {
    assert.match(leer(ruta), /unknown date/, `${ruta} no dice UNKNOWN sin fecha`);
  }
});
