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
  const dedicated = Object.fromEntries(Object.entries(starters));
  for (const [position, weight] of Object.entries(FLEX_WEIGHTS)) starters[position] += flex * weight;
  for (const [position, weight] of Object.entries(SUPERFLEX_WEIGHTS)) starters[position] += superflex * weight;

  if (Object.values(starters).every((v) => v === 0)) {
    return { supported: false, reason: "no fantasy positions in roster" };
  }
  return {
    supported: true, teams, starters, bench, hasKicker, hasDefense,
    // Los huecos DEDICADOS, sin repartir: es lo que necesita el voraz. Se
    // capturan antes de sumar el flex, igual que en Python.
    dedicated, flex, superflex,
    isSuperflex: starters.QB > 1.05,
    slots: teams * (Object.values(dedicated).reduce((a, b) => a + b, 0) + flex + superflex),
  };
}

// Qué admite cada hueco compartido. Espejo de `league.py`.
export const FLEX_ELIGIBLE = ["RB", "WR", "TE"];
export const SUPERFLEX_ELIGIBLE = ["QB", "RB", "WR", "TE"];

/**
 * Nivel de reemplazo asignando de verdad los huecos compartidos.
 *
 * Espejo exacto de `league.greedy_replacement`. Repartir el flex por pesos fijos
 * calcula el reemplazo de cada posición **como si el hueco compartido no
 * existiera**, y al redondear cada una por su lado la demanda total deja de
 * cuadrar con los huecos que la liga define: en E18, hasta un hueco de desvío en
 * seis de las siete plantillas probadas. El voraz consume exactamente los que
 * hay, porque asigna uno por hueco.
 *
 * Devuelve también `short`: las posiciones cuyo reemplazo cae FUERA del pool
 * publicado. Ahí no hay valor calculable, y decirlo es la diferencia entre un
 * board de tu liga y uno que parece de tu liga.
 */
export function greedyReplacement(pointsByPosition, context) {
  const ranked = {};
  for (const [position, points] of Object.entries(pointsByPosition)) {
    ranked[position] = [...points].sort((a, b) => b - a);
  }
  const taken = Object.fromEntries(Object.keys(ranked).map((p) => [p, 0]));
  const dedicated = context.dedicated ?? {};

  const bestAvailable = (position) => {
    const pool = ranked[position];
    const index = taken[position] ?? 0;
    return pool && index < pool.length ? pool[index] : null;
  };
  const claim = (position) => {
    if (bestAvailable(position) === null) return false;
    taken[position] += 1;
    return true;
  };

  let consumed = 0;
  for (const [position, perTeam] of Object.entries(dedicated)) {
    for (let i = 0; i < perTeam * context.teams; i += 1) if (claim(position)) consumed += 1;
  }
  const shared = [
    ...Array((context.superflex ?? 0) * context.teams).fill(SUPERFLEX_ELIGIBLE),
    ...Array((context.flex ?? 0) * context.teams).fill(FLEX_ELIGIBLE),
  ];
  for (const eligible of shared) {
    let best = null;
    let bestPosition = null;
    for (const position of eligible) {
      const value = bestAvailable(position);
      if (value !== null && (best === null || value > best)) {
        best = value;
        bestPosition = position;
      }
    }
    if (bestPosition && claim(bestPosition)) consumed += 1;
  }

  const replacement = {};
  const rank = {};
  const short = [];
  for (const [position, pool] of Object.entries(ranked)) {
    if (pool.length === 0) continue;
    // Si la posición se agotó, el reemplazo cae fuera de lo publicado: no se usa
    // el último y se sigue como si nada, se DICE. Usar el último inflaría el VOR
    // de toda la posición y el board saldría mal justo donde la liga es rara.
    if ((taken[position] ?? 0) >= pool.length) short.push(position);
    const index = Math.min(taken[position] ?? 0, pool.length - 1);
    replacement[position] = pool[index];
    rank[position] = index + 1;
  }
  return { replacement, rank, consumed, short };
}

