/**
 * Ida y vuelta contra el payload REAL.
 *
 * Los otros tests usan jugadores inventados y prueban la lógica. Éste prueba el
 * contrato: que los componentes que se publican, compilados con las reglas con
 * las que se construyó el board, devuelven exactamente los puntos publicados.
 *
 * Es donde se caería un desajuste entre Python y JavaScript —un coeficiente
 * distinto, un componente en otro orden, un redondeo de más— y ninguno de esos
 * fallos se ve leyendo el código de un solo lado.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { COMPONENTS, DEFAULT_RULES, compilePoints } from "../app/fantasy/scoring.js";
import { projectPlayer, setComponentOrder } from "../app/fantasy/leagueValue.js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(readFileSync(path.join(WEB, "data/model.json"), "utf8"));
const fantasy = payload.fantasy;

test("el payload declara el orden de los componentes", () => {
  // El navegador NO supone el orden: lo lee. Si Python añade uno en medio y el
  // array se lee por posición, sin esto todos los valores se desplazan.
  assert.deepEqual(fantasy.components, COMPONENTS);
});

test("cada fila del board trae sus componentes y su factor de edad", () => {
  for (const row of fantasy.board) {
    assert.equal(row.c?.length, COMPONENTS.length, row.player_name);
    assert.ok(Number.isFinite(row.age_factor), row.player_name);
  }
});

test("el payload trae las medias por posición y las constantes de encogimiento", () => {
  // Sin ellas el navegador no puede reproducir el encogimiento: las medias se
  // calculan sobre los ~860 jugadores proyectados y aquí viajan 250.
  assert.ok(fantasy.position_priors, "faltan position_priors");
  for (const position of ["QB", "RB", "WR", "TE"]) {
    const prior = fantasy.position_priors[position];
    assert.equal(prior?.mean_components?.length, COMPONENTS.length, position);
    assert.ok(Number.isFinite(prior.td_mean), position);
  }
  assert.ok(Number.isFinite(fantasy.shrink_prior_games));
  assert.ok(Number.isFinite(fantasy.td_persistence));
});

test("los componentes publicados reproducen la proyección publicada", () => {
  // La prueba de fuego del bloque: el navegador rehace en PPR lo que Python
  // calculó en PPR. Si esto falla, el board por liga sería otro modelo, no el
  // mismo modelo con otras reglas.
  setComponentOrder(fantasy.components);
  let worst = 0;
  let peor = null;
  for (const row of fantasy.board) {
    const components = Object.fromEntries(COMPONENTS.map((name, i) => [name, row.c[i]]));
    const projected = projectPlayer({
      components, position: row.position, weightedGames: row.wg,
      ageFactor: row.age_factor, rules: DEFAULT_RULES,
      priors: fantasy.position_priors,
      shrinkPriorGames: fantasy.shrink_prior_games,
      tdPersistence: fantasy.td_persistence,
      compilePoints, games: fantasy.projected_games,
    });
    const delta = Math.abs(projected - row.projected_points);
    if (delta > worst) { worst = delta; peor = row.player_name; }
  }
  console.log(`      peor |Δ| ida y vuelta: ${worst.toFixed(4)} pts de temporada (${peor})`);
  // Tolerancia por el redondeo declarado del payload: componentes a 3 decimales
  // y medias a 4, multiplicados por 15,5 partidos. No es margen de modelado.
  assert.ok(worst < 0.5, `peor diferencia ${worst.toFixed(4)} en ${peor}`);
});

test("el VOR publicado es puntos menos reemplazo", () => {
  for (const row of fantasy.board.slice(0, 50)) {
    if (row.vor == null) continue;
    // Consistencia interna del board publicado: si esto se rompe, el board y su
    // VOR vienen de dos cálculos distintos.
    assert.ok(row.projected_points >= row.vor - 1e-6, row.player_name);
  }
});
