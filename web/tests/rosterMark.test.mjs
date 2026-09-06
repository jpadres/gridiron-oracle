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

import { isUnavailable, splitAvailable, tierPool } from "../app/fantasy/availablePool.js";
import { model } from "../data/model.js";

test("un jugador en el 53 activo no lleva marca", () => {
  // Una marca que sale siempre no informa: es decoración con nombre técnico.
  assert.equal(rosterMark({ roster_state: "ACTIVE" }), null);
  assert.equal(rosterMark({}), null);
  assert.equal(rosterMark(null), null);
});

test("sin equipo se pinta salvo donde la pantalla ya lo dice", () => {
  // El Draft Room y el modo draft pintan «SIN EQUIPO» por su cuenta desde
  // `rostered === false`, y ahí esta marca se calla para no decirlo dos veces.
  assert.equal(rosterMark({ roster_state: "NOT_ON_ROSTER" }, { yaDiceSinEquipo: true }), null);
  // Pero la tabla principal de /fantasy NO lo pintaba, y su rótulo prometía
  // justo ese dato: Brandon Aiyuk salía el 119 sin equipo y sin una sola marca.
  const mark = rosterMark({ roster_state: "NOT_ON_ROSTER", roster_source_as_of: "2026-09-05" });
  assert.ok(mark);
  assert.match(mark.text, /NO NFL TEAM/);
  assert.match(mark.title, /2026-09-05/);
  assert.match(mark.title, /no longer on/);
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

test("sin equipo NO se cuenta en el tier, pero SIGUE en el pool del motor", () => {
  // Las dos mitades importan y se probaron por separado:
  //  · esconderlo del conteo arregla «8 RBs left in tier» con la mitad
  //    agentes libres, que se lee como que puedes esperar;
  //  · esconderlo del POOL rompió la tortura de 780 drafts en cuatro casos,
  //    dejando huecos TITULARES vacíos. Un hueco vacío rinde CERO.
  const rows = [
    { player_id: "a", position: "RB", tier: 6, rostered: true },
    { player_id: "b", position: "RB", tier: 6, rostered: false },
    { player_id: "c", position: "RB", tier: 6, status_severity: "OUT" },
  ];
  const { available, unavailable, untaken } = splitAvailable(rows, new Set());
  // El sin equipo sigue disponible para el motor: puede llenar un hueco.
  assert.deepEqual(available.map((r) => r.player_id), ["a", "b"]);
  assert.deepEqual(unavailable.map((r) => r.player_id), ["c"]);
  assert.equal(untaken.length, 3);
  // Pero NO cuenta para «cuántos quedan de este tier».
  assert.deepEqual(tierPool(available).map((r) => r.player_id), ["a"]);
});

test("el conteo de tier de las dos pantallas pasa por el mismo filtro", () => {
  for (const ruta of ["../app/fantasy/DraftMode.jsx", "../app/fantasy/DraftRoom.jsx"]) {
    const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
    assert.match(fuente, /tierPool|countableTier/,
      `${ruta} cuenta el tier sin filtrar a quien no tiene equipo`);
  }
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
  assert.equal(isUnavailable({ status_severity: "OUT" }), true);
  // Sin equipo NO es «no disponible»: es un hecho que se MARCA y que se
  // descuenta del conteo de tier, pero el motor tiene que poder cogerlo antes
  // que dejar un hueco titular vacío.
  assert.equal(isUnavailable({ rostered: false }), false);
  assert.equal(isUnavailable({ rostered: true }), false);
  assert.equal(isUnavailable({}), false);
  assert.equal(isUnavailable(null), false);
});

test("el mismo hecho no se dice dos veces, y dos hechos distintos sí", () => {
  // Once filas del board pintaban «EXEMPT LIST» y «EXEMPT LIST», o «IR» junto a
  // «RESERVE LIST»: la misma afirmación dos veces se lee como dos problemas.
  assert.equal(rosterMark({ roster_state: "EXEMPT", status_label: "EXEMPT LIST" }), null);
  assert.equal(rosterMark({ roster_state: "RESERVE", status_label: "IR" }), null);
  assert.equal(rosterMark({ roster_state: "RESERVE", status_label: "RESERVE/PUP" }), null);
  // Dos hechos DISTINTOS se conservan los dos: el desacuerdo es información.
  assert.ok(rosterMark({ roster_state: "RESERVE", status_label: "SUSPENDED" }));
  assert.ok(rosterMark({ roster_state: "PRACTICE_SQUAD", status_label: "QUESTIONABLE" }));
  // Sin marca de prensa se pinta siempre.
  assert.ok(rosterMark({ roster_state: "RESERVE" }));
});

test("los especialistas del payload llevan su situación de plantilla", () => {
  // La capa de plantilla cubría las 552 filas del board y CERO de los 64
  // especialistas: diez de los 32 pateadores publicados estaban mal — cuatro
  // sin equipo, tres activos en otro equipo, dos en el equipo de prácticas.
  // Es la ronda donde nadie mira dos veces.
  const sp = model?.fantasy?.specialists;
  if (!sp?.kickers?.length) return; // sin payload generado no se afirma nada
  for (const clave of ["kickers", "defenses"]) {
    const filas = sp[clave] ?? [];
    assert.ok(filas.length > 0, `${clave} vacío`);
    const sinEstado = filas.filter((r) => !r.roster_state);
    assert.equal(sinEstado.length, 0,
      `${sinEstado.length} de ${filas.length} ${clave} sin roster_state: `
      + `${sinEstado.slice(0, 3).map((r) => r.player_full_name ?? r.team).join(", ")}`);
  }
  // Y el que no está activo se puede MARCAR: la marca sale de los mismos campos.
  for (const k of sp.kickers) {
    if (k.roster_state !== "ACTIVE") assert.ok(rosterMark(k), `${k.player_full_name} sin marca`);
  }
});
