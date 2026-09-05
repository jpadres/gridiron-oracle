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
