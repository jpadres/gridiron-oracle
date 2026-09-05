import assert from "node:assert/strict";
import test from "node:test";
import { NO_BET, noBetReason } from "../app/betting/noBet.js";
import { model } from "../data/model.js";

test("por debajo del mínimo: NO BET por el mínimo", () => {
  assert.equal(noBetReason({ edge: 0.01, market_prob: 0.5, decimal_odds: 1.9091 }), NO_BET.UNDER_MINIMUM);
});

test("edge del 4,3% a −110: el edge a la mitad no bate el precio (el caso ARI @ LAC)", () => {
  assert.equal(noBetReason({ edge: 0.043, market_prob: 0.5, decimal_odds: 1.9091 }), NO_BET.BELOW_PRICE);
});

test("edge del 7,2% a −110: se apuesta, sin motivo de NO BET (el caso MIA @ LV)", () => {
  assert.equal(noBetReason({ edge: 0.0722, market_prob: 0.5, decimal_odds: 1.9091 }), null);
});

test("sin números no se inventa un motivo", () => {
  assert.equal(noBetReason({ edge: null, market_prob: 0.5, decimal_odds: 1.9 }), null);
  assert.equal(noBetReason(null), null);
});

test("sobre el payload entero, el espejo y Python dicen lo mismo lado a lado", () => {
  const markets = model.markets ?? [];
  assert.ok(markets.length > 0);
  for (const side of markets) {
    const reason = noBetReason(side);
    if (side.stake_fraction > 0) assert.equal(reason, null, `${side.matchup} ${side.market}: Python apuesta y esto dice «${reason}»`);
    else assert.ok(reason, `${side.matchup} ${side.market}: Python no apuesta y esto no sabe por qué`);
  }
});
