/**
 * LOS PICKS DEL PROVEEDOR, bajo las condiciones de un sondeo real.
 *
 * Un sondeo puede devolver la lista desordenada, con un pick repetido, entera
 * otra vez tras una reconexión, o con huecos donde un jugador no se pudo
 * emparejar. El estado que sale de `providerEvents` + `fold` tiene que ser el
 * MISMO en todos esos casos: los mismos picks, con el mismo número cada uno,
 * y los míos siendo míos. Un evento canónico duplicado corrompe la plantilla;
 * un hueco que se cierra solo pone a alguien en la columna de otro equipo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ROSTER, fold, providerEvents, takeEvent } from "../app/fantasy/draftLog.js";

const pick = (playerId, pickNo, draftSlot, extra = {}) => ({ playerId, pickNo, draftSlot, ...extra });

/** Doce picks de una liga de 12, con el 7 sin emparejar (no aparece). */
const LISTA = [
  pick("a", 1, 1), pick("b", 2, 2), pick("c", 3, 3), pick("d", 4, 4), pick("e", 5, 5),
  pick("f", 6, 6), /* el 7 es un novato sin id: no llega */ pick("h", 8, 8),
  pick("i", 9, 9), pick("j", 10, 10), pick("k", 11, 11), pick("l", 12, 12),
  pick("m", 13, 12), pick("n", 14, 11),          // ronda 2, snake
];

const huella = (estado) => ({
  orden: estado.picks.map((p) => `${p.overall}:${p.playerId}:${p.roster}`),
  mios: [...estado.mine].sort(),
  count: estado.count,
});

const base = fold(providerEvents(LISTA, { mySlot: 11 }));

test("el pick sin emparejar deja su hueco: el 8 sigue siendo el 8", () => {
  const ocho = base.picks.find((p) => p.playerId === "h");
  assert.equal(ocho.overall, 8);
  assert.equal(base.count, 13, "trece resueltos de catorce leídos");
});

test("la casilla declarada atribuye los míos sin cuenta enlazada, y sólo los míos", () => {
  assert.deepEqual([...base.mine].sort(), ["k", "n"]);   // puesto 11: picks 11 y 14
  assert.equal(base.picks.find((p) => p.playerId === "a").roster, ROSTER.OPPONENT);
});

test("desordenar la lista no cambia nada", () => {
  const revuelta = [...LISTA].reverse();
  assert.deepEqual(huella(fold(providerEvents(revuelta, { mySlot: 11 }))), huella(base));
  const barajada = [LISTA[5], LISTA[0], LISTA[12], LISTA[3], ...LISTA.filter((_, i) => ![5, 0, 12, 3].includes(i))];
  assert.deepEqual(huella(fold(providerEvents(barajada, { mySlot: 11 }))), huella(base));
});

test("un pick repetido en la respuesta no se convierte en dos eventos", () => {
  const conDuplicado = [...LISTA, pick("c", 3, 3), pick("k", 11, 11)];
  assert.deepEqual(huella(fold(providerEvents(conDuplicado, { mySlot: 11 }))), huella(base));
});

test("reenviar la lista entera tras una reconexión es idempotente", () => {
  const dosVeces = [...providerEvents(LISTA, { mySlot: 11 }), ...providerEvents(LISTA, { mySlot: 11 })];
  assert.deepEqual(huella(fold(dosVeces)), huella(base));
});

test("una reconexión que trae DIEZ picks nuevos los coloca todos donde el proveedor dice", () => {
  const antes = fold(providerEvents(LISTA.slice(0, 4), { mySlot: 11 }));
  assert.equal(antes.count, 4);
  const despues = fold(providerEvents(LISTA, { mySlot: 11 }));
  assert.deepEqual(huella(despues), huella(base));
  for (const p of despues.picks) assert.equal(p.overall, LISTA.find((x) => x.playerId === p.playerId).pickNo);
});

test("sin puesto declarado y sin dueño del proveedor, NADIE es mío ni de otro", () => {
  const sinPuesto = fold(providerEvents(LISTA, { mySlot: null }));
  assert.equal(sinPuesto.mine.size, 0);
  assert.ok(sinPuesto.picks.every((p) => p.roster === ROSTER.UNKNOWN));
});

test("un pick que el proveedor YA atribuye no lo reatribuye la casilla", () => {
  const lista = [pick("a", 1, 11, { roster: ROSTER.OPPONENT }), pick("b", 2, 2)];
  const estado = fold(providerEvents(lista, { mySlot: 11 }));
  assert.equal(estado.picks[0].roster, ROSTER.OPPONENT, "el proveedor es evidencia más fuerte que la casilla");
});

test("un pick manual tecleado después NO cae en el número de un pick del proveedor sin emparejar", () => {
  // El 7 existió (lo dice el proveedor por omisión) y no se emparejó; un pick
  // manual no puede ocupar ese número, porque en la parrilla sería otra columna.
  const eventos = [...providerEvents(LISTA, { mySlot: 11 }), takeEvent({ playerId: "z", roster: ROSTER.MINE })];
  const estado = fold(eventos);
  const z = estado.picks.find((p) => p.playerId === "z");
  assert.notEqual(z.overall, 7, "el hueco del proveedor no se rellena");
  assert.equal(z.overall, 15, "va detrás del último número que ya existe");
});
