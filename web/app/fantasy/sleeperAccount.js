/**
 * La cuenta de Sleeper, traducida: de lo que devuelve la API a lo que el
 * producto ya sabe consumir (una entrada de catálogo por liga, una plantilla
 * resuelta contra el board, un mock draft que se puede seguir).
 *
 * ## Sin red y sin React, a propósito
 *
 * Aquí no hay `fetch`: las peticiones viven en `useSleeperDraft.js`, que es el
 * ÚNICO adaptador de Sleeper del sitio y el único fichero (con `DraftMode.jsx`)
 * donde CI permite que aparezca la palabra. Este módulo recibe los objetos ya
 * bajados y los traduce, y por eso se puede probar con `node --test` sin
 * levantar nada.
 *
 * ## «Linkear la cuenta» no es iniciar sesión
 *
 * La API de Sleeper es pública y de sólo lectura: con el nombre de usuario se
 * obtiene el `user_id`, con el `user_id` las ligas de la temporada, y con cada
 * liga sus plantillas, sus usuarios y sus drafts. No hay OAuth, no hay clave,
 * no hay contraseña y nada sale del navegador salvo el nombre de usuario, que
 * ya es público en la propia URL de Sleeper. Se guarda en `localStorage` para
 * no teclearlo dos veces, y ya.
 *
 * ## Un mock draft no tiene liga
 *
 * Sleeper devuelve los mocks en `/user/{id}/drafts/nfl/{season}` con
 * `league_id: null`. El Draft Room se ata a `{league, draft, temporada}` y sin
 * liga no hay clave, así que un mock recibe una liga SINTÉTICA `draft-<id>` que
 * existe sólo para aislar su estado del de cualquier otra cosa (regla 6). Su
 * configuración sale de `draft.settings` (huecos) y de
 * `draft.metadata.scoring_type` (puntuación) — y lo que no venga queda UNKNOWN.
 *
 * ## Frescura
 *
 * Una plantilla cambia con los waivers, o sea a diario; no cada quince segundos
 * como un draft. La ventana es de dominio y se declara aquí: pasada, la
 * interfaz dice STALE y ofrece refrescar. Nunca escribe LIVE: nada de esta
 * pantalla se está sincronizando de verdad.
 */

import { numberOrNull } from "../numbers.js";
import { mySlot } from "./draftSync.js";
import { DEFAULT_RULES, rulesFromSleeper, scoringLabel } from "./scoring.js";

export const ACCOUNT_KEY = "gridiron-sleeper-account-v1";

// Seis horas. Los waivers se procesan de madrugada y una plantilla no cambia
// más de una o dos veces al día; a partir de aquí lo que se enseña puede no
// ser lo que hay en Sleeper y se dice.
export const ROSTER_STALE_MS = 6 * 60 * 60 * 1000;

/** `scoring_type` de un mock -> puntos por recepción. Lo que no está, UNKNOWN. */
export const MOCK_SCORING = Object.freeze({ ppr: 1, half_ppr: 0.5, std: 0, standard: 0 });

// `draft.settings.slots_*` -> nombre de hueco tal y como lo entiende
// `rosterContext`. Los IDP se traducen a nombres que el compilador NO soporta a
// propósito: una liga con defensivos individuales no puede recibir un board de
// reemplazo calculado como si no los tuviera.
const DRAFT_SLOTS = Object.freeze({
  slots_qb: "QB", slots_rb: "RB", slots_wr: "WR", slots_te: "TE",
  slots_flex: "FLEX", slots_super_flex: "SUPER_FLEX",
  slots_wrrb_flex: "WRRB_FLEX", slots_rec_flex: "REC_FLEX",
  slots_k: "K", slots_def: "DEF", slots_bn: "BN",
  slots_dl: "DL", slots_lb: "LB", slots_db: "DB", slots_idp_flex: "IDP_FLEX",
});

export const DRAFT_STATUS_LABEL = Object.freeze({
  pre_draft: "Draft not started",
  drafting: "Drafting",
  paused: "Draft paused",
  complete: "Draft complete",
});

