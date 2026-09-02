/**
 * Identidad y persistencia del estado de draft, por liga y por draft.
 *
 * ## El defecto que esto corrige
 *
 * La versión anterior guardaba TODO bajo una sola clave:
 *
 *     const STORAGE_KEY = "gridiron-draft-v1";
 *
 * Una clave global para todas las ligas. Cambiar de liga sobrescribía la
 * anterior: los jugadores tachados en la liga A seguían tachados en la B, y la
 * plantilla de la A aparecía como plantilla de la B. No fallaba nada — el estado
 * simplemente era el equivocado, que es la peor forma de estar roto.
 *
 * ## La identidad, y por qué lleva tres partes
 *
 *     gridiron-draft-v2:sleeper:<season>:<league_id>:<draft_id>
 *
 * El `draft_id` de Sleeper ya es único por sí solo, así que estrictamente
 * bastaría. Las otras dos partes están **a propósito**, y no por costumbre:
 *
 * - `league_id` hace que la clave sea autodescriptiva al depurar, y convierte un
 *   `draft_id` mal asociado en una clave distinta —o sea, en estado vacío— en
 *   vez de en una mezcla silenciosa de dos ligas.
 * - `season` hace estructuralmente imposible la colisión entre años en una liga
 *   dynasty, que es donde el mismo `league_id` tiene un draft por temporada.
 *
 * Las tres juntas: si CUALQUIERA de ellas difiere, es otro estado. Nunca se
 * fusiona.
 *
 * ## Falla seguro
 *
 * Sin identidad completa NO se persiste. `scopeFor` devuelve `null` y el estado
 * vive sólo en memoria. Perder el estado al recargar es malo; escribirlo en una
 * clave compartida y contaminar otra liga es peor, y además es invisible.
 */

/**
 * El almacenamiento del navegador, o `null` si no lo hay.
 *
 * `window.localStorage` no es una propiedad: es un getter que LANZA
 * `SecurityError` cuando el navegador bloquea el almacenamiento del sitio
 * (Chrome con «bloquear todas las cookies», una política de empresa, algunos
 * modos privados). Leerlo a pelo dentro de un efecto tumbaba la página entera
 * a «This page could not load» en /fantasy, /fantasy/draft, /leagues, /semanal
 * y /betting a la vez — con un navegador perfectamente sano y sin estado
 * guardado, que es justo el caso que el mensaje de error no contemplaba.
 *
 * Todo acceso pasa por aquí. Sin almacenamiento el sitio funciona igual y
 * no recuerda nada entre recargas, y la pantalla lo dice.
 */
export function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    // Algunos navegadores dan el objeto y fallan al USARLO: se prueba una vez.
    storage.getItem("gridiron-probe");
    return storage;
  } catch {
    return null;
  }
}

export const PREFIX = "gridiron-draft-v2";
export const LEGACY_KEY = "gridiron-draft-v1";

/** Preferencia de conexión (última liga usada). NO es estado de draft. */
export const PREFS_KEY = "gridiron-draft-prefs-v1";

export const EMPTY = Object.freeze({ gone: [], mine: [] });

/**
 * La clave de un contexto de draft, o `null` si la identidad está incompleta.
 *
 * El tablero manual —sin Sleeper— tiene su propio ámbito por temporada: no
 * pertenece a ninguna liga, así que meterlo en una sería atribuirle una que no
 * tiene.
 */
export function scopeFor({ platform = "sleeper", season, leagueId, draftId } = {}) {
  if (platform === "local") {
    return season ? `${PREFIX}:local:${season}` : null;
  }
  if (!season || !leagueId || !draftId) return null;
  return `${PREFIX}:${platform}:${season}:${leagueId}:${draftId}`;
}

function normalize(state) {
  // Los ids llegan de `localStorage`, que cualquiera puede editar, y de la API
  // de Sleeper. Se filtra a cadenas y se deduplica: un `null` dentro de `gone`
  // rompería el `Set` de forma difícil de ver.
  const list = (value) =>
    Array.isArray(value)
      ? [...new Set(value.filter((id) => typeof id === "string" && id))]
      : [];
  return { gone: list(state?.gone), mine: list(state?.mine) };
}

export function loadScope(scope, storage) {
  if (!scope || !storage) return { ...EMPTY };
  try {
    const raw = storage.getItem(scope);
    return raw ? normalize(JSON.parse(raw)) : { ...EMPTY };
  } catch {
    // Un almacenamiento corrupto no puede impedirte draftear.
    return { ...EMPTY };
  }
}

