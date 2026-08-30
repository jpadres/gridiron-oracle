/**
 * Compilador de puntuación y valor por liga.
 *
 * El test que más importa es el de superflex: si `12-equipos PPR 1QB` y
 * `12-equipos PPR superflex` producen la misma jerarquía de quarterbacks, la
 * migración entera no sirve para nada — y sería un fallo invisible, porque los
 * números seguirían pareciendo razonables.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COEFFICIENTS, COMPONENTS, DEFAULT_RULES, compilePoints, rulesFromSleeper,
} from "../app/fantasy/scoring.js";
import {
  buildLeagueBoard, replacementRank, rosterContext,
} from "../app/fantasy/leagueValue.js";

const STD = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF",
             "BN", "BN", "BN", "BN", "BN", "BN"];
const SUPERFLEX = [...STD.slice(0, 8), "SUPER_FLEX", ...STD.slice(8)];
const TWO_WR = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"];
const DOS_FLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "BN"];

/** Un jugador con componentes por partido plausibles para su posición. */
function player(id, position, overrides = {}) {
  const base = {
    QB: { passing_yards: 250, passing_tds: 1.6, interceptions: 0.6, rushing_yards: 20,
          rushing_tds: 0.2 },
    RB: { rushing_yards: 70, rushing_tds: 0.5, receptions: 3, receiving_yards: 25 },
    WR: { receptions: 5.5, receiving_yards: 75, receiving_tds: 0.45 },
    TE: { receptions: 4.5, receiving_yards: 50, receiving_tds: 0.35 },
  }[position];
  const components = Object.fromEntries(COMPONENTS.map((c) => [c, 0]));
  return {
    player_id: id, position, age_factor: 1,
    components: { ...components, ...base, ...overrides },
  };
}

// Una población con profundidad suficiente para que el reemplazo caiga dentro de
// la lista en todas las configuraciones que se prueban.
//
// Las curvas están calibradas para PARECERSE AL FÚTBOL, y eso importa desde
// E18: el reparto de los huecos compartidos es voraz sobre puntos, así que un
// pool donde el QB24 vale menos que el WR40 manda huecos de superflex a
// receptores. Con la curva vieja pasaba exactamente eso, y una propiedad que en
// datos reales se cumple —el superflex no toca el valor de los no-quarterback—
// fallaba por culpa del fixture. En los datos de verdad el reemplazo del QB
// ronda los 15,5 puntos por partido y el del WR los 9,3; estas curvas mantienen
// esa separación.
const POOL = [
  ...Array.from({ length: 32 }, (_, i) =>
    player(`qb${i}`, "QB", { passing_yards: 290 - i * 3.5, passing_tds: 2.0 - i * 0.028 })),
  ...Array.from({ length: 60 }, (_, i) =>
    player(`rb${i}`, "RB", { rushing_yards: 110 - i * 1.4, rushing_tds: 0.8 - i * 0.011,
                             receptions: 4.5 - i * 0.05 })),
  ...Array.from({ length: 80 }, (_, i) =>
    player(`wr${i}`, "WR", { receptions: 7.5 - i * 0.09, receiving_yards: 100 - i * 1.4,
                             receiving_tds: 0.6 - i * 0.008 })),
  ...Array.from({ length: 30 }, (_, i) =>
    player(`te${i}`, "TE", { receptions: 6 - i * 0.14, receiving_yards: 70 - i * 1.7 })),
];

// `buildLeagueBoard` devuelve `{rows, short, ...}` desde E18: el board y las
// posiciones cuyo reemplazo se sale del pool. Aquí se desenvuelve `rows`, pero
// se EXIGE que `short` esté vacío: si la población de prueba se quedara corta,
// los VOR saldrían `null` y estas aserciones pasarían por el motivo equivocado.
const board = (rosterPositions, teams, rules = DEFAULT_RULES) => {
  const result = buildLeagueBoard({
    players: POOL, rules,
    context: rosterContext(rosterPositions, teams),
    compilePoints,
  });
  assert.deepEqual(result.short, [],
                   `la población de prueba se queda corta en ${result.short}`);
  return result.rows;
};

const rankOf = (rows, id) => rows.findIndex((r) => r.player_id === id) + 1;
const bestQbRank = (rows) => rows.findIndex((r) => r.position === "QB") + 1;

// --- contrato entre los dos lados -------------------------------------------

test("los diez componentes tienen coeficiente o son la recepción", () => {
  // Un componente sin coeficiente se sumaría como CERO en silencio.
  for (const name of COMPONENTS) {
    assert.ok(name === "receptions" || Object.hasOwn(COEFFICIENTS, name), name);
  }
  assert.equal(COMPONENTS.length, 10);
});

// --- puntuación --------------------------------------------------------------

test("la puntuación es lineal en los componentes", () => {
  const p = player("x", "WR").components;
  const uno = compilePoints(p, DEFAULT_RULES, "WR");
  const doble = compilePoints(
    Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v * 2])), DEFAULT_RULES, "WR");
  assert.ok(Math.abs(doble - uno * 2) < 1e-9);
});

