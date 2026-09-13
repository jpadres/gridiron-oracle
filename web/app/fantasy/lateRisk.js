/**
 * RIESGO DE ESTADO TARDÍO: el que decide antes de que se te cierre la puerta.
 *
 *     TU DUDOSO JUEGA A LAS 20:20. TU RECAMBIO SE BLOQUEA A LA UNA.
 *     LA DECISIÓN ES A LA UNA, NO A LAS 20:20.
 *
 * Es la asimetría que arruina una jornada de fantasy y que ninguna pantalla de
 * este producto decía. Un titular QUESTIONABLE del partido nocturno parece que
 * te deja siete horas para decidir; en realidad te deja hasta el saque de tu
 * SUPLENTE, porque una vez bloqueado ya no lo puedes meter. Si esperas a que
 * salga el parte de inactivos del nocturno, te has quedado sin las dos cosas.
 *
 * ## Lo que esto NO hace
 *
 * **No predice si el dudoso juega.** QUESTIONABLE sigue siendo QUESTIONABLE
 * hasta el parte de inactivos oficial, que sale 90 minutos antes del saque.
 * Esto no mueve una probabilidad: ordena por RELOJ y dice cuándo se cierra la
 * ventana de decisión, que es un hecho del calendario.
 *
 * **No elige por ti.** Enseña el par —quién está en duda, quién lo cubre y a
 * qué hora se cierra— y la decisión es del dueño.
 *
 * ## Por qué el recambio tiene que estar EN TU PLANTILLA
 *
 * Un agente libre no es un recambio: hay que ficharlo, y eso es otra decisión
 * con otro plazo. Aquí sólo entran suplentes que ya tienes y que pueden ocupar
 * el hueco del dudoso, porque son los que la ventana afecta de verdad.
 */

import { numberOrNull } from "../numbers.js";
import { GAME, gameState, kickoffMs } from "../gameClock.js";
import { starterSlots } from "./lineup.js";
import { SLOT_ELIGIBILITY } from "./leagueValue.js";

/** Designaciones que abren una ventana de decisión. Un OUT no la abre: ya está
 *  decidido, y lo que toca es sustituirlo, no esperar. */
const EN_DUDA = new Set(["QUESTIONABLE", "DOUBTFUL"]);

/** ¿Está este titular pendiente de una designación que aún puede cambiar? */
export function inDoubt(row) {
  if (!row) return false;
  if (EN_DUDA.has(String(row.injury_designation ?? ""))) return true;
  /* La capa de prensa también marca dudas (`status_severity: RISK`), y una
     disputa entre fuentes es duda por definición. No se prefiere una capa
     sobre la otra: las dos abren la misma ventana. */
  return row.status_severity === "RISK" || row.status_disputed === true;
}

function admite(slot, position) {
  const elegibles = SLOT_ELIGIBILITY[String(slot).toUpperCase()] ?? [];
  return elegibles.includes(String(position ?? "").toUpperCase());
}

/**
 * Los pares (dudoso tardío, recambio que se bloquea antes) de UNA liga.
 *
 * `now` en milisegundos; con `null` no se afirma que nada haya empezado, igual
 * que en el resto del reloj.
 */
export function lateStatusRisks({ league, index, now = null }) {
  const huecos = starterSlots(league?.config?.roster);
  const puestos = Array.isArray(league?.starters) ? league.starters.map(String) : [];
  if (huecos.length === 0 || puestos.length === 0) return [];

  const apartados = new Set(
    [...(league?.reserve ?? []), ...(league?.taxi ?? [])].map(String)
  );
  const titulares = new Set(puestos.filter((s) => s && s !== "0"));
  const banquillo = (league?.players ?? [])
    .map(String)
    .filter((sid) => sid && sid !== "0" && !titulares.has(sid) && !apartados.has(sid))
    .map((sid) => ({ sid, row: index?.get?.(sid) ?? null }))
    .filter((b) => b.row);

  const riesgos = [];
  for (let i = 0; i < huecos.length; i += 1) {
    const sid = puestos[i] ?? "";
    if (!sid || sid === "0") continue;
    const row = index?.get?.(sid) ?? null;
    if (!row || !inDoubt(row)) continue;
    // Un partido que ya empezó no tiene ventana: la decisión ya pasó.
    if (gameState(row, now) !== GAME.SCHEDULED) continue;
    const suyo = kickoffMs(row);
    if (suyo === null) continue;

    /* El recambio: un suplente que CABE en ese hueco y cuyo partido se bloquea
       ANTES. Se ordena por proyección porque, entre los que caben, el que más
       aporta es el que de verdad cubre. */
    const recambios = banquillo
      .filter((b) => admite(huecos[i], b.row.position))
      .filter((b) => gameState(b.row, now) === GAME.SCHEDULED)
      .map((b) => ({ ...b, kickoff: kickoffMs(b.row) }))
      .filter((b) => b.kickoff !== null && b.kickoff < suyo)
      .sort((a, b) =>
        (numberOrNull(b.row.projected_points) ?? -Infinity)
        - (numberOrNull(a.row.projected_points) ?? -Infinity));
    if (recambios.length === 0) continue;

    /* LA VENTANA SE CIERRA CON EL PRIMERO QUE SE BLOQUEA, no con el mejor.
       Si el mejor recambio juega a las 16:25 y hay otro a la una, a la una ya
       hay que decidir si se usa ése — esperar cuesta la opción. */
    const cierre = Math.min(...recambios.map((r) => r.kickoff));
    riesgos.push({
      slot: huecos[i],
      starter: { sid, row },
      starterKickoff: suyo,
      options: recambios.slice(0, 3),
      decideBy: cierre,
      // Cuánto queda, para que la pantalla no tenga que restar. `null` sin
      // reloj: en el render del servidor no se afirma una cuenta atrás.
      msLeft: Number.isFinite(now) ? cierre - now : null,
    });
  }
  // Lo que se cierra ANTES va primero: es lo que hay que decidir ya.
  return riesgos.sort((a, b) => a.decideBy - b.decideBy);
}
