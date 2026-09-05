/**
 * BEST PICK FOR ME — el motor con contexto de plantilla.
 *
 * El fallo que existe para cazar es el que reportó el dueño en un draft real:
 * coges un ala cerrada y el asistente te sigue ofreciendo otro porque el board
 * dice que vale mucho. Aquí se prueba que deja de encabezar, que NO desaparece
 * del board, y que en las ligas donde ese segundo sí cabe (superflex, 2QB) sí
 * puede encabezar — con la MISMA regla, sin una excepción escrita para cada una.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { bestForMe, candidates } from "../app/fantasy/candidates.js";
import { POSITION_STATE, replacementPoints, starterState } from "../app/fantasy/rosterFit.js";

/* Niveles de reemplazo parecidos a los del board real: el QB es el más alto,
   que es lo que hace que ordenar por PUNTOS ponga a los quarterbacks arriba. */
const REP = { QB: 233, RB: 131, WR: 132, TE: 113 };
let n = 0;
const p = (position, proj, extra = {}) => ({
  player_id: `${position}${(n += 1)}`, player_name: `${position} ${n}`,
  position, projected_points: proj, vor: proj - REP[position], tier: 1,
  wg: 16, rostered: true, ...extra,
});

const NORMAL = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN"];
const SUPERFLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"];
const DOS_QB = ["QB", "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"];
const SIN_FLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "BN"];
const FLEX_CON_TE = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"];

/** Un pool donde el mejor de todos es un ala cerrada, que es el caso del fallo. */
const pool = () => {
  n = 0;
  return {
    TE1: p("TE", 240), TE2: p("TE", 230),   // vor 127 y 117 — los más altos
    QB1: p("QB", 350), QB2: p("QB", 340),   // vor 117 y 107
    RB1: p("RB", 250), RB2: p("RB", 240),   // vor 119 y 109
    WR1: p("WR", 248), WR2: p("WR", 238),   // vor 116 y 106
  };
};

/* ── el estado de la plantilla, en hechos ────────────────────────────────── */

test("sin estructura declarada NO se deriva ningún estado", () => {
  assert.equal(starterState({ roster: [], rosterPositions: [] }), null);
  assert.equal(bestForMe([], { roster: [], rosterPositions: null }), null);
});

test("con la plantilla vacía todas las posiciones tienen hueco dedicado", () => {
  const s = starterState({ roster: [], rosterPositions: NORMAL });
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    assert.equal(s.byPosition[pos], POSITION_STATE.OPEN_STARTER, pos);
  }
  assert.equal(s.startersComplete, false);
  assert.equal(s.openSpecialist.length, 2, "DEF y K son huecos que sólo ellos llenan");
});

test("con el TE puesto, TE pasa a FLEX_ELIGIBLE: el hueco dedicado se cerró", () => {
  const b = pool();
  const s = starterState({ roster: [b.TE1], rosterPositions: NORMAL });
  assert.equal(s.byPosition.TE, POSITION_STATE.FLEX_ELIGIBLE);
  assert.equal(s.byPosition.RB, POSITION_STATE.OPEN_STARTER);
});

test("en una liga SIN flex, el segundo TE queda SATURADO", () => {
  const b = pool();
  const s = starterState({ roster: [b.TE1], rosterPositions: SIN_FLEX });
  assert.equal(s.byPosition.TE, POSITION_STATE.STARTER_FILLED);
});

test("en 1QB, con el QB puesto, QB queda SATURADO — el FLEX no lo admite", () => {
  const b = pool();
  const s = starterState({ roster: [b.QB1], rosterPositions: NORMAL });
  assert.equal(s.byPosition.QB, POSITION_STATE.STARTER_FILLED);
});

test("en SUPERFLEX, con el QB puesto, QB sigue teniendo hueco", () => {
  const b = pool();
  const s = starterState({ roster: [b.QB1], rosterPositions: SUPERFLEX });
  assert.equal(s.byPosition.QB, POSITION_STATE.FLEX_ELIGIBLE);
});

test("en 2QB, con un QB puesto, el otro hueco de QB sigue DEDICADO y abierto", () => {
  const b = pool();
  const s = starterState({ roster: [b.QB1], rosterPositions: DOS_QB });
  assert.equal(s.byPosition.QB, POSITION_STATE.OPEN_STARTER);
});

/* ── EL FALLO REPORTADO ──────────────────────────────────────────────────── */