test("PPR, half y standard dan puntos distintos con los MISMOS componentes", () => {
  const wr = player("x", "WR").components;
  const ppr = compilePoints(wr, DEFAULT_RULES, "WR");
  const half = compilePoints(wr, { ...DEFAULT_RULES, reception: 0.5 }, "WR");
  const std = compilePoints(wr, { ...DEFAULT_RULES, reception: 0 }, "WR");
  assert.ok(ppr > half && half > std);
  assert.ok(Math.abs(ppr - std - wr.receptions) < 1e-9);
});

test("el TD de pase a 6 puntos sube a los quarterbacks y no a nadie más", () => {
  const seis = { ...DEFAULT_RULES, passing_td: 6 };
  const qb = player("q", "QB").components;
  const wr = player("w", "WR").components;
  assert.ok(compilePoints(qb, seis, "QB") > compilePoints(qb, DEFAULT_RULES, "QB"));
  assert.equal(compilePoints(wr, seis, "WR"), compilePoints(wr, DEFAULT_RULES, "WR"));
});

test("la penalización por intercepción cambia sólo a los quarterbacks", () => {
  const suave = { ...DEFAULT_RULES, interception: -1 };
  const qb = player("q", "QB").components;
  const delta = compilePoints(qb, suave, "QB") - compilePoints(qb, DEFAULT_RULES, "QB");
  assert.ok(Math.abs(delta - qb.interceptions) < 1e-9);
});

test("el TE premium sube al ala cerrada y deja igual al receptor", () => {
  const rules = { ...DEFAULT_RULES, reception_by_position: { TE: 1.5 } };
  const te = player("t", "TE").components;
  const wr = player("w", "WR").components;
  assert.ok(Math.abs(
    compilePoints(te, rules, "TE") - compilePoints(te, DEFAULT_RULES, "TE") - 0.5 * te.receptions
  ) < 1e-9);
  assert.equal(compilePoints(wr, rules, "WR"), compilePoints(wr, DEFAULT_RULES, "WR"));
});

// --- traducción desde Sleeper ------------------------------------------------

test("una regla de Sleeper que no se sabe traducir NO se ignora en silencio", () => {
  const out = rulesFromSleeper({ rec: 1, pass_td: 4, regla_inventada_2026: 3 });
  assert.equal(out.supported, false);
  assert.deepEqual(out.unsupported, ["regla_inventada_2026"]);
});

test("los bonus por partido se detectan y bloquean, no se aplican a medias", () => {
  // Dependen de la distribución semanal: dos jugadores con la misma media cobran
  // bonus distintos, y desde la media no se puede saber cuál.
  const out = rulesFromSleeper({ rec: 1, bonus_rec_yd_100: 3 });
  assert.equal(out.supported, false);
  assert.deepEqual(out.bonuses, ["bonus_rec_yd_100"]);
  assert.match(out.reason, /per-game bonuses/);
});

test("un bonus a cero no bloquea nada", () => {
  assert.equal(rulesFromSleeper({ rec: 1, bonus_rec_yd_100: 0 }).supported, true);
});

test("la puntuación de defensa y pateador no afecta al board ofensivo", () => {
  const out = rulesFromSleeper({ rec: 1, sack: 1, fgm_40_49: 4, pts_allow_0: 10 });
  assert.equal(out.supported, true);
  assert.deepEqual(out.unsupported, []);
});

test("el TE premium de Sleeper es un EXTRA sobre la recepción, no el total", () => {
  // `bonus_rec_te: 0.5` con `rec: 1` significa 1,5 por recepción de TE. Leerlo
  // como el total lo convertiría en 0,5 — menos que el resto.
  const out = rulesFromSleeper({ rec: 1, bonus_rec_te: 0.5 });
  assert.equal(out.rules.reception_by_position.TE, 1.5);
});

test("sin scoring_settings no hay reglas: UNKNOWN, no PPR por defecto", () => {
  const out = rulesFromSleeper(null);
  assert.equal(out.supported, false);
  assert.equal(out.rules, null);
});

// --- plantilla ---------------------------------------------------------------

test("un hueco de plantilla desconocido hace la liga no soportada", () => {
  const out = rosterContext(["QB", "RB", "OP", "BN"], 12);
  assert.equal(out.supported, false);
  assert.match(out.reason, /OP/);
});

test("sin roster_positions o sin equipos: UNKNOWN", () => {
  assert.equal(rosterContext(null, 12).supported, false);
  assert.equal(rosterContext(STD, null).supported, false);
});

test("el flex se reparte y el superflex va entero a quarterback", () => {
  const std = rosterContext(STD, 12);
  assert.ok(Math.abs(std.starters.RB - 2.45) < 1e-9);
  assert.ok(Math.abs(std.starters.TE - 1.10) < 1e-9);
  assert.equal(std.isSuperflex, false);

  const sf = rosterContext(SUPERFLEX, 12);
  assert.ok(Math.abs(sf.starters.QB - 2.0) < 1e-9);
  assert.equal(sf.isSuperflex, true);
});

