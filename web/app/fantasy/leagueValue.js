/**
 * Valor por liga: nivel de reemplazo y VOR.
 *
 * Espejo de `src/oracle/fantasy/league.py`. Está SEPARADO de `scoring.js` a
 * propósito, y no por orden:
 *
 *     LOS PUNTOS DE UN JUGADOR DEPENDEN DE LA PUNTUACIÓN.
 *     SU VALOR DEPENDE ADEMÁS DE LA ESTRUCTURA DE LA LIGA.
 *
 * Dos ligas con la misma puntuación dan valores distintos si una tiene 10
 * equipos y otra 14. Meter las dos cosas en una función es lo que hace creer
 * que compilar la puntuación termina el trabajo cuando falta la mitad — y la
 * mitad que falta es la que reordena un board superflex.
 */

export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"];

// Reparto del hueco FLEX. Convención declarada, no medida: se escribe aquí para
// que se vea y se pueda cambiar en un sitio. A partes iguales daría al ala
// cerrada un peso que no tiene en un flex real.
export const FLEX_WEIGHTS = { RB: 0.45, WR: 0.45, TE: 0.10 };
// Un SUPER_FLEX se llena con un quarterback prácticamente siempre. Repartirlo
// suavizaría justo el efecto que define el formato.
export const SUPERFLEX_WEIGHTS = { QB: 1.0 };

const FLEX_SLOTS = new Set(["FLEX", "WRRB_FLEX", "REC_FLEX", "WRRB", "WRT"]);
const SUPERFLEX_SLOTS = new Set(["SUPER_FLEX", "SUPERFLEX", "QB_FLEX"]);
const BENCH_SLOTS = new Set(["BN", "BE", "BENCH", "IR", "TAXI"]);
const KICKER = new Set(["K"]);
const DEFENSE = new Set(["DEF", "DST"]);

/**
 * `roster_positions` de Sleeper -> titulares por posición.
 *
 * Un hueco que no se sabe traducir hace `supported: false`. Ignorarlo produce un
 * nivel de reemplazo demasiado bajo y un board equivocado en silencio, que es
 * peor que no dar board.
 */
export function rosterContext(rosterPositions, teams) {
  if (!Array.isArray(rosterPositions) || rosterPositions.length === 0) {
    return { supported: false, reason: "UNKNOWN roster settings" };
  }
  if (!Number.isInteger(teams) || teams < 2) {
    return { supported: false, reason: "UNKNOWN team count" };
  }
  const starters = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let flex = 0;
  let superflex = 0;
  let bench = 0;
  let hasKicker = false;
  let hasDefense = false;
  const unknown = [];

  for (const raw of rosterPositions) {
    const slot = String(raw).toUpperCase().trim();
    if (BENCH_SLOTS.has(slot)) bench += 1;
    else if (FLEX_SLOTS.has(slot)) flex += 1;
    else if (SUPERFLEX_SLOTS.has(slot)) superflex += 1;
    else if (KICKER.has(slot)) hasKicker = true;
    else if (DEFENSE.has(slot)) hasDefense = true;
    else if (Object.hasOwn(starters, slot)) starters[slot] += 1;
    else unknown.push(slot);
  }
  if (unknown.length > 0) {
    return { supported: false, reason: `unsupported roster slots: ${[...new Set(unknown)].sort().join(", ")}` };
  }
  for (const [position, weight] of Object.entries(FLEX_WEIGHTS)) starters[position] += flex * weight;
  for (const [position, weight] of Object.entries(SUPERFLEX_WEIGHTS)) starters[position] += superflex * weight;

  if (Object.values(starters).every((v) => v === 0)) {
    return { supported: false, reason: "no fantasy positions in roster" };
  }
  return {
    supported: true, teams, starters, bench, hasKicker, hasDefense,
    isSuperflex: starters.QB > 1.05,
  };
}

/** Puesto del jugador de reemplazo de una posición, 1-indexado. */
export function replacementRank(context, position) {
  const perTeam = context?.starters?.[position] ?? 0;
  return Math.max(Math.round(context.teams * perTeam), 1);
}