test("EL FALLO: cojo el TE y el segundo TE deja de encabezar «para mí»", () => {
  const b = pool();
  const todos = Object.values(b);
  // Antes de coger nada, el TE es el número uno del board Y el recomendado.
  const antes = bestForMe(todos, { roster: [], rosterPositions: NORMAL, replacement: REP });
  assert.equal(antes.primary.row.position, "TE", "de partida el TE encabeza: su VOR es el mayor");

  // Cojo ese TE. Llega el pick canónico, mi plantilla cambia.
  const disponibles = todos.filter((r) => r.player_id !== b.TE1.player_id);
  const despues = bestForMe(disponibles, {
    roster: [b.TE1], rosterPositions: NORMAL, replacement: REP,
  });
  assert.notEqual(despues.primary.row.position, "TE",
    "con el hueco de TE lleno, el segundo TE no puede seguir siendo el principal");
  assert.equal(despues.state.byPosition.TE, POSITION_STATE.FLEX_ELIGIBLE);

  // Y NO ha desaparecido: sigue en el board, con su valor intacto.
  const board = candidates(disponibles, { limit: 8 });
  assert.ok(board.some((e) => e.row.player_id === b.TE2.player_id),
    "BEST AVAILABLE no se toca: el TE2 sigue ahí con su número");
  assert.equal(board.find((e) => e.row.player_id === b.TE2.player_id).row.vor, b.TE2.vor);
});

test("y el motivo lo DICE, con hechos y sin nota compuesta", () => {
  const b = pool();
  const despues = bestForMe(Object.values(b).filter((r) => r !== b.TE1), {
    roster: [b.TE1], rosterPositions: NORMAL, replacement: REP,
  });
  const kinds = despues.primary.reasons.map((r) => r.kind);
  assert.ok(kinds.includes("OPEN_STARTER"), kinds.join(","));
  assert.ok(despues.primary.reasons.every((r) => typeof r.text === "string" && r.text.length > 0));
  // Nada de `needScore`, `rosterFit: 82%` ni `draftGrade`.
  assert.equal(despues.primary.score, undefined);
  assert.equal(despues.primary.grade, undefined);
});

test("mismo caso con el QUARTERBACK en 1QB: el segundo QB no encabeza", () => {
  const b = pool();
  const despues = bestForMe(Object.values(b).filter((r) => r !== b.QB1), {
    roster: [b.QB1], rosterPositions: NORMAL, replacement: REP,
  });
  assert.notEqual(despues.primary.row.position, "QB");
  assert.equal(despues.state.byPosition.QB, POSITION_STATE.STARTER_FILLED);
});

test("pero en SUPERFLEX el segundo QB SÍ puede encabezar, con la MISMA regla", () => {
  const b = pool();
  // Se le deja solo contra receptores peores para que la comparación sea suya.
  const disponibles = [b.QB2, p("WR", 150), p("RB", 150)];
  const despues = bestForMe(disponibles, {
    roster: [b.QB1], rosterPositions: SUPERFLEX, replacement: REP,
  });
  assert.equal(despues.primary.row.position, "QB");
  assert.ok(despues.primary.fit.marginal > 0);
});

test("por un FLEX compiten por PUNTOS, no por VOR — y eso es lo correcto", () => {
  const b = pool();
  /* El detalle que hay que entender: TE2 tiene MÁS VOR que RB2 (117 contra
     109), pero MENOS puntos (230 contra 240). Por un hueco compartido los dos
     sustituyen al MISMO reemplazo —el suelo del FLEX, 132— así que quien añade
     más es quien más puntúa, no quien tiene más VOR.

     No es una excepción a la regla 6b: el VOR existe para comparar ENTRE
     posiciones que llenan huecos distintos. Dentro de un mismo hueco el
     denominador ya es común y la resta se hace sola. */
  const despues = bestForMe([b.TE2, b.RB2], {
    roster: [b.TE1, b.RB1, p("RB", 200), b.WR1, p("WR", 200), b.QB1],
    rosterPositions: FLEX_CON_TE, replacement: REP,
  });
  assert.equal(despues.primary.row.position, "RB");
  assert.equal(despues.primary.fit.marginal, 240 - 132);
  assert.equal(despues.primary.reasons[0].kind, "FLEX");
  // Y el ala cerrada sigue siendo elegible para ese flex: no se le excluye.
  assert.equal(despues.state.byPosition.TE, POSITION_STATE.FLEX_ELIGIBLE);
});

