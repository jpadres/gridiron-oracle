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