export function isMock(draft) {
  return Boolean(draft) && (draft.league_id === null || draft.league_id === undefined);
}

/** La liga sintética de un mock. Sólo para aislar su estado; no existe en Sleeper. */
export function mockLeagueId(draftId) {
  return draftId ? `draft-${draftId}` : null;
}

export function isMockLeagueId(leagueId) {
  return typeof leagueId === "string" && leagueId.startsWith("draft-");
}

/**
 * Los huecos de un draft desde `draft.settings`. `null` si no publica ninguno:
 * sin huecos no se inventa una alineación estándar.
 */
export function rosterFromDraftSettings(settings) {
  if (!settings || typeof settings !== "object") return null;
  const out = [];
  let any = false;
  for (const [key, slot] of Object.entries(DRAFT_SLOTS)) {
    if (!Object.hasOwn(settings, key)) continue;
    any = true;
    const n = Number(settings[key]);
    for (let i = 0; i < (Number.isFinite(n) ? n : 0); i += 1) out.push(slot);
  }
  return any ? out : null;
}

/**
 * Un `scoring_settings` sintético para un mock, con la forma que ya entiende
 * `rulesFromSleeper`. `null` si el tipo no está en la tabla: se dice UNKNOWN,
 * no «PPR».
 */
export function mockScoringSettings(draft) {
  const type = draft?.metadata?.scoring_type;
  const rec = MOCK_SCORING[String(type ?? "").toLowerCase()];
  return rec === undefined ? null : { rec };
}

/** El identificador corto de la puntuación que usa el configurador manual. */
function scoringIdFrom(rules) {
  if (!rules) return null;
  if (rules.reception === 1) return "ppr";
  if (rules.reception === 0.5) return "half";
  if (rules.reception === 0) return "standard";
  return null;
}

/** El roster del usuario entre los de la liga, por `owner_id` o co-dueño. */
export function myRosterOf(rosters, userId) {
  if (!Array.isArray(rosters) || !userId) return null;
  const id = String(userId);
  return rosters.find((r) =>
    String(r?.owner_id) === id
      || (Array.isArray(r?.co_owners) && r.co_owners.map(String).includes(id))) ?? null;
}

/**
 * La entrada de catálogo de una liga (o de un mock) de Sleeper.
 *
 * Es la MISMA forma que escribe la antesala del Draft Room, con `rosterSource`
 * SLEEPER y `providerBacked`. Lo que Sleeper no publica queda `null`, que la
 * interfaz escribe como UNKNOWN; nunca 12 equipos PPR.
 */
export function leagueConfigFrom({ league = null, draft = null, userId = null, rosterId = null, season }) {
  if (!league && !draft) return null;
  const mock = !league && isMock(draft);
  const draftId = draft?.draft_id ?? league?.draft_id ?? null;
  const leagueId = league?.league_id ?? (mock ? mockLeagueId(draftId) : draft?.league_id) ?? null;
  const scoringSettings = league?.scoring_settings ?? (mock ? mockScoringSettings(draft) : null);
  const parsed = scoringSettings ? rulesFromSleeper(scoringSettings) : null;
  const rules = parsed?.supported ? parsed.rules : null;
  const roster = Array.isArray(league?.roster_positions) && league.roster_positions.length > 0
    ? league.roster_positions
    : rosterFromDraftSettings(draft?.settings);
  const teams = Number(draft?.settings?.teams ?? league?.total_rosters) || null;
  const type = typeof draft?.type === "string" ? draft.type : null;
  return {
    name: league?.name ?? draft?.metadata?.name ?? (mock ? `Mock draft ${draftId}` : null),
    platform: "sleeper",
    userId: userId ? String(userId) : "",
    leagueId: leagueId ? String(leagueId) : null,
    draftId: draftId ? String(draftId) : null,
    season: Number(draft?.season ?? league?.season ?? season) || (season ?? null),
    teams,
    rounds: Number(draft?.settings?.rounds) || null,
    draftType: type === "snake" || type === "linear" || type === "auction" ? type : null,
    mySlot: draft ? mySlot({ draft, userId, rosterId }) : null,
    roster: roster ?? null,
    rosterSource: roster ? "SLEEPER" : null,
    scoring: scoringIdFrom(rules),
    scoringLabel: rules ? scoringLabel(rules) : null,
    scoringSettings: scoringSettings ?? null,
    status: draft?.status ?? league?.status ?? null,
    isMock: mock,
    providerBacked: true,
    // Puro dato: `rules` sale de `rulesFromSleeper`, con sus no soportados.
    unsupportedScoring: parsed && !parsed.supported ? parsed.reason ?? "unsupported scoring" : null,
  };
}

