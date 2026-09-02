/**
 * La foto va por IDENTIFICADOR o no va. Cada test es una forma de acabar
 * pintando la cara de otro jugador.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { headshotUrl, initials } from "../app/headshot.js";

test("un jugador con sleeper_id numérico tiene miniatura en el CDN", () => {
  assert.equal(headshotUrl({ sid: "4046", team: "KC", position: "QB" }),
    "https://sleepercdn.com/content/nfl/players/thumb/4046.jpg");
});

test("sin sleeper_id no hay foto: null, no una URL inventada", () => {
  assert.equal(headshotUrl({ sid: null, team: "KC", position: "QB" }), null);
  assert.equal(headshotUrl({ sid: "", team: "KC", position: "QB" }), null);
  assert.equal(headshotUrl({ sid: "sin-mapear-00-0001", team: "KC", position: "QB" }), null);
});

test("una defensa va por el escudo del equipo, aunque su id del mapa sea el código", () => {
  assert.equal(headshotUrl({ sid: "ARI", team: "ARI", position: "DEF" }),
    "https://sleepercdn.com/images/team_logos/nfl/ari.png");
  assert.equal(headshotUrl({ sid: "DST_LAR", team: "LAR", position: "DST" }),
    "https://sleepercdn.com/images/team_logos/nfl/lar.png");
  assert.equal(headshotUrl({ team: "", position: "DEF" }), null);
});

test("las iniciales salen del nombre completo o del abreviado", () => {
  assert.equal(initials("Ja'Marr Chase"), "JC");
  assert.equal(initials("P.Nacua"), "PN");
  assert.equal(initials("Cardinals"), "CA");
  assert.equal(initials(""), "?");
});
