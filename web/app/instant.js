/**
 * UN INSTANTE, ESCRITO PARA LEERSE.
 *
 * El payload fecha sus fuentes en ISO-8601 («2026-10-14T13:59:16Z»), que es lo
 * correcto para comparar y para guardar, y es ilegible pintado tal cual: en un
 * teléfono ocupa dos líneas y la hora queda partida por la mitad. Aquí se
 * convierte en «Oct 14, 2026 · 13:59 UTC» — con el AÑO, porque un instante
 * sin año leído doce meses después es una fecha de este año.
 *
 * Tres decisiones, y las tres son de la regla 5:
 *
 *   1. SIEMPRE EN UTC Y CON LA ZONA ESCRITA. La hora local de quien mira
 *      cambiaría el texto entre el servidor y el navegador (el build corre en
 *      UTC) y dejaría una hora sin zona, que no es un instante.
 *   2. NO SE INVENTA NADA. Lo que no se puede leer como fecha se devuelve tal
 *      cual: un texto raro a la vista es mejor que una fecha fabricada.
 *   3. UN `null` SIGUE SIENDO `null`. Quien pinta decide escribir UNKNOWN; este
 *      módulo no rellena un hueco con la fecha de hoy.
 */

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
/* CON ZONA, o no es un instante. «2026-10-14T13:59» a secas lo lee `Date.parse`
   en la hora LOCAL de quien ejecuta: el build (UTC) y un teléfono en Ciudad de
   México pintarían dos horas distintas rotuladas las dos «UTC». Sin zona se
   devuelve el texto tal cual — decisión 2. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** «2026-10-14» → «Oct 14, 2026»; un instante ISO → «Oct 14, 2026 · 13:59 UTC». */
export function instantLabel(value) {
  if (value === null || value === undefined || value === "") return null;
  const texto = String(value);
  const fecha = SOLO_FECHA.exec(texto);
  if (fecha) {
    const mes = MESES[Number(fecha[2]) - 1];
    return mes ? `${mes} ${Number(fecha[3])}, ${fecha[1]}` : texto;
  }
  if (!INSTANTE.test(texto)) return texto;
  const ms = Date.parse(texto);
  if (!Number.isFinite(ms)) return texto;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MESES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}
