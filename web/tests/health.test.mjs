/**
 * LA PÁGINA DE SALUD: que lea el payload y no se escriba nada a mano.
 *
 * Esta página existe porque el 7 de octubre de 2026 producción servía la
 * jornada 4 estando en la 5 y ninguna pantalla decía de cuándo era lo que
 * enseñaba. Un guardián que la deje escribir sus propios umbrales —o declarar
 * FRESH por su cuenta— la convierte en la misma prosa a mano que ya derivó
 * cuatro veces en este repositorio.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { model } from "../data/model.js";

const PAGE = readFileSync(new URL("../app/salud/page.jsx", import.meta.url), "utf8");
const TABLE = readFileSync(new URL("../app/salud/HealthTable.jsx", import.meta.url), "utf8");

test("el payload trae la sección de salud", () => {
  assert.ok(model.health?.sources?.length > 0, "sin `health` la página no puede decir nada");
});

test("cada fuente trae las cinco cosas con las que se discute una etiqueta", () => {
  for (const s of model.health.sources) {
    assert.ok(s.name, "una fuente sin nombre");
    assert.ok(s.feeds, `${s.name}: sin decir qué alimenta, una fila roja no se puede priorizar`);
    assert.ok(s.origin, `${s.name}: sin origen la etiqueta no es comprobable`);
    assert.ok(["FRESH", "STALE", "BROKEN"].includes(s.label), `${s.name}: etiqueta ${s.label}`);
    assert.ok(s.basis, `${s.name}: sin decir en qué marca se apoya, «hace 2 h» no se audita`);
  }
});

test("lo que no está FRESH dice POR QUÉ", () => {
  for (const s of model.health.sources) {
    if (s.label === "FRESH") continue;
    assert.ok(s.reason, `${s.name} está ${s.label} y no dice por qué`);
  }
});

test("una fuente sin fecha es BROKEN y nunca FRESH", () => {
  // UNKNOWN > STALE PRESENTADO COMO ACTUAL: «no sé de cuándo es» no puede
  // caer del lado tranquilizador.
  for (const s of model.health.sources) {
    if (s.as_of == null) {
      assert.equal(s.label, "BROKEN", `${s.name}: sin fecha y etiquetada ${s.label}`);
    }
  }
});

test("la etiqueta no se calcula en el navegador", () => {
  /* Dos autoridades para la misma decisión es el fallo de `noBet.js`: Python
     con precisión completa y JS repitiendo la aritmética sobre valores
     redondeados. La etiqueta viaja decidida y la pantalla sólo la pinta. */
  for (const fuente of [PAGE, TABLE]) {
    assert.doesNotMatch(fuente, /Date\.now\(\)/, "la página no puede fechar con el reloj del que mira");
    assert.doesNotMatch(fuente, /\* 3600|\/ 3600|36e5/, "ha vuelto a calcular horas por su cuenta");
  }
});

test("el umbral que decidió la etiqueta se ENSEÑA", () => {
  assert.match(TABLE, /window_hours/, "sin el umbral, la etiqueta no es auditable");
});

test("la jornada que cubre se enseña, y un BEHIND se marca", () => {
  // La otra mitad de la frescura: un fichero de hace diez minutos puede hablar
  // de la jornada pasada, y la columna de la edad no lo puede decir.
  assert.match(TABLE, /covers_week/);
  assert.match(TABLE, /coverage === "BEHIND"/,
    "la pantalla no marca una sección que no ha avanzado");
});

test("el contraste de jornada no elige en silencio", () => {
  const w = model.health.week_agreement ?? {};
  assert.ok(["AGREE", "DISAGREE", "UNREACHABLE"].includes(w.status), `status ${w.status}`);
  assert.match(PAGE, /UNREACHABLE|could not/i,
    "si Sleeper no se pudo leer hay que decirlo: no es un acuerdo");
  // La autoridad sigue siendo el calendario, y la página lo dice.
  assert.match(PAGE, /first unplayed game/);
});

test("la página sin sección de salud no inventa una", () => {
  assert.match(PAGE, /NoDataYet/);
  assert.match(PAGE, /carries no <code>health<\/code> section/);
});

test("FRESH va SIN insignia", () => {
  /* Una marca que sale siempre no informa — la misma razón por la que
     `rosterMark` se calla con ACTIVE. Y `mark--ok` no existe en la hoja: si
     alguien la escribe, la fila sale sin vestir, que es el fallo de los 72
     raíles grises. */
  assert.match(TABLE, /label === "FRESH" \?/);
  assert.doesNotMatch(TABLE, /mark--ok/);
});

test("la página está en el menú, que es lo que la hace alcanzable", () => {
  const layout = readFileSync(new URL("../app/layout.jsx", import.meta.url), "utf8");
  assert.match(layout, /href: "\/salud"/);
});
