/**
 * La etiqueta del dossier: fechada siempre, y subordinada a la marca de hoy.
 *
 * El fallo que existía: Josh Jacobs con «EXEMPT LIST» (comprobado hoy) y
 * «QUESTIONABLE» (dossier del 11 de agosto) como etiquetas iguales, y la
 * segunda sin fecha a la vista. Cada test de aquí falla con el código viejo.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { availabilityMark, shortDate } from "../app/availability.js";

const JACOBS = {
  level: "DUDA", situation: "Legal", status: "Pending review",
  source: "Master report", date: "2026-08-11",
};

test("sin ficha no hay etiqueta", () => {
  assert.equal(availabilityMark(undefined, "2026-09-03"), null);
  assert.equal(availabilityMark({}, null), null);
});

test("la fecha va SIEMPRE en el texto, no sólo en el title", () => {
  const mark = availabilityMark(JACOBS, null);
  assert.equal(mark.text, "8/11 QUESTIONABLE");
  assert.equal(mark.superseded, false);
});

test("una ficha sin fecha lo dice: UNDATED, no una fecha inventada", () => {
  const mark = availabilityMark({ ...JACOBS, date: "" }, null);
  assert.equal(mark.text, "UNDATED QUESTIONABLE");
});

test("con marca de estado más nueva, la ficha se subordina", () => {
  const mark = availabilityMark(JACOBS, "2026-09-03");
  assert.equal(mark.superseded, true);
  assert.match(mark.className, /avail--superseded/);
  assert.match(mark.title, /not a current claim/);
  // Pero NO desaparece: el desacuerdo se conserva.
  assert.equal(mark.text, "8/11 QUESTIONABLE");
});

test("sin fecha y con marca de estado, se subordina igual", () => {
  // No poder fechar algo no lo hace actual. UNKNOWN > STALE COMO ACTUAL.
  assert.equal(availabilityMark({ ...JACOBS, date: null }, "2026-09-03").superseded, true);
});

test("una ficha MÁS NUEVA que la comprobación no se subordina", () => {
  const mark = availabilityMark({ ...JACOBS, date: "2026-09-04" }, "2026-09-03");
  assert.equal(mark.superseded, false);
  assert.doesNotMatch(mark.className, /superseded/);
});

test("el nivel se traduce y el desconocido cae al original", () => {
  assert.match(availabilityMark({ level: "FUERA", date: "2026-08-08" }, null).text, /OUT$/);
  assert.match(availabilityMark({ level: "SEGUIR", date: "2026-08-08" }, null).text, /MONITOR$/);
  assert.match(availabilityMark({ level: "RARO", date: "2026-08-08" }, null).text, /RARO$/);
});

test("shortDate sólo acepta la forma ISO", () => {
  assert.equal(shortDate("2026-08-11"), "8/11");
  assert.equal(shortDate("11 de agosto"), null);
  assert.equal(shortDate(undefined), null);
});
