/**
 * EL PARTE A MEDIAS NO SE PUEDE LEER COMO UN PARTE.
 *
 * El martes de la jornada 3 de 2026 la pantalla escribía «week 3 · 0
 * designations» con DOS clubes de treinta y dos entregados. Cierta palabra por
 * palabra, y se lee como «no hay nadie tocado».
 *
 * Lo que se comprueba aquí no es que exista la función: es que las DOS
 * pantallas que hablan de disponibilidad la PINTEN. Un guardián sobre una
 * función que ninguna pantalla llama vigila una función, no un producto — y
 * este proyecto lo ha pagado ya varias veces.
 */
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  coverageWarning,
  injuryClockLabel,
  reportCoverage,
} from "../app/fantasy/injuryReport.js";

// Coherente a propósito: 30 entregados de 32 y DOS pendientes. La primera
// versión ponía «2 de 32» con dos pendientes, que no puede pasar — y un doble
// que miente en un campo prueba otra cosa, que en este repositorio ya ha
// costado seis iteraciones. Éste es el estado de un sábado: falta poco.
const PARCIAL = {
  status: "PARTIALLY_FILED",
  week: 3,
  teams: 30,
  teams_expected: 32,
  teams_filed: [],
  teams_pending: ["BUF", "KC"],
  with_designation: 41,
};

const COMPLETO = {
  status: "PUBLISHED",
  week: 3,
  teams: 32,
  teams_expected: 32,
  teams_pending: [],
  with_designation: 59,
};

test("un parte parcial avisa, y nombra a los clubes que faltan", () => {
  const aviso = coverageWarning(PARCIAL);
  assert.ok(aviso, "un parte a medias tiene que avisar");
  assert.match(aviso, /30 of 32/);
  assert.match(aviso, /BUF, KC/,
    "con pocos pendientes se nombran los pendientes, que es la lista corta");
  assert.match(aviso, /not healthy/i,
    "la frase que impide leer el hueco como afirmación es la razón de existir del aviso");
});

test("con casi todos pendientes se nombra a los que SÍ entregaron, no a los 30", () => {
  // Un martes faltan treinta de treinta y dos: esa lista en un teléfono es un
  // muro de códigos. Se dice la más corta, y se dice CUÁL se está diciendo.
  const martes = {
    status: "PARTIALLY_FILED", week: 3, teams: 2, teams_expected: 32,
    teams_filed: ["ATL", "GB"],
    teams_pending: ["ARI", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET",
                    "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE",
                    "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"],
    with_designation: 0,
  };
  const aviso = coverageWarning(martes);
  assert.match(aviso, /ATL, GB/, "nombra a los dos que entregaron");
  assert.ok(!aviso.includes("WAS"), "no escupe los treinta pendientes");
  assert.match(aviso, /only ATL, GB have/i,
    "y dice que ésos son los que SÍ entregaron, no al revés");
});

test("un parte COMPLETO no avisa: un aviso que sale siempre es decoración", () => {
  assert.equal(coverageWarning(COMPLETO), null);
});

test("sin designaciones y a medias, la etiqueta NO dice «week 3» a secas", () => {
  const etiqueta = injuryClockLabel(PARCIAL);
  assert.match(etiqueta, /PARTIAL/);
  assert.match(etiqueta, /30 of 32/);
  // La frase exacta que se publicaba y era engañosa.
  assert.notEqual(etiqueta, "week 3 · 0 designations");
});

test("«no ha entregado nadie» y «lo han entregado algunos» son huecos distintos", () => {
  const SIN_NADA = { status: "NOT_PUBLISHED_YET", week: 3, last_published_week: 2 };
  const nada = reportCoverage(SIN_NADA);
  assert.equal(nada.partial, false);
  assert.equal(nada.missing, true);
  assert.equal(reportCoverage(PARCIAL).partial, true);
  assert.equal(reportCoverage(PARCIAL).missing, false);
  // Y la jornada pasada NO se arrastra como si fuera ésta.
  assert.match(coverageWarning(SIN_NADA), /week 2/);
  assert.match(coverageWarning(SIN_NADA), /NOT carried forward|not carried forward/i);
});

test("sin parte legible tampoco se afirma salud", () => {
  assert.match(coverageWarning(null), /not healthy/i);
  assert.match(coverageWarning({ status: "SOURCE_UNAVAILABLE" }), /not healthy/i);
});

/* ------------------------------------------------------------------ *
 * Y ahora lo que de verdad falla si nadie mira: que lo PINTEN las dos.
 * ------------------------------------------------------------------ */

const PANTALLAS = [
  "app/fantasy/waivers/WaiversShell.jsx",
  "app/fantasy/lineups/page.jsx",
];

test("las DOS pantallas de disponibilidad pintan el aviso de cobertura", () => {
  for (const ruta of PANTALLAS) {
    const src = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(src, /coverageWarning\s*\(/,
      `${ruta} no llama a coverageWarning`);
    // No basta con que el nombre aparezca: ya ha pasado dos veces que el
    // identificador siguiera en un `title` o en un comentario con la condición
    // desactivada. Se exige la CONDICIÓN del JSX que decide si se pinta.
    const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.match(sinComentarios, /\{\s*avisoParte\s*\?/,
      `${ruta}: el aviso no está condicionado y pintado en el JSX`);
    assert.match(sinComentarios, /<Callout/,
      `${ruta}: el aviso tiene que contradecir lo asumido, que es para lo que existe el ámbar`);
  }
});

test("la traducción está definida UNA vez: nadie se la reimplementa", () => {
  let definiciones = 0;
  for (const ruta of [...PANTALLAS, "app/fantasy/injuryReport.js", "app/fantasy/startSit.js",
                      "app/fantasy/waivers.js"]) {
    const src = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    definiciones += (src.match(/function\s+coverageWarning/g) || []).length;
  }
  assert.equal(definiciones, 1,
    "dos traductores del mismo hecho es el fallo que este proyecto lleva catorce veces cometiendo");
});
