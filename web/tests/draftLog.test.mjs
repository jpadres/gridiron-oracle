/**
 * El registro canónico de picks.
 *
 * Lo que se comprueba no es que sume bien: es que **no se puede** perder una
 * corrección, duplicar un jugador, romper el recuento ni asignar un pick a la
 * plantilla equivocada.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ROSTER, SOURCE, fold, isMyTurn, pickLabel, providerEvents, replayState, slotForOverall,
  takeEvent, undoEvent, untilMyTurn,
} from "../app/fantasy/draftLog.js";

const T0 = 1_800_000_000_000;
const take = (playerId, extra = {}) => takeEvent({ playerId, at: T0, ...extra });

// --- fold -------------------------------------------------------------------

test("los picks se numeran por orden, no por cuándo se crearon", () => {
  const events = [take("a"), take("b", { at: T0 + 10 }), take("c", { at: T0 + 20 })];
  const { picks } = fold(events);
  assert.deepEqual(picks.map((p) => [p.playerId, p.overall]), [["a", 1], ["b", 2], ["c", 3]]);
});

test("veinte picks en el mismo milisegundo conservan su orden", () => {
  // `Date.now()` no basta: veinte tomas rápidas caen en el mismo ms y sin el
  // contador el orden sería el del array, que no es un orden.
  const events = Array.from({ length: 20 }, (_, i) => take(`p${i}`));
  const { picks } = fold(events);
  assert.deepEqual(picks.map((p) => p.playerId), events.map((e) => e.playerId));
  assert.equal(picks.at(-1).overall, 20);
});

test("tomar dos veces al mismo jugador no lo duplica", () => {
  const { picks, count } = fold([take("a"), take("a", { at: T0 + 5 })]);
  assert.equal(count, 1);
  assert.equal(picks.length, 1);
});

test("un adaptador puede reenviar su lista entera sin duplicar nada", () => {
  const lote = [take("a"), take("b"), take("c")];
  const { count } = fold([...lote, ...lote, ...lote]);
  assert.equal(count, 3);
});

// --- deshacer ---------------------------------------------------------------

test("deshacer libera al jugador y renumera lo que venía detrás", () => {
  // El recuento roto es el fallo clásico aquí: si `overall` se congelara al
  // crear el evento, deshacer un pick de en medio dejaría un hueco.
  const events = [take("a"), take("b", { at: T0 + 10 }), take("c", { at: T0 + 20 })];
  const { picks, count } = fold([...events, undoEvent({ playerId: "b", at: T0 + 30 })]);
  assert.equal(count, 2);
  assert.deepEqual(picks.map((p) => [p.playerId, p.overall]), [["a", 1], ["c", 2]]);
});

test("deshacer sobrevive a que el proveedor reenvíe el mismo pick", () => {
  // Es el defecto concreto de la versión anterior: `undo()` quitaba del
  // conjunto y el sondeo lo devolvía a los 15 s.
  const sincronizado = take("a", { source: SOURCE.SLEEPER, at: T0 });
  const deshecho = undoEvent({ playerId: "a", at: T0 + 100 });
  const reenvio = take("a", { source: SOURCE.SLEEPER, at: T0 });
  assert.equal(fold([sincronizado, deshecho, reenvio]).count, 0);
});

test("un pick POSTERIOR del proveedor vuelve a tomarlo: el comisionado rehace", () => {
  const events = [
    take("a", { source: SOURCE.SLEEPER, at: T0 }),
    undoEvent({ playerId: "a", at: T0 + 100 }),
    take("a", { source: SOURCE.SLEEPER, at: T0 + 200 }),
  ];
  assert.equal(fold(events).count, 1);
});

test("a igual instante, una corrección manual gana al proveedor", () => {
  const manual = undoEvent({ playerId: "a", source: SOURCE.MANUAL, at: T0 });
  const proveedor = take("a", { source: SOURCE.SLEEPER, at: T0 });
  // MANUAL se ordena primero, así que el TAKE del proveedor queda DESPUÉS y
  // vuelve a tomarlo. Lo que importa es que el orden sea determinista.
  const uno = fold([manual, proveedor]).count;
  const otro = fold([proveedor, manual]).count;
  assert.equal(uno, otro, "el resultado no puede depender del orden del array");
});

test("deshacer varias veces seguidas deja el estado limpio", () => {
  const events = [take("a"), take("b", { at: T0 + 1 }), take("c", { at: T0 + 2 })];
  const undos = ["c", "b", "a"].map((p, i) => undoEvent({ playerId: p, at: T0 + 10 + i }));
  assert.equal(fold([...events, ...undos]).count, 0);
});

test("deshacer un jugador que no está no rompe nada", () => {
  assert.equal(fold([take("a"), undoEvent({ playerId: "zzz", at: T0 + 5 })]).count, 1);
});

// --- plantilla ---------------------------------------------------------------

test("sólo entran en mi plantilla los picks marcados como míos", () => {
  const events = [
    take("a", { roster: ROSTER.MINE }),
    take("b", { roster: ROSTER.OPPONENT, at: T0 + 1 }),
    take("c", { roster: ROSTER.UNKNOWN, at: T0 + 2 }),
  ];
  const { mine, count } = fold(events);
  // Los tres están fuera del board; sólo uno es mío. UNKNOWN no entra en la
  // plantilla de nadie: es la regla que protege el roster.
  assert.equal(count, 3);
  assert.deepEqual([...mine], ["a"]);
});

test("deshacer un pick mío lo saca de mi plantilla", () => {
  const events = [take("a", { roster: ROSTER.MINE }), undoEvent({ playerId: "a", at: T0 + 5 })];
  assert.equal(fold(events).mine.size, 0);
});

// --- estructura del draft -----------------------------------------------------

test("snake invierte en las rondas pares", () => {
  assert.deepEqual(slotForOverall(1, 12, "snake"), { round: 1, slot: 1, inRound: 1 });
  assert.deepEqual(slotForOverall(12, 12, "snake"), { round: 1, slot: 12, inRound: 12 });
  assert.deepEqual(slotForOverall(13, 12, "snake"), { round: 2, slot: 12, inRound: 1 });
  assert.deepEqual(slotForOverall(24, 12, "snake"), { round: 2, slot: 1, inRound: 12 });
});

test("linear no invierte", () => {
  assert.equal(slotForOverall(13, 12, "linear").slot, 1);
  assert.equal(slotForOverall(24, 12, "linear").slot, 12);
});

test("un tipo de draft desconocido no produce calendario", () => {
  assert.equal(slotForOverall(5, 12, "auction"), null);
  assert.equal(slotForOverall(5, 12, undefined), null);
});

test("10, 12 y 14 equipos dan turnos distintos", () => {
  for (const teams of [10, 12, 14]) {
    assert.equal(slotForOverall(teams + 1, teams, "snake").slot, teams);
  }
});

// --- ¿es mi turno? ------------------------------------------------------------

test("mi turno se deriva del puesto y el tipo", () => {
  assert.equal(isMyTurn({ overall: 8, teams: 12, type: "snake", mySlot: 8 }), true);
  assert.equal(isMyTurn({ overall: 9, teams: 12, type: "snake", mySlot: 8 }), false);
  // Ronda 2 de un snake de 12: el puesto 8 elige en el pick 17.
  assert.equal(isMyTurn({ overall: 17, teams: 12, type: "snake", mySlot: 8 }), true);
});

test("sin puesto conocido NO se adivina: null, no false", () => {
  // `false` diría «no es tuyo», que es una afirmación. `null` dice que no se
  // sabe, y la interfaz pregunta en vez de asignar.
  assert.equal(isMyTurn({ overall: 8, teams: 12, type: "snake", mySlot: null }), null);
  assert.equal(isMyTurn({ overall: 8, teams: null, type: "snake", mySlot: 8 }), null);
  assert.equal(isMyTurn({ overall: 8, teams: 12, type: null, mySlot: 8 }), null);
});

// --- cuántos faltan -----------------------------------------------------------

test("los picks hasta mi turno se cuentan sobre los picks reales", () => {
  const next = untilMyTurn({ count: 5, teams: 12, type: "snake", mySlot: 8 });
  assert.equal(next.overall, 8);
  assert.equal(next.away, 2);
});

test("justo en mi turno faltan cero", () => {
  assert.equal(untilMyTurn({ count: 7, teams: 12, type: "snake", mySlot: 8 }).away, 0);
});

test("tras mi pick, el siguiente turno es el de la vuelta", () => {
  // Snake de 12, puesto 8: tras el pick 8, el siguiente mío es el 17.
  const next = untilMyTurn({ count: 8, teams: 12, type: "snake", mySlot: 8 });
  assert.equal(next.overall, 17);
  assert.equal(next.round, 2);
});

test("terminadas las rondas ya no hay turno siguiente", () => {
  assert.equal(untilMyTurn({ count: 24, teams: 12, type: "snake", mySlot: 8, rounds: 2 }), null);
});

test("sin puesto no se inventa una cuenta atrás", () => {
  assert.equal(untilMyTurn({ count: 5, teams: 12, type: "snake", mySlot: null }), null);
});

test("la etiqueta de pick usa el formato del deporte", () => {
  assert.equal(pickLabel(8, 12, "snake"), "1.08");
  assert.equal(pickLabel(17, 12, "snake"), "2.05");
  assert.equal(pickLabel(8, null, null), "#8");
});

// --- replay: el estado tras el pick efectivo N ------------------------------

test("REPLAY · el invariante: rebanar N picks == replegar esos N como eventos", () => {
  // Una historia con ruido de verdad: deshacer, rehacer, corrección de dueño.
  const events = [
    takeEvent({ playerId: "a", roster: ROSTER.OPPONENT, at: T0 }),
    takeEvent({ playerId: "b", roster: ROSTER.MINE, at: T0 + 1 }),
    undoEvent({ playerId: "a", at: T0 + 2 }),
    takeEvent({ playerId: "c", roster: ROSTER.OPPONENT, at: T0 + 3 }),
    takeEvent({ playerId: "a", roster: ROSTER.MINE, at: T0 + 4 }),
    takeEvent({ playerId: "d", roster: ROSTER.OPPONENT, at: T0 + 5 }),
  ];
  const state = fold(events);
  assert.equal(state.count, 4, "b, c, a(rehecho), d");

  for (let n = 0; n <= state.count; n += 1) {
    const sliced = replayState(state, n);
    // Replegar los N primeros picks efectivos como si fueran el registro entero.
    const refolded = fold(state.picks.slice(0, n));
    assert.deepEqual(
      sliced.picks.map((p) => [p.playerId, p.overall, p.roster]),
      refolded.picks.map((p) => [p.playerId, p.overall, p.roster]),
      `n=${n}`
    );
    assert.deepEqual([...sliced.mine].sort(), [...refolded.mine].sort(), `mine n=${n}`);
    assert.equal(sliced.count, n);
  }
});

test("REPLAY · la historia efectiva no enseña el ruido", () => {
  // El jugador deshecho y rehecho aparece UNA vez, en su sitio final.
  const events = [
    takeEvent({ playerId: "x", roster: ROSTER.OPPONENT, at: T0 }),
    undoEvent({ playerId: "x", at: T0 + 1 }),
    takeEvent({ playerId: "y", roster: ROSTER.OPPONENT, at: T0 + 2 }),
    takeEvent({ playerId: "x", roster: ROSTER.MINE, at: T0 + 3 }),
  ];
  const state = fold(events);
  const at1 = replayState(state, 1);
  assert.deepEqual(at1.picks.map((p) => p.playerId), ["y"],
    "tras el pick 1 está y — el primer TAKE de x fue deshecho y no es historia");
  const at2 = replayState(state, 2);
  assert.ok(at2.mine.has("x"), "x aparece con su dueño CORREGIDO desde el principio");
});

test("REPLAY · las fronteras: 0 es pre-draft y count es el presente", () => {
  const events = [takeEvent({ playerId: "a", at: T0 }), takeEvent({ playerId: "b", at: T0 + 1 })];
  const state = fold(events);
  assert.equal(replayState(state, 0).count, 0);
  assert.equal(replayState(state, 0).byPlayer.size, 0);
  assert.deepEqual(replayState(state, 2).picks, state.picks);
  // Fuera de rango se acota, no revienta.
  assert.equal(replayState(state, -3).count, 0);
  assert.equal(replayState(state, 99).count, 2);
});

test("REPLAY · determinismo: mismo punto, mismo estado, venga como venga el registro", () => {
  const base = [
    takeEvent({ playerId: "a", at: T0 }), takeEvent({ playerId: "b", at: T0 + 1 }),
    undoEvent({ playerId: "a", at: T0 + 2 }), takeEvent({ playerId: "c", at: T0 + 3 }),
  ];
  const shuffled = [base[3], base[1], base[0], base[2]];
  const one = replayState(fold(base), 1);
  const two = replayState(fold(shuffled), 1);
  assert.deepEqual(one.picks.map((p) => p.playerId), two.picks.map((p) => p.playerId));
});


/* ── el NÚMERO DE PICK del proveedor manda ───────────────────────────────────
 *
 * El fallo que esto caza se vio en un draft REAL. Sleeper dice «pick 59» y
 * Gridiron numeraba por posición ENTRE LOS RESUELTOS: un solo pick que no se
 * pueda emparejar —un novato de 2026 que no está en el board publicado, un
 * pateador— y todo lo siguiente se corre una casilla. En una parrilla de snake
 * una casilla es la columna de OTRO equipo, así que los jugadores aparecían en
 * el sitio equivocado y la etiqueta `5.09` describía otro pick.
 *
 * No hacía falta adivinar nada: el número venía en `pick_no` y se tiraba.
 */

