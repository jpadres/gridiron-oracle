/**
 * La fecha de una ficha de prensa dice QUÉ fecha es.
 *
 * `published_at` es cuándo lo publicó la fuente; `retrieved_at` es cuándo lo
 * leyó el barrido. 27 de las 40 fichas del 4 de septiembre sólo tienen la
 * segunda y se pintaban igual que las que tienen la primera — la fecha de
 * importación presentada como fecha del hecho (regla 5). La etiqueta lleva la
 * palabra, y sin ninguna de las dos no se inventa nada.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { dateLabel } from "../app/research/dates.js";

test("con fecha de publicación se dice «published», y manda sobre la de lectura", () => {
  assert.deepEqual(dateLabel({ published_at: "2026-09-02T10:00:00+00:00", retrieved_at: "2026-09-04" }),
    { word: "published", iso: "2026-09-02" });
});

test("sólo con fecha de lectura se dice «seen», nunca «published»", () => {
  assert.deepEqual(dateLabel({ published_at: null, retrieved_at: "2026-09-04" }),
    { word: "seen", iso: "2026-09-04" });
});

test("sin ninguna de las dos no hay etiqueta: UNKNOWN antes que el reloj", () => {
  assert.equal(dateLabel({ date: "2026-09-04" }), null);   // `date` es el día del barrido, no una fecha de la ficha
  assert.equal(dateLabel({}), null);
  assert.equal(dateLabel(null), null);
});
