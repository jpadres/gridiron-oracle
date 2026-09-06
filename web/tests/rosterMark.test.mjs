/**
 * La marca de plantilla dice un hecho y no toca un número.
 *
 * El fallo que estas pruebas existen para impedir: el board se compila con datos
 * de agosto y el registro de plantillas es de septiembre. Sin esta marca, un
 * jugador en una lista de reserva se lee igual que un titular.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import {
  rosterMark, changedSinceModel, teamChangeMark, updatedSinceModel,
} from "../app/fantasy/rosterMark.js";
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
  // La condición es ESA, no la palabra del que llama: una fila sin `rostered`
  // —los especialistas— no la cumple y sí lleva marca. Ver el test de abajo.
  assert.equal(
    rosterMark({ roster_state: "NOT_ON_ROSTER", rostered: false }, { yaDiceSinEquipo: true }),
    null,
  );
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

test("una defensa de equipo no lleva marca ni cuenta como cambio", () => {
  /* El payload marcaba las 32 defensas `NOT_ON_ROSTER` porque un equipo no
     tiene fila en el registro de plantillas. `rosterMark` con
     `yaDiceSinEquipo` se callaba por casualidad, pero la tabla principal la
     llama SIN esa opción: una pantalla de distancia de escribir «NO NFL TEAM»
     al lado de la defensa de Kansas City. */
  const defensa = { position: "DST", team: "KC", roster_state: "TEAM_UNIT",
                    roster_label: "TEAM UNIT", roster_team: "KC",
                    roster_source_as_of: "2026-09-05" };
  assert.equal(rosterMark(defensa), null);
  assert.equal(changedSinceModel(defensa), false);
});

test("y sin fila, la marca lleva la fecha del fichero de plantillas", () => {
  // «as of an unknown date» salía en 66 filas del board teniendo la fecha.
  const fantasma = { position: "WR", roster_state: "NOT_ON_ROSTER",
                     roster_source_as_of: "2026-09-05" };
  const marca = rosterMark(fantasma);
  assert.match(marca.title, /2026-09-05/);
  assert.ok(!/unknown date/.test(marca.title));
});

test("un especialista sin equipo NFL SÍ lleva marca aunque la pantalla prometa pintarla", () => {
  /* `yaDiceSinEquipo` era una promesa del llamador, y el Draft Room sólo
     cumple esa promesa cuando `rostered === false`. Los pateadores y las
     defensas no traen ese campo, así que los cuatro pateadores sin equipo del
     payload de 2026 salían en la sala sin ninguna marca. */
  const pateador = { position: "K", roster_state: "NOT_ON_ROSTER",
                     roster_source_as_of: "2026-09-05" };
  const marca = rosterMark(pateador, { yaDiceSinEquipo: true });
  assert.ok(marca, "sin `rostered === false` nadie más lo dice: hay que decirlo aquí");
  assert.equal(marca.text, "NO NFL TEAM");

  // Y con el campo puesto sí se calla, que es para lo que existe la opción.
  const jugador = { position: "WR", roster_state: "NOT_ON_ROSTER", rostered: false };
  assert.equal(rosterMark(jugador, { yaDiceSinEquipo: true }), null);
});

test("«updated since model» sólo habla de hechos MATERIALES y posteriores", () => {
  const base = { position: "RB", team: "LV", roster_source_as_of: "2026-09-05" };
  // Cambio de equipo después de la fecha del modelo: material.
  const cambio = updatedSinceModel({ ...base, roster_team: "KC", roster_state: "ACTIVE" }, "2026-08-17");
  assert.ok(cambio.facts.some((f) => /Now on KC/.test(f)));
  assert.equal(cambio.asOf, "2026-09-05");

  // Activo en su mismo equipo: no hay nada que decir.
  assert.equal(
    updatedSinceModel({ ...base, roster_team: "LV", roster_state: "ACTIVE" }, "2026-08-17"),
    null,
  );

  // ANTERIOR a la fecha del modelo: el modelo ya lo pudo ver.
  assert.equal(
    updatedSinceModel({ ...base, roster_team: "KC", roster_state: "ACTIVE",
                        roster_source_as_of: "2026-08-10" }, "2026-08-17"),
    null,
  );

  // Sin fecha del modelo no se afirma que algo sea posterior a ella.
  assert.equal(updatedSinceModel({ ...base, roster_state: "RESERVE" }, null), null);

  // Y una defensa no genera hechos: no es una persona.
  assert.equal(
    updatedSinceModel({ position: "DST", team: "KC", roster_team: "KC",
                        roster_state: "TEAM_UNIT", roster_source_as_of: "2026-09-05" },
                      "2026-08-17"),
    null,
  );
});

