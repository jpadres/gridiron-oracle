/**
 * UNA definición de «disponible para draftear», para las dos pantallas.
 *
 * Hasta el 5 de septiembre de 2026 el Draft Room y el board de `/fantasy`
 * contestaban distinto: el Room apartaba a quien NO VA A JUGAR —suspendido,
 * exento, IR, PUP de temporada— en un bloque al pie, y `/fantasy` no miraba el
 * estado en absoluto: Josh Jacobs, exento, salía el 38 de «Best available by
 * VOR» sin una marca, y contaba en «N RBs left in tier». La regla 8 dice que
 * la marca no mueve el número, y no lo mueve; lo que no puede es faltar en
 * una pantalla y estar en la otra. Séptima vez de los dos traductores.
 *
 *   untaken      quien no se ha ido del board — se puede BUSCAR y tachar,
 *                también si no va a jugar: el pick de un OUT se registra igual.
 *   available    quien puede jugar — alimenta la lista corta, la profundidad
 *                y los conteos de tier.
 *   unavailable  quien no va a jugar — se enseña aparte, con su valor intacto
 *                y su marca diciendo por qué. No se esconde, no se penaliza.
 */
export function splitAvailable(rows, taken) {
  const has = typeof taken?.has === "function" ? (id) => taken.has(id) : () => false;
  const untaken = [];
  const available = [];
  const unavailable = [];
  for (const row of rows ?? []) {
    if (!row || has(row.player_id)) continue;
    untaken.push(row);
    if (row.status_severity === "OUT") unavailable.push(row);
    else available.push(row);
  }
  return { untaken, available, unavailable };
}
