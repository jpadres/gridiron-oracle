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
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { COMPONENTS, DEFAULT_RULES, compilePoints } from "../app/fantasy/scoring.js";
import { projectPlayer, setComponentOrder } from "../app/fantasy/leagueValue.js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// El payload VERSIONADO (`model.b64.js`), descomprimido por el mismo módulo
// que usa la web. `model.json` no se versiona: en CI no existe nunca, y leerlo
// aquí ponía el test rojo por un fichero que no es del test.
const { model: payload } = await import(path.join(WEB, "data/model.js"));
const fantasy = payload.fantasy;

test("las filas del board llevan su `sid` de Sleeper horneado por model.js", () => {
  // Es lo que permite la foto por identificador sin pedir nada a la API. Los
  // que no están en el mapa se quedan sin `sid` (iniciales), nunca con el de otro.
  const withSid = fantasy.board.filter((row) => row.sid);
  assert.ok(withSid.length > fantasy.board.length * 0.7, `${withSid.length} de ${fantasy.board.length}`);
  for (const row of withSid) assert.equal(fantasy.sleeper_ids[row.sid], row.player_id, row.player_name);
  for (const row of fantasy.specialists.defenses) assert.ok(row.sid, row.player_id);
});

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
    // El novato NO pasa por el encogimiento de veterano: sus componentes ya
    // vienen encogidos con la muestra de su celda posición-ronda, y
    // `weighted_games` es cero, así que `projectPlayer` le devolvería la media
    // de la posición — la misma para todos. La ida y vuelta que hay que exigir
    // es la del camino que el producto usa de verdad, que es éste.
    const projected = row.rookie
      ? compilePoints(components, DEFAULT_RULES, row.position) * fantasy.projected_games
      : projectPlayer({
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

test("un novato del payload trae su intervalo y NO trae señales de veterano", () => {
  const rookies = fantasy.board.filter((row) => row.rookie);
  assert.ok(rookies.length > 0, "el board publica novatos");
  for (const row of rookies) {
    // El intervalo viaja SIEMPRE. Un valor de novato sin su dispersión es
    // exactamente el número que `ROOKIE_PRIOR` prohíbe publicar solo.
    for (const key of ["rookie_p25", "rookie_p50", "rookie_p75", "rookie_sample"]) {
      assert.ok(Number.isFinite(row[key]), `${row.player_name}: falta ${key}`);
    }
    assert.ok(row.rookie_p25 <= row.rookie_p50 && row.rookie_p50 <= row.rookie_p75,
              `${row.player_name}: intervalo desordenado`);
    // Riesgo, ausencia y bust se calculan sobre historial NFL. Un novato no lo
    // tiene, así que un número ahí sería la media del board disfrazada de
    // medición.
    for (const key of ["risk_label", "risk_score", "p_bust", "missed_rate"]) {
      assert.ok(row[key] == null, `${row.player_name}: ${key} no debería existir`);
    }
  }
});