export function saveScope(scope, state, storage) {
  if (!scope || !storage) return false;
  try {
    storage.setItem(scope, JSON.stringify(normalize(state)));
    return true;
  } catch {
    /* modo privado o cuota llena: se sigue pudiendo draftear, sin recordar */
    return false;
  }
}

export function loadPrefs(storage) {
  if (!storage) return { league: "", userId: "" };
  try {
    const raw = storage.getItem(PREFS_KEY);
    const prefs = raw ? JSON.parse(raw) : null;
    return {
      league: typeof prefs?.league === "string" ? prefs.league : "",
      userId: typeof prefs?.userId === "string" ? prefs.userId : "",
    };
  } catch {
    return { league: "", userId: "" };
  }
}

export function savePrefs(prefs, storage) {
  if (!storage) return false;
  try {
    storage.setItem(
      PREFS_KEY,
      JSON.stringify({ league: prefs.league ?? "", userId: prefs.userId ?? "" })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Migración desde la clave global v1.
 *
 * El blob v1 trae `{gone, mine, league, userId}` pero **no trae `draft_id`**, y
 * sin él no se puede saber a qué draft pertenecía. Así que los jugadores
 * tachados van al ámbito LOCAL de la temporada —un tablero manual sin liga— y
 * **nunca** a un ámbito de liga.
 *
 * Es deliberado y es la parte importante: atribuirlos a la liga que aparece en
 * el blob parecería más útil y sería exactamente la contaminación que este
 * fichero existe para impedir. Un draft de otra temporada, o el segundo draft de
 * la misma liga, heredaría 40 jugadores tachados que nadie tachó ahí.
 *
 * `league` y `userId` sí se conservan, pero como PREFERENCIA de conexión, que no
 * es estado de draft: recuperan el «con qué liga estabas trabajando» sin mover
 * ni un jugador.
 *
 * La clave v1 se borra al terminar. Si se quedara, cada arranque volvería a
 * migrar y a pisar lo que ya hubiera en el ámbito local.
 */
export function migrateLegacy(storage, season) {
  if (!storage) return { migrated: false, reason: "sin almacenamiento" };
  let raw;
  try {
    raw = storage.getItem(LEGACY_KEY);
  } catch {
    return { migrated: false, reason: "sin almacenamiento" };
  }
  if (!raw) return { migrated: false, reason: "no hay estado v1" };

  let legacy = null;
  try {
    legacy = JSON.parse(raw);
  } catch {
    try { storage.removeItem(LEGACY_KEY); } catch { /* da igual */ }
    return { migrated: false, reason: "estado v1 ilegible" };
  }

  const state = normalize(legacy);
  const scope = scopeFor({ platform: "local", season });
  let moved = 0;
  if (scope && (state.gone.length || state.mine.length)) {
    // Se fusiona con lo que ya hubiera en el ámbito local en vez de pisarlo.
    const existing = loadScope(scope, storage);
    const merged = {
      gone: [...new Set([...existing.gone, ...state.gone])],
      mine: [...new Set([...existing.mine, ...state.mine])],
    };
    saveScope(scope, merged, storage);
    moved = state.gone.length + state.mine.length;
  }

  if (typeof legacy?.league === "string" && legacy.league) {
    const prefs = loadPrefs(storage);
    if (!prefs.league) {
      savePrefs({ league: legacy.league, userId: legacy.userId ?? "" }, storage);
    }
  }

  try { storage.removeItem(LEGACY_KEY); } catch { /* da igual */ }
  return { migrated: true, moved, scope };
}

/* ===========================================================================
   REGISTRO DE PICKS (v3)
   ---------------------------------------------------------------------------
   El estado de draft pasa de dos listas de ids a un registro de eventos. La
   clave de ámbito es la MISMA que en v2 —temporada, liga y draft— con otro
   sufijo, así que el aislamiento entre ligas que demuestra E14 se conserva tal
   cual: dos ligas distintas siguen sin poder compartir clave.
   =========================================================================== */

export const LOG_SUFFIX = "log";

/**
 * La liga configurada en el Draft Room. La escribe la antesala y la lee también
 * el board: es el CONTEXTO ACTIVO, no una preferencia de una pantalla.
 */
export const ROOM_LEAGUE_KEY = "gridiron-room-league-v1";

/* ===========================================================================
   CATÁLOGO DE LIGAS
   ---------------------------------------------------------------------------
   Hasta ahora sólo persistía UNA configuración: la de la liga activa del Draft
   Room, que se sobreescribía al cambiar de liga. Lo único durable por liga eran
   los registros de picks, cuyas claves llevan la identidad pero no el nombre ni
   la estructura. Un centro de mando multi-liga necesita las dos cosas.

   El catálogo guarda la configuración POR IDENTIDAD (la misma tripleta que
   aísla los registros: plataforma, temporada, liga, draft). Se escribe al
   entrar en una liga y nunca borra a las demás. Una liga con registro pero sin
   entrada de catálogo existe igualmente — con configuración UNKNOWN, que es la
   verdad, no un hueco.
   =========================================================================== */

export const LEAGUES_KEY = "gridiron-leagues-v1";

export function loadCatalog(storage) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(LEAGUES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLeagueToCatalog(league, storage) {
  const scope = scopeFor({
    platform: league?.platform, season: league?.season,
    leagueId: league?.leagueId, draftId: league?.draftId,
  });
  if (!scope || !storage) return false;
  try {
    const catalog = loadCatalog(storage);
    catalog[scope] = { ...league, savedAt: Date.now() };
    storage.setItem(LEAGUES_KEY, JSON.stringify(catalog));
    return true;
  } catch {
    return false;
  }
}

/**
 * La identidad que hay dentro de una clave de registro, o `null`.
 *
 * Es el camino de vuelta: un registro sin catálogo sigue siendo una liga real
 * de la que se sabe la identidad y el estado del draft, y nada más. Los ids
 * generados no llevan dos puntos, así que la partición es exacta; una clave que
 * no cuadre devuelve `null` en vez de una identidad a medias.
 */
export function parseLogKey(key) {
  if (typeof key !== "string" || !key.startsWith(`${PREFIX}:`) || !key.endsWith(`:${LOG_SUFFIX}`)) {
    return null;
  }
  const middle = key.slice(PREFIX.length + 1, -(LOG_SUFFIX.length + 1));
  const parts = middle.split(":");
  if (parts[0] === "local" && parts.length === 2) {
    const season = Number(parts[1]);
    return Number.isFinite(season) ? { platform: "local", season } : null;
  }
  if (parts.length !== 4) return null;
  const season = Number(parts[1]);
  if (!Number.isFinite(season) || !parts[0] || !parts[2] || !parts[3]) return null;
  return { platform: parts[0], season, leagueId: parts[2], draftId: parts[3] };
}

/**
 * Todas las ligas conocidas: catálogo y registros, fundidos por identidad.
 *
 * Cada entrada dice de dónde sale lo que afirma: `config` (del catálogo, puede
 * faltar) y `hasLog`. El tablero local por temporada también aparece — es un
 * contexto real de draft — marcado como tal.
 */
export function knownLeagues(storage) {
  if (!storage) return [];
  const catalog = loadCatalog(storage);
  const byScope = new Map();
  for (const [scope, config] of Object.entries(catalog)) {
    byScope.set(scope, { scope, identity: parseLogKey(`${scope}:${LOG_SUFFIX}`), config, hasLog: false });
  }
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      const identity = parseLogKey(key);
      if (!identity) continue;
      const scope = key.slice(0, -(LOG_SUFFIX.length + 1));
      const entry = byScope.get(scope);
      if (entry) entry.hasLog = true;
      else byScope.set(scope, { scope, identity, config: null, hasLog: true });
    }
  } catch { /* un almacenamiento sin .key() no puede tumbar la página */ }
  return [...byScope.values()].filter((entry) => entry.identity);
}

export function loadRoomLeague(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ROOM_LEAGUE_KEY);
    const league = raw ? JSON.parse(raw) : null;
    return league && typeof league === "object" ? league : null;
  } catch {
    return null;
  }
}

