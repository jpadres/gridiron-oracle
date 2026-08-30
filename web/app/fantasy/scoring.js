/**
 * Compilador de puntuación en el navegador.
 *
 * Espejo exacto de `src/oracle/fantasy/components.py`. Está duplicado a
 * propósito y no derivado: el navegador no puede importar Python, y precompilar
 * en el payload congelaría las reglas en el momento del build — que es
 * justamente lo que este bloque viene a quitar.
 *
 * Duplicar código es una deuda, así que se paga con un test que comprueba que
 * los dos lados usan los MISMOS diez componentes y los mismos coeficientes
 * (`tests/scoring.test.mjs`, contra el contrato del payload). Si allí se añade
 * un componente y aquí no, el test lo dice en vez de sumarlo como cero.
 *
 *     LOS PUNTOS DEPENDEN DE LA PUNTUACIÓN.
 *     EL VALOR DEPENDE ADEMÁS DE LA ESTRUCTURA DE LA LIGA.
 *
 * Aquí sólo se compilan PUNTOS. El nivel de reemplazo y el VOR viven en
 * `leagueValue.js`, separados a propósito.
 */

/** Los diez componentes canónicos, en el mismo orden que en Python. */
export const COMPONENTS = [
  "passing_yards", "passing_tds", "interceptions",
  "rushing_yards", "rushing_tds",
  "receptions", "receiving_yards", "receiving_tds",
  "fumbles_lost", "two_point_conversions",
];

/** Componente -> campo de las reglas. `receptions` va aparte: depende de la posición. */
export const COEFFICIENTS = {
  passing_yards: "passing_yards",
  passing_tds: "passing_td",
  interceptions: "interception",
  rushing_yards: "rushing_yards",
  rushing_tds: "rushing_td",
  receiving_yards: "receiving_yards",
  receiving_tds: "receiving_td",
  fumbles_lost: "fumble_lost",
  two_point_conversions: "two_point",
};

/** Los valores por defecto, iguales a los de `ScoringRules` en Python. */
export const DEFAULT_RULES = {
  passing_yards: 0.04,
  passing_td: 4,
  interception: -2,
  rushing_yards: 0.1,
  rushing_td: 6,
  receiving_yards: 0.1,
  receiving_td: 6,
  reception: 1,
  fumble_lost: -2,
  two_point: 2,
  reception_by_position: null,
};

/**
 * `scoring_settings` de Sleeper -> reglas de este proyecto.
 *
 * Las claves son las de su API. Lo que NO está aquí y afecta a un jugador
 * ofensivo se devuelve en `unsupported`: **no se ignora en silencio**. Una regla
 * que no se sabe traducir y se descarta produce un board que parece de tu liga y
 * no lo es, y esa es la peor forma de equivocarse aquí.
 */
export const SLEEPER_SCORING = {
  pass_yd: "passing_yards",
  pass_td: "passing_td",
  pass_int: "interception",
  rush_yd: "rushing_yards",
  rush_td: "rushing_td",
  rec_yd: "receiving_yards",
  rec_td: "receiving_td",
  rec: "reception",
  fum_lost: "fumble_lost",
  pass_2pt: "two_point",
  rush_2pt: "two_point",
  rec_2pt: "two_point",
};

/** Reglas de Sleeper que no cambian una proyección de temporada ofensiva. */
const IGNORED = new Set([
  // Defensa, equipos especiales, IDP y pateador: el board no proyecta esas
  // posiciones, así que su puntuación no puede cambiar su orden.
  "def_td", "def_st_td", "def_st_ff", "def_st_fum_rec", "def_st_tkl_solo",
  "st_td", "st_ff", "st_fum_rec", "st_tkl_solo", "sack", "int", "ff",
  "fum_rec", "safe", "blk_kick", "def_2pt", "def_pass_def", "tkl", "tkl_loss",
  "tkl_ast", "qb_hit", "idp_tkl", "idp_sack", "idp_int", "def_forced_punts",
  "def_3_and_out", "def_4_and_stop", "fgm", "fgmiss", "xpm", "xpmiss",
  "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p", "fgm_yds",
  "fgm_yds_over_30", "fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39",
  "fgmiss_40_49", "fgmiss_50p", "pts_allow", "pts_allow_0", "pts_allow_1_6",
  "pts_allow_7_13", "pts_allow_14_20", "pts_allow_21_27", "pts_allow_28_34",
  "pts_allow_35p", "yds_allow", "yds_allow_0_100", "yds_allow_100_199",
  "yds_allow_200_299", "yds_allow_300_349", "yds_allow_350_399",
  "yds_allow_400_449", "yds_allow_450_499", "yds_allow_500_549",
  "yds_allow_550p",
  // Sin efecto sobre una proyección de temporada agregada.
  "fum", "fum_rec_td", "pass_fd", "rush_fd", "rec_fd", "pass_cmp", "pass_inc",
  "pass_att", "rush_att", "pass_cmp_40p", "pass_td_40p", "rush_td_40p",
  "rec_td_40p", "bonus_pass_cmp_25", "pass_sack", "pass_int_td", "st_fum_rec_td",
]);

