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
import { ageLabel, effective, tally } from "../app/salud/healthClock.js";

const PAGE = readFileSync(new URL("../app/salud/page.jsx", import.meta.url), "utf8");
const TABLE = readFileSync(new URL("../app/salud/HealthTable.jsx", import.meta.url), "utf8");
const BOARD = readFileSync(new URL("../app/salud/HealthBoard.jsx", import.meta.url), "utf8");
const CLOCK = readFileSync(new URL("../app/salud/healthClock.js", import.meta.url), "utf8");

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

/* === EL RELOJ: PYTHON CIERRA, EL NAVEGADOR SÓLO BAJA =======================

   Aquí hubo un test que prohibía leer el reloj en esta página: «la etiqueta no
   se calcula en el navegador». La intención era buena —dos autoridades para la
   misma decisión es el fallo de `noBet.js`— y la consecuencia no: la etiqueta
   se quedaba CONGELADA en el instante de la exportación. El 10 de noviembre de
   2026 la página decía «10 de 12 FRESH» sobre un payload del 14 de octubre,
   con la exportación semanal parada tres semanas. La página que existe para
   avisar de eso era la única que no podía verlo.

   La regla que queda es la de `gameClock.js`, entera:

     - el UMBRAL sigue siendo de Python (`fresh_for_hours`, de `freshness.py`);
     - comparar con el reloj se hace en UN módulo, `healthClock.js`;
     - y sólo hacia abajo: lo que Python cerró no se reabre. */

const ISO = "2026-10-14T12:00:00Z";
const T0 = Date.parse(ISO);
const HORA = 3600_000;
const fuente = (extra = {}) => ({ name: "x", label: "FRESH", as_of: ISO, fresh_for_hours: 24, ...extra });

test("una fuente FRESH envejece: pasada su ventana es STALE", () => {
  const dentro = effective(fuente(), T0 + 23 * HORA);
  assert.equal(dentro.label, "FRESH");
  assert.equal(dentro.aged, false);
  const fuera = effective(fuente(), T0 + 25 * HORA);
  assert.equal(fuera.label, "STALE", "el veredicto se quedó congelado en la exportación");
  assert.equal(fuera.aged, true, "y tiene que decir que lo bajó el tiempo, no Python");
  assert.equal(fuera.ageMs, 25 * HORA);
});

test("el caso que pasó: 27 días después nada sigue FRESH salvo lo que no caduca", () => {
  const ahora = T0 + 27 * 24 * HORA;
  const c = tally([
    fuente({ fresh_for_hours: 0.25 }),          // cuotas
    fuente({ fresh_for_hours: 24 }),            // plantillas
    fuente({ fresh_for_hours: null }),          // el board: viejo POR DISEÑO
    fuente({ label: "BROKEN", as_of: null }),   // survivor sin fichero
  ], ahora);
  assert.deepEqual(c, { FRESH: 1, STALE: 2, BROKEN: 1 });
});

test("lo que Python cerró NO se reabre, mire cuando mire el navegador", () => {
  // Un reloj atrasado —o un `now` anterior a la exportación— no puede
  // convertir un STALE en FRESH ni un BROKEN en nada.
  for (const label of ["STALE", "BROKEN"]) {
    for (const ahora of [T0 - 5 * HORA, T0, T0 + 1, T0 + 500 * HORA]) {
      const v = effective(fuente({ label }), ahora);
      assert.equal(v.label, label, `${label} visto a ${ahora - T0} ms pasó a ${v.label}`);
      assert.equal(v.aged, false);
    }
  }
});

test("sin reloj se pinta lo que dijo Python: el primer pintado es el del servidor", () => {
  for (const ahora of [null, undefined]) {
    assert.deepEqual(effective(fuente(), ahora), { label: "FRESH", aged: false, ageMs: null });
  }
});

test("lo que no caduca no se degrada nunca, y una edad negativa no se publica", () => {
  assert.equal(effective(fuente({ fresh_for_hours: null }), T0 + 9999 * HORA).label, "FRESH");
  // `Number(null)` es CERO: con el idioma equivocado, «no caduca» sería
  // «caduca al instante». Tampoco un hueco con forma de texto o de array.
  for (const hueco of ["", [], undefined, "abc"]) {
    assert.equal(effective(fuente({ fresh_for_hours: hueco }), T0 + 9999 * HORA).label, "FRESH",
      `fresh_for_hours = ${JSON.stringify(hueco)} se leyó como un umbral`);
  }
  const atras = effective(fuente(), T0 - HORA);
  assert.equal(atras.label, "FRESH");
  assert.equal(atras.ageMs, null, "una edad negativa no es una edad");
});

