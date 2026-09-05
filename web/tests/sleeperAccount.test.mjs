/**
 * La cuenta de Sleeper, traducida. Cada test reproduce una forma concreta de
 * inventarse una configuración, mezclar dos contextos o decir «tengo a X» sin
 * haberlo resuelto por identificador.
 *
 * Los fixtures tienen la FORMA de las respuestas reales de Sleeper (campos y
 * tipos), no una forma cómoda: un doble que miente en un campo prueba otra
 * cosa.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ROSTER_STALE_MS,
  accountFreshness,
  buildIndex,
  isMock,
  isMockLeagueId,
  leagueConfigFrom,
  leagueSnapshotFrom,
  loadAccount,
  matchupFrom,
  mockDrafts,
  mockLeagueId,
  mockScoringSettings,
  myRosterOf,
  ownershipLabel,
  ownershipOf,
  rosterFromDraftSettings,
  rosterView,
  saveAccount,
} from "../app/fantasy/sleeperAccount.js";

const ME = "884444";

// --- fixtures con la forma de Sleeper ------------------------------------

const LEAGUE = {
  league_id: "1180000000000000001",
  name: "Work league",
  season: "2026",
  status: "in_season",
  total_rosters: 10,
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN"],
  scoring_settings: { rec: 0.5, pass_td: 4, rush_td: 6, rec_td: 6 },
  draft_id: "1180000000000000099",
};

const DRAFT = {
  draft_id: "1180000000000000099",
  league_id: "1180000000000000001",
  season: "2026",
  status: "complete",
  type: "snake",
  settings: { teams: 10, rounds: 15, pick_timer: 90 },
  draft_order: { [ME]: 7, u2: 1 },
  slot_to_roster_id: { 7: 3, 1: 1 },
};

const MOCK = {
  draft_id: "1190000000000000555",
  league_id: null,
  season: "2026",
  status: "drafting",
  type: "snake",
  created: 1_790_000_000_000,
  settings: {
    teams: 12, rounds: 15, pick_timer: 60,
    slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_te: 1, slots_flex: 1,
    slots_k: 1, slots_def: 1, slots_bn: 6,
  },
  metadata: { scoring_type: "ppr", name: "Mock draft" },
  draft_order: { [ME]: 4 },
};

const ROSTERS = [
  { roster_id: 1, owner_id: "u2", players: ["4046"], starters: ["4046"], settings: { wins: 3, losses: 1 } },
  { roster_id: 3, owner_id: ME, players: ["6794", "4046x", "ARI", "11631"],
    starters: ["6794", "ARI"], settings: { wins: 2, losses: 2, ties: 0 } },
];

const USERS = [
  { user_id: ME, display_name: "jpadres", metadata: { team_name: "Los Padres" } },
  { user_id: "u2", display_name: "rival" },
];

const POOL = [
  { player_id: "00-0036223", player_name: "J.Jefferson", position: "WR", team: "MIN", vor: 90 },
  { player_id: "00-0039100", player_name: "B.Robinson", position: "RB", team: "ATL", vor: 80 },
  { player_id: "DST_ARI", player_name: "Cardinals", position: "DEF", team: "ARI" },
];
const ID_MAP = { 6794: "00-0036223", 11631: "00-0039100", ARI: "DST_ARI" };

// --- un mock no tiene liga -----------------------------------------------

test("un mock se reconoce por `league_id: null`, y recibe una liga sintética", () => {
  assert.equal(isMock(MOCK), true);
  assert.equal(isMock(DRAFT), false);
  assert.equal(mockLeagueId(MOCK.draft_id), "draft-1190000000000000555");
  assert.equal(isMockLeagueId("draft-1190000000000000555"), true);
  assert.equal(isMockLeagueId("1180000000000000001"), false);
});

test("los huecos de un mock salen de `draft.settings`, contados", () => {
  const roster = rosterFromDraftSettings(MOCK.settings);
  assert.deepEqual(roster, [
    "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN",
  ]);
});

test("sin `slots_*` no se inventa una alineación: null", () => {
  assert.equal(rosterFromDraftSettings({ teams: 12, rounds: 15 }), null);
  assert.equal(rosterFromDraftSettings(null), null);
});

test("un mock con IDP produce huecos que el compilador NO soporta, en vez de ignorarlos", () => {
  const roster = rosterFromDraftSettings({ slots_qb: 1, slots_dl: 2 });
  assert.deepEqual(roster, ["QB", "DL", "DL"]);
});

test("la puntuación de un mock sale de `scoring_type`; lo que no está en la tabla es UNKNOWN", () => {
  assert.deepEqual(mockScoringSettings(MOCK), { rec: 1 });
  assert.deepEqual(mockScoringSettings({ metadata: { scoring_type: "half_ppr" } }), { rec: 0.5 });
  assert.deepEqual(mockScoringSettings({ metadata: { scoring_type: "std" } }), { rec: 0 });
  assert.equal(mockScoringSettings({ metadata: { scoring_type: "dynasty_2qb" } }), null);
  assert.equal(mockScoringSettings({}), null);
});

test("la entrada de catálogo de un mock: liga sintética, huecos, puntuación y MI puesto", () => {
  const config = leagueConfigFrom({ draft: MOCK, userId: ME, season: 2026 });
  assert.equal(config.platform, "sleeper");
  assert.equal(config.isMock, true);
  assert.equal(config.leagueId, "draft-1190000000000000555");
  assert.equal(config.draftId, "1190000000000000555");
  assert.equal(config.teams, 12);
  assert.equal(config.rounds, 15);
  assert.equal(config.draftType, "snake");
  assert.equal(config.mySlot, 4);
  assert.equal(config.scoring, "ppr");
  assert.equal(config.scoringLabel, "PPR");
  assert.equal(config.rosterSource, "SLEEPER");
  assert.equal(config.roster.length, 16);
  assert.equal(config.status, "drafting");
  assert.equal(config.name, "Mock draft");
});

test("un mock sin tipo de puntuación conocido queda UNKNOWN, no PPR", () => {
  const config = leagueConfigFrom({
    draft: { ...MOCK, metadata: { scoring_type: "whatever" } }, userId: ME, season: 2026,
  });
  assert.equal(config.scoring, null);
  assert.equal(config.scoringLabel, null);
  assert.equal(config.scoringSettings, null);
});

test("sin `draft_order` para mí, el puesto es null — nunca 1", () => {
  const config = leagueConfigFrom({ draft: { ...MOCK, draft_order: {} }, userId: ME, season: 2026 });
  assert.equal(config.mySlot, null);
});

// --- una liga de verdad --------------------------------------------------

test("la entrada de una liga: puntuación y plantilla de la LIGA, puesto por roster", () => {
  const mine = myRosterOf(ROSTERS, ME);
  assert.equal(mine.roster_id, 3);
  const config = leagueConfigFrom({
    league: LEAGUE, draft: DRAFT, userId: ME, rosterId: mine.roster_id, season: 2026,
  });
  assert.equal(config.isMock, false);
  assert.equal(config.leagueId, LEAGUE.league_id);
  assert.equal(config.teams, 10);
  assert.equal(config.scoring, "half");
  assert.equal(config.scoringLabel, "Half PPR");
  assert.deepEqual(config.roster, LEAGUE.roster_positions);
  assert.equal(config.mySlot, 7);
  assert.equal(config.name, "Work league");
  assert.equal(config.status, "complete");
});

test("una liga sin draft todavía sigue siendo una liga: draft null, puesto null", () => {
  const config = leagueConfigFrom({ league: { ...LEAGUE, draft_id: null }, userId: ME, season: 2026 });
  assert.equal(config.draftId, null);
  assert.equal(config.mySlot, null);
  assert.equal(config.rounds, null);
  assert.equal(config.teams, 10);
});

test("co-dueño cuenta como mío; un user_id ajeno no encuentra nada", () => {
  const rosters = [{ roster_id: 9, owner_id: "x", co_owners: [ME] }];
  assert.equal(myRosterOf(rosters, ME).roster_id, 9);
  assert.equal(myRosterOf(rosters, "nadie"), null);
  assert.equal(myRosterOf(null, ME), null);
});

// --- la plantilla, resuelta POR ID ---------------------------------------

test("la plantilla se resuelve por `sleeper_id` contra el mapa horneado; lo que no está queda UNMAPPED", () => {
  const index = buildIndex(POOL, ID_MAP);
  const view = rosterView({ roster: ROSTERS[1], index });
  assert.deepEqual(view.players.map((p) => p.player_name), ["B.Robinson", "J.Jefferson", "Cardinals"]);
  assert.deepEqual(view.unmapped, ["4046x"]);
  assert.equal(view.total, 4);
  assert.equal(view.hasDefense, true);
  assert.equal(view.hasKicker, false);
  assert.deepEqual(view.counts, { RB: 1, WR: 1, DEF: 1 });
  // Titulares según Sleeper, no según nosotros.
  assert.equal(view.players.find((p) => p.player_name === "J.Jefferson").starter, true);
  assert.equal(view.players.find((p) => p.player_name === "B.Robinson").starter, false);
});

test("un `sleeper_id` que apunte a un jugador que no está en el pool no resuelve a nadie", () => {
  const index = buildIndex(POOL, { 7777: "00-0000000" });
  assert.equal(index.size, 0);
});

test("una plantilla vacía o ausente es cero jugadores, no un error", () => {
  const index = buildIndex(POOL, ID_MAP);
  assert.equal(rosterView({ roster: null, index }).total, 0);
  assert.equal(rosterView({ roster: { players: null }, index }).players.length, 0);
});

// --- la instantánea que se persiste --------------------------------------

test("la instantánea guarda IDENTIFICADORES y hechos, no filas del board", () => {
  const snap = leagueSnapshotFrom({
    league: LEAGUE, draft: DRAFT, rosters: ROSTERS, users: USERS, userId: ME, season: 2026,
  });
  assert.equal(snap.leagueId, LEAGUE.league_id);
  assert.equal(snap.rosterId, 3);
  assert.deepEqual(snap.players, ["6794", "4046x", "ARI", "11631"]);
  assert.deepEqual(snap.starters, ["6794", "ARI"]);
  assert.deepEqual(snap.record, { wins: 2, losses: 2, ties: 0 });
  assert.equal(snap.owners[ME], "Los Padres");
  assert.equal(snap.owners.u2, "rival");
  assert.equal(snap.rosterCount, 2);
  assert.equal(snap.config.mySlot, 7);
  assert.equal(JSON.stringify(snap).includes("J.Jefferson"), false);
});

test("sin rosters la plantilla es UNKNOWN (null), no vacía", () => {
  const snap = leagueSnapshotFrom({ league: LEAGUE, draft: DRAFT, rosters: null, users: null, userId: ME, season: 2026 });
  assert.equal(snap.players, null);
  assert.equal(snap.record, null);
  assert.equal(snap.rosterCount, null);
});

// --- mocks del usuario ---------------------------------------------------

test("de los drafts del usuario sólo los mocks de la temporada, el más nuevo primero", () => {
  const list = mockDrafts([
    DRAFT,
    { ...MOCK, draft_id: "a", created: 1 },
    { ...MOCK, draft_id: "b", created: 2 },
    { ...MOCK, draft_id: "old", season: "2025", created: 3 },
  ], 2026);
  assert.deepEqual(list.map((d) => d.draft_id), ["b", "a"]);
});

// --- frescura: nunca LIVE ------------------------------------------------

test("la frescura de la cuenta es de PLANTILLA: seis horas, y nunca LIVE", () => {
  const now = 1_800_000_000_000;
  assert.equal(accountFreshness(null, now), "UNKNOWN");
  assert.equal(accountFreshness(now + 1000, now), "UNKNOWN");
  assert.equal(accountFreshness(now - 1000, now), "CURRENT");
  assert.equal(accountFreshness(now - ROSTER_STALE_MS, now), "CURRENT");
  assert.equal(accountFreshness(now - ROSTER_STALE_MS - 1, now), "STALE");
});

// --- almacenamiento ------------------------------------------------------

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("la cuenta se guarda y se lee; sin nombre de usuario no se guarda nada", () => {
  const storage = memoryStorage();
  assert.equal(saveAccount({ userId: ME }, storage), false);
  assert.equal(loadAccount(storage), null);
  assert.equal(saveAccount({ username: "jpadres", userId: ME, retrievedAt: 1 }, storage), true);
  assert.equal(loadAccount(storage).userId, ME);
});

test("un almacenamiento roto no tumba la página", () => {
  const broken = { getItem: () => { throw new Error("private mode"); }, setItem: () => { throw new Error("x"); } };
  assert.equal(loadAccount(broken), null);
  assert.equal(saveAccount({ username: "a" }, broken), false);
  assert.equal(loadAccount(null), null);
});

// --- todas las plantillas, el enfrentamiento y la propiedad -------------

const MATCHUPS = [
  { roster_id: 1, matchup_id: 1, starters: ["4046"], players: ["4046"], points: 0 },
  { roster_id: 3, matchup_id: 1, starters: ["6794", "ARI"], players: ["6794", "4046x", "ARI", "11631"], points: 0 },
  { roster_id: 5, matchup_id: 2, starters: [], players: [], points: 0 },
];

test("la instantánea lleva TODAS las plantillas por id, con dueño y récord", () => {
  const snap = leagueSnapshotFrom({
    league: LEAGUE, draft: DRAFT, rosters: ROSTERS, users: USERS, userId: ME, season: 2026,
  });
  assert.equal(snap.teams.length, 2);
  const rival = snap.teams.find((t) => t.rosterId === 1);
  assert.equal(rival.owner, "rival");
  assert.deepEqual(rival.players, ["4046"]);
  assert.deepEqual(rival.record, { wins: 3, losses: 1, ties: 0 });
  assert.equal(snap.teams.find((t) => t.rosterId === 3).owner, "Los Padres");
});

test("el enfrentamiento de la semana: mi roster y el rival con el mismo matchup_id", () => {
  const m = matchupFrom({ matchups: MATCHUPS, rosterId: 3, week: 1 });
  assert.equal(m.opponentRosterId, 1);
  assert.deepEqual(m.myStarters, ["6794", "ARI"]);
  assert.deepEqual(m.opponentStarters, ["4046"]);
  assert.equal(m.week, 1);
});

test("sin rival (bye) o sin matchups no hay enfrentamiento inventado", () => {
  assert.equal(matchupFrom({ matchups: MATCHUPS, rosterId: 5, week: 1 }).opponentRosterId, null);
  assert.equal(matchupFrom({ matchups: null, rosterId: 3, week: 1 }), null);
  assert.equal(matchupFrom({ matchups: MATCHUPS, rosterId: 9, week: 1 }), null);
  assert.equal(matchupFrom({ matchups: MATCHUPS, rosterId: null, week: 1 }), null);
});

test("propiedad por id: mío, de otro o AGENTE LIBRE en esa liga", () => {
  const snap = leagueSnapshotFrom({
    league: LEAGUE, draft: DRAFT, rosters: ROSTERS, users: USERS, userId: ME, season: 2026,
  });
  const ownership = ownershipOf(snap);
  assert.deepEqual(ownershipLabel({ ownership, sid: "6794", myRosterId: 3 }), { status: "MINE", rosterId: 3 });
  assert.deepEqual(ownershipLabel({ ownership, sid: "4046", myRosterId: 3 }), { status: "TAKEN", rosterId: 1 });
  assert.deepEqual(ownershipLabel({ ownership, sid: "9999", myRosterId: 3 }), { status: "FREE_AGENT", rosterId: null });
  assert.equal(ownershipLabel({ ownership, sid: null, myRosterId: 3 }), null);
  // Una defensa se posee por código de equipo, que es su id en Sleeper.
  assert.equal(ownershipLabel({ ownership, sid: "ARI", myRosterId: 3 }).status, "MINE");
});

/* ── «no hay dato» no es «cero» ───────────────────────────────────────────
   `Number(null)` vale CERO y es finito, así que preguntar
   `Number.isFinite(Number(x))` responde que SÍ hay dato sobre un hueco. Aquí
   costaba dos afirmaciones falsas a la vez: una liga sin récord publicado
   salía «0-0», y un enfrentamiento que aún no se ha jugado publicaba CERO
   PUNTOS —para mí y para el rival— con la misma pinta que un marcador real. */
