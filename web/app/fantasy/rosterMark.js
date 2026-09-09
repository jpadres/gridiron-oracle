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
 *   TEAM_UNIT       nada. Es una defensa de equipo: la pregunta «¿está en una
 *                   plantilla?» no se le hace a un equipo, y responderla que
 *                   NO —que es lo que hacía— publicaba 32 hechos falsos.
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
  NOT_ON_ROSTER: { text: "NO NFL TEAM", tone: "out" },
};

/**
 * @param row fila del board.
 * @param opciones.yaDiceSinEquipo la pantalla YA pinta «sin equipo» por su
 *   cuenta (el Draft Room y el modo draft lo hacen desde `rostered === false`).
 *   Sólo entonces se calla, para no decir el mismo hecho dos veces.
 *
 *   La primera versión lo daba por hecho SIEMPRE, y la tabla principal de
 *   `/fantasy` no lo pintaba: Brandon Aiyuk salía en el puesto 119 sin una sola
 *   marca, sin equipo NFL, bajo un rótulo que prometía justo ese dato. Una
 *   promesa que la pantalla no cumple es peor que no prometer nada.
 * @returns null, o `{text, className, title}` listo para pintar.
 */
export function rosterMark(row, { yaDiceSinEquipo = false } = {}) {
  // SÓLO SE CALLA SI LA OTRA MARCA VA A SALIR DE VERDAD. La opción era una
  // PROMESA del que llama —«esta pantalla ya lo pinta»— y esa promesa es falsa
  // para los especialistas: el Draft Room pinta «SIN EQUIPO» desde
  // `rostered === false`, y un pateador no trae ese campo. Resultado medido:
  // los cuatro pateadores sin equipo NFL del payload salían en la sala SIN UNA
  // SOLA MARCA, en la ronda donde nadie mira dos veces. Ahora la condición se
  // comprueba en la fila en vez de creerse, que es la diferencia entre una
  // invariante y un acuerdo entre dos ficheros.
  if (yaDiceSinEquipo && row?.roster_state === "NOT_ON_ROSTER" && row?.rostered === false) {
    return null;
  }
  const shown = PINTA[row?.roster_state];
  if (!shown) return null;
  // NO SE DICE DOS VECES EL MISMO HECHO. La capa de prensa ya escribe su propia
  // etiqueta en la fila, y en once del board las dos hablaban de lo mismo:
  // «EXEMPT LIST» y «EXEMPT LIST» pegadas, o «IR» junto a «RESERVE LIST».
  // Cuando la prensa dice lo mismo con MÁS detalle —ella sí puede distinguir IR
  // de PUP, con fuente— la suya es la buena y ésta sobra. Si dijeran cosas
  // distintas se conservarían las dos: el desacuerdo es información.
  if (dicenLoMismo(row)) return null;
  if (row.roster_state === "NOT_ON_ROSTER") {
    return {
      text: shown.text,
      className: `mark mark--${shown.tone}`,
      title: "Not on any NFL roster as of "
        + (row.roster_source_as_of ?? "an unknown date")
        + ". The projection comes from his production with a team he is no longer on."
        + " Changes no number on this row.",
    };
  }
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
  // `TEAM_UNIT` NO ES UN CAMBIO. Una defensa no está en el registro de
  // plantillas porque no es una persona, y contarla como «cambió de situación»
  // metería 32 equipos en un conteo que dice «cuántos del top 150 ya no están
  // donde el board cree». Ver `roster_status.TEAM_UNIT`.
  if (row?.roster_state === "TEAM_UNIT") return false;
  return row?.roster_state != null && row.roster_state !== "ACTIVE";
}

/**
 * ¿EL EQUIPO QUE PINTA LA FILA ES EL QUE DICE LA PLANTILLA DE HOY?
 *
 *     EL RÓTULO PROMETÍA «QUIÉN CAMBIÓ DE EQUIPO» Y NINGUNA FILA LO DECÍA.
 *
 * El board pinta `row.team`, que es el último equipo en el que el jugador
 * JUGÓ. El registro de plantillas dice dónde está hoy. Cuando no coinciden, la
 * fila enseña un equipo que el fichero del día contradice — y eso importa
 * doblemente porque la proyección hereda el reparto de uso del equipo
 * ANTERIOR.
 *
 * Medido el 6 de septiembre de 2026: **32 filas del board** con esa
 * discrepancia y ninguna marcada. Isiah Pacheco salía «RB · KC» con el
 * registro diciendo DET y en reserva; tres de los 32 pateadores publicados
 * —Grupe, Carlson, Folk— salían bajo el equipo que ya habían dejado, sin una
 * sola marca, porque su `roster_state` es ACTIVE y `rosterMark` sólo hablaba
 * de los que NO están activos. Y la cabecera del board prometía, con esas
 * palabras, «quién cambió de equipo».
 *
 * Los códigos se comparan NORMALIZADOS: el payload publica «LA» y «LAR» para
 * los Rams, y compararlos en crudo fabricaba un traspaso que no existe. Es el
 * `AZ`/`ARI` de la tabla de errores, esta vez en el navegador.
 */
