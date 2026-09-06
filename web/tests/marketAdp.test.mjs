/** El ADP del mercado: dos hechos y ninguna predicción. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";

import { MEANINGFUL_GAP, marketGap, marketNote } from "../app/fantasy/marketAdp.js";

test("sin ADP o sin puesto no se dice nada", () => {
  assert.equal(marketGap({ overall_rank: 31 }), null);
  assert.equal(marketGap({ adp: 52 }), null);
  assert.equal(marketNote({}), null);
});

test("el signo dice QUIÉN va antes, y se lee en la frase", () => {
  const tarde = marketGap({ overall_rank: 31, adp: 52 });
  assert.equal(tarde.direction, "MARKET_LATER");
  assert.match(marketNote({ overall_rank: 31, adp: 52 }), /later than the board/);
  const pronto = marketGap({ overall_rank: 52, adp: 31 });
  assert.equal(pronto.direction, "MARKET_EARLIER");
  assert.match(marketNote({ overall_rank: 52, adp: 31 }), /earlier than the board/);
});

test("una diferencia pequeña NO se pinta como diferencia", () => {
  // El ADP es un promedio con varianza. Dos números parecidos uno al lado del
  // otro invitan a leer una señal que no está.
  const casi = marketGap({ overall_rank: 40, adp: 40 + MEANINGFUL_GAP - 1 });
  assert.equal(casi.direction, "SAME");
  assert.equal(marketNote({ overall_rank: 40, adp: 44 }), "Board 40 · market ADP 44.0");
});

test("no aparece ninguna palabra que suene a probabilidad", () => {
  for (const fila of [{ overall_rank: 31, adp: 52 }, { overall_rank: 52, adp: 31 }]) {
    const texto = marketNote(fila);
    assert.ok(!/\b(will|won't|guaranteed|chance|%|likely|probably)\b/i.test(texto),
      `«${texto}» promete disponibilidad futura sin un modelo calibrado`);
  }
});

test("un ADP sin su ventana y su muestra no significa nada, y se dice", () => {
  /* «market ADP 52.3» en presente, sin ventana ni muestra ni fuente, es una
     afirmación de actualidad sin fecha. Y el agregado empieza ANTES de los
     cortes que la propia pantalla marca al lado. */
  const fuente = { window_start: "2026-08-29", sample_size: 7430,
                   fetched_at: "2026-09-06T09:27:16Z" };
  const texto = marketNote({ overall_rank: 31, adp: 52.3 }, fuente);
  assert.match(texto, /7,430 drafts since 2026-08-29/);
  // Y va la VENTANA, no la hora de descarga: cuándo lo bajé no es de cuándo es.
  assert.ok(!texto.includes("2026-09-06"),
    "la hora de descarga no puede leerse como la fecha del dato");
  // Sin fuente se dice lo mismo de menos, no algo inventado de más.
  assert.equal(marketNote({ overall_rank: 31, adp: 52.3 }),
    "Board 31 · market ADP 52.3 — drafted later than the board ranks him");
});

test("las dos pantallas del draft le pasan la procedencia", () => {
  for (const ruta of ["app/fantasy/DraftRoom.jsx", "app/fantasy/DraftMode.jsx"]) {
    const fuente = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(fuente, /marketNote\(forMe\.primary\.row, context\.adpSource\)/,
      `${ruta} pinta un ADP sin decir de cuándo es`);
  }
});