/**
 * La proyección de un jugador bajo unas reglas, con el encogimiento incluido.
 *
 * Reproduce exactamente la cadena de `draft.py`:
 *
 *     encogido = media_posición + fiabilidad × (bruto − media_posición)
 *              + (persistencia_TD − 1) × (TD_pg − TD_media) × fiabilidad × puntos_TD
 *
 * Los dos términos son LINEALES en los componentes, así que compilar la media de
 * componentes da exactamente la media de puntos, y el encogimiento sale igual en
 * el navegador que en Python. No es una reimplementación aproximada: es la misma
 * expresión con los mismos números.
 *
 * `priors` tiene que venir del payload y no calcularse aquí: las medias se
 * computaron sobre los ~860 jugadores proyectados y el payload publica 250.
 * Recalcularlas con 250 daría otra media y otro board — silenciosamente.
 */
export function projectPlayer({
  components, position, weightedGames, ageFactor = 1, rules, priors,
  shrinkPriorGames, tdPersistence, compilePoints, games = 15.5,
}) {
  const prior = priors?.[position];
  if (!prior) return null;
  const meanComponents = Object.fromEntries(
    COMPONENTS_ORDER.map((name, i) => [name, prior.mean_components[i]])
  );
  const raw = compilePoints(components, rules, position);
  const meanPoints = compilePoints(meanComponents, rules, position);
  const reliability = weightedGames / (weightedGames + shrinkPriorGames);
  let shrunk = meanPoints + reliability * (raw - meanPoints);

  // El TD se encoge más que el resto y se convierte a puntos con el valor que
  // esa liga paga por el TD de esa posición — otra cosa que cambia por liga.
  const tdPerGame = (Number(components.passing_tds) || 0)
    + (Number(components.rushing_tds) || 0)
    + (Number(components.receiving_tds) || 0);
  const tdPoints = position === "QB" ? rules.passing_td : rules.rushing_td;
  shrunk += (tdPersistence - 1) * (tdPerGame - prior.td_mean) * reliability * tdPoints;

  return shrunk * ageFactor * games;
}

/** El orden canónico de los componentes. Lo declara el payload; esto es el respaldo. */
let COMPONENTS_ORDER = [
  "passing_yards", "passing_tds", "interceptions", "rushing_yards", "rushing_tds",
  "receptions", "receiving_yards", "receiving_tds", "fumbles_lost", "two_point_conversions",
];
export function setComponentOrder(order) {
  if (Array.isArray(order) && order.length > 0) COMPONENTS_ORDER = order;
}

/**
 * El board de una liga: puntos compilados, reemplazo, VOR y orden.
 */
export function buildLeagueBoard({
  players, rules, context, compilePoints, games = 15.5,
  priors = null, shrinkPriorGames = 10, tdPersistence = 0.55,
}) {
  const scored = players.map((row) => {
    const projected = priors
      ? projectPlayer({
          components: row.components, position: row.position,
          weightedGames: row.weighted_games ?? 0, ageFactor: row.age_factor ?? 1,
          rules, priors, shrinkPriorGames, tdPersistence, compilePoints, games,
        })
      : compilePoints(row.components, rules, row.position) * (row.age_factor ?? 1) * games;
    return { ...row, projected_points: projected };
  });

  const replacement = {};
  for (const position of FANTASY_POSITIONS) {
    const ranked = scored
      .filter((row) => row.position === position)
      .sort((a, b) => b.projected_points - a.projected_points);
    if (ranked.length === 0) continue;
    const index = Math.min(replacementRank(context, position), ranked.length) - 1;
    replacement[position] = ranked[index].projected_points;
  }

  return scored
    .map((row) => ({
      ...row,
      replacement_points: replacement[row.position] ?? 0,
      vor: row.projected_points - (replacement[row.position] ?? 0),
    }))
    .sort((a, b) => b.vor - a.vor)
    .map((row, i) => ({ ...row, overall_rank: i + 1 }));
}