/**
 * Hasta dónde está VALIDADO el valor por liga. Espejo de `league.py`.
 *
 * E18 pasó sus 16 propiedades a 10, 12 y 14 equipos. A 32 fallaron dos, las dos
 * de magnitud: el VOR del quarterback en superflex sube +10,5 puntos en vez de
 * los +20 exigidos, y no entra ni un QB más en el top-25.
 *
 * No es que superflex importe menos en una liga profunda: es que el ancla de
 * reemplazo cae donde la proyección ya es casi el prior. Entre el QB33 y el QB65
 * hay 30 puntos en bruto y 11 tras encoger — el encogimiento se come el 65%.
 *
 * La ESTRUCTURA sigue respondiendo bien a 32 equipos (el reparto cuadra, el
 * reemplazo se profundiza, el rank del QB se dobla). Lo que no se sostiene es la
 * magnitud. Por eso esto no bloquea el board: lo etiqueta.
 */
export const VALIDATED_MAX_TEAMS = 14;

export function valueConfidence(context) {
  return (context?.teams ?? 0) <= VALIDATED_MAX_TEAMS ? "VALIDATED" : "UNVALIDATED_DEPTH";
}

// Qué admite cada hueco al PINTAR una plantilla. Espejo de
// `league.SLOT_ELIGIBILITY`: elegibilidad de la liga, no una opinión sobre a
// quién conviene poner ahí.
export const SLOT_ELIGIBILITY = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  K: ["K"], DEF: ["DST", "DEF"], DST: ["DST", "DEF"],
};
const SLOT_ORDER = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, DST: 0, FLEX: 1, SUPER_FLEX: 2 };
const BENCH = new Set(["BN", "BE", "BENCH", "IR", "TAXI"]);

/**
 * Reparte jugadores en huecos de plantilla, para PINTARLOS.
 *
 * Espejo exacto de `league.assign_slots`, con su misma regla: dedicados antes
 * que FLEX y FLEX antes que SUPER_FLEX. Al revés, un jugador que sólo cabía en
 * su hueco dedicado puede quedarse fuera porque un flexible se lo llevó, y la
 * plantilla enseñaría un hueco abierto con un sobrante que sí encajaba.
 *
 * Es lógica de presentación: no dice a quién alinear ni qué falta por draftear.
 * Un hueco abierto es un hecho de la plantilla, no un consejo.
 *
 * Devuelve `{ slots, unassigned }` con `slots: [{index, slot, player|null}]`
 * en el orden declarado por la liga.
 */
export function assignSlots(players, rosterPositions) {
  const slots = (rosterPositions ?? [])
    .map((raw, index) => ({ index, slot: String(raw).toUpperCase().trim(), player: null }))
    .filter((entry) => !BENCH.has(entry.slot));

  const fillable = slots
    .filter((entry) => Object.hasOwn(SLOT_ELIGIBILITY, entry.slot))
    .sort((a, b) => (SLOT_ORDER[a.slot] ?? 3) - (SLOT_ORDER[b.slot] ?? 3) || a.index - b.index);

  // Mayor valor primero: quien más vale entra antes en el hueco más ajustado.
  const pending = [...players].sort(
    (a, b) => (Number(b.vor ?? b.projected_points) || 0) - (Number(a.vor ?? a.projected_points) || 0)
  );

  for (const entry of fillable) {
    const eligible = SLOT_ELIGIBILITY[entry.slot];
    const i = pending.findIndex((p) => eligible.includes(String(p.position ?? "").toUpperCase()));
    if (i >= 0) entry.player = pending.splice(i, 1)[0];
  }

  slots.sort((a, b) => a.index - b.index);
  return { slots, unassigned: pending };
}

/**
 * La lista de huecos desde los CONTADORES del configurador manual.
 *
 * El orden de salida es el de una alineación como la pinta cualquier app —
 * QB, corredores, receptores, ala cerrada, flexibles, defensa, pateador — y es
 * estable: el mismo formulario produce siempre la misma lista.
 */
