/**
 * La lista corta del asistente: TOP AVAILABLE, no «tu mejor pick».
 *
 * ## La frontera, que es todo el fichero
 *
 * Esto NO es `BEST_PICK_FOR_ME`, que sigue BLOCKED. Lo que hace es ORDENAR por
 * el valor por liga ya validado (E18) y quedarse con los primeros elegibles.
 * No pondera por lo que te falta, no inventa una necesidad y no predice si
 * alguien llegará a tu próximo turno. Cada una de esas tres cosas exigiría un
 * experimento que no existe.
 *
 * Lo que sí puede decir, porque son HECHOS derivados de cosas validadas:
 *
 *   - es el disponible con más valor de tu liga        (E18, dentro de su rango)
 *   - comparte tier con estos otros                    (conteo sobre el pool)
 *   - encaja en un hueco titular que tienes abierto    (assignSlots)
 *   - cuántos quedan de su tier                        (conteo)
 *
 * ## K y DST
 *
 * Son fichables y filtrables, pero NO entran en la lista corta: su orden no
 * está validado (E8b lo rechaza para el pateador) y el modelo de defensa no
 * existe. Mezclarlos en una lista ordenada les prestaría la autoridad de los
 * otros — y esa autoridad es justo lo que no tienen.
 */

import { SLOT_ELIGIBILITY } from "./leagueValue.js";

/** Posiciones cuyo ORDEN está validado. K y DST quedan fuera a propósito. */
export const RANKED_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Los huecos titulares que siguen abiertos, en códigos de posición. */
export function openSlotPositions(slots) {
  const open = new Set();
  for (const entry of slots ?? []) {
    if (entry.player) continue;
    for (const pos of SLOT_ELIGIBILITY[entry.slot] ?? []) open.add(pos);
  }
  return open;
}

/**
 * Los candidatos: los primeros disponibles por valor, con sus HECHOS al lado.
 *
 * `limit` es corto a propósito. Bajo el reloj, una lista de veinte no es una
 * lista corta: es el board otra vez.
 */
export function candidates(available, { slots = null, limit = 4 } = {}) {
  // Un jugador sin equipo NO se recomienda. Su VOR salió de lo que produjo en
  // un equipo en el que ya no está, así que ofrecerlo como «lo mejor
  // disponible» es afirmar algo que los datos contradicen. Sigue en el board,
  // marcado y buscable — lo que no hace es encabezar la lista.
  //
  // Y tampoco se recomienda a quien NO VA A JUGAR aunque siga en su plantilla:
  // suspendido, en la Lista de Exentos, en IR o en PUP de temporada. Ese hecho
  // no lo tienen los datos de nflverse —Josh Jacobs figura ACT en Green Bay
  // estando apartado sin fecha— y lo trae la capa de prensa con su fuente.
  //
  // Marcar y dejar de recomendar NO es calcular: el número de la fila es el
  // mismo con marca y sin ella, y el jugador sigue en el board y buscable. Lo
  // que no hace es encabezar una lista que dice «lo mejor disponible».
  //
  // `RISK` (PUP activo, holdout, duda) NO sale: sacar a alguien del board por
  // una duda es tomar por quien draftea una decisión que es suya.
  const pool = available.filter(
    (row) => RANKED_POSITIONS.includes(row.position)
      && row.rostered !== false
      && row.status_severity !== "OUT"
  );
  if (pool.length === 0) return [];
  const openPositions = slots ? openSlotPositions(slots) : null;

  return pool.slice(0, limit).map((row, index) => {
    // Cuántos quedan de SU tier en el pool disponible entero, no en lo pintado.
    // Contarlo sobre la ventana visible fue un bug real de este proyecto.
    const sameTier = Number.isFinite(row.tier)
      ? pool.filter((other) => other.position === row.position && other.tier === row.tier).length
      : null;
    const reasons = [];
    if (index === 0) reasons.push({ kind: "TOP", text: "Highest league value available" });
    if (openPositions && openPositions.has(row.position)) {
      reasons.push({ kind: "SLOT", text: `Fills an open ${row.position} slot` });
    }
    if (sameTier !== null) {
      reasons.push({
        kind: "TIER",
        text: sameTier === 1
          ? `Last ${row.position} in tier ${row.tier}`
          : `${sameTier} ${row.position}s left in tier ${row.tier}`,
      });
    }
    return { row, reasons, sameTier };
  });
}