test("con los titulares puestos Y MEJORES que lo que queda, no hay principal", () => {
  const b = pool();
  /* «Titulares completos» no basta para callarse: si el que queda en el board
     MEJORA a uno de los tuyos, sustituirlo sí añade puntos y decir que no hay
     nada sería falso. Por eso el corte no es «quedan huecos» sino «alguien
     mejora la alineación», que es la misma resta de siempre.

     Aquí TODOS los titulares están por encima de lo que queda en el board, el
     flex incluido: el corredor de 250 que lo ocupa bate al ala cerrada de 230.
     (La primera versión de este test ponía un 200 en el flex y el candidato SÍ
     lo mejoraba: el test estaba mal, no el motor.) */
  const lleno = [b.QB1, p("RB", 260), p("RB", 255), p("WR", 248), p("WR", 245), b.TE1, p("RB", 250)];
  const despues = bestForMe([b.TE2, b.QB2], {
    roster: lleno, rosterPositions: FLEX_CON_TE, replacement: REP,
  });
  assert.equal(despues.primary, null);
  assert.equal(despues.startersComplete, true);
});

test("pero si el que queda MEJORA a un titular tuyo, sí se recomienda", () => {
  const b = pool();
  const flojo = [b.QB1, b.RB1, p("RB", 200), b.WR1, p("WR", 200), b.TE1, p("RB", 150)];
  const despues = bestForMe([b.TE2], {
    roster: flojo, rosterPositions: FLEX_CON_TE, replacement: REP,
  });
  assert.equal(despues.primary.row.player_id, b.TE2.player_id);
  assert.equal(despues.primary.fit.marginal, 230 - 150, "lo que añade es sobre el que desplaza");
});

/* ── pateador y defensa ──────────────────────────────────────────────────── */

test("K y DST no se adelantan por estar el hueco vacío", () => {
  const b = pool();
  const r = bestForMe(Object.values(b), {
    roster: [], rosterPositions: NORMAL, replacement: REP, picksLeftForMe: 10,
  });
  assert.equal(r.mustFillSpecialist, false, "con diez picks por delante no urge nada");
  assert.ok(["QB", "RB", "WR", "TE"].includes(r.primary.row.position));
});

test("pero si quedan tantos picks como huecos, se avisa de que hay que llenarlos", () => {
  const b = pool();
  const casiLleno = [b.QB1, b.RB1, p("RB", 200), b.WR1, p("WR", 200), b.TE1];
  const r = bestForMe(Object.values(b), {
    roster: casiLleno, rosterPositions: NORMAL, replacement: REP, picksLeftForMe: 3,
  });
  assert.equal(r.state.openSpecialist.length, 2, "DEF y K siguen abiertos");
  assert.equal(r.mustFillSpecialist, true);
});

test("sin saber cuántos picks quedan, NO se afirma que urja", () => {
  const b = pool();
  const r = bestForMe(Object.values(b), {
    roster: [], rosterPositions: NORMAL, replacement: REP, picksLeftForMe: null,
  });
  assert.equal(r.mustFillSpecialist, false);
});

/* ══════════════════════════════════════════════════════════════════════════
 * LA RAMA DEL HUECO VACÍO, DESPUÉS DE LA REVISIÓN ADVERSARIA
 *
 * Los cuatro defectos de abajo salieron de una revisión del arreglo que llenó
 * el hueco titular que se quedaba vacío para siempre. Ninguno lo veía la
 * tortura de 546 drafts: sus bots no construyen estas plantillas. Se prueban
 * con casos escritos a mano, que es lo que hace falta cuando el fallo depende
 * de dónde cae un jugador en una lista.
 * ══════════════════════════════════════════════════════════════════════════ */

test("un cuarto RB que MEJORA tu alineación encabeza, aunque el cupo esté lleno", () => {
  /* El cupo de RB en NORMAL es tres (RB, RB, FLEX) y yo tengo tres. Filtrar
     por cupo lo excluía: «un cuarto no puede jugar». Puede — sentando al peor.
     Los tres míos son de 135; el libre, de 228. */
  const b = pool();
  const mios = [b.QB1, b.WR1, b.WR2, b.TE1, p("RB", 135), p("RB", 135), p("RB", 134)];
  const bestia = p("RB", 228);
  const r = bestForMe([bestia, p("WR", 211)], {
    roster: mios, rosterPositions: NORMAL, replacement: REP,
  });
  assert.equal(r.primary.row.player_id, bestia.player_id,
    "el que más añade encabeza: desplaza al peor titular al banquillo");
  assert.ok(r.primary.fit.marginal > 50, `marginal real ${r.primary.fit.marginal}`);
});

