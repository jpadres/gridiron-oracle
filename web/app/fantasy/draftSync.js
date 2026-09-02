/**
 * Estado de sincronización del draft: qué se puede decir y cuándo.
 *
 * ## El defecto que esto corrige
 *
 * La versión anterior hacía:
 *
 *     setStatus({ state: "live", at: Date.now(), … });
 *
 * `live` se fijaba en CUALQUIER sondeo con éxito y **no caducaba nunca**. El
 * `at` se guardaba y no se pintaba en ninguna parte, y la pantalla prometía
 * «refresca cada 15 segundos» — una promesa, no una observación. Si la pestaña
 * se iba al fondo y el navegador estrangulaba el intervalo, la pantalla seguía
 * diciendo `live` sobre datos de hace minutos. En un draft en directo, dos
 * minutos son cuatro picks.
 *
 * ## Las ventanas
 *
 * Son las mismas que `Domain.DRAFT_STATE` en `src/oracle/freshness.py`, y están
 * duplicadas aquí a propósito: el navegador no puede importar Python, y meterlas
 * en el payload las congelaría en el momento del build. Si se cambian allí, hay
 * que cambiarlas aquí — lo comprueba `tests/draftSync.test.mjs`.
 *
 * ## LIVE exige TRES condiciones, no una
 *
 * 1. el último sondeo fue correcto,
 * 2. hace menos de 30 segundos,
 * 3. y el draft está `drafting` según Sleeper.
 *
 * La tercera es la que impide sondear un draft terminado hace tres semanas y
 * pintarlo como si estuviera vivo.
 */

export const LIVE_MS = 30_000;
export const CURRENT_MS = 120_000;
export const RECENT_MS = 600_000;

/** Lo que Sleeper devuelve en `draft.status`. */
export const DRAFT_STATUS = {
  PRE: "pre_draft",
  DRAFTING: "drafting",
  COMPLETE: "complete",
  PAUSED: "paused",
};

/**
 * Etiqueta de frescura a partir de la edad del último sondeo correcto.
 * `UNKNOWN` cuando no hay ninguno: nunca se degrada a algo más optimista.
 */
export function freshness(lastSyncAt, now = Date.now()) {
  if (!lastSyncAt) return "UNKNOWN";
  const age = now - lastSyncAt;
  // Un `at` en el futuro significa reloj mal puesto, no «fresquísimo». La
  // comparación ingenua daría edad negativa y por tanto LIVE.
  if (age < 0) return "UNKNOWN";
  if (age <= LIVE_MS) return "LIVE";
  if (age <= CURRENT_MS) return "CURRENT";
  if (age <= RECENT_MS) return "RECENT";
  return "STALE";
}