/**
 * Índice de identidad: `sleeper_id` -> fila del pool.
 *
 * El mapa viaja HORNEADO en el payload (`fantasy.sleeper_ids`). Resolver por
 * identificador es lo único correcto: el nombre abreviado no distingue a los
 * dos «B.Robinson» de Atlanta. Sin mapa no hay resolución por nombre de
 * repuesto: el jugador queda UNMAPPED y se dice.
 *
 * Vive aquí y lo importa el adaptador: UNA implementación para el draft en vivo
 * y para la plantilla, no dos traductores del mismo mapa.
 */
/**
 * El POOL sobre el que se resuelve un pick: el board más los especialistas y
 * los novatos.
 *
 * Existe como función compartida porque las dos pantallas que sincronizan
 * —el board de `/fantasy` y el Draft Room— lo construían por su cuenta y **no
 * igual**: el Draft Room sumaba pateadores, defensas y novatos, y el board
 * pasaba sólo el board. En el board, entonces, el pick de una defensa o de un
 * pateador salía UNMAPPED y NO se tachaba, en la ronda donde todo el mundo
 * ficha justo eso. Es el fallo de los dos traductores del mismo formato, por
 * quinta vez en este proyecto, y aquí decidía si tu tablero refleja el draft.
 *
 * Un novato sin `sleeper_id` en el mapa horneado sigue saliendo UNMAPPED: eso
 * es cobertura del mapa, no de esta lista, y se cuenta y se dice.
 */
export function syncPool(board, context) {
  const s = context?.specialists;
  return [
    ...(Array.isArray(board) ? board : []),
    ...(s?.kickers ?? []),
    ...(s?.defenses ?? []),
    ...(context?.rookies ?? []),
  ];
}

export function buildIndex(pool, idMap) {
  const byPlayerId = new Map();
  for (const row of pool ?? []) byPlayerId.set(String(row.player_id), row);
  const index = new Map();
  for (const [sleeperId, playerId] of Object.entries(idMap ?? {})) {
    const row = byPlayerId.get(String(playerId));
    if (row) index.set(String(sleeperId), row);
  }
  return index;
}

const POSITION_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5, DST: 5 };

/**
 * Mi plantilla en una liga, resuelta contra el board.
 *
 * `players` son las filas del pool que Sleeper dice que tengo, ordenadas por
 * posición y valor; `unmapped` los ids que el mapa horneado no conoce (se
 * cuentan y se enseñan como ids, no se adivinan). `hasDefense` y `hasKicker`
 * son HECHOS de la plantilla: «ya cogiste defensa» es la pregunta que se hace
 * en la última ronda, y se contesta con lo que hay, no con lo que conviene.
 */
export function rosterView({ roster, index }) {
  const ids = Array.isArray(roster?.players) ? roster.players.map(String) : [];
  const starters = new Set(Array.isArray(roster?.starters) ? roster.starters.map(String) : []);
  const players = [];
  const unmapped = [];
  for (const id of ids) {
    const row = index?.get(id);
    if (row) players.push({ ...row, sleeper_id: id, starter: starters.has(id) });
    else unmapped.push(id);
  }
  players.sort((a, b) =>
    (POSITION_ORDER[a.position] ?? 9) - (POSITION_ORDER[b.position] ?? 9)
    || (Number(b.vor) || 0) - (Number(a.vor) || 0)
    || String(a.player_name).localeCompare(String(b.player_name)));
  const counts = {};
  for (const row of players) counts[row.position] = (counts[row.position] ?? 0) + 1;
  return {
    players,
    unmapped,
    counts,
    total: ids.length,
    hasDefense: players.some((row) => row.position === "DEF" || row.position === "DST"),
    hasKicker: players.some((row) => row.position === "K"),
  };
}

