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
import { rosterMark } from "./fantasy/rosterMark.js";

export const AVAILABILITY_LABEL = { FUERA: "OUT", DUDA: "QUESTIONABLE", SEGUIR: "MONITOR" };

/** `2026-08-11` -> `8/11`. Lo que no tenga esa forma se devuelve tal cual. */
export function shortDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!match) return null;
  return `${Number(match[2])}/${Number(match[3])}`;
}

/**
 * LA FICHA VIEJA SE SUBORDINA A CUALQUIER CAPA MÁS NUEVA, NO SÓLO A UNA.
 *
 * Esto recibía `statusVerifiedAt` a pelo y comparaba SÓLO contra la capa de
 * prensa. Pero de disponibilidad hablan TRES: el dossier curado (agosto), la
 * capa de estado (`status_*`) y el registro de PLANTILLAS (`roster_*`), que
 * trae su propia fecha y pinta «RESERVE LIST», «PRACTICE SQUAD» o «EXEMPT».
 *
 * Medido en la jornada 4 de 2026: Alec Pierce, puesto 76, con «RESERVE LIST»
 * del registro del 29 de septiembre y al lado un «UNDATED OUT» del dossier SIN
 * subordinar — las dos afirmaciones con el mismo peso, y la que no se puede
 * fechar compitiendo de igual a igual con la de hoy. Es el fallo de las dos
 * superficies del mismo hecho, en una TERCERA capa.
 *
 * Y se recibe la FILA en vez de sus trozos a propósito: los cinco sitios que
 * llamaban pasaban `row` y además `row.status_verified_at`, o sea el mismo dato
 * dos veces. Un parámetro que se puede pasar a medias es exactamente cómo el
 * arreglo acaba en un lado de la llamada y el fallo en el otro.
 *
 * @param entry ficha médica del dossier (o nada).
 * @param row la fila del board o del semanal, con sus campos `status_*` y `roster_*`.
 * @returns null, o `{text, className, title, superseded}` listos para pintar.
 */
/**
 * La fecha de la afirmación de disponibilidad MÁS NUEVA que ya lleva la fila.
 *
 * La de plantilla cuenta **sólo si su capa de verdad pinta algo**: `rosterMark`
 * se calla con `ACTIVE`, con `TEAM_UNIT` y cuando la prensa ya lo dice mejor, y
 * subordinar una ficha a una afirmación que nadie ve sería peor que no
 * subordinarla — se preguntaría por una marca invisible. Se le pregunta a
 * `rosterMark`, que es la única autoridad de cuándo habla esa capa, en vez de
 * copiar aquí su lista de estados.
 */
function newerClaimDate(row) {
  if (!row) return null;
  const fechas = [];
  if (row.status_verified_at) fechas.push(String(row.status_verified_at));
  if (row.roster_source_as_of && rosterMark(row)) fechas.push(String(row.roster_source_as_of));
  if (!fechas.length) return null;
  // Las dos son `YYYY-MM-DD`, así que ordenar como texto ordena por fecha.
  return fechas.sort().at(-1);
}


export function availabilityMark(entry, row = null) {
  if (!entry || !entry.level) return null;
  const statusLabel = row?.status_label ?? null;
  const label = AVAILABILITY_LABEL[entry.level] ?? entry.level;
  // EL DESACUERDO ES INFORMACIÓN; EL ACUERDO REPETIDO ES RUIDO. Una ficha vieja
  // que dice exactamente lo mismo que la marca de hoy no aporta nada y deja la
  // fila con la misma palabra dos veces.
  if (statusLabel && label === statusLabel) return null;
  const date = typeof entry.date === "string" && entry.date ? entry.date : null;
  // Sin fecha no se puede sostener que sea más nuevo que nada: se subordina
  // igual. UNKNOWN > STALE PRESENTADO COMO ACTUAL.
  const competing = newerClaimDate(row);
  const superseded = Boolean(competing) && (!date || date < competing);
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