test("una fuente sin fecha no envejece: ya es lo que Python dijo", () => {
  assert.equal(effective(fuente({ as_of: null, label: "BROKEN" }), T0 + HORA).label, "BROKEN");
  assert.equal(effective({ as_of: ISO }, T0).label, "BROKEN", "sin etiqueta, nunca FRESH");
});

test("la edad se escribe con las dos unidades que importan", () => {
  assert.equal(ageLabel(27 * 24 * HORA + 4 * HORA + 59_000), "27d 4h");
  assert.equal(ageLabel(3 * HORA + 12 * 60_000), "3h 12m");
  assert.equal(ageLabel(18 * 60_000), "18m");
  assert.equal(ageLabel(-1), null);
  assert.equal(ageLabel(null), null);
});

test("el umbral NO vive en el navegador", () => {
  /* `healthClock.js` compara; no decide cuánto dura nada. Un 24 o un 0.25
     escrito ahí sería un segundo sitio donde vive la ventana, que es como
     acabaron discrepando Python y `noBet.js`. Se quitan los comentarios antes
     de mirar: la prosa que explica el fallo lo casa igual que el código. */
  const codigo = CLOCK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(codigo, /fresh_for_hours/, "tiene que leer el corte que publica Python");
  const numeros = [...codigo.matchAll(/(?<![\w.])\d+(?:[._]\d+)*(?![\w.])/g)].map((m) => m[0]);
  // El 1 es el incremento del recuento; lo demás, conversiones de unidades.
  const permitidos = new Set(["0", "1", "1000", "60", "3600", "86400", "3600_000"]);
  for (const n of numeros) {
    assert.ok(permitidos.has(n), `healthClock.js lleva un ${n} que no es una conversión de unidades`);
  }
});

test("y fuera de healthClock.js nadie compara con el reloj", () => {
  /* La página (servidor) y la tabla NO leen el reloj: reciben la etiqueta ya
     vista. El tablero lo lee —es quien tiene el reloj— y no hace aritmética
     de ventanas con él. */
  for (const [nombre, src] of [["page.jsx", PAGE], ["HealthTable.jsx", TABLE]]) {
    assert.doesNotMatch(src, /Date\.now\(\)/, `${nombre} no puede fechar con el reloj del que mira`);
  }
  for (const [nombre, src] of [["page.jsx", PAGE], ["HealthTable.jsx", TABLE], ["HealthBoard.jsx", BOARD]]) {
    assert.doesNotMatch(src, /\* 3600|\/ 3600|36e5|3600_000/, `${nombre} ha vuelto a calcular horas por su cuenta`);
    assert.doesNotMatch(src, /window_hours\s*[*<>]|fresh_for_hours\s*[*<>]/,
      `${nombre} compara un umbral: eso es de healthClock.js`);
  }
});

test("lo que se PINTA es la etiqueta vista ahora, no la del payload", () => {
  /* Un módulo correcto que ninguna pantalla llama vigila una función, no un
     producto. Se mira la CONDICIÓN del JSX y no que el nombre aparezca: el
     nombre sigue ahí aunque la tabla pinte `s.label`. */
  assert.match(BOARD, /now: effective\(s, now\)/, "el tablero no pasa la etiqueta vista ahora");
  assert.match(BOARD, /tally\(health\.sources, now\)/, "el recuento sale de la exportación");
  assert.match(BOARD, /s\.now\.label === "BROKEN"/);
  assert.match(BOARD, /s\.now\.label === "STALE"/);
  assert.match(TABLE, /const v = s\.now \?\?/, "la tabla no lee la etiqueta vista ahora");
  assert.match(TABLE, /\{v\.label === "FRESH" \?/, "la insignia sale de la etiqueta del payload");
  assert.doesNotMatch(TABLE, /\{s\.label\}|s\.label === "(?:FRESH|STALE|BROKEN)"/,
    "la tabla pinta la etiqueta congelada en la exportación");
  assert.match(PAGE, /<HealthBoard health=\{h\} \/>/, "la página no monta el tablero");
});

test("el umbral que decidió la etiqueta se ENSEÑA", () => {
  // El corte que la bajó —el de `fresh_for_hours`, que es el que compara el
  // reloj— va en la misma fila que la etiqueta que explica.
  assert.match(TABLE, /fresh_for_hours\} h/, "sin el umbral, la etiqueta no es auditable");
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
  assert.match(BOARD, /w\.status === "UNREACHABLE"\s*\?\s*"Could not be read"/,
    "si Sleeper no se pudo leer hay que decirlo: no es un acuerdo");
  assert.match(BOARD, /Not checked is not the same as agreeing/);
  // La autoridad sigue siendo el calendario, y la página lo dice.
  assert.match(BOARD, /First unplayed game/);
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
