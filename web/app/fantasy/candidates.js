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
 *   - cuánto AÑADE a tu alineación de hoy              (rosterFit.js, misma resta)
 *
 * ## El ajuste a la plantilla NO es el multiplicador retirado
 *
 * Desde septiembre de 2026 la lista se ordena por lo que cada jugador añade a
 * TU alineación, cuando la liga declara sus huecos. Eso NO es el `VOR × 0,35`
 * que se retiró en agosto: aquello era un peso a ojo sobre una plantilla
 * estándar que nadie había dicho. Esto es la MISMA definición del VOR con el
 * segundo término bien puesto —lo que pondrías tú si no lo tuvieras, en vez de
 * lo que pondría la liga media— y con la plantilla vacía da exactamente el VOR
 * publicado, que es cómo se comprueba que no hay nada inventado dentro.
 *
 * El board NO cambia. Sigue ordenado por VOR puro, que es la única definición
 * de BEST AVAILABLE que hay en el producto. Lo que se adapta es esta lista de
 * cuatro, que existe para el turno de alguien concreto, y lleva los dos números
 * a la vista para que la diferencia se pueda leer.
 *
 * ## K y DST
 *
 * Son fichables y filtrables, pero NO entran en la lista corta: su orden no
 * está validado (E8b lo rechaza para el pateador) y el modelo de defensa no
 * existe. Mezclarlos en una lista ordenada les prestaría la autoridad de los
 * otros — y esa autoridad es justo lo que no tienen.
 */

import { MIN_WEIGHTED_GAMES, SLOT_ELIGIBILITY, priorShare } from "./leagueValue.js";
import { orderByFit } from "./rosterFit.js";

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
export function candidates(
  available,
  { slots = null, limit = 4, roster = null, rosterPositions = null, replacement = null } = {}
) {
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
  //
  // Y no se recomienda a quien NO TIENE NÚMERO PROPIO. Con menos de tres
  // partidos ponderados de historial NFL, el encogimiento le da más del 75% de
  // su proyección desde la media de su posición: el board enseñaba a Phil
  // Mafah, Kevin Harris, Zach Evans y siete corredores más entre los puestos
  // 150 y 180, todos con ~112 puntos porque 112 ES la media del corredor. Eso
  // no es una lista de valor, es el ancla repetida con nombres distintos.
  //
  // No hace falta validar nada para excluirlos: `prior = 10/(wg+10)` es la
  // propia fórmula del encogimiento leída al revés, no una predicción. Siguen
  // en el board, buscables y fichables — lo que no hacen es encabezar una lista
  // que dice «lo mejor disponible».
  //
  // Un NOVATO no entra en esta regla: su número sale de la previa por capital
  // de draft, que está validada aparte y no es la media de la posición.
  const pool = available.filter(
    (row) => RANKED_POSITIONS.includes(row.position)
      && row.rostered !== false
      && row.status_severity !== "OUT"
      && (row.rookie || !Number.isFinite(Number(row.weighted_games ?? row.wg))
          || Number(row.weighted_games ?? row.wg) >= MIN_WEIGHTED_GAMES)
  );
  if (pool.length === 0) return [];
  const openPositions = slots ? openSlotPositions(slots) : null;

  // El ORDEN. Por defecto es el del board (valor de liga); con la estructura de
  // la plantilla declarada, por lo que cada uno añade a la alineación de hoy.
  // Sin estructura no se reordena nada: suponer una plantilla es justo lo que
  // se retiró, y un orden personalizado sobre una suposición no falla, miente.
  // TERCER ESTADO: la estructura está declarada pero ya no queda hueco titular
  // que nadie pueda mejorar. El orden vuelve a ser el del board por el propio
  // desempate, y la lista tiene que DECIRLO en vez de seguir rotulada como
  // personalizada — con un +0 en las cuatro filas, que es la contradicción.
  const { rows: ordenados, byId: porId, active: fitActive } =
    orderByFit(pool, { roster, rosterPositions, replacement });

  return ordenados.slice(0, limit).map((row, index) => {
    const ajuste = porId?.get(row.player_id) ?? null;
    // Cuántos quedan de SU tier en el pool disponible entero, no en lo pintado.
    // Contarlo sobre la ventana visible fue un bug real de este proyecto.
    const sameTier = Number.isFinite(row.tier)
      ? pool.filter((other) => other.position === row.position && other.tier === row.tier).length
      : null;
    const reasons = [];
    if (index === 0) {
      reasons.push({
        kind: "TOP",
        text: fitActive
          ? "Adds the most to your starting lineup"
          : "Highest league value available",
      });
    }
    if (openPositions && openPositions.has(row.position)) {
      reasons.push({ kind: "SLOT", text: `Fills an open ${row.position} slot` });
    }
    // Cuánto se come tu plantilla del valor publicado, dicho como resta y no
    // como consejo. Sólo se enseña cuando hay algo que decir: repetir «100% of
    // his board value» en las cuatro filas del primer pick sería el aviso que
    // sale siempre y por eso no informa.
    if (fitActive && ajuste && Number.isFinite(ajuste.marginal) && Number.isFinite(ajuste.vor)
        && ajuste.vor > 0 && ajuste.marginal < ajuste.vor - 0.5) {
      reasons.push({
        kind: "FIT",
        text: ajuste.marginal <= 0.5
          ? `You already start a ${row.position} — he adds nothing to this lineup`
          : `Your ${row.position} slot is taken: ${Math.round(ajuste.marginal)} of his `
            + `${Math.round(ajuste.vor)} VOR reaches your lineup`,
      });
    }
    if (sameTier !== null) {
      reasons.push({
        kind: "TIER",
        text: sameTier === 1
          ? `Last ${row.position} in tier ${row.tier}`
          : `${sameTier} ${row.position}s left in tier ${row.tier}`,
      });
    }
    // `fit` lleva el dato; `fitActive` dice si ordenar por él significa algo.
    // Separados a propósito: el número sigue siendo cierto cuando ya no queda
    // hueco, lo que deja de ser cierto es la etiqueta de la lista.
    return { row, reasons, sameTier, fit: ajuste, fitActive };
  });
}