test("dos flex reparten el doble", () => {
  const uno = rosterContext(["QB", "RB", "WR", "TE", "FLEX", "BN"], 12);
  const dos = rosterContext(DOS_FLEX, 12);
  assert.ok(dos.starters.RB > uno.starters.RB);
});

test("el tamaño de la liga mueve el nivel de reemplazo", () => {
  const diez = rosterContext(STD, 10);
  const catorce = rosterContext(STD, 14);
  assert.ok(replacementRank(diez, "WR") < replacementRank(catorce, "WR"));
  assert.equal(replacementRank(rosterContext(STD, 12), "QB"), 12);
});

// --- SUPERFLEX: el red team ---------------------------------------------------

test("SUPERFLEX mueve el reemplazo de quarterback de 12 a 24", () => {
  assert.equal(replacementRank(rosterContext(STD, 12), "QB"), 12);
  assert.equal(replacementRank(rosterContext(SUPERFLEX, 12), "QB"), 24);
});

test("SUPERFLEX cambia MATERIALMENTE el orden del board", () => {
  // Si esto no cambia, la migración entera no sirve: los puntos serían
  // league-specific y el VALOR no, que es la mitad que importa.
  const std = board(STD, 12);
  const sf = board(SUPERFLEX, 12);
  const qbStd = bestQbRank(std);
  const qbSf = bestQbRank(sf);
  assert.ok(qbSf < qbStd,
            `el mejor QB debe subir en superflex: ${qbStd} -> ${qbSf}`);

  const vorStd = std.find((r) => r.position === "QB").vor;
  const vorSf = sf.find((r) => r.position === "QB").vor;
  assert.ok(vorSf > vorStd * 1.5,
            `el VOR del QB debe subir mucho: ${vorStd.toFixed(1)} -> ${vorSf.toFixed(1)}`);
});

test("en superflex NO cambia el valor de los que no son quarterback", () => {
  const std = board(STD, 12);
  const sf = board(SUPERFLEX, 12);
  const wrStd = std.find((r) => r.player_id === "wr0").vor;
  const wrSf = sf.find((r) => r.player_id === "wr0").vor;
  assert.ok(Math.abs(wrStd - wrSf) < 1e-9);
});

// --- matriz multi-liga ---------------------------------------------------------

test("mismos componentes, distinta puntuación -> distinto valor", () => {
  const ppr = board(STD, 12);
  const std = board(STD, 12, { ...DEFAULT_RULES, reception: 0 });
  const wr = "wr0";
  assert.notEqual(rankOf(ppr, wr), rankOf(std, wr));
  assert.ok(ppr.find((r) => r.player_id === wr).vor >
            std.find((r) => r.player_id === wr).vor);
});

test("misma puntuación, distinto tamaño -> distinto VOR", () => {
  const diez = board(STD, 10);
  const catorce = board(STD, 14);
  const id = "wr10";
  assert.notEqual(diez.find((r) => r.player_id === id).vor,
                  catorce.find((r) => r.player_id === id).vor);
});

test("2WR frente a 3WR baja el VOR de todos los receptores", () => {
  // Con menos receptores titulares el reemplazo cae en un puesto MÁS ALTO de la
  // lista, así que el jugador de reemplazo es mejor y todos los receptores valen
  // menos sobre él. La dirección es comprobable, no una cuestión de gusto — y la
  // primera versión de este test se conformaba con «que cambie», que es una
  // comprobación que no puede fallar.
  const tres = board(STD, 12);
  const dos = board(TWO_WR, 12);
  assert.ok(replacementRank(rosterContext(TWO_WR, 12), "WR") <
            replacementRank(rosterContext(STD, 12), "WR"));
  for (const id of ["wr0", "wr10", "wr20"]) {
    assert.ok(dos.find((r) => r.player_id === id).vor <
              tres.find((r) => r.player_id === id).vor, id);
  }
});

test("10, 12 y 14 equipos dan tres boards distintos", () => {
  const vors = [10, 12, 14].map((n) => board(STD, n).find((r) => r.player_id === "rb15").vor);
  assert.equal(new Set(vors.map((v) => v.toFixed(4))).size, 3);
});

test("el TE premium sube al ala cerrada en el board, no sólo en puntos", () => {
  const normal = board(STD, 12);
  const premium = board(STD, 12, { ...DEFAULT_RULES, reception_by_position: { TE: 1.5 } });
  assert.ok(rankOf(premium, "te0") < rankOf(normal, "te0"));
});

test("la liga A y la liga B valoran al MISMO jugador distinto", () => {
  const a = board(STD, 12);
  const b = board(SUPERFLEX, 10, { ...DEFAULT_RULES, reception: 0.5, passing_td: 6 });
  const id = "qb2";
  assert.notEqual(a.find((r) => r.player_id === id).vor,
                  b.find((r) => r.player_id === id).vor);
});
