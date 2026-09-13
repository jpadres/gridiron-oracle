/**
 * QUÉ SEMANA ES, DICHO DE FORMA COMPROBABLE.
 *
 *     «WEEK 1» CON DOS PARTIDOS YA JUGADOS SE LEE COMO UNA ETIQUETA VIEJA.
 *
 * El 13 de septiembre de 2026 el dueño leyó «WEEK 1» con NE@SEA y SF@LA ya
 * terminados y concluyó que la web se había quedado atrás una semana. La
 * etiqueta era CORRECTA —el calendario pone los dos en la jornada 1, miércoles
 * 9 y jueves 10, y la jornada 2 no empieza hasta el jueves 17— pero no había
 * forma de comprobarlo desde la pantalla: un número de jornada a secas no dice
 * a qué fechas corresponde, así que el lector lo contrasta con lo único que
 * tiene, que es su recuerdo de haber visto fútbol.
 *
 * Es el mismo principio que `data_dates`: una afirmación se publica con lo que
 * permite comprobarla. Aquí la comprobación son las FECHAS de los partidos de
 * esa jornada y cuántos van jugados — los dos salen del payload, no de una
 * suposición, y explican por qué la jornada todavía no ha avanzado.
 *
 * No decide nada: la jornada la resuelve Python (`schedule.py::current_point`,
 * el primer partido sin jugar) y aquí sólo se describe. Si un día el número y
 * las fechas no cuadran, el fallo está en el payload y esto lo hace VISIBLE en
 * vez de taparlo.
 */

import { kickoffMs } from "./gameClock.js";

/**
 * La FECHA de un partido es la de su propia zona, y ya viene en la cadena.
 *
 * `2026-09-09T20:20:00-04:00` es un partido del MIÉRCOLES 9 para todo el mundo,
 * incluido quien lo vea desde Europa. La primera versión de este fichero
 * convertía a UTC y publicaba «Sep 10–15» sobre una jornada que va del 9 al 14:
 * las 20:20 del Este ya son del día siguiente en UTC, así que los tres partidos
 * de noche se corrían un día. Plausible y falsa, que es la peor clase. El
 * prefijo de la cadena es la respuesta y no hay que calcular nada.
 */
function fechaLocal(row) {
  const raw = row?.kickoff_at ?? row?.game_kickoff_at ?? null;
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/**
 * La ventana de una jornada y su progreso, derivada de sus propios partidos.
 *
 * Devuelve `null` cuando no hay con qué: sin saques publicados no se inventa un
 * rango — UNKNOWN antes que inventado, como en todo lo demás.
 */
export function weekWindow(games) {
  const filas = Array.isArray(games) ? games : [];
  const conSaque = filas
    .map((g) => ({ ms: kickoffMs(g), fecha: fechaLocal(g) }))
    .filter((x) => Number.isFinite(x.ms) && x.fecha !== null)
    .sort((a, b) => a.ms - b.ms);
  if (conSaque.length === 0) return null;
  const jugados = filas.filter((g) => (g?.final ?? g?.game_final) === true).length;
  return {
    from: conSaque[0].fecha,
    to: conSaque[conSaque.length - 1].fecha,
    games: filas.length,
    played: jugados,
  };
}

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** «Sep 9–14», o «Sep 28 – Oct 2» cuando la jornada cruza de mes. */
export function windowLabel(ventana) {
  if (!ventana) return null;
  const mesA = MESES[ventana.from.month - 1];
  const mesB = MESES[ventana.to.month - 1];
  const diaA = ventana.from.day;
  const diaB = ventana.to.day;
  if (mesA === mesB && diaA === diaB) return `${mesA} ${diaA}`;
  if (mesA === mesB) return `${mesA} ${diaA}–${diaB}`;
  return `${mesA} ${diaA} – ${mesB} ${diaB}`;
}

/**
 * El progreso, en palabras: qué falta para que la jornada avance.
 *
 * «2 of 16 played» contesta exactamente la pregunta que se hizo el dueño. Con
 * la jornada entera jugada se dice, porque entonces lo que toca es que el
 * siguiente build la mueva y eso SÍ sería una etiqueta vieja si no pasa.
 */
export function progressLabel(ventana) {
  if (!ventana || ventana.games === 0) return null;
  if (ventana.played === 0) return `${ventana.games} games, none played yet`;
  if (ventana.played === ventana.games) return `all ${ventana.games} played`;
  return `${ventana.played} of ${ventana.games} played`;
}
