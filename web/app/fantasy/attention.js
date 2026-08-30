/**
 * Atención factual entre ligas. El modelo del centro de mando.
 *
 *     ATENCIÓN NO ES RECOMENDACIÓN.
 *
 * Cada elemento de esta cola es un HECHO comprobable del estado de una liga:
 * estás en el reloj, faltan N picks, hay huecos titulares sin llenar en un
 * draft en marcha, la estructura no está configurada. Lo que no cabe aquí, por
 * construcción: «roster débil», «ficha a alguien», «liga en riesgo» — juicios
 * que exigirían un modelo de decisión que nadie ha validado.
 *
 * ## Qué entra en la cola y qué se queda en la fila de la liga
 *
 * No todo hecho es un aviso. Un descanso a tres meses vista es un dato de la
 * fila de su liga; un draft donde te toca en dos picks es operativo AHORA. La
 * cola lleva sólo lo segundo:
 *
 * - ACTIVE      — reloj y distancia al turno, en drafts con picks y sin acabar.
 * - FACT        — huecos titulares abiertos, sólo mientras su draft está vivo.
 * - SETUP       — estructura de plantilla sin configurar.
 *
 * Los descansos, el draft completado y la configuración conocida se enseñan en
 * la fila de cada liga, sin disfraz de urgencia.
 *
 * ## La ordenación, entera y sin pesos secretos
 *
 * 1. En el reloj.
 * 2. Faltan N picks, N ascendente.
 * 3. Draft activo sin reloj derivable.
 * 4. Huecos abiertos con draft activo.
 * 5. Estructura sin configurar.
 * Empates: nombre de liga, y después el ámbito. Determinista siempre; si dos
 * ligas no se distinguen por un hecho, no se inventa una prioridad.
 */

import { fold, isMyTurn, untilMyTurn } from "./draftLog.js";
import { loadLog } from "./draftStorage.js";
import { assignSlots } from "./leagueValue.js";

const RANK = { ON_THE_CLOCK: 0, PICKS_UNTIL_ME: 1, DRAFT_ACTIVE: 2, OPEN_STARTER_SLOTS: 3, ROSTER_CONFIG_UNKNOWN: 4 };

/**
 * La instantánea factual de una liga: identidad + lo que se puede derivar HOY.
 *
 * Cada campo dice lo que es o es `null` = no establecible. `complete` es
 * ternario a propósito: `true`, `false`, o `null` cuando la liga no declaró
 * tamaño y rondas — un draft con picks y sin totales conocidos no se afirma ni
 * vivo ni acabado más allá de sus hechos.
 */
export function leagueSnapshot(entry, { storage, board = [], byes = null } = {}) {
  const config = entry.config ?? null;
  const events = loadLog(`${entry.scope}:log`, storage);
  const state = fold(events);

  const teams = config?.teams ?? null;
  const rounds = config?.rounds ?? null;
  const type = config?.draftType ?? null;
  const mySlot = config?.mySlot ?? null;
  const total = teams && rounds ? teams * rounds : null;
  const complete = total !== null ? state.count >= total : null;
  const active = state.count > 0 && complete !== true;

  const onClock = active
    ? isMyTurn({ overall: state.count + 1, teams, type, mySlot })
    : null;
  const next = active && onClock !== true
    ? untilMyTurn({ count: state.count, teams, type, mySlot, rounds })
    : null;

  const mine = board.filter((row) => state.mine.has(row.player_id));
  let openStarters = null;
  if (Array.isArray(config?.roster) && config.roster.length > 0) {
    const { slots } = assignSlots(mine, config.roster);
    openStarters = slots.filter((slot) => !slot.player).length;
  }

  // Descansos de MI plantilla, agrupados. Dato de temporada, nunca aviso.
  let byeGroups = null;
  if (byes && mine.length > 0) {
    const groups = {};
    for (const row of mine) {
      const week = byes[row.team];
      if (week) (groups[week] ??= []).push(row);
    }
    byeGroups = Object.keys(groups).length ? groups : null;
  }

  return {
    scope: entry.scope,
    identity: entry.identity,
    name: config?.name || null,
    platform: entry.identity?.platform ?? null,
    config,
    hasLog: entry.hasLog,
    count: state.count,
    total,
    complete,
    active,
    onClock,
    next,
    mine,
    openStarters,
    byeGroups,
    rosterKnown: Array.isArray(config?.roster) && config.roster.length > 0,
  };
}

/** Los elementos de la cola que ese estado JUSTIFICA. Hechos, con su destino. */
export function attentionItems(snapshot) {
  const items = [];
  const base = { scope: snapshot.scope, league: snapshot.name || labelFor(snapshot) };

  if (snapshot.onClock === true) {
    items.push({ ...base, type: "ON_THE_CLOCK", category: "ACTIVE", away: 0,
      message: "You're on the clock", action: "Open draft" });
  } else if (snapshot.next) {
    items.push({ ...base, type: "PICKS_UNTIL_ME", category: "ACTIVE", away: snapshot.next.away,
      message: snapshot.next.away === 1 ? "1 pick until you" : `${snapshot.next.away} picks until you`,
      detail: `you're up at ${snapshot.next.round}.${String(snapshot.next.inRound).padStart(2, "0")}`,
      action: "Open draft" });
  } else if (snapshot.active) {
    items.push({ ...base, type: "DRAFT_ACTIVE", category: "ACTIVE", away: Infinity,
      message: "Draft in progress",
      detail: snapshot.total ? `${snapshot.count} of ${snapshot.total} picks` : `${snapshot.count} picks recorded`,
      action: "Open draft" });
  }

  if (snapshot.active && snapshot.openStarters !== null && snapshot.openStarters > 0) {
    items.push({ ...base, type: "OPEN_STARTER_SLOTS", category: "FACT", away: Infinity,
      message: snapshot.openStarters === 1 ? "1 starter slot open" : `${snapshot.openStarters} starter slots open`,
      action: "Open draft" });
  }

  if (!snapshot.rosterKnown && snapshot.config) {
    items.push({ ...base, type: "ROSTER_CONFIG_UNKNOWN", category: "SETUP", away: Infinity,
      message: "Roster setup unknown", action: "Configure roster" });
  }

  return items;
}

export function sortAttention(items) {
  return [...items].sort((a, b) =>
    (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9)
    || (a.away ?? Infinity) - (b.away ?? Infinity)
    || String(a.league).localeCompare(String(b.league))
    || String(a.scope).localeCompare(String(b.scope)));
}

/** Ligas: activas con reloj primero, y el resto en orden estable por nombre. */
export function sortLeagues(snapshots) {
  const key = (s) => {
    if (s.onClock === true) return 0;
    if (s.next) return 1;
    if (s.active) return 2;
    if (s.complete === true) return 4;
    return 3;
  };
  return [...snapshots].sort((a, b) =>
    key(a) - key(b)
    || (a.next?.away ?? Infinity) - (b.next?.away ?? Infinity)
    || String(a.name || labelFor(a)).localeCompare(String(b.name || labelFor(b)))
    || a.scope.localeCompare(b.scope));
}

export function labelFor(snapshot) {
  const id = snapshot.identity;
  if (!id) return "Unknown league";
  if (id.platform === "local") return `Local board · ${id.season}`;
  return `${id.platform} league ${id.leagueId}`;
}