/** «hace 8 s», «hace 4 min». Nunca una promesa de lo que va a pasar. */
export function agoLabel(lastSyncAt, now = Date.now()) {
  if (!lastSyncAt) return "never";
  const seconds = Math.max(0, Math.round((now - lastSyncAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/**
 * Lo que la interfaz puede decir, dado el estado técnico real.
 *
 * `canRecommend` es la decisión importante: con el estado del draft viejo NO se
 * recomienda un pick, porque el jugador que se sugiera puede llevar cuatro
 * picks fuera del tablero.
 */
export function syncState({
  connected, error, lastSyncAt, draftStatus, syncing = false, now = Date.now(),
}) {
  if (!connected) {
    return {
      level: "OFFLINE", label: "Not connected",
      detail: "Manual board. Cross players off as they go.",
      canRecommend: true,
    };
  }
  if (error) {
    return {
      level: "ERROR", label: "Sync error", detail: error,
      // El tablero manual sigue siendo válido: lo sincronizado hasta ahora no
      // se pierde, sólo deja de actualizarse.
      canRecommend: true,
    };
  }
  if (draftStatus === DRAFT_STATUS.COMPLETE) {
    return {
      level: "COMPLETE", label: "Draft complete",
      detail: "This draft is finished. Shown as history.",
      canRecommend: false,
    };
  }
  if (draftStatus === DRAFT_STATUS.PRE) {
    return {
      level: "PRE", label: "Draft not started",
      detail: "Pre-draft. Picks appear once it starts.",
      canRecommend: true,
    };
  }

  const level = freshness(lastSyncAt, now);
  const ago = agoLabel(lastSyncAt, now);
  if (level === "UNKNOWN") {
    // SYNCING y «no verificado» NO son lo mismo. El primero dice que hay una
    // petición en vuelo y todavía no ha vuelto —el estado normal de los dos
    // primeros segundos y el de una reconexión—; el segundo, que no hay nada y
    // nadie está intentándolo. Fundirlos hacía que reconectar pareciera un
    // fallo. Ninguno de los dos permite recomendar: no hay evidencia todavía.
    if (syncing) {
      return {
        level: "SYNCING", label: "Syncing",
        detail: "Reading the draft from Sleeper\u2026",
        canRecommend: false,
      };
    }
    return {
      level: "UNKNOWN", label: "Not verified",
      detail: "No successful sync yet.",
      canRecommend: false,
    };
  }
  if (level === "LIVE" && draftStatus === DRAFT_STATUS.DRAFTING) {
    // El único sitio del producto donde se escribe LIVE.
    return { level: "LIVE", label: "Live", detail: `Synced ${ago}`, canRecommend: true };
  }
  if (level === "STALE") {
    return {
      level: "STALE", label: "Stale",
      detail: `Last sync ${ago}. Refresh before picking.`,
      canRecommend: false,
    };
  }
  // Si el sondeo es reciente pero Sleeper NO dice `drafting`, la frescura por sí
  // sola vale LIVE y aquí se degrada a CURRENT a propósito: sin confirmar que el
  // draft está en curso no se puede afirmar que algo esté pasando en directo.
  // Sin esta línea, un `status` desconocido se colaba como LIVE por el último
  // return — que es el fallo exacto que encontró el test.
  const shown = level === "LIVE" ? "CURRENT" : level;
  return {
    level: shown, label: `Last sync ${ago}`,
    detail: draftStatus === DRAFT_STATUS.PAUSED ? "Draft paused." : "",
    canRecommend: true,
  };
}

/**
 * Mi puesto de draft, desde `draft_order` y `slot_to_roster_id`.
 *
 * Sleeper publica los dos y hasta ahora no se leía ninguno. `draft_order` mapea
 * `user_id -> slot`; es lo directo. `slot_to_roster_id` mapea `slot -> roster`,
 * y sirve cuando lo que se conoce es el roster.
 *
 * Devuelve `null` —no un 1— cuando no se puede establecer. Un puesto inventado
 * produce un calendario de picks inventado, que es peor que no tenerlo.
 */
export function mySlot({ draft, userId, rosterId }) {
  if (!draft) return null;
  const order = draft.draft_order;
  if (order && userId && Object.hasOwn(order, String(userId))) {
    const slot = Number(order[String(userId)]);
    if (Number.isInteger(slot) && slot > 0) return slot;
  }
  const slots = draft.slot_to_roster_id;
  if (slots && rosterId != null) {
    for (const [slot, roster] of Object.entries(slots)) {
      if (String(roster) === String(rosterId)) {
        const value = Number(slot);
        if (Number.isInteger(value) && value > 0) return value;
      }
    }
  }
  return null;
}

/**
 * Los números de pick de un puesto, ronda a ronda.
 *
 * **El tipo de draft se lee, no se supone.** `snake` invierte en las rondas
 * pares; `linear` no. Codificar snake porque «casi todos lo son» daría a un
 * draft lineal un calendario equivocado a partir de la ronda 2, y equivocado de
 * forma plausible, que es la peor.
 *
 * Las subastas no tienen turno: devuelven lista vacía en vez de un número.
 */
export function pickSchedule({ slot, teams, rounds, type }) {
  if (!slot || !teams || !rounds) return [];
  if (type !== "snake" && type !== "linear") return [];
  const picks = [];
  for (let round = 1; round <= rounds; round += 1) {
    const inRound = type === "snake" && round % 2 === 0 ? teams - slot + 1 : slot;
    picks.push({
      round,
      pick: inRound,
      overall: (round - 1) * teams + inRound,
      label: `${round}.${String(inRound).padStart(2, "0")}`,
    });
  }
  return picks;
}

/**
 * Cuánto queda del pick en curso, en segundos, desde lo que publica Sleeper.
 *
 * `draft.last_picked` es la hora (ms) del último pick y `settings.pick_timer`
 * los segundos por pick. El reloj se DERIVA en cada render de esos dos datos y
 * de la hora actual: no se guarda ni se cuenta hacia atrás por su cuenta, así
 * que un sondeo nuevo lo corrige solo. `null` si falta cualquiera de los dos:
 * un reloj inventado es peor que ninguno.
 *
 * La hora de Sleeper y la del navegador pueden discrepar unos segundos; por
 * eso la interfaz lo enseña como aproximado y sólo con la conexión en LIVE.
 */
export function pickClock({ draft, now = Date.now() }) {
  const last = Number(draft?.last_picked);
  const timer = Number(draft?.settings?.pick_timer);
  if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(timer) || timer <= 0) return null;
  const elapsed = Math.floor((now - last) / 1000);
  if (elapsed < 0) return { remaining: timer, total: timer, expired: false };
  const remaining = Math.max(0, timer - elapsed);
  return { remaining, total: timer, expired: remaining === 0 };
}

/** «0:43». */
export function clockLabel(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Cuántos picks faltan para mi turno. `null` si no se puede establecer. */
export function picksUntilMe({ schedule, picksMade }) {
  if (!schedule?.length || !Number.isInteger(picksMade)) return null;
  const next = schedule.find((entry) => entry.overall > picksMade);
  return next ? { ...next, away: next.overall - picksMade - 1 } : null;
}