const prov = (playerId, pickNo, extra = {}) =>
  ({ playerId, pickNo, providerId: `s${playerId}`, roster: ROSTER.OPPONENT, ...extra });

test("un pick del proveedor conserva SU número, no el de su posición en la lista", () => {
  // Sleeper manda los picks 1, 2 y 4: el 3 no se pudo emparejar y NO llega.
  const { picks } = fold(providerEvents([prov("a", 1), prov("b", 2), prov("d", 4)]));
  assert.deepEqual(picks.map((p) => [p.playerId, p.overall]), [["a", 1], ["b", 2], ["d", 4]]);
});

test("y por eso el hueco del pick sin emparejar se QUEDA vacío en la parrilla", () => {
  const { picks } = fold(providerEvents([prov("a", 1), prov("b", 2), prov("d", 4)]));
  assert.equal(picks.find((p) => p.overall === 3), undefined,
    "la casilla 3 es de un pick que existió y no se pudo emparejar: vacía es la verdad");
});

test("con doce equipos, un solo pick perdido cambiaba de COLUMNA a los siguientes", () => {
  // La demostración del daño, en números que no son la vuelta del snake: el 6
  // no se pudo emparejar, así que llegan el 5 y el 7. Con la numeración por
  // posición, el jugador del 7 heredaba el 6 — la columna del equipo 6, que es
  // el pick de OTRO.
  const { picks } = fold(providerEvents([prov("x", 5), prov("y", 7)]));
  const y = picks.find((p) => p.playerId === "y");
  assert.equal(y.overall, 7);
  assert.equal(slotForOverall(7, 12, "snake").slot, 7);
  assert.equal(slotForOverall(6, 12, "snake").slot, 6, "el 6 es de otro equipo");
  assert.notEqual(slotForOverall(y.overall, 12, "snake").slot, 6);
});

