/**
 * «¿Hay número?» — la pregunta que `Number.isFinite(Number(x))` NO contesta.
 *
 * `Number(null)` y `Number("")` valen **CERO**, que es finito. Así que ese
 * modismo dice «sí hay dato» sobre un hueco, y el cero se cuela como si fuera
 * una medición. Este repositorio ha tropezado con eso cuatro veces:
 *
 *   · una liga SIN titular de TE recibía un TE inventado (`counts[pos] ||`);
 *   · una apuesta sin jornada se habría guardado como «jornada 0»;
 *   · «no sé cuántos picks te quedan» se convertía en «te queda cero»;
 *   · y un partido SIN mercado se publicaba como «Pick'em · O/U 0.0».
 *
 * La corrección estaba escrita —`intOrNull` en `bankroll.js`, con su comentario
 * explicando exactamente esto— pero era privada de ese fichero, así que los
 * demás sitios la reimplementaron mal. Es el fallo de los dos traductores
 * aplicado a cuatro líneas de aritmética. Una sola, aquí, y todos la llaman.
 */

/**
 * El número, o `null` si no lo hay. Un hueco NUNCA sale como cero.
 *
 * Se rechazan también los objetos, y no por purismo: `Number([])` vale **CERO**
 * y `Number([7])` vale **SIETE**. Un array vacío colándose como cero es el
 * mismo fallo con otro disfraz, y lo destapó el propio test de este fichero.
 */
export function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  // `Number("")` es cero y `Number("   ")` TAMBIÉN: JavaScript recorta antes de
  // convertir, así que una celda con espacios —lo que deja un CSV, un campo de
  // texto vacío o un `join` de nada— entraba como una medición de cero. La
  // primera versión de este helper sólo miraba la cadena vacía exacta y por eso
  // dejaba pasar el caso que más se parece a un dato de verdad.
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "object") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ¿Hay número? Para condiciones, donde `numberOrNull(x) !== null` se lee peor. */
export function hasNumber(value) {
  return numberOrNull(value) !== null;
}
