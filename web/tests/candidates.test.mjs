/**
 * La lista corta: qué se recomienda y, sobre todo, qué NO.
 *
 * Los dos casos que esto vigila no fallan solos. Un agente libre y un jugador
 * apartado por la liga llegan al board con su número intacto —la proyección
 * salió de lo que produjeron cuando jugaban— así que encabezan la lista sin que
 * nada chirríe. La diferencia entre «lo mejor disponible» y «lo mejor
 * disponible que además va a jugar» es toda la utilidad del asistente en la
 * primera ronda.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";

import { candidates, headlineReason } from "../app/fantasy/candidates.js";

const fila = (id, vor, extra = {}) => ({
  player_id: id, player_name: id, position: "RB", team: "GB", vor, tier: 1, ...extra,
});

test("el primero por VOR encabeza la lista", () => {
  const out = candidates([fila("a", 40), fila("b", 30)], { limit: 2 });
  assert.equal(out[0].row.player_id, "a");
  assert.ok(out[0].reasons.some((r) => r.kind === "TOP"));
});

test("un jugador APARTADO no se recomienda, aunque sea el de más VOR", () => {
  // El caso real: Josh Jacobs, puesto 38 del board, en la Lista de Exentos del
  // Comisionado sin fecha de vuelta y figurando ACT en Green Bay.
  const pool = [
    fila("exento", 40, { status_severity: "OUT", status_label: "EXEMPT LIST" }),
    fila("sano", 30),
  ];
  const out = candidates(pool, { limit: 4 });
  assert.equal(out.length, 1);
  assert.equal(out[0].row.player_id, "sano");
});

test("una DUDA sí se recomienda, marcada: no se decide por quien draftea", () => {
  const pool = [
    fila("duda", 40, { status_severity: "RISK", status_label: "PUP" }),
    fila("sano", 30),
  ];
  const out = candidates(pool, { limit: 4 });
  assert.equal(out.length, 2);
  assert.equal(out[0].row.player_id, "duda");
});

test("un agente libre tampoco encabeza la lista", () => {
  const out = candidates([fila("libre", 40, { rostered: false }), fila("sano", 30)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].row.player_id, "sano");
});

test("el conteo del tier se hace sobre el pool RECOMENDABLE, no sobre el board", () => {
  // Si los apartados contaran, «quedan 3 de este tier» incluiría a quien no
  // puede jugar — un número que se lee como abundancia y no lo es.
  const pool = [
    fila("sano", 30),
    fila("out1", 29, { status_severity: "OUT", status_label: "IR" }),
    fila("out2", 28, { status_severity: "OUT", status_label: "IR" }),
  ];
  const [primero] = candidates(pool, { limit: 1 });
  assert.equal(primero.sameTier, 1, "sólo queda uno de verdad");
});

test("no se recomienda a quien no tiene número propio", () => {
  // El caso real: del puesto 150 al 180 el board se llenó de corredores de
  // plantilla profunda, todos con ~112 puntos porque 112 ES la media del
  // corredor. Con 0,3 partidos ponderados, el 97% de esa cifra es el ancla.
  const pool = [
    fila("mafah", 40, { weighted_games: 0.56 }),
    fila("lloyd", 39, { weighted_games: 0.3 }),
    fila("titular", 30, { weighted_games: 15 }),
  ];
  const out = candidates(pool, { limit: 4 });
  assert.equal(out.length, 1);
  assert.equal(out[0].row.player_id, "titular");
});

test("un NOVATO no cae en esa regla: su número no es la media de la posición", () => {
  // Su previa viene del capital de draft (E9), validada aparte. Excluirlo por
  // no tener partidos NFL sería excluirlo por ser novato.
  const pool = [
    fila("novato", 40, { weighted_games: 0, rookie: true }),
    fila("titular", 30, { weighted_games: 15 }),
  ];
  const out = candidates(pool, { limit: 4 });
  assert.equal(out.length, 2);
  assert.equal(out[0].row.player_id, "novato");
});

test("sin dato de muestra no se excluye a nadie", () => {
  // Ausencia de dato no es evidencia de muestra corta. Un board publicado por
  // una versión anterior no trae `wg`, y vaciar la lista corta por eso sería
  // peor que el problema.
  const out = candidates([fila("sinwg", 40), fila("otro", 30)], { limit: 4 });
  assert.equal(out.length, 2);
});

// --- §6: nunca presentar como normal a quien no lo es ---------------------

test("la alternativa enseña la SALVEDAD, no la mitad bonita", () => {
  /* Las alternativas pintaban `reasons[0]`, que siempre es «llena tu hueco
     de X». En la rama de último recurso todas las filas llevan además «no
     queda nadie con equipo NFL para ese hueco», y esa era la que se caía: un
     agente libre presentado con el mismo texto que un titular. */
  const entrada = {
    reasons: [
      { kind: "EMPTY_SLOT", text: "Fills your open WR, which would otherwise score 0" },
      { kind: "NO_NFL_TEAM", text: "No rostered player is left for this slot — this one has no NFL team" },
    ],
  };
  assert.equal(headlineReason(entrada).kind, "NO_NFL_TEAM");
  // Y sin salvedad se enseña lo de siempre.
  assert.equal(
    headlineReason({ reasons: [{ kind: "OPEN_STARTER", text: "Fills your open RB" }] }).kind,
    "OPEN_STARTER",
  );
  assert.equal(headlineReason(null), null);
  assert.equal(headlineReason({ reasons: [] }), null);
});

test("las dos pantallas piden el motivo a la MISMA función", () => {
  // Séptima vez que el Draft Room y el modo draft divergen. Lo que divergiría
  // aquí es si una fila dice o no que el jugador no tiene equipo NFL.
  for (const ruta of ["app/fantasy/DraftRoom.jsx", "app/fantasy/DraftMode.jsx"]) {
    const fuente = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(fuente, /headlineReason\(entry\)/, `${ruta} no usa headlineReason`);
    assert.ok(
      !/entry\.reasons\[0\]/.test(fuente),
      `${ruta} sigue pintando reasons[0]: se le cae la salvedad`,
    );
  }
});