test("las etiquetas de pick salen bien después de un hueco", () => {
  const { picks } = fold(providerEvents([prov("a", 1), prov("c", 13)]));
  assert.equal(pickLabel(picks.at(-1).overall, 12, "snake"), "2.01");
});

test("un draft MANUAL sigue numerando 1, 2, 3: no se le inventa un hueco", () => {
  const { picks } = fold([take("a"), take("b", { at: T0 + 1 }), take("c", { at: T0 + 2 })]);
  assert.deepEqual(picks.map((p) => p.overall), [1, 2, 3]);
});

test("un pick manual junto a los del proveedor NO roba un número ya ocupado", () => {
  // El 3 es del proveedor; el manual llega después y tiene que ir al 4.
  const eventos = [
    ...providerEvents([prov("a", 1), prov("b", 3)]),
    take("manual", { at: T0 + 9_000 }),
  ];
  const { picks } = fold(eventos);
  const porId = Object.fromEntries(picks.map((p) => [p.playerId, p.overall]));
  assert.equal(porId.a, 1);
  assert.equal(porId.b, 3);
  assert.equal(porId.manual, 4, "no puede caer en el 2, que es de un pick que existió");
  assert.equal(new Set(picks.map((p) => p.overall)).size, picks.length, "sin números repetidos");
});

test("deshacer un pick del proveedor no renumera a los demás", () => {
  // Ésta es la razón por la que `fold` renumeraba, y sigue cubierta: con
  // números del proveedor no hace falta renumerar nada, que es lo correcto —
  // el pick 3 sigue siendo el 3 aunque el 2 se caiga.
  const eventos = [...providerEvents([prov("a", 1), prov("b", 2), prov("c", 3)]),
                   undoEvent({ playerId: "b", at: T0 + 9_000 })];
  const { picks, count } = fold(eventos);
  assert.equal(count, 2);
  assert.deepEqual(picks.map((p) => [p.playerId, p.overall]), [["a", 1], ["c", 3]]);
});

test("el replay recorre picks, no números: con huecos sigue avanzando de uno en uno", () => {
  const state = fold(providerEvents([prov("a", 1), prov("d", 4), prov("f", 6)]));
  assert.equal(replayState(state, 2).count, 2);
  assert.deepEqual(replayState(state, 2).picks.map((p) => p.overall), [1, 4]);
});
