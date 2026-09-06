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
/**
 * ¿Este jugador NO va a jugar? UNA definición, para las tres cosas que dependen
 * de ella: la partición, el separador de la lista y la clase de la fila.
 *
 * Tenerla en tres sitios ya se rompió: al mover «sin equipo NFL» a
 * `unavailable`, el separador y la clase `is-out` seguían mirando SÓLO la capa
 * de prensa, así que 142 filas caían detrás del separador sin que el separador
 * llegara a pintarse — la lista decía que estaban disponibles y el orden decía
 * que no. Es el fallo de los dos traductores, ahora dentro de una sola pantalla.
 */
export function isUnavailable(row) {
  return row?.status_severity === "OUT" || row?.rostered === false;
}

export function splitAvailable(rows, taken) {
  const has = typeof taken?.has === "function" ? (id) => taken.has(id) : () => false;
  const untaken = [];
  const available = [];
  const unavailable = [];
  for (const row of rows ?? []) {
    if (!row || has(row.player_id)) continue;
    untaken.push(row);
    // SIN EQUIPO NFL cuenta como «no va a jugar», igual que un OUT. No es una
    // regla nueva: `candidates` ya se negaba a recomendarlos y el Draft Room ya
    // los marcaba «SIN EQUIPO» — lo que faltaba era que la PARTICIÓN lo supiera,
    // y de ahí que los conteos de tier los siguieran contando. Con 142 de los
    // 552 del board sin plantilla, «8 RBs left in tier 6» podía ser medio
    // agentes libres: el mismo artefacto de «2 left in tier», ahora por contar
    // sobre gente que no está en ningún equipo en vez de sobre lo pintado.
    if (isUnavailable(row)) unavailable.push(row);
    else available.push(row);
  }
  return { untaken, available, unavailable };
}
