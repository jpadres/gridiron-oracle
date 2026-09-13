/**
 * La alineación de la semana: la puesta, la de mayor proyección y el cara a
 * cara. Todo es aritmética sobre la proyección semanal publicada.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { lineupFrom, rowsOf, sideBySide, startSit } from "../app/fantasy/lineup.js";

const ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];

const P = (sid, position, pts) =>
  ({ sid, position, projected_points: pts, player_name: sid });

const POOL = [
  P("q1", "QB", 22), P("q2", "QB", 14),
  P("r1", "RB", 18), P("r2", "RB", 12), P("r3", "RB", 11),
  P("w1", "WR", 16), P("w2", "WR", 13), P("w3", "WR", 9),
  P("t1", "TE", 10),
  P("k1", "K", 8),
  { sid: "ARI", position: "DEF", player_name: "ARI D/ST" },   // sin proyección
];
const INDEX = new Map(POOL.map((p) => [p.sid, p]));
const TODOS = POOL.map((p) => p.sid);

test("los ids que el mapa no conoce se cuentan aparte, no se inventan", () => {
  const { rows, missing } = rowsOf(["q1", "9999", "0", ""], INDEX);
  assert.deepEqual(rows.map((r) => r.sid), ["q1"]);
  assert.deepEqual(missing, ["9999"]);
});

test("la alineación de mayor proyección llena los huecos que la liga declara", () => {
  const best = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  const puestos = best.slots.map((s) => `${s.slot}:${s.player?.sid ?? "-"}`);
  // QB 22 · RB 18,12 · WR 16,13 · TE 10 · FLEX el mejor libre (RB3 11) · K 8 · DEF
  assert.deepEqual(puestos, [
    "QB:q1", "RB:r1", "RB:r2", "WR:w1", "WR:w2", "TE:t1", "FLEX:r3", "K:k1", "DEF:ARI",
  ]);
  // 22+18+12+16+13+10+11+8 = 110. La defensa NO suma: no tiene proyección.
  assert.equal(best.points, 110);
  assert.equal(best.unknown, 1);
});

test("el banquillo es lo que no cupo, y sigue disponible", () => {
  const best = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  assert.deepEqual(best.bench.map((p) => p.sid).sort(), ["q2", "w3"]);
});

test("sin huecos declarados no se inventa una plantilla estándar", () => {
  const vacia = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: null });
  assert.deepEqual(vacia.slots, []);
  assert.equal(vacia.points, 0);
});

/* ── start / sit ─────────────────────────────────────────────────────────── */

test("propone quién entra y quién sale, con la alineación puesta delante", () => {
  const best = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  // Tengo sentado a r1 (18) y puesto a r3 (11).
  const actual = ["q1", "r3", "r2", "w1", "w2", "t1", "w3", "k1", "ARI"];
  const cambio = startSit({ currentIds: actual, best });
  assert.equal(cambio.sinCambios, false);
  assert.deepEqual(cambio.entran.map((e) => e.player.sid), ["r1"]);
  assert.deepEqual(cambio.salen, ["w3"]);
});

test("si ya tienes puesta la de mayor proyección, se dice que no hay cambio", () => {
  const best = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  const actual = best.slots.filter((s) => s.player).map((s) => s.player.sid);
  const cambio = startSit({ currentIds: actual, best });
  assert.equal(cambio.sinCambios, true);
  assert.deepEqual(cambio.entran, []);
  assert.deepEqual(cambio.salen, []);
});

test("sin titulares publicados no se propone nada", () => {
  // Proponer un cambio sobre una alineación inventada es peor que no proponer.
  const best = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  assert.equal(startSit({ currentIds: [], best }), null);
  assert.equal(startSit({ currentIds: null, best }), null);
});

/* ── cara a cara ─────────────────────────────────────────────────────────── */

