/**
 * LA VALIDACIÓN SE PUBLICA ENTERA, INCLUIDA LA COLUMNA INCÓMODA.
 *
 * `validation.overall` trae tres comparaciones sobre los MISMOS partidos fuera
 * de muestra: el modelo, la línea de cierre, y una variante del modelo que
 * NUNCA ve la línea (`free_brier`, `free_margin_mae`).
 *
 * La tercera es la que contesta la objeción más afilada que se le puede hacer
 * a este modelo — «si el margen se ajusta como un residuo SOBRE la línea, ¿qué
 * vale sin ella?»— y durante meses estuvo medida, exportada al payload y
 * pintada por UNA sola pantalla: `/survivor`, que habla de otro producto. La
 * página que existe para presentar la validación enseñaba dos columnas.
 *
 * Es el dato computado que no llega a la pantalla, y aquí con el agravante de
 * que la que faltaba era la que va en contra del producto. La regla 3 de este
 * proyecto dice que lo que sale mal se publica igual.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { model } from "../data/model.js";

const page = readFileSync(new URL("../app/modelo/page.jsx", import.meta.url), "utf8");

test("el payload trae las tres comparaciones sobre los mismos partidos", () => {
  const o = model.validation?.overall ?? {};
  for (const k of ["brier", "market_brier", "free_brier",
                   "margin_mae", "market_margin_mae", "free_margin_mae"]) {
    assert.equal(typeof o[k], "number", `falta ${k} en validation.overall`);
  }
});

test("la TABLA de validación pinta la variante SIN la línea", () => {
  /* En la TABLA, no en el fichero. La primera versión buscaba
     `overall.free_brier` en todo `page.jsx` y pasó VERDE al inyectar el fallo
     —quitar la celda— porque la cifra también aparece en el párrafo que
     explica la columna. Es «la palabra aparece cerca», que en este repositorio
     ya costó dos versiones en `candidates.test.mjs` y dos en
     `rosterMark.test.mjs`; aquí lo escribí yo y lo cazó el simulacro. */
  const i = page.indexOf("<tbody>");
  const cuerpo = page.slice(i, page.indexOf("</tbody>", i));
  assert.ok(i > 0 && cuerpo.length > 0, "la tabla cambió de forma: revisa este guardián");
  assert.match(cuerpo, /overall\.free_brier/,
    "la columna del modelo sin mercado no se pinta en la tabla: es la que "
    + "contesta la objeción, y estaba medida");
  assert.match(cuerpo, /overall\.free_margin_mae/);
  // Y la cabecera, que es lo que la hace legible.
  const cabecera = page.slice(page.indexOf("<thead>"), page.indexOf("</thead>"));
  assert.match(cabecera, /without the line/i,
    "la columna existe y no se dice qué es");
});

test("el orden que se publica es el que dicen los datos", () => {
  /* Mercado < modelo-con-mercado < modelo-sin-mercado, en Brier y en MAE
     (menor es mejor). Si algún día esto se invirtiera, la hipótesis por
     defecto NO es «mejoró»: es fuga de información — está escrito en la
     cabecera de CLAUDE.md. Este test es donde se notaría. */
  const o = model.validation.overall;
  assert.ok(o.market_brier < o.brier,
    `el modelo estaría batiendo a la línea en Brier (${o.brier} vs ${o.market_brier}): `
    + "busca la fuga antes de celebrarlo");
  assert.ok(o.brier < o.free_brier,
    "quitar el mercado estaría MEJORANDO el modelo: eso no es una mejora, es un síntoma");
  assert.ok(o.market_margin_mae < o.margin_mae && o.margin_mae < o.free_margin_mae);
});

test("la calibración se ajusta contra RESULTADOS, no contra líneas", () => {
  /* El objetivo de `_fit_calibration` es `(margin > 0)` —ganó o no ganó— y la
     distribución de márgenes se ajusta con `margin`. Si algún día alguien la
     ajustara contra la línea, las probabilidades dejarían de ser
     probabilidades y nada fallaría. */
  const py = readFileSync(new URL("../../src/oracle/models/predictor.py", import.meta.url), "utf8");
  assert.match(py, /_fit_calibration\(raw_probs,\s*\(margin\s*>\s*0\)\.astype\(float\)\)/,
    "la calibración ya no se ajusta contra el resultado realizado");
  assert.match(py, /self\.free_model\.fit\(X,\s*margin\)/,
    "el modelo libre ya no se ajusta contra el margen real");
});
