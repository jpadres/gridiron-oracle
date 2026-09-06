/** El ADP del mercado: dos hechos y ninguna predicción. */
import assert from "node:assert/strict";
import { test } from "node:test";

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
