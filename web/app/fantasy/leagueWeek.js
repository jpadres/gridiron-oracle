/**
 * La semana de una liga, en hechos: mi alineación contra la del rival, y la
 * profundidad de cada equipo por posición. Sin React ni red: se prueba con
 * `node --test`.
 *
 * ## Qué se afirma y qué no
 *
 * Los puntos que se suman son la PROYECCIÓN SEMANAL PUBLICADA de cada titular
 * (validada para QB/RB/WR/TE y K; la defensa no tiene proyección y cuenta
 * como «sin proyección», nunca como cero). «Quién está débil» se enseña como
 * lo que es: cuántos jugadores tiene cada equipo en cada posición y cuánto
 * proyectan sus mejores esta semana. No hay «este equipo necesita un RB» —
 * eso sería un consejo que nadie ha validado; el dato que lo decide sí está.
 */

import { numberOrNull } from "../numbers.js";

const OFFENSE = ["QB", "RB", "WR", "TE"];

/** Índice `sleeper_id` -> fila del ranking semanal (o del pateador). */
export function weeklyIndex(rankings, kickers = null) {
  const index = new Map();
  for (const row of rankings ?? []) if (row?.sid) index.set(String(row.sid), row);
  for (const row of kickers ?? []) if (row?.sid && !index.has(String(row.sid))) index.set(String(row.sid), { ...row, position: "K" });
  return index;
}

/**
 * Una alineación (lista de ids de titulares) resuelta: fila por jugador, suma
 * de lo proyectado y cuántos titulares no tienen proyección (defensas, ids
 * que el mapa no conoce, huecos vacíos que Sleeper publica como "0").
 */
export function lineupOf(starterIds, index) {
  const rows = [];
  let projected = 0;
  let unknown = 0;
  for (const raw of starterIds ?? []) {
    const id = String(raw ?? "");
    if (!id || id === "0") { rows.push({ sid: null, empty: true }); unknown += 1; continue; }
    const row = index.get(id);
    // Un titular SIN proyección tiene que caer en `unknown`, no contar como
    // conocido con cero puntos: `Number(null)` es cero y es finito, así que el
    // idioma anterior desinflaba el total de la alineación mientras la
    // presentaba como completa.
    const puntos = numberOrNull(row?.projected_points);
    if (row && puntos !== null) {
      rows.push({ sid: id, row, points: puntos });
      projected += puntos;
    } else {
      rows.push({ sid: id, row: row ?? null, points: null });
      unknown += 1;
    }
  }
  return { rows, projected: Math.round(projected * 10) / 10, unknown, count: rows.length };
}

/**
 * Mi alineación contra la del rival esta semana. `null` sin enfrentamiento.
 * Los puntos reales (`points`) los publica Sleeper cuando la jornada ya
 * empezó; hasta entonces son 0 y NO se enseñan como resultado.
 */
export function matchupView({ snapshot, index }) {
  const m = snapshot?.matchup;
  if (!m || m.opponentRosterId == null) return null;
  const rival = (snapshot.teams ?? []).find((t) => String(t.rosterId) === String(m.opponentRosterId)) ?? null;
  return {
    week: m.week ?? null,
    mine: lineupOf(m.myStarters, index),
    rival: lineupOf(m.opponentStarters, index),
    rivalName: rival?.owner ?? `roster ${m.opponentRosterId}`,
    rivalRecord: rival?.record ?? null,
  };
}

/**
 * Profundidad por posición de cada equipo: cuántos tiene y cuánto proyectan
 * sus mejores N esta semana, con N = titulares dedicados de esa posición en
 * la liga (1 QB, 2 RB…; sin plantilla declarada, N = 1). Ordenado como viene
 * (por roster); quien lo pinte resalta el mío.
 */
export function depthByTeam({ snapshot, index, starters = null }) {
  const perPosition = OFFENSE.map((p) => [p, Math.max(1, Number(starters?.[p]) || 1)]);
  return (snapshot?.teams ?? []).map((team) => {
    const byPos = {};
    for (const [position] of perPosition) byPos[position] = [];
    let unknown = 0;
    for (const id of team.players ?? []) {
      const row = index.get(String(id));
      if (!row) { unknown += 1; continue; }
      if (!byPos[row.position]) continue;
      byPos[row.position].push(Number(row.projected_points) || 0);
    }
    const positions = {};
    for (const [position, n] of perPosition) {
      const sorted = byPos[position].sort((a, b) => b - a);
      positions[position] = {
        count: sorted.length,
        top: Math.round(sorted.slice(0, n).reduce((a, b) => a + b, 0) * 10) / 10,
        starters: n,
      };
    }
    return {
      rosterId: team.rosterId, owner: team.owner, record: team.record,
      mine: snapshot.rosterId != null && String(team.rosterId) === String(snapshot.rosterId),
      positions, unknown, size: (team.players ?? []).length,
    };
  });
}

/** Titulares dedicados por posición desde la lista de huecos de la liga. */
export function dedicatedStarters(rosterPositions) {
  if (!Array.isArray(rosterPositions)) return null;
  const out = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const raw of rosterPositions) {
    const slot = String(raw).toUpperCase();
    if (Object.hasOwn(out, slot)) out[slot] += 1;
  }
  return out;
}