const ALIAS_EQUIPO = { LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV", WSH: "WAS", ARZ: "ARI" };

export function normalizeTeam(code) {
  const limpio = String(code ?? "").trim().toUpperCase();
  return ALIAS_EQUIPO[limpio] ?? limpio;
}

export function teamChangeMark(row) {
  const board = normalizeTeam(row?.team);
  const registro = normalizeTeam(row?.roster_team);
  if (!board || !registro || board === registro) return null;
  if (row?.roster_state === "TEAM_UNIT") return null;
  return {
    text: `NOW ${registro}`,
    className: "mark mark--risk",
    title: `The board shows ${board} — his last team on the field — but the `
      + `${row.roster_source_as_of ?? "latest"} roster registry lists him on ${registro}. `
      + "His projection still carries the usage share of the team he left. "
      + "Changes no number on this row.",
  };
}

/**
 * UN HECHO MATERIAL POSTERIOR A LA FECHA DEL MODELO, en una línea.
 *
 *     EL NÚMERO ES DEL 17 DE AGOSTO. ESTO PASÓ DESPUÉS.
 *
 * No cambia ningún número —regla 8, y `attach()` sólo escribe campos con
 * prefijo `roster_`— pero es lo que decide si drafteas a alguien. La lista de
 * lo que cuenta como MATERIAL es corta y cerrada a propósito: cambio de
 * equipo, lista de reserva, equipo de prácticas, exento, sin equipo NFL, y lo
 * que la prensa marca como OUT. Una entrevista de pretemporada no entra.
 *
 * Devuelve `null` cuando no hay nada material o cuando falta alguna de las dos
 * fechas: sin saber cuál es la del modelo no se puede afirmar que algo sea
 * POSTERIOR a ella, y afirmarlo sin comprobarlo es la regla 5 otra vez.
 */
const MATERIAL = {
  RESERVE: "Moved to a reserve list",
  PRACTICE_SQUAD: "On the practice squad",
  EXEMPT: "On the exempt list",
  NOT_ON_ROSTER: "No NFL team",
};

export function updatedSinceModel(row, modelDate) {
  const rosterDate = row?.roster_source_as_of;
  if (!rosterDate || !modelDate || rosterDate <= modelDate) return null;
  if (row?.roster_state === "TEAM_UNIT") return null;
  const hechos = [];
  // NORMALIZADO. «LA» y «LAR» son los mismos Rams, y compararlos en crudo
  // emitía «Now on LAR, not LA» — un traspaso inventado sobre cuatro filas del
  // payload. El `AZ`/`ARI` de siempre, en el navegador.
  const board = normalizeTeam(row?.team);
  const registro = normalizeTeam(row?.roster_team);
  if (board && registro && board !== registro) {
    hechos.push(`Now on ${registro}, not ${board}`);
  }
  const estado = MATERIAL[row?.roster_state];
  if (estado) hechos.push(estado);
  if (row?.status_severity === "OUT" && row?.status_label) {
    hechos.push(String(row.status_label));
  }
  if (hechos.length === 0) return null;
  return { facts: hechos, asOf: rosterDate, modelDate };
}

/**
 * ¿La marca de prensa de esta fila ya dice lo que diría la de plantilla?
 *
 * No es «hay marca de prensa»: es que hable del MISMO hecho. Un jugador en
 * lista de reserva con una nota de prensa que dice «IR» son la misma
 * afirmación con dos niveles de detalle. Uno con «SUSPENDED» y estado
 * `RESERVE` son dos hechos y se enseñan los dos.
 */
function dicenLoMismo(row) {
  const prensa = String(row?.status_label ?? "").toUpperCase();
  if (!prensa) return false;
  if (row.roster_state === "EXEMPT") return prensa.includes("EXEMPT");
  if (row.roster_state === "RESERVE") {
    return prensa.includes("IR") || prensa.includes("RESERVE") || prensa.includes("PUP");
  }
  if (row.roster_state === "NOT_ON_ROSTER") return prensa.includes("NO NFL TEAM");
  return false;
}

/**
 * EL HISTORIAL DEL MODELO CON ESTE JUGADOR.
 *
 *     UN PROMEDIO NO PUEDE AVISAR DEL CASO QUE EL PROMEDIO APLASTA.
 *
 * La curva de edad está bien calibrada para el corredor de 30+ MEDIO —55
 * temporadas medidas, proyectados 94 y realizados 57, con 22 en cero— y aun
 * así se quedó corta con Derrick Henry por 201 puntos en 2024 y por 145 en
 * 2025. Por construcción, ese caso es invisible EN la media: sólo se ve
 * mirando al jugador, y por eso se enseña en su fila.
 *
 * No toca ningún número. `projected_points`, `vor` y el puesto son los mismos
 * con marca y sin ella — la frontera de la regla 8, aplicada al propio modelo.
 *
 * Devuelve `null` cuando no hay dos temporadas con el MISMO fallo grande: un
 * año malo es ruido, y una marca que sale siempre no informa.
 */
export function trackMark(row) {
  const sesgo = row?.track_bias;
  if (sesgo !== "UNDER" && sesgo !== "OVER") return null;
  const puntos = Number(row?.track_bias_points);
  if (!Number.isFinite(puntos)) return null;
  const temporadas = Array.isArray(row?.track_seasons) ? row.track_seasons : [];
  const detalle = temporadas
    .map((t) => `${t.season}: projected ${t.projected}, scored ${t.realized}`)
    .join("; ");
  const corto = sesgo === "UNDER";
  return {
    text: corto ? `MODEL LOW ${Math.round(puntos)}` : `MODEL HIGH ${Math.round(puntos)}`,
    className: `mark mark--${corto ? "risk" : "out"}`,
    title:
      `This model's own record on this player: it ${corto ? "under" : "over"}-projected him `
      + `by ${Math.round(puntos)} points per season, both of the last two. ${detalle}. `
      + "Each season was re-projected walk-forward, using only earlier seasons, and compared "
      + "with what he actually scored. It changes no number on this row — the projection, the "
      + "VOR and the rank are the same with this mark and without it.",
  };
}