test("el cambio de equipo se marca, y «LA» y «LAR» NO son un cambio", () => {
  /* 32 filas del board pintaban el equipo en el que el jugador JUGÓ mientras
     el registro del día decía otro, y la cabecera prometía «quién cambió de
     equipo». Isiah Pacheco salía «RB · KC» con el registro diciendo DET. */
  const pacheco = { position: "RB", team: "KC", roster_team: "DET",
                    roster_state: "RESERVE", roster_source_as_of: "2026-09-05" };
  const marca = teamChangeMark(pacheco);
  assert.equal(marca.text, "NOW DET");
  assert.match(marca.title, /KC/);
  assert.match(marca.title, /2026-09-05/);

  // Un pateador ACTIVO en otro equipo también: `rosterMark` se calla con
  // ACTIVE, así que sin esto Grupe, Carlson y Folk salían sin ninguna marca.
  assert.equal(teamChangeMark({ position: "K", team: "IND", roster_team: "NYJ",
                                roster_state: "ACTIVE" }).text, "NOW NYJ");

  // Y los Rams no se traspasan a sí mismos: el payload publica «LA» y «LAR».
  assert.equal(teamChangeMark({ position: "WR", team: "LA", roster_team: "LAR" }), null);
  assert.equal(teamChangeMark({ position: "WR", team: "LAR", roster_team: "LAR" }), null);
  // Una defensa no cambia de equipo: es el equipo.
  assert.equal(teamChangeMark({ position: "DST", team: "KC", roster_team: "KC",
                                roster_state: "TEAM_UNIT" }), null);
});

test("«updated since model» tampoco inventa un traspaso entre LA y LAR", () => {
  assert.equal(
    updatedSinceModel({ position: "WR", team: "LA", roster_team: "LAR",
                        roster_state: "ACTIVE", roster_source_as_of: "2026-09-05" },
                      "2026-08-17"),
    null,
  );
});

test("las tres superficies piden la marca a la MISMA función", () => {
  for (const ruta of ["app/ui.jsx", "app/fantasy/rowMarks.jsx"]) {
    const fuente = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(fuente, /teamChangeMark/, `${ruta} no marca el cambio de equipo`);
  }
});

test("las DOS listas de board pintan el cambio de equipo, no sólo la tarjeta", () => {
  /* `rosterMark` calla con ACTIVE porque es el caso normal, así que un jugador
     ACTIVO EN OTRO EQUIPO no produce marca por esa vía. Medido en los
     pateadores del board de 2026: Blake Grupe con el board en IND y el registro
     en NYJ, Daniel Carlson LV/NO y Nick Folk NYJ/ATL — tres filas que salían en
     la lista del board SIN UNA SOLA MARCA, en la ronda donde nadie mira dos
     veces. `teamChangeMark` ya existía y ya se pintaba en la tarjeta de
     recomendación y en el semanal (`RowMarks`): faltaba en la lista. Es el
     fallo de las dos superficies con distinta cobertura, y por eso se comprueba
     leyendo el JSX de las dos. */
  for (const file of ["app/fantasy/DraftRoom.jsx", "app/fantasy/DraftMode.jsx"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    /* Se mira la CONDICIÓN del JSX, no que el nombre aparezca. La primera
       versión pedía `teamChangeMark(` a secas y la inyección —cambiar la
       condición por `false`— la dejaba VERDE, porque el nombre sigue estando
       en el `title` y en el texto de dentro. Es el «la palabra aparece cerca»
       que ya costó dos versiones en `tests/candidates.test.mjs`. */
    assert.match(src, /\{\s*teamChangeMark\([^)]*\)\s*\?\s*\(/,
      `${file} no pinta el cambio de equipo en su lista de board`);
  }
});

test("un pateador ACTIVO en otro equipo produce marca de cambio", () => {
  const grupe = { player_full_name: "Blake Grupe", position: "K", team: "IND",
                  roster_state: "ACTIVE", roster_team: "NYJ",
                  roster_source_as_of: "2026-09-05" };
  assert.equal(rosterMark(grupe), null, "ACTIVE no produce marca de plantilla, y es correcto");
  const cambio = teamChangeMark(grupe);
  assert.ok(cambio, "un activo en otro equipo tiene que marcarse");
  assert.equal(cambio.text, "NOW NYJ");
});