export function rosterFromCounts(counts) {
  const out = [];
  const push = (slot, n) => { for (let i = 0; i < (Number(n) || 0); i += 1) out.push(slot); };
  push("QB", counts.QB); push("RB", counts.RB); push("WR", counts.WR); push("TE", counts.TE);
  push("FLEX", counts.FLEX); push("SUPER_FLEX", counts.SUPER_FLEX);
  push("DEF", counts.DEF); push("K", counts.K); push("BN", counts.BN);
  return out;
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
 *
 * Devuelve `{rows, replacement, rank, short, consumed}`. `short` son las
 * posiciones cuyo reemplazo cae fuera del pool publicado: ahí el VOR no es
 * calculable y quien lo pinte tiene que decirlo, no enseñar un número.
 *
 * El pool se eligió por VOR en la liga por defecto (12 equipos, PPR), así que
 * para otra liga no es el top-N que le correspondería. Con la profundidad que se
 * publica por posición alcanza para las ligas soportadas; cuando no alcanza sale
 * en `short` en vez de en un número silenciosamente malo.
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

  const byPosition = {};
  for (const row of scored) {
    if (!Number.isFinite(row.projected_points)) continue;
    (byPosition[row.position] ??= []).push(row.projected_points);
  }
  const { replacement, rank, consumed, short } = greedyReplacement(byPosition, context);
  const shortSet = new Set(short);

  const rows = scored
    .map((row) => {
      // Una posición sin reemplazo calculable NO recibe un VOR inventado: queda
      // `null` y se ordena al final. Un cero diría «vale lo mismo que su
      // reemplazo», que es una afirmación y no la ausencia de una.
      const base = replacement[row.position];
      const usable = base !== undefined && !shortSet.has(row.position)
        && Number.isFinite(row.projected_points);
      return {
        ...row,
        replacement_points: usable ? base : null,
        vor: usable ? row.projected_points - base : null,
        value_known: usable,
      };
    })
    .sort((a, b) => {
      if (a.vor === null && b.vor === null) return 0;
      if (a.vor === null) return 1;
      if (b.vor === null) return -1;
      return b.vor - a.vor;
    })
    .map((row, i) => ({ ...row, overall_rank: i + 1 }));

  return { rows, replacement, rank, consumed, short };
}

/**
 * El board de UNA liga, desde el payload horneado y su configuración.
 *
 * Existe porque ahora lo necesitan DOS pantallas —el board de `/fantasy` y el
 * Live Draft Assistant— y copiar el montaje habría repetido el fallo que ya
 * costó dos iteraciones en este proyecto: dos traductores del mismo formato con
 * distinta cobertura. La primera vez fue `bonus_rec_te` entre JS y Python; la
 * segunda, `attach_today` entre el barrido semanal y el diario. Aquí duele más:
 * dos boards distintos para la misma liga, cada uno con razón en su pantalla.
 *
 * Devuelve `null` cuando NO se puede compilar con garantías (puntuación o
 * plantilla no soportadas, payload sin priors, componentes que no cuadran). El
 * que llama enseña entonces el board publicado y lo DICE — nunca una mezcla,
 * que es exactamente el error que E18 existe para impedir.
 */
export function leagueBoardFrom({ board, context, rules, roster, compilePoints }) {
  if (!rules || !roster?.supported || !context?.positionPriors) return null;
  const order = context.componentOrder ?? [];
  const players = board
    .filter((row) => Array.isArray(row.c) && row.c.length === order.length)
    .map((row) => ({
      ...row,
      components: Object.fromEntries(order.map((name, i) => [name, row.c[i]])),
      weighted_games: row.wg ?? 0,
    }));
  if (players.length === 0) return null;
  return buildLeagueBoard({
    players,
    rules,
    context: roster,
    compilePoints,
    games: context.projectedGames ?? 15.5,
    priors: context.positionPriors,
    shrinkPriorGames: context.shrinkPriorGames ?? 10,
    tdPersistence: context.tdPersistence ?? 0.55,
  });
}

/**
 * Las filas utilizables de un board de liga, o el publicado.
 *
 * Nunca una mezcla: un VOR de una liga con el orden de otra sería el error que
 * E18 existe para impedir.
 */
export function activeBoardFrom(leagueBoard, published) {
  if (!leagueBoard) return published;
  const known = leagueBoard.rows.filter((row) => row.value_known);
  return known.length > 0 ? known : published;
}
