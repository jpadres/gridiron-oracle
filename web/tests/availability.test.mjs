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
  assert.equal(availabilityMark(undefined, { status_verified_at: "2026-09-03" }), null);
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
  const mark = availabilityMark(JACOBS, { status_verified_at: "2026-09-03" });
  assert.equal(mark.superseded, true);
  assert.match(mark.className, /avail--superseded/);
  assert.match(mark.title, /not a current claim/);
  // Pero NO desaparece: el desacuerdo se conserva.
  assert.equal(mark.text, "8/11 QUESTIONABLE");
});

test("sin fecha y con marca de estado, se subordina igual", () => {
  // No poder fechar algo no lo hace actual. UNKNOWN > STALE COMO ACTUAL.
  assert.equal(availabilityMark({ ...JACOBS, date: null }, { status_verified_at: "2026-09-03" }).superseded, true);
});

test("una ficha MÁS NUEVA que la comprobación no se subordina", () => {
  const mark = availabilityMark({ ...JACOBS, date: "2026-09-04" }, { status_verified_at: "2026-09-03" });
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

test("si la ficha vieja dice LO MISMO que la marca de hoy, no se repite", () => {
  // El desacuerdo es información; el acuerdo repetido es ruido.
  assert.equal(availabilityMark(JACOBS, { status_verified_at: "2026-09-03", status_label: "QUESTIONABLE" }), null);
});

test("pero si dicen cosas distintas se conservan las dos", () => {
  const mark = availabilityMark(JACOBS, { status_verified_at: "2026-09-03", status_label: "EXEMPT LIST" });
  assert.equal(mark.text, "8/11 QUESTIONABLE");
  assert.equal(mark.superseded, true);
});

/* ------------------------------------------------------------------ *
 * LA TERCERA CAPA. De disponibilidad hablan el dossier, la prensa y el
 * registro de PLANTILLAS — y hasta la jornada 4 de 2026 la subordinación
 * sólo miraba la prensa. Medido: Alec Pierce, puesto 76, «RESERVE LIST»
 * del 29 de septiembre y al lado un «UNDATED OUT» del dossier SIN
 * subordinar, las dos afirmaciones con el mismo peso.
 * ------------------------------------------------------------------ */

test("la capa de PLANTILLA también subordina a la ficha vieja", () => {
  const fila = { roster_state: "RESERVE", roster_label: "RESERVE LIST",
                 roster_source_as_of: "2026-09-29" };
  const mark = availabilityMark({ ...JACOBS, date: null }, fila);
  assert.ok(mark, "la ficha se sigue enseñando: el desacuerdo es información");
  assert.equal(mark.superseded, true,
    "sin fecha y con el registro de plantillas hablando de hoy, no puede competir de igual a igual");
});

test("una ficha del dossier MÁS NUEVA que el registro no se subordina", () => {
  const fila = { roster_state: "RESERVE", roster_label: "RESERVE LIST",
                 roster_source_as_of: "2026-09-01" };
  const mark = availabilityMark({ ...JACOBS, date: "2026-09-20" }, fila);
  assert.equal(mark.superseded, false);
});

test("con la plantilla en ACTIVE no hay marca visible, así que no subordina", () => {
  // `rosterMark` se calla con ACTIVE porque una marca que sale siempre no
  // informa. Subordinar contra una afirmación que nadie ve sería peor que no
  // subordinar: la fila diría «esto no es actual» señalando a un hueco.
  const fila = { roster_state: "ACTIVE", roster_source_as_of: "2026-09-29" };
  const mark = availabilityMark({ ...JACOBS, date: null }, fila);
  assert.equal(mark.superseded, false);
});

test("se toma la fecha MÁS NUEVA de las dos capas, no la primera que aparezca", () => {
  const mark = availabilityMark(
    { ...JACOBS, date: "2026-09-10" },
    { status_verified_at: "2026-09-03", roster_state: "RESERVE",
      roster_label: "RESERVE LIST", roster_source_as_of: "2026-09-29" },
  );
  assert.equal(mark.superseded, true,
    "la ficha del 10 es más nueva que la prensa del 3 pero no que la plantilla del 29");
});