/**
 * Bonus por partido. NO se pueden calcular desde medias por partido: dependen de
 * la distribución semanal. Se detectan para poder decirlo, no para aplicarlos.
 */
const PER_GAME_BONUSES = new Set([
  "bonus_pass_yd_300", "bonus_pass_yd_400", "bonus_rush_yd_100",
  "bonus_rush_yd_200", "bonus_rec_yd_100", "bonus_rec_yd_200",
  "bonus_rush_rec_yd_100", "bonus_rush_rec_yd_200",
]);

/** Premium de recepción por posición, tal y como lo nombra Sleeper. */
const RECEPTION_BY_POSITION = { bonus_rec_te: "TE", bonus_rec_rb: "RB", bonus_rec_wr: "WR" };

/**
 * Traduce la configuración de una liga. Devuelve además lo que NO supo traducir.
 *
 * `supported: false` significa que el board de esa liga **no se puede** generar
 * con garantías. El producto lo dice; no publica un board aproximado.
 */
export function rulesFromSleeper(settings) {
  if (!settings || typeof settings !== "object") {
    return { rules: null, unsupported: [], bonuses: [], supported: false, reason: "UNKNOWN scoring" };
  }
  const rules = { ...DEFAULT_RULES };
  const perPosition = {};
  const unsupported = [];
  const bonuses = [];

  for (const [key, raw] of Object.entries(settings)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (PER_GAME_BONUSES.has(key)) {
      if (value !== 0) bonuses.push(key);
      continue;
    }
    if (Object.hasOwn(RECEPTION_BY_POSITION, key)) {
      // Sleeper lo publica como un EXTRA sobre la recepción base, no como el
      // valor total. Sumarlo mal aquí convierte un TE premium de 1,5 en 0,5.
      if (value !== 0) perPosition[RECEPTION_BY_POSITION[key]] = value;
      continue;
    }
    const field = SLEEPER_SCORING[key];
    if (field) {
      rules[field] = value;
      continue;
    }
    if (!IGNORED.has(key)) unsupported.push(key);
  }

  if (Object.keys(perPosition).length > 0) {
    rules.reception_by_position = Object.fromEntries(
      Object.entries(perPosition).map(([position, extra]) => [position, rules.reception + extra])
    );
  }

  return {
    rules,
    unsupported: unsupported.sort(),
    bonuses: bonuses.sort(),
    supported: unsupported.length === 0 && bonuses.length === 0,
    reason:
      bonuses.length > 0
        ? "per-game bonuses cannot be computed from per-game averages"
        : unsupported.length > 0
          ? `unmapped scoring rules: ${unsupported.join(", ")}`
          : "",
  };
}

/** Puntos por partido de un jugador, dados sus componentes y unas reglas. */
export function compilePoints(components, rules, position) {
  if (!components || !rules) return null;
  let points = 0;
  for (const [name, field] of Object.entries(COEFFICIENTS)) {
    points += (Number(components[name]) || 0) * (Number(rules[field]) || 0);
  }
  const receptionValue =
    rules.reception_by_position && position && Object.hasOwn(rules.reception_by_position, position)
      ? rules.reception_by_position[position]
      : rules.reception;
  points += (Number(components.receptions) || 0) * (Number(receptionValue) || 0);
  return points;
}