/** Los mocks de la temporada entre los drafts de un usuario, el más nuevo primero. */
export function mockDrafts(drafts, season) {
  const wanted = season == null ? null : String(season);
  return (Array.isArray(drafts) ? drafts : [])
    .filter((d) => isMock(d) && (!wanted || String(d.season ?? wanted) === wanted))
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
}

/** Frescura de una instantánea de cuenta, con la ventana de PLANTILLA. */
export function accountFreshness(retrievedAt, now = Date.now()) {
  if (!retrievedAt) return "UNKNOWN";
  const age = now - retrievedAt;
  if (age < 0) return "UNKNOWN";
  return age <= ROSTER_STALE_MS ? "CURRENT" : "STALE";
}

/**
 * LA LIGA ACTIVA, una para todo el producto.
 *
 * Antes cada pantalla se acordaba de la suya: el semanal guardaba
 * `gridiron-weekly-league-v1` y el analizador habría guardado otra clave. Eso
 * es exactamente el fallo que ya costó una iteración con el estado del draft —
 * dos superficies que hablan de lo mismo con su propia copia, las dos con
 * razón, y ninguna forma de saber cuál mira el que lee. Una clave, y las
 * pantallas la comparten.
 *
 * La clave vieja se sigue leyendo como respaldo para no perder la liga que ya
 * tuvieras elegida; se escribe siempre en la nueva.
 */
export const ACTIVE_LEAGUE_KEY = "gridiron-active-league-v1";
const LEGACY_LEAGUE_KEY = "gridiron-weekly-league-v1";