/**
 * En qué draft estoy, mire la pantalla que mire.
 *
 * Sin esto la convergencia no existe: el board sin conectar caía en el ámbito
 * LOCAL de la temporada y el Draft Room en el de su liga manual, así que las dos
 * pantallas hablaban de dos drafts distintos y las dos tenían razón.
 *
 * La precedencia es fija y no depende de qué pantalla pregunte:
 *
 * 1. Un draft de Sleeper conectado. Es la identidad más fuerte que hay: la trae
 *    el proveedor y no se la ha inventado nadie.
 * 2. La liga configurada en el Draft Room, si su identidad está completa.
 * 3. El ámbito LOCAL de la temporada — el tablero manual sin liga.
 *
 * Lo que NO hace es fusionar. Si estás conectado a Sleeper y además tienes una
 * liga manual configurada, son dos contextos y siguen siéndolo: uno gana, el
 * otro se queda intacto donde está. Mezclarlos sería la contaminación que E14
 * existe para impedir, sólo que por una puerta nueva.
 */
export function activeIdentity({ storage, season, sleeperDraft = null, leagueId = "" } = {}) {
  if (sleeperDraft?.draft_id && leagueId) {
    return {
      platform: "sleeper",
      season: Number(sleeperDraft.season) || season,
      leagueId,
      draftId: sleeperDraft.draft_id,
    };
  }
  const room = loadRoomLeague(storage);
  if (room?.leagueId && room?.draftId) {
    return {
      platform: room.platform || "manual",
      season,
      leagueId: String(room.leagueId),
      draftId: String(room.draftId),
      name: room.name || "",
    };
  }
  return { platform: "local", season };
}