test("los dos equipos se emparejan HUECO a hueco, no jugador a jugador", () => {
  const mia = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  const suya = lineupFrom({ ids: ["q2", "r3", "w3", "t1"], index: INDEX, rosterPositions: ROSTER });
  const cara = sideBySide(mia, suya);
  assert.equal(cara.rows[0].slot, "QB");
  assert.equal(cara.rows[0].mine.sid, "q1");
  assert.equal(cara.rows[0].theirs.sid, "q2");
  assert.equal(cara.rows[0].delta, 8);            // 22 − 14
  assert.equal(cara.delta, round(cara.minePoints - cara.theirsPoints));
});

test("un hueco vacío del rival no puntúa ni rompe la comparación", () => {
  const mia = lineupFrom({ ids: TODOS, index: INDEX, rosterPositions: ROSTER });
  const suya = lineupFrom({ ids: ["q2"], index: INDEX, rosterPositions: ROSTER });
  const cara = sideBySide(mia, suya);
  const rb = cara.rows.find((r) => r.slot === "RB");
  assert.equal(rb.theirs, null);
  assert.equal(rb.delta, null);                   // no se compara contra nada
  assert.equal(cara.theirsPoints, 14);
});

function round(x) { return Math.round(x * 10) / 10; }

// -------------------------------------------------------------------------
// EL CANDADO DEL PARTIDO JUGADO, COMPARTIDO POR LOS DOS MOTORES
// -------------------------------------------------------------------------

test("`lineupFrom` tampoco saca a quien ya jugó", () => {
  const index = new Map([
    ["qb_jugo", { sid: "qb_jugo", position: "QB", projected_points: 8, game_final: true }],
    ["qb_libre", { sid: "qb_libre", position: "QB", projected_points: 24 }],
    ["r1", { sid: "r1", position: "RB", projected_points: 15 }],
    ["r2", { sid: "r2", position: "RB", projected_points: 14 }],
  ]);
  const huecos = ["QB", "RB", "RB", "BN"];
  const ids = [...index.keys()];
  // Control: sin `starters` no hay nada congelado y el motor sí lo cambia.
  const libre = lineupFrom({ ids, index, rosterPositions: huecos });
  assert.equal(libre.slots.find((s) => s.slot === "QB").player.sid, "qb_libre",
    "el fixture no distingue las dos respuestas");
  const conCandado = lineupFrom({
    ids, index, rosterPositions: huecos, starters: ["qb_jugo", "r1", "r2"],
  });
  assert.equal(conCandado.slots.find((s) => s.slot === "QB").player.sid, "qb_jugo");
  assert.equal(conCandado.slots.find((s) => s.slot === "QB").locked, true);
});

test("LA REGLA DEL CANDADO ES UNA, y los dos motores la llaman", () => {
  /* El analizador usa `lineupFrom` y `/fantasy/lineups` usa `bestLineup`: dos
     motores para la misma decisión, que es el fallo que este repositorio ha
     cometido once veces. La regla vive en `lockedSlots` y ninguno de los dos
     puede tener la suya. */
  let definiciones = 0;
  for (const ruta of ["../app/fantasy/startSit.js", "../app/fantasy/lineup.js"]) {
    const src = readFileSync(new URL(ruta, import.meta.url), "utf8");
    assert.match(src, /lockedSlots/, `${ruta} no usa la regla compartida`);
    definiciones += (src.match(/function lockedSlots\(/g) ?? []).length;
  }
  assert.equal(definiciones, 1,
    "el candado está definido más de una vez: dos motores con dos reglas");
  // Y la pantalla del analizador tiene que PASARLE los titulares: la regla
  // compartida no sirve de nada si el caller no le dice qué hay puesto.
  const shell = readFileSync(
    new URL("../app/fantasy/analisis/AnalyzerShell.jsx", import.meta.url), "utf8");
  assert.match(shell, /starters: misTitulares/,
    "el analizador no le dice al motor qué tiene puesto: nada se congela");
});
