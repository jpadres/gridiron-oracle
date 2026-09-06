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
 * Tenerla en tres sitios ya se rompió una vez y se arregló con esta función.
 *
 * ## Por qué SIN EQUIPO no entra aquí, aunque lo parezca
 *
 * Se probó: mover `rostered === false` a `unavailable` deja los conteos de tier
 * limpios —142 agentes libres dejaban de contar como «8 RBs left in tier»— y
 * **rompe el motor bajo presión de pool**. La tortura de 780 drafts lo puso en
 * rojo en cuatro: con 32 equipos y rivales que agotan la posición, el asistente
 * terminaba con huecos TITULARES vacíos habiendo jugadores en el board.
 *
 * Y un hueco vacío no rinde el nivel de reemplazo: rinde CERO. Es el error que
 * E23 midió en el baseline y el 47% de la ventaja que se le atribuía a este
 * motor, así que cometerlo aquí invalidaría su razón de existir.
 *
 * El conteo de tier se arregla donde estaba mal —contando— y no escondiendo
 * gente del motor. Ver `tierPool`.
 */
export function isUnavailable(row) {
  // UN OUT TIENE QUE SER UN HECHO. Cuando el registro de plantillas —oficial y
  // POSTERIOR— contradice la afirmación de la prensa, el hecho ha dejado de
  // estar establecido y lo que hay es una DISPUTA. Apartar al jugador
  // entonces es quedarse con una de las dos mitades y llamarla verdad.
  //
  // Medido: Stefon Diggs, receptor 72 del board, marcado `NO NFL TEAM` por un
  // hecho del 11 de marzo, ACTIVO en Washington según el registro del 5 de
  // septiembre, y drafteado por el mercado en el ADP 94,6. Salía del asistente
  // entero. La disputa se PINTA (ver `roster_status.reconcile`); lo que no
  // hace es excluir.
  return row?.status_severity === "OUT" && row?.status_disputed !== true;
}

/**
 * Sobre quién se CUENTA «cuántos quedan de este tier».
 *
 *     «8 RBs LEFT IN TIER 6» SE LEE COMO ESCASEZ Y SE DECIDE CON ELLO.
 *
 * Contarlo sobre todo el disponible metía a los 142 del board que no están en
 * ninguna plantilla de la NFL: el número decía que podías esperar y la mitad de
 * lo que contaba eran agentes libres sin equipo. Es el artefacto del «2 left in
 * tier» por tercera vez — antes por contar sobre lo pintado, ahora por contar
 * sobre quien no juega.
 *
 * Los que sí pueden jugar siguen en el pool del motor: esto acota el CONTEO,
 * no la disponibilidad.
 */
export function tierPool(rows) {
  return (rows ?? []).filter((row) => row?.rostered !== false);
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
