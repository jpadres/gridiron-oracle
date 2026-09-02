/**
 * La semana de una liga en hechos: alineación contra alineación y profundidad
 * por equipo. Cada test reproduce una forma de convertir «sin proyección» en
 * cero o de sumar a quien no juega.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedicatedStarters, depthByTeam, lineupOf, matchupView, weeklyIndex,
} from "../app/fantasy/leagueWeek.js";

const RANKINGS = [
  { sid: "6794", player_name: "J.Jefferson", position: "WR", projected_points: 18.4 },
  { sid: "11631", player_name: "B.Robinson", position: "RB", projected_points: 16.1 },
  { sid: "4046", player_name: "P.Mahomes", position: "QB", projected_points: 21.0 },
  { sid: "5555", player_name: "T.Kelce", position: "TE", projected_points: 11.2 },
];
const KICKERS = [{ sid: "9001", player_name: "H.Butker", projected_points: 8.5 }];

const SNAPSHOT = {
  rosterId: 3,
  teams: [
    { rosterId: 1, owner: "rival", record: { wins: 3, losses: 1, ties: 0 }, players: ["4046", "5555"], starters: ["4046"] },
    { rosterId: 3, owner: "Los Padres", record: null, players: ["6794", "11631", "ARI", "9001"], starters: ["6794", "ARI"] },
  ],
  matchup: { week: 1, matchupId: "1", myStarters: ["6794", "ARI", "0"], opponentRosterId: 1, opponentStarters: ["4046", "5555"] },
};

test("el índice semanal resuelve por sid, y los pateadores entran con posición K", () => {
  const index = weeklyIndex(RANKINGS, KICKERS);
  assert.equal(index.get("6794").player_name, "J.Jefferson");
  assert.equal(index.get("9001").position, "K");
});

test("una alineación suma sólo lo proyectado; defensa, hueco vacío y desconocido cuentan como sin proyección", () => {
  const index = weeklyIndex(RANKINGS, KICKERS);
  const lineup = lineupOf(["6794", "ARI", "0", "no-existe"], index);
  assert.equal(lineup.projected, 18.4);
  assert.equal(lineup.unknown, 3);
  assert.equal(lineup.count, 4);
  assert.equal(lineup.rows[2].empty, true);
});

test("el enfrentamiento: mi alineación contra la del rival, con su nombre y récord", () => {
  const view = matchupView({ snapshot: SNAPSHOT, index: weeklyIndex(RANKINGS, KICKERS) });
  assert.equal(view.rivalName, "rival");
  assert.deepEqual(view.rivalRecord, { wins: 3, losses: 1, ties: 0 });
  assert.equal(view.mine.projected, 18.4);
  assert.equal(view.rival.projected, 32.2);
  assert.equal(view.week, 1);
});

test("sin rival no hay enfrentamiento", () => {
  assert.equal(matchupView({ snapshot: { ...SNAPSHOT, matchup: null }, index: new Map() }), null);
  assert.equal(matchupView({ snapshot: { ...SNAPSHOT, matchup: { ...SNAPSHOT.matchup, opponentRosterId: null } }, index: new Map() }), null);
});

test("la profundidad por equipo cuenta y suma los mejores N por posición; el mío va marcado", () => {
  const index = weeklyIndex(RANKINGS, KICKERS);
  const depth = depthByTeam({ snapshot: SNAPSHOT, index, starters: { QB: 1, RB: 2, WR: 2, TE: 1 } });
  const mine = depth.find((t) => t.mine);
  assert.equal(mine.owner, "Los Padres");
  assert.equal(mine.positions.WR.count, 1);
  assert.equal(mine.positions.WR.top, 18.4);
  assert.equal(mine.positions.RB.count, 1);
  assert.equal(mine.positions.QB.count, 0);
  assert.equal(mine.positions.QB.top, 0);
  // La defensa no está en el índice semanal: se cuenta como desconocida, no como cero de una posición.
  assert.equal(mine.unknown, 1);
  const rival = depth.find((t) => !t.mine);
  assert.equal(rival.positions.QB.top, 21.0);
  assert.equal(rival.positions.TE.top, 11.2);
});

test("los titulares dedicados salen de la lista de huecos; FLEX no cuenta para nadie", () => {
  assert.deepEqual(dedicatedStarters(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN"]),
    { QB: 1, RB: 2, WR: 3, TE: 1 });
  assert.equal(dedicatedStarters(null), null);
});
