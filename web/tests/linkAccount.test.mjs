/**
 * La traducción de una cuenta enlazada, ahora compartida por TODAS las
 * pantallas: Leagues, el semanal y el analizador enlazan con esta función.
 *
 * `accountFrom` es la mitad pura de `linkSleeperAccount` — recibe la lectura ya
 * hecha, así que se prueba sin red y sin navegador. La otra mitad es la
 * petición, que vive en el adaptador.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { accountFrom } from "../app/fantasy/linkAccount.js";

const ME = "111000111000111000";

const LEAGUE = {
  league_id: "L1", name: "Work league", season: "2026", total_rosters: 10,
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN"],
  scoring_settings: { rec: 0.5 }, draft_id: "D1",
};
const DRAFT = {
  draft_id: "D1", league_id: "L1", season: "2026", status: "complete", type: "snake",
  settings: { teams: 10, rounds: 15 }, draft_order: { [ME]: 7 }, slot_to_roster_id: { 7: 3 },
};
const MOCK = {
  draft_id: "M1", league_id: null, season: "2026", status: "drafting", type: "snake",
  created: 1_790_000_000_000,
  settings: { teams: 12, rounds: 15, slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_te: 1, slots_bn: 6 },
  metadata: { scoring_type: "ppr", name: "Tuesday mock" },
  draft_order: { [ME]: 4 },
};
const ROSTERS = [
  { roster_id: 3, owner_id: ME, players: ["6794"], starters: ["6794"], settings: { wins: 2, losses: 1 } },
];
const USERS = [{ user_id: ME, display_name: "jpadres", metadata: { team_name: "Los Padres" } }];

const READ = {
  user: { userId: ME, username: "jpadres", displayName: "jpadres" },
  leagues: [{ league: LEAGUE, draft: DRAFT, rosters: ROSTERS, users: USERS, matchups: null }],
  drafts: [DRAFT, MOCK],
  retrievedAt: 1_790_000_100_000,
};

test("la cuenta traducida trae usuario, ligas y su instantánea", () => {
  const account = accountFrom({ read: READ, season: 2026 });
  assert.equal(account.username, "jpadres");
  assert.equal(account.userId, ME);
  assert.equal(account.leagues.length, 1);
  assert.equal(account.leagues[0].leagueId, "L1");
  assert.equal(account.leagues[0].rosterId, 3);
  assert.equal(account.retrievedAt, READ.retrievedAt);
});

test("el draft de una liga NO se cuela además como mock", () => {
  // Dos entradas para el mismo draft serían dos contextos con un nombre, y el
  // estado de uno contaminaría al otro (regla 6).
  const account = accountFrom({ read: READ, season: 2026 });
  assert.deepEqual(account.mocks.map((m) => m.draftId), ["M1"]);
});

test("el mock conserva su configuración: tamaño, puntuación y mi puesto", () => {
  const [mock] = accountFrom({ read: READ, season: 2026 }).mocks;
  assert.equal(mock.config.teams, 12);
  assert.equal(mock.config.scoring, "ppr");
  assert.equal(mock.config.mySlot, 4);
  assert.equal(mock.config.isMock, true);
});

test("cada liga con draft entra en el catálogo del Draft Room", () => {
  // Sin esto, una liga enlazada desde el semanal no se podría abrir en el
  // asistente sin volver a teclearla.
  const escrito = [];
  const storage = {
    getItem: () => null,
    setItem: (k, v) => escrito.push([k, v]),
  };
  accountFrom({ read: READ, season: 2026, storage });
  assert.ok(escrito.some(([, v]) => String(v).includes("L1")));
});

test("sin almacenamiento la traducción sigue funcionando", () => {
  // El navegador puede bloquearlo: `browserStorage()` devuelve null y esto no
  // puede reventar por ello.
  const account = accountFrom({ read: READ, season: 2026, storage: null });
  assert.equal(account.leagues.length, 1);
});

test("una lectura vacía da una cuenta vacía, no una excepción", () => {
  const account = accountFrom({
    read: { user: { userId: ME, username: "x", displayName: null }, leagues: [], drafts: [], retrievedAt: 1 },
    season: 2026,
  });
  assert.deepEqual(account.leagues, []);
  assert.deepEqual(account.mocks, []);
});
