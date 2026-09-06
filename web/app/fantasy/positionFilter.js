/**
 * QUÉ POSICIONES CUBRE CADA ETIQUETA DEL FILTRO.
 *
 *     ESTO ES UNA LENTE SOBRE LO QUE SE PINTA. NUNCA UN FILTRO DEL MOTOR.
 *
 * El filtro por posición acota la TABLA. Si llegara al motor de recomendación,
 * filtrar a WR haría que no viera al corredor que llena tu RB2 y el hueco se
 * quedaría abierto sin que nada lo dijera — un filtro de interfaz convertido en
 * filtro de modelo, que es el «2 left in tier» contado sobre lo pintado
 * elevado a decisión. `tests/candidates.test.mjs` lo comprueba en las dos
 * pantallas.
 *
 * Las combinaciones existen porque la pregunta que uno se hace en un draft casi
 * nunca es de una posición sola: «¿qué me queda entre corredores y receptores?»
 * es la comparación que decide un FLEX, y con el filtro de a una había que
 * mirar dos listas y recordarlas.
 */

/** El orden en que se pintan. `ALL` primero; las combinaciones, al final. */
export const POSITION_FILTERS = [
  "ALL", "QB", "RB", "WR", "TE", "K", "DST", "RB+WR", "WR+TE", "QB+TE", "K+DST",
];

/** Las posiciones de una etiqueta. `ALL` devuelve `null`: no acota nada. */
export function positionsOf(filter) {
  if (!filter || filter === "ALL") return null;
  return String(filter).toUpperCase().split("+").filter(Boolean);
}

/** ¿Entra esta fila en el filtro? Sin filtro, entra todo. */
export function matchesFilter(row, filter) {
  const posiciones = positionsOf(filter);
  return posiciones === null || posiciones.includes(row?.position);
}

/**
 * ¿Ordena el board de VOR todas las posiciones de este filtro?
 *
 * El pateador y la defensa tienen panel propio porque no tienen VOR; una
 * combinación que los mezcle con posiciones que sí lo tienen ordenaría dos
 * cosas distintas en la misma tabla, así que `K+DST` va al panel y `RB+WR` al
 * board.
 */
const CON_VOR = new Set(["QB", "RB", "WR", "TE"]);

export function isBoardFilter(filter) {
  const posiciones = positionsOf(filter);
  return posiciones === null || posiciones.every((pos) => CON_VOR.has(pos));
}