export function loadActiveLeagueId(storage) {
  if (!storage) return "";
  try {
    return storage.getItem(ACTIVE_LEAGUE_KEY) ?? storage.getItem(LEGACY_LEAGUE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveActiveLeagueId(storage, leagueId) {
  if (!storage) return;
  try { storage.setItem(ACTIVE_LEAGUE_KEY, String(leagueId ?? "")); } catch { /* privado */ }
}

export function loadAccount(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACCOUNT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && parsed.username ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAccount(account, storage) {
  if (!storage || !account?.username) return false;
  try {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    return true;
  } catch {
    return false;
  }
}

export function clearAccount(storage) {
  try { storage?.removeItem(ACCOUNT_KEY); } catch { /* modo privado */ }
}

/**
 * La instantánea que se persiste por liga: sólo IDENTIFICADORES y hechos.
 *
 * Las filas del board no se guardan —se resuelven al pintar contra el payload
 * vigente— para que un payload nuevo no deje una plantilla vieja congelada
 * con el VOR de la semana pasada.
 */
export function leagueSnapshotFrom({ league, draft, rosters, users, userId, season, matchups = null, week = null }) {
  const mine = myRosterOf(rosters, userId);
  const config = leagueConfigFrom({
    league, draft, userId, rosterId: mine?.roster_id ?? null, season,
  });
  const owners = {};
  for (const u of Array.isArray(users) ? users : []) {
    if (u?.user_id) owners[String(u.user_id)] = u.metadata?.team_name || u.display_name || String(u.user_id);
  }
  const record = registro(mine?.settings);
  // TODAS las plantillas, por identificador: es lo que permite decir en el
  // ranking semanal quién es mío, quién es agente libre y quién es de quién,
  // y medir la profundidad de cada equipo. Sólo ids: unos 200 por liga.
  const teams = Array.isArray(rosters) ? rosters.map((r) => ({
    rosterId: r?.roster_id ?? null,
    ownerId: r?.owner_id != null ? String(r.owner_id) : null,
    owner: r?.owner_id != null ? (owners[String(r.owner_id)] ?? String(r.owner_id)) : null,
    players: Array.isArray(r?.players) ? r.players.map(String) : [],
    starters: Array.isArray(r?.starters) ? r.starters.map(String) : [],
    record: registro(r?.settings),
  })) : null;
  return {
    leagueId: config?.leagueId ?? null,
    draftId: config?.draftId ?? null,
    name: config?.name ?? null,
    config,
    rosterId: mine?.roster_id ?? null,
    players: Array.isArray(mine?.players) ? mine.players.map(String) : null,
    starters: Array.isArray(mine?.starters) ? mine.starters.map(String) : null,
    record,
    owners,
    rosterCount: Array.isArray(rosters) ? rosters.length : null,
    teams,
    matchup: matchupFrom({ matchups, rosterId: mine?.roster_id ?? null, week }),
  };
}

/**
 * Mi enfrentamiento de la semana desde `/league/{id}/matchups/{week}`.
 *
 * Sleeper devuelve una entrada por roster con `matchup_id`; los dos con el
 * mismo id se enfrentan. Devuelve el roster rival y los titulares que cada
 * uno tiene ALINEADOS esa semana (por id), o `null` si no se puede establecer
 * — una semana de descanso, sin matchups todavía, o sin mi roster.
 */
export function matchupFrom({ matchups, rosterId, week }) {
  if (!Array.isArray(matchups) || rosterId == null) return null;
  const mine = matchups.find((m) => String(m?.roster_id) === String(rosterId));
  if (!mine || mine.matchup_id == null) return null;
  const rival = matchups.find((m) =>
    String(m?.matchup_id) === String(mine.matchup_id) && String(m?.roster_id) !== String(rosterId));
  return {
    week: week ?? null,
    matchupId: String(mine.matchup_id),
    myStarters: Array.isArray(mine.starters) ? mine.starters.map(String) : [],
    myPoints: numberOrNull(mine.points),
    opponentRosterId: rival?.roster_id ?? null,
    opponentStarters: Array.isArray(rival?.starters) ? rival.starters.map(String) : [],
    opponentPoints: rival ? numberOrNull(rival.points) : null,
  };
}

/**
 * Quién tiene a cada jugador en una liga: `sleeper_id` -> rosterId.
 * Un id que no está en ningún roster es AGENTE LIBRE en esa liga.
 */
export function ownershipOf(snapshot) {
  const map = new Map();
  for (const team of snapshot?.teams ?? []) {
    for (const id of team.players ?? []) map.set(String(id), team.rosterId);
  }
  return map;
}

/** MINE / FREE_AGENT / TAKEN (con el rosterId del dueño), por id. */
export function ownershipLabel({ ownership, sid, myRosterId }) {
  if (!sid || !ownership) return null;
  const owner = ownership.get(String(sid));
  if (owner === undefined) return { status: "FREE_AGENT", rosterId: null };
  if (myRosterId != null && String(owner) === String(myRosterId)) return { status: "MINE", rosterId: owner };
  return { status: "TAKEN", rosterId: owner };
}

export const DEFAULT_RULES_FOR_TESTS = DEFAULT_RULES;


/**
 * El récord de un equipo, o `null` si la liga no lo publica.
 *
 * `Number.isFinite(Number(x))` NO sirve para «¿hay dato?»: `Number(null)` y
 * `Number("")` valen CERO, que es finito, así que una liga sin victorias
 * reportadas —o antes de la jornada 1— salía como 0-0-0 con la misma
 * autoridad que un récord medido. Es la QUINTA vez que esta conversión cuela
 * un hueco por dato en este repositorio; el helper existe justo para eso.
 */
function registro(settings) {
  const wins = numberOrNull(settings?.wins);
  if (wins === null) return null;
  return {
    wins,
    losses: numberOrNull(settings?.losses) ?? 0,
    ties: numberOrNull(settings?.ties) ?? 0,
  };
}