test("la GUARDA del hueco vacío mira el pool entero, no la ventana de 50", () => {
  /* El primero que mejora cae en el puesto 51. Con la guarda leyendo sólo la
     ventana, la pantalla escribía «no one left beats replacement level» sobre
     alguien que sí lo bate. Mismo hecho, etiqueta distinta según el puesto. */
  const b = pool();
  const mios = [b.QB1, b.RB1, b.RB2, b.WR1, b.WR2, b.TE1, p("TE", 200)];
  // Cincuenta alas cerradas que no caben en ningún hueco: no mejoran nada.
  const relleno = Array.from({ length: 50 }, () => p("TE", 150));
  const util = p("RB", 245);   // mejor que RB2 (240): SÍ mejora
  const r = bestForMe([...relleno, util], {
    roster: mios, rosterPositions: SIN_FLEX, replacement: REP,
  });
  assert.equal(r.fillingEmptySlot ?? false, false,
    "hay quien mejora: la rama del hueco vacío no debe dispararse");
  assert.equal(r.primary.row.player_id, util.player_id);
  assert.ok(r.primary.fit.marginal > 0);
});

test("cuando la rama SÍ se dispara, sus motivos tienen la misma forma que el resto", () => {
  const r = ramaDeHuecoVacio();
  assert.equal(r.fillingEmptySlot, true);
  for (const motivo of r.primary.reasons) {
    assert.ok(motivo.kind, `un motivo sin 'kind': ${JSON.stringify(motivo)}`);
    assert.equal(motivo.key, undefined, "'key' es la forma de OTRO fichero");
  }
});

test("el motivo nombra un hueco que EXISTE y está abierto", () => {
  /* EL CASO TIENE QUE SEPARAR EL HUECO DE LA POSICIÓN.
     La primera versión de esta prueba usaba un hueco de RB abierto y un RB
     libre: el texto equivocado —«fills an open RB slot»— nombra «RB», que es
     también el hueco, así que al inyectar el fallo la prueba seguía VERDE. Aquí
     el único hueco que admite al recomendado es el FLEX, y su posición es WR:
     las dos respuestas caen en sitios distintos. Es el mismo cuidado que hizo
     falta en el test del turno, donde 8 y 9 eran los dos míos. */
  const r = ramaDeFlex();
  const texto = r.primary.reasons.find((m) => m.kind === "EMPTY_SLOT").text;
  assert.equal(r.primary.row.position, "WR");
  const abiertos = r.state.open.map((h) => h.slot);
  assert.ok(!abiertos.includes("WR"), "el caso exige que NO haya hueco de WR abierto");
  const nombrado = abiertos.find((slot) => texto.includes(slot));
  assert.ok(nombrado, `«${texto}» no nombra ninguno de los huecos abiertos ${abiertos}`);
  // Y el hueco nombrado tiene que admitir de verdad a quien se recomienda.
  const hueco = r.state.open.find((h) => h.slot === nombrado);
  assert.ok(hueco.eligible.includes(r.primary.row.position),
    `el hueco ${nombrado} no admite a un ${r.primary.row.position}`);
});

/** Titulares dedicados llenos, sólo el FLEX abierto, y sólo receptores libres. */
function ramaDeFlex() {
  const b = pool();
  const mios = [b.QB1, b.RB1, b.RB2, b.WR1, b.WR2, b.TE1];
  const r = bestForMe(Array.from({ length: 6 }, () => p("WR", REP.WR)), {
    roster: mios, rosterPositions: NORMAL, replacement: REP,
  });
  assert.ok(r && r.primary, "el caso base tiene que producir una recomendación");
  assert.equal(r.fillingEmptySlot, true, "sin esto la prueba no mira la rama que quiere mirar");
  return r;
}

/** Plantilla con un hueco de RB abierto y ningún RB por encima del reemplazo. */
function ramaDeHuecoVacio() {
  const b = pool();
  const mios = [b.QB1, b.WR1, b.WR2, b.TE1, p("RB", 250)];
  const soloReemplazo = Array.from({ length: 8 }, () => p("RB", REP.RB));
  const r = bestForMe(soloReemplazo, {
    roster: mios, rosterPositions: SIN_FLEX, replacement: REP,
  });
  assert.ok(r && r.primary, "el caso base tiene que producir una recomendación");
  return r;
}