/** La clave del registro de un contexto. `null` si la identidad está incompleta. */
export function logScopeFor(identity) {
  const scope = scopeFor(identity);
  return scope ? `${scope}:${LOG_SUFFIX}` : null;
}

function sanitizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const { kind, playerId, at, seq } = event;
  if (kind !== "TAKE" && kind !== "UNDO") return null;
  if (typeof playerId !== "string" || !playerId) return null;
  if (!Number.isFinite(at) || !Number.isFinite(seq)) return null;
  return event;
}

export function loadLog(scope, storage) {
  if (!scope || !storage) return [];
  try {
    const raw = storage.getItem(scope);
    const parsed = raw ? JSON.parse(raw) : [];
    // Un evento corrupto se descarta en vez de tumbar el draft entero: en medio
    // de una ronda, perder un pick es malo y perder la pantalla es peor.
    return Array.isArray(parsed) ? parsed.map(sanitizeEvent).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveLog(scope, events, storage) {
  if (!scope || !storage) return false;
  try {
    storage.setItem(scope, JSON.stringify(events));
    return true;
  } catch {
    return false;
  }
}

/**
 * Migración del estado v2 (`{gone, mine}`) al registro.
 *
 * Se pierde información que v2 nunca tuvo —el orden real, la hora, el puesto—
 * y **eso se dice** en el evento: `rosterSource: "MIGRATED"` y un `at`
 * sintético anterior a cualquier pick nuevo. Inventar números de pick para que
 * pareciera un registro completo sería fabricar un historial.
 */
export function migrateMarksToLog(marks, { at = 0 } = {}) {
  const events = [];
  let seq = 0;
  const push = (playerId, roster) => {
    seq += 1;
    events.push({
      kind: "TAKE", playerId, roster, rosterSource: "MIGRATED",
      overall: null, source: "MANUAL", providerId: null, at, seq,
    });
  };
  for (const id of marks?.mine ?? []) push(id, "MINE");
  for (const id of marks?.gone ?? []) push(id, "OPPONENT");
  return events;
}

/**
 * El registro de un ámbito, migrando las marcas v2 si todavía no lo hay.
 *
 * Es el ÚNICO sitio por el que las dos pantallas leen su estado, y por eso está
 * aquí y no en cada una: cuando el board y el Draft Room resolvían por su cuenta
 * qué heredar, cada uno se construía su propia versión del mismo draft.
 *
 * La clave vieja se borra al migrar, y esa línea es la que hace la migración
 * idempotente. Si se quedara, «empezar de cero» vaciaría el registro y las
 * marcas volverían enteras en la siguiente recarga — un reinicio que no
 * reinicia es peor que no tener botón.
 */
export function loadOrMigrateLog(scope, storage) {
  if (!scope || !storage) return [];
  const existing = loadLog(scope, storage);
  if (existing.length > 0) return existing;

  const marksKey = scope.slice(0, -(LOG_SUFFIX.length + 1));
  let raw = null;
  try {
    raw = storage.getItem(marksKey);
  } catch {
    return [];
  }
  if (!raw) return [];

  const events = migrateMarksToLog(loadScope(marksKey, storage));
  if (events.length > 0) saveLog(scope, events, storage);
  try { storage.removeItem(marksKey); } catch { /* da igual */ }
  return events;
}