test("un enfrentamiento sin puntos publicados da null, no cero", () => {
  const sinJugar = matchupFrom({
    matchups: [
      { roster_id: 1, matchup_id: 7, starters: ["a"], points: null },
      { roster_id: 2, matchup_id: 7, starters: ["b"] },
    ],
    rosterId: 1,
    week: 3,
  });
  assert.equal(sinJugar.myPoints, null, "null, no 0");
  assert.equal(sinJugar.opponentPoints, null, "undefined tampoco es cero");
});

test("una liga que no publica victorias no tiene récord 0-0", () => {
  const conRosters = (settings) => leagueSnapshotFrom({
    league: { league_id: "L", name: "L", season: "2026", total_rosters: 2, roster_positions: ["QB", "BN"], scoring_settings: { rec: 1 } },
    draft: null,
    rosters: [{ roster_id: 1, owner_id: "u1", players: [], starters: [], settings }],
    users: [{ user_id: "u1", display_name: "yo" }],
    userId: "u1",
    season: 2026,
  });
  assert.equal(conRosters({ wins: null }).teams[0].record, null, "sin victorias reportadas: null");
  assert.equal(conRosters({}).teams[0].record, null);
  assert.deepEqual(conRosters({ wins: 3, losses: 1 }).teams[0].record,
    { wins: 3, losses: 1, ties: 0 });
});
