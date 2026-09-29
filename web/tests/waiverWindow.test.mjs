/**
 * LA VENTANA NO PUEDE EXCLUIR UNA POSICIÓN ENTERA.
 *
 *     EL SEMANAL LLEGA ORDENADO POR POSICIÓN, NO POR VALOR.
 *
 * `fantasy_weekly.rankings` agrupa QB, luego RB, luego TE, luego WR, y
 * `WaiversShell` lo pasa tal cual. Con `slice(0, 60)` el pool quedaba en 32
 * quarterbacks y 28 corredores: los alas cerradas y los receptores no entraban
 * NUNCA. Medido en la jornada 4 de 2026 con el hueco de TE vacío, el motor
 * ofrecía nueve quarterbacks de banquillo y ni un TE.
 *
 * El fixture está ordenado POR POSICIÓN a propósito: un doble que llegue
 * ordenado por valor prueba otra cosa, y ése es el fallo que este repositorio
 * lleva seis veces cometiendo con sus dobles.
 */
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { waiverMoves, ventanaPorPosicion, WAIVER_WINDOW } from "../app/fantasy/waivers.js";

/** Un pool con la MISMA forma que el payload: agrupado por posición. */
function poolPorPosicion() {
  const filas = [];
  let n = 0;
  // Los quarterbacks primero y con los puntos MÁS ALTOS, que es lo que hace que
  // copen cualquier orden por puntos brutos (regla 6b).
  for (const [pos, cuantos, base] of [["QB", 32, 24], ["RB", 64, 22], ["TE", 32, 18], ["WR", 128, 22]]) {
    for (let i = 0; i < cuantos; i += 1) {
      filas.push({
        player_id: `p${n += 1}`, player_name: `${pos}${i + 1}`, position: pos,
        projected_points: Math.max(1, base - i * 0.4),
      });
    }
  }
  return filas;
}

const HUECOS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN"];

test("la ventana llega a TODAS las posiciones del pool", () => {
  const v = ventanaPorPosicion(poolPorPosicion(), WAIVER_WINDOW);
  const cuenta = {};
  for (const r of v) cuenta[r.position] = (cuenta[r.position] ?? 0) + 1;
  for (const pos of ["QB", "RB", "TE", "WR"]) {
    assert.ok((cuenta[pos] ?? 0) > 0,
      `${pos} no entra en la ventana: con el pool ordenado por posición queda excluido para siempre`);
  }
  assert.ok(v.length <= WAIVER_WINDOW + 4, `la ventana no puede desbordarse: ${v.length}`);
});

test("dentro de una posición entran los MEJORES, no los primeros del array", () => {
  const pool = poolPorPosicion().reverse(); // el peor de cada posición, primero
  const v = ventanaPorPosicion(pool, WAIVER_WINDOW);
  const tes = v.filter((r) => r.position === "TE").map((r) => r.projected_points);
  assert.deepEqual([...tes].sort((a, b) => b - a), tes, "los TE de la ventana no vienen ordenados");
  assert.ok(Math.max(...tes) >= 17.9, `el mejor TE no entró: máximo ${Math.max(...tes)}`);
});

test("con el hueco de TE vacío y TE libres, se ofrece un TE", () => {
  const pool = poolPorPosicion();
  // Mi plantilla: todo menos ala cerrada.
  const roster = [
    pool.find((r) => r.position === "QB"),
    ...pool.filter((r) => r.position === "RB").slice(0, 2),
    ...pool.filter((r) => r.position === "WR").slice(0, 3),
  ];
  const ids = new Set(roster.map((r) => r.player_id));
  const res = waiverMoves({
    available: pool.filter((r) => !ids.has(r.player_id)),
    roster, rosterPositions: HUECOS, rosterLimit: HUECOS.length,
  });
  assert.ok(res, "el motor tiene que contestar con estructura declarada");
  assert.ok(res.emptyStarterSlots.includes("TE"), "el hueco de TE está vacío y hay que verlo");
  const teOfrecido = res.moves.find((m) => m.add?.position === "TE");
  assert.ok(teOfrecido,
    "con un hueco de TE vacío y 32 TE libres el motor tiene que ofrecer un TE; "
    + `ofreció ${JSON.stringify(res.moves.slice(0, 3).map((m) => `${m.category}:${m.add?.position}`))}`);
  // Y encabeza: llenar un titular vacío vale más que una mejora de banquillo.
  assert.equal(res.moves[0].add.position, "TE",
    "llenar el hueco titular vacío tiene que encabezar la lista");
  assert.equal(res.moves[0].category, "IMMEDIATE_STARTER");
});

test("un pool de UNA sola posición se respeta tal cual", () => {
  // Sin varias posiciones no hay reparto que hacer, y forzar uno cambiaría el
  // orden de entrada sin motivo.
  const solo = poolPorPosicion().filter((r) => r.position === "WR");
  const v = ventanaPorPosicion(solo, 10);
  assert.equal(v.length, 10);
  assert.equal(v[0].player_name, solo[0].player_name);
});

/* ------------------------------------------------------------------ *
 * Y LO QUE ESTA TABLA NO PUEDE DAR, SE DICE.
 * El pool del semanal es QB/RB/WR/TE; pateador y defensa viajan en sus
 * propias listas. La cabecera enumeraba «empty starting slots: TE, DEF, K»
 * y debajo ofrecía doce alas cerradas: una promesa que la pantalla no
 * cumple es peor que no prometer nada.
 * ------------------------------------------------------------------ */

test("el motor publica QUÉ posiciones trae su pool", () => {
  const pool = poolPorPosicion();
  const roster = [pool.find((r) => r.position === "QB")];
  const res = waiverMoves({
    available: pool.filter((r) => r.player_id !== roster[0].player_id),
    roster, rosterPositions: ["QB", "TE", "K", "DEF", "BN"], rosterLimit: 5,
  });
  assert.deepEqual(res.poolPositions, ["QB", "RB", "TE", "WR"]);
  // Y los huecos que el pool NO puede servir siguen estando declarados: no se
  // esconden, que sería la otra mitad del fallo.
  assert.ok(res.emptyStarterSlots.includes("K"));
  assert.ok(res.emptyStarterSlots.includes("DEF"));
});

test("la pantalla deriva del pool los huecos que no puede llenar", () => {
  const src = readFileSync(new URL("../app/fantasy/waivers/WaiversShell.jsx", import.meta.url), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(src, /poolPositions/,
    "la cabecera no lee qué trae el pool, así que puede volver a prometer DEF y K");
  assert.ok(!/"K"|'K'|DEF and K/.test(src.replace(/cannot be filled[^`]*/g, "")),
    "las posiciones que faltan no pueden estar escritas a mano en la vista");
  // NO BASTA CON QUE EL NOMBRE APAREZCA. Envolver el bloque en `false &&` deja
  // el identificador intacto y esta prueba pasaba en verde con el aviso
  // apagado — es el «el nombre sigue apareciendo» que ya costó versiones en
  // `rosterMark.test.mjs` y `candidates.test.mjs`. Se exige la CONDICIÓN del
  // JSX: la interpolación abre con la comprobación y nada delante.
  assert.match(src, /\{\s*fueraDelPool\.length\s*\n?\s*\?/,
    "el aviso no está condicionado a la derivación: ¿lo han apagado con un literal?");
});
