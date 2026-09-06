/**
 * La marca de plantilla dice un hecho y no toca un número.
 *
 * El fallo que estas pruebas existen para impedir: el board se compila con datos
 * de agosto y el registro de plantillas es de septiembre. Sin esta marca, un
 * jugador en una lista de reserva se lee igual que un titular.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { rosterMark, changedSinceModel } from "../app/fantasy/rosterMark.js";
import { readFileSync } from "node:fs";

import { isUnavailable, splitAvailable } from "../app/fantasy/availablePool.js";

test("un jugador en el 53 activo no lleva marca", () => {
  // Una marca que sale siempre no informa: es decoración con nombre técnico.
  assert.equal(rosterMark({ roster_state: "ACTIVE" }), null);
  assert.equal(rosterMark({}), null);
  assert.equal(rosterMark(null), null);
});

test("no se pinta dos veces el mismo hecho", () => {
  // SIN EQUIPO ya lo pinta `rostered === false`. Dos marcas para un hecho se
  // leen como dos problemas.
  assert.equal(rosterMark({ roster_state: "NOT_ON_ROSTER" }), null);
});

test("reserva, prácticas y exento sí se dicen", () => {
  for (const state of ["RESERVE", "PRACTICE_SQUAD", "EXEMPT"]) {
    const mark = rosterMark({ roster_state: state, roster_team: "KC" });
    assert.ok(mark, `${state} tiene que pintarse`);
    assert.ok(mark.text.length > 0);
    assert.match(mark.className, /^mark mark--/);
  }
});

test("la marca lleva SIEMPRE su fecha, o dice que no la sabe", () => {
  const con = rosterMark({ roster_state: "RESERVE", roster_source_as_of: "2026-09-05" });
  assert.match(con.title, /2026-09-05/, "una afirmación de actualidad sin fecha visible es la regla 5 rota");
  const sin = rosterMark({ roster_state: "RESERVE" });
  assert.match(sin.title, /unknown/i, "sin fecha se DICE, no se calla");
});

test("el código de nflverse viaja crudo y no se traduce", () => {
  const mark = rosterMark({ roster_state: "RESERVE", roster_code: "R48" });
  assert.match(mark.title, /R48/);
  // Traducir R48 a «vuelve en la jornada 5» sería inventarle significado a un
  // dato que este repositorio no puede verificar, y decide un pick.
  assert.doesNotMatch(mark.title, /injured reserve|physically unable|week \d/i);
});

test("la marca dice que no mueve ningún número", () => {
  assert.match(rosterMark({ roster_state: "RESERVE" }).title, /Changes no number/i);
});

test("sin equipo NFL cuenta como no disponible, y por eso no infla el tier", () => {
  const rows = [
    { player_id: "a", position: "RB", tier: 6, rostered: true },
    { player_id: "b", position: "RB", tier: 6, rostered: false },
    { player_id: "c", position: "RB", tier: 6, status_severity: "OUT" },
  ];
  const { available, unavailable, untaken } = splitAvailable(rows, new Set());
  assert.deepEqual(available.map((r) => r.player_id), ["a"],
    "un agente libre sin equipo contaba como «quedan 3 RBs en el tier»");
  assert.deepEqual(unavailable.map((r) => r.player_id).sort(), ["b", "c"]);
  // Siguen buscables y drafteables: se marcan, no se borran.
  assert.equal(untaken.length, 3);
});

test("changedSinceModel sólo es cierto cuando hay dato y no es ACTIVE", () => {
  assert.equal(changedSinceModel({ roster_state: "ACTIVE" }), false);
  assert.equal(changedSinceModel({ roster_state: "RESERVE" }), true);
  // Sin dato NO se afirma que haya cambiado nada.
  assert.equal(changedSinceModel({}), false);
});

test("una sola definición decide partición, separador y clase de fila", () => {
  // Cuando esto vivía en tres sitios, mover «sin equipo» a `unavailable` dejó
  // 142 filas detrás de un separador que nunca se pintaba: la lista decía
  // disponible y el orden decía lo contrario.
  const fuente = readFileSync(new URL("../app/fantasy/DraftRoom.jsx", import.meta.url), "utf8");
  assert.match(fuente, /isUnavailable\(row\) && !outMarked/,
    "el separador tiene que usar el mismo predicado que la partición");
  assert.match(fuente, /isUnavailable\(entry\.row\) \? "is-out"/,
    "la clase de la fila también");
  assert.equal(isUnavailable({ rostered: false }), true);
  assert.equal(isUnavailable({ status_severity: "OUT" }), true);
  assert.equal(isUnavailable({ rostered: true }), false);
  assert.equal(isUnavailable({}), false);
  assert.equal(isUnavailable(null), false);
});
