/**
 * La situación de plantilla de una fila, como marca.
 *
 *     EL BOARD PIENSA CON DATOS DEL 17 DE AGOSTO.
 *     LAS PLANTILLAS SON DEL 5 DE SEPTIEMBRE.
 *     ESTA MARCA ES ESA DIFERENCIA, Y NO TOCA NINGÚN NÚMERO.
 *
 * Viene de `fantasy/roster_status.py`, que lee el fichero de plantillas de
 * nflverse. Es una capa distinta de la prensa (`narrative/status.py`): ésta no
 * necesita que nadie escriba una noticia, sale del registro de plantillas, y
 * por eso cubre a los 552 del board y no a los 46 que alguien curó a mano.
 *
 * ## Qué se pinta y qué no
 *
 *   ACTIVE          nada. Es el caso normal, y una marca que sale siempre no
 *                   informa: es decoración con nombre técnico.
 *   NOT_ON_ROSTER   nada AQUÍ. Ese hecho ya lo pinta `rostered === false` como
 *                   «NO NFL TEAM», y dos marcas para el mismo hecho se leen
 *                   como dos problemas.
 *   RESERVE         sí. NO está en el 53 de su equipo.
 *   PRACTICE_SQUAD  sí.
 *   EXEMPT          sí.
 *
 * ## Lo que esta marca NO afirma
 *
 * El fichero trae un código fino (`R01`, `R48`…) y **no se traduce**: decir
 * «lesionado toda la temporada» o «vuelve en la jornada 5» a partir de un
 * código que este repositorio no puede verificar sería inventarle significado
 * al dato que decide el pick. El código va en el `title`, crudo, y la
 * distinción fina la trae la prensa cuando existe con fuente.
 *
 * Y **no excluye a nadie** de la lista corta. Una lista de reserva no es lo
 * mismo que no poder jugar: sin saber cuál es, apartar al jugador sería
 * inventar la mitad que falta. Se dice y decide el que draftea.
 */

/** Los estados que SÍ se pintan, con su etiqueta y su peso visual. */
const PINTA = {
  RESERVE: { text: "RESERVE LIST", tone: "out" },
  PRACTICE_SQUAD: { text: "PRACTICE SQUAD", tone: "risk" },
  EXEMPT: { text: "EXEMPT LIST", tone: "out" },
};

/**
 * @param row fila del board.
 * @returns null, o `{text, className, title}` listo para pintar.
 */
export function rosterMark(row) {
  const shown = PINTA[row?.roster_state];
  if (!shown) return null;
  const team = row.roster_team ? ` on ${row.roster_team}` : "";
  const code = row.roster_code ? ` nflverse code ${row.roster_code}.` : "";
  const asOf = row.roster_source_as_of
    ? ` Rosters as of ${row.roster_source_as_of}.`
    : " Roster date unknown.";
  return {
    text: shown.text,
    className: `mark mark--${shown.tone}`,
    // El `title` dice de dónde sale y de cuándo, porque una afirmación de
    // actualidad sin fecha visible es la regla 5 rota otra vez.
    title: `Not on the active roster${team}.${code}${asOf}`
      + " Changes no number on this row.",
  };
}

/**
 * ¿Es este jugador un HECHO que el board no pudo saber?
 *
 * Sirve para el conteo de portada («N del top 150 han cambiado de situación
 * desde la fecha del modelo»), no para ordenar nada.
 */
export function changedSinceModel(row) {
  return row?.roster_state != null && row.roster_state !== "ACTIVE";
}
