/**
 * EN QUÉ ESTADO ESTÁ UN PARTIDO, Y QUIÉN DECIDE CADA MITAD.
 *
 *     UN PARTIDO EMPEZADO NO ES UN MERCADO ABIERTO NI UN HUECO LIBRE.
 *
 * ## Por qué esto vive en el navegador y no en Python
 *
 * Este sitio es estático: el payload se compila una vez y se sirve durante
 * horas. «¿Ha terminado el partido?» es un hecho del FICHERO —hay marcador o no
 * lo hay— y lo decide Python, que es la única autoridad de todo lo que se
 * calcula. «¿Ha empezado?» no se puede saber en el build, porque depende de
 * cuándo se MIRA la página. Son dos preguntas distintas y por eso están en dos
 * sitios distintos; lo que no puede pasar es que el navegador REABRA algo que
 * Python cerró, y por eso `FINAL` gana siempre.
 *
 * Hacía falta el 13 de septiembre de 2026: dos partidos habían terminado y se
 * cerraron con el marcador, pero los otros trece arrancaban a la una, a las
 * cuatro y veinticinco y a las ocho y veinte de la tarde. A las dos, la página
 * seguía ofreciendo el de la una como apuesta y proponiendo mover a sus
 * jugadores de hueco — un cambio que Sleeper ya no acepta.
 *
 * ## Cuatro estados, y `UNKNOWN` es uno de ellos
 *
 *   FINAL        el fichero publica marcador. Lo dice Python (`game_final`).
 *   IN_PROGRESS  el saque ya pasó y todavía no hay marcador.
 *   SCHEDULED    el saque está en el futuro.
 *   UNKNOWN      no hay hora publicada, o no se puede leer.
 *
 * `UNKNOWN` no se degrada a `SCHEDULED`: «no sé cuándo empieza» y «no ha
 * empezado» son cosas distintas, y confundirlas es cómo se ofrece una apuesta
 * sobre un partido en marcha. La pantalla lo dice como lo que es.
 */

export const GAME = Object.freeze({
  FINAL: "FINAL",
  IN_PROGRESS: "IN_PROGRESS",
  SCHEDULED: "SCHEDULED",
  UNKNOWN: "UNKNOWN",
});

/**
 * El instante del saque en milisegundos, o `null`.
 *
 * `kickoff_at` viaja con su zona resuelta (`2026-09-13T16:25:00-04:00`), así
 * que `Date.parse` da el mismo momento se mire desde donde se mire. La cadena
 * sin zona (`kickoff`) NO sirve para esto: el navegador la leería como hora
 * local del que mira.
 */
export function kickoffMs(row) {
  const raw = row?.kickoff_at ?? row?.game_kickoff_at ?? null;
  if (typeof raw !== "string" || raw === "") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * El estado del partido de una fila. `now` en milisegundos.
 *
 * Se pasa `now` en vez de leer el reloj aquí dentro para que se pueda probar,
 * y para que una pantalla que todavía no ha montado (render en el servidor)
 * pueda pedir el estado SIN reloj: con `now` nulo no se afirma que algo haya
 * empezado, sólo lo que el fichero ya dice.
 */
export function gameState(row, now = null) {
  const final = row?.game_final ?? row?.final ?? null;
  if (final === true) return GAME.FINAL;
  const ms = kickoffMs(row);
  if (ms === null) return GAME.UNKNOWN;
  // Sin reloj no se afirma que haya empezado: es lo que se pinta en el
  // servidor, donde «ahora» sería la hora del BUILD — la falsa actualidad que
  // este proyecto persigue, aplicada al reloj en vez de a los datos.
  if (!Number.isFinite(now)) return GAME.SCHEDULED;
  return now >= ms ? GAME.IN_PROGRESS : GAME.SCHEDULED;
}

/**
 * ¿Se puede APOSTAR? Sólo si se puede AFIRMAR que no ha empezado.
 *
 * `UNKNOWN` no abre: no ofrecer una apuesta que no se puede confirmar abierta
 * es la respuesta conservadora, y equivocarse cuesta un mercado que se deja de
 * enseñar.
 */
export function isOpen(row, now = null) {
  return gameState(row, now) === GAME.SCHEDULED;
}

/**
 * ¿Se puede AFIRMAR que ya empezó? Sólo con marcador o con el saque pasado.
 *
 *     LAS DOS PREGUNTAS TIENEN EL «NO SÉ» EN LADOS OPUESTOS, A PROPÓSITO.
 *
 * Para apostar, lo que no se puede confirmar abierto se cierra. Para una
 * ALINEACIÓN es al revés: congelar un hueco porque no se sabe la hora del
 * partido no es prudente, es romperla — sin hora publicada se congelaría la
 * plantilla entera y la pantalla diría que no hay nada que cambiar.
 *
 * Lo destapó la suite al enlazar el reloj: siete tests en rojo porque sus
 * fixtures no llevan saque, que es exactamente el caso «no se sabe». Un mismo
 * predicado para las dos preguntas parecía economía y era un fallo.
 */
export function hasStarted(row, now = null) {
  const estado = gameState(row, now);
  return estado === GAME.FINAL || estado === GAME.IN_PROGRESS;
}

/** Texto corto del estado, para la marca de la fila. `null` si no hay nada que decir. */
export function stateLabel(row, now = null) {
  const estado = gameState(row, now);
  if (estado === GAME.FINAL) return "FINAL";
  if (estado === GAME.IN_PROGRESS) return "IN PROGRESS";
  // SCHEDULED es el caso normal y una marca que sale siempre no informa.
  // UNKNOWN sí se dice: es una afirmación menos, no una más.
  if (estado === GAME.UNKNOWN) return "KICKOFF UNKNOWN";
  return null;
}
