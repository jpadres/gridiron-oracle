import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NO_BET, noBetReason } from "../app/betting/noBet.js";
import { model } from "../data/model.js";

test("traduce los códigos que publica Python, y nada más", () => {
  assert.equal(noBetReason({ decision: "NO_BET", no_bet_reason: "UNDER_MINIMUM" }), NO_BET.UNDER_MINIMUM);
  assert.equal(noBetReason({ decision: "NO_BET", no_bet_reason: "BELOW_PRICE" }), NO_BET.BELOW_PRICE);
  assert.equal(noBetReason({ decision: "BET", no_bet_reason: null }), null);
  assert.equal(noBetReason(null), null);
});

test("un código desconocido no se disfraza de motivo conocido", () => {
  assert.match(noBetReason({ decision: "NO_BET", no_bet_reason: "SOMETHING_NEW" }), /not sized/);
  assert.equal(noBetReason({ decision: "NO_BET", no_bet_reason: null }), "reason not published");
});

test("el fichero no recalcula nada: sin umbrales ni aritmética", () => {
  const src = readFileSync(new URL("../app/betting/noBet.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /MIN_EDGE|EDGE_SHRINK|decimal_odds|market_prob|Math\./);
});

test("en el payload, cada lado trae la decisión y el motivo cuadra con el tamaño", () => {
  const markets = model.markets ?? [];
  assert.ok(markets.length > 0);
  for (const side of markets) {
    assert.ok(side.decision === "BET" || side.decision === "NO_BET", `${side.matchup}: sin decisión`);
    assert.equal(side.decision === "BET", side.stake_fraction > 0, `${side.matchup} ${side.market}`);
    assert.equal(side.no_bet_reason == null, side.decision === "BET", `${side.matchup} ${side.market}`);
    if (side.decision === "NO_BET") assert.ok(noBetReason(side) && !/not sized|not published/.test(noBetReason(side)));
  }
});

// -------------------------------------------------------------------------
// GAME_FINAL, Y QUE LOS MERCADOS NUEVOS LLEGUEN A LA PANTALLA
// -------------------------------------------------------------------------

test("un partido con resultado se dice FINAL, no «not sized»", () => {
  const side = { decision: "NO_BET", no_bet_reason: "GAME_FINAL" };
  assert.equal(noBetReason(side), "game is final");
  assert.ok(!/not sized/.test(noBetReason(side)),
    "un código conocido no puede salir como desconocido");
});

test("la tabla de mercados NO filtra a spreads: la moneyline llega a la pantalla", () => {
  const src = readFileSync(new URL("../app/betting/BettingShell.jsx", import.meta.url), "utf8");
  // El filtro por partido tiene que existir…
  assert.match(src, /markets\.filter\(\(m\) => m\.game_id === game\.game_id\)/,
    "la tabla no agrupa los mercados por partido");
  // …y NO puede acotar la familia: son 32 spreads y 32 moneylines, y hasta el
  // 13 de septiembre de 2026 este filtro decía `startsWith("spread")`, correcto
  // sólo mientras la moneyline no llegaba nunca al payload.
  const cuerpo = src.slice(src.indexOf("bk-markets"));
  assert.ok(!/m\.game_id === game\.game_id && String\(m\.market\)\.startsWith\("spread"\)/.test(cuerpo),
    "la tabla vuelve a dejar fuera la moneyline");
});

test("la pantalla PINTA el cierre por resultado y el precio publicado", () => {
  const src = readFileSync(new URL("../app/betting/BettingShell.jsx", import.meta.url), "utf8");
  /* El estado del partido lo decide `gameClock.js`: `game_final` es la mitad
     que sabe Python —hay marcador— y el saque pasado es la que sólo sabe el
     reloj del que mira. La pantalla tiene que preguntar por las DOS, y por eso
     lo que se exige es la llamada compartida y no el campo suelto. */
  assert.match(src, /gameState\(/,
    "nadie mira el estado del partido: uno acabado o en marcha saldría abierto");
  assert.match(src, /GAME\.SCHEDULED/,
    "no se distingue «abierto» de los otros tres estados");
  /* EL RELOJ SE LEE AL MONTAR, no sólo cada minuto.
     La primera versión de esto pedía `setNow(Date.now())` en el fichero y
     seguía VERDE al quitar la lectura inicial, porque la MISMA cadena está
     dentro del `setInterval`. Es «el nombre sigue apareciendo» por tercera vez
     en esta sesión. Lo que importa es el PRIMER pintado: sin lectura al montar,
     el que abre la página a las dos de la tarde ve el partido de la una
     abierto durante un minuto entero. Se quita el intervalo del cuerpo del
     efecto y se exige que la lectura siga estando. */
  const efecto = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("}, []);"));
  assert.ok(efecto.length > 0, "no hay efecto de montaje que leer");
  const sinIntervalo = efecto.replace(/setInterval\([\s\S]*?\);/g, " ");
  assert.match(sinIntervalo, /setNow\(Date\.now\(\)\)/,
    "el reloj sólo se lee en el intervalo: el primer pintado va sin él");
  assert.match(src, /side\.american_odds/,
    "el precio publicado no se pinta: la columna seguiría siendo la convención");
  assert.match(src, /side\.price_source/,
    "no se distingue una cotización de un relleno -110");
  // Y la boleta tiene que registrar el precio del lado, no el -110 cableado.
  assert.match(src, /odds: hasNumber\(bet\.american_odds\)/,
    "la boleta vuelve a cablear -110");
  // La frase que afirmaba 50/50 por construcción ya no puede estar.
  assert.ok(!/−110 both ways de-vigged\s*\n?\s*\(Shin\), so 50\/50/.test(src),
    "el pie sigue afirmando que la casa es 50/50");
});

test("la tarjeta de partido dice FINAL con el marcador de verdad", () => {
  const src = readFileSync(new URL("../app/sports.jsx", import.meta.url), "utf8");
  assert.match(src, /game\.final === true/,
    "la tarjeta no comprueba si el partido se jugó");
  assert.match(src, /home_score/,
    "el marcador real no llega a la tarjeta");
  assert.match(src, /FINAL</, "no se pinta la marca FINAL");
  assert.match(src, /game\.kickoff/, "no se dice cuándo se juega");
});
