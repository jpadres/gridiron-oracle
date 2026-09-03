/**
 * La etiqueta de disponibilidad del dossier, fechada y subordinada al estado.
 *
 * El dossier (`research/dossier.json`) es un libro curado que se importó una
 * vez: sus fichas médicas llevan nivel (FUERA/DUDA/SEGUIR), fuente y —a
 * veces— fecha. La capa de estado (`narrative/status.py`) es otra cosa: se
 * recomprueba a diario y dice si el jugador PUEDE JUGAR, con `verified_at`.
 *
 * Hasta ahora las dos se pintaban como iguales, una al lado de la otra, y la
 * vieja ganaba la lectura porque es más suave: Josh Jacobs salía con
 * «EXEMPT LIST» y «QUESTIONABLE» a la vez, y lo segundo era del 11 de agosto.
 * Pacheco, Conner y Benson salían «QUESTIONABLE» de agosto estando en IR hoy.
 * Es la regla 5 exactamente: DATO REAL + FECHA VIEJA = RESPUESTA ACTUAL FALSA,
 * y aquí ni siquiera se veía la fecha, que vivía sólo en el `title`.
 *
 * Dos decisiones, y las dos son de la regla:
 *
 *   1. La etiqueta lleva SIEMPRE su fecha delante (o `UNDATED`: ocho fichas
 *      del dossier no la traen y entonces no se puede afirmar nada de cuándo).
 *      Una afirmación de disponibilidad sin fecha visible es una afirmación
 *      de actualidad que nadie comprobó.
 *   2. Cuando la fila lleva marca de estado y el dossier es MÁS VIEJO, la
 *      etiqueta se subordina: sigue ahí —el desacuerdo se conserva, no se
 *      borra— pero en gris y sin competir con la marca de hoy.
 *
 * Vive en su propio módulo, puro y sin imports, porque lo usan una página de
 * servidor (`ui.jsx`) y un componente de cliente (`WeeklyExplorer.jsx`). Dos
 * copias de esta regla serían el fallo de los dos traductores de Sleeper otra
 * vez, y aquí decidiría qué se lee sobre quién puede jugar.
 */

// Los niveles del dossier van en español porque el fichero versionado se
// importó así y no se puede regenerar sin el libro. Se traducen al pintar.
export const AVAILABILITY_LABEL = { FUERA: "OUT", DUDA: "QUESTIONABLE", SEGUIR: "MONITOR" };

/** `2026-08-11` -> `8/11`. Lo que no tenga esa forma se devuelve tal cual. */
export function shortDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!match) return null;
  return `${Number(match[2])}/${Number(match[3])}`;
}

/**
 * @param entry ficha médica del dossier (o nada).
 * @param statusVerifiedAt `status_verified_at` de la fila, si la capa de
 *   estado habló de este jugador.
 * @param statusLabel la etiqueta que ya pinta la capa de estado en esa fila.
 * @returns null, o `{text, className, title, superseded}` listos para pintar.
 */
export function availabilityMark(entry, statusVerifiedAt, statusLabel = null) {
  if (!entry || !entry.level) return null;
  const label = AVAILABILITY_LABEL[entry.level] ?? entry.level;
  // EL DESACUERDO ES INFORMACIÓN; EL ACUERDO REPETIDO ES RUIDO. Una ficha vieja
  // que dice exactamente lo mismo que la marca de hoy no aporta nada y deja la
  // fila con la misma palabra dos veces.
  if (statusLabel && label === statusLabel) return null;
  const date = typeof entry.date === "string" && entry.date ? entry.date : null;
  // Sin fecha no se puede sostener que sea más nuevo que nada: se subordina
  // igual. UNKNOWN > STALE PRESENTADO COMO ACTUAL.
  const superseded = Boolean(statusVerifiedAt) && (!date || date < statusVerifiedAt);
  const stamp = shortDate(date) ?? "UNDATED";
  const attrib = [entry.source, date ?? "undated"].filter(Boolean).join(", ");
  const title =
    `Dossier: ${entry.situation ?? ""}${entry.status ? ` — ${entry.status}` : ""} (${attrib}).`
    + (superseded
      ? " Older than the status mark on this row, so it is not a current claim."
      + " Kept because the disagreement is information."
      : "");
  return {
    text: `${stamp} ${label}`,
    className: `avail avail--${entry.level.toLowerCase()}${superseded ? " avail--superseded" : ""}`,
    title,
    superseded,
  };
}
