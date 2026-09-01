/**
 * Qué ficha va a qué sección de /research. Función pura, con test.
 *
 * ## El agujero que esto tapa
 *
 * La página tenía tres cajas y sólo dos con contenido:
 *
 *     today            los 10 más accionables       -> «What moves a lineup»
 *     relevancia >= 4  se calculaba y NO se pintaba  -> a ningún sitio
 *     relevancia < 4   -> «Everything else, by day»
 *
 * Con 40 fichas de relevancia 4-5 en el barrido, **30 no se pintaban en ninguna
 * parte**: la página enseñaba las veinte menos importantes y escondía las
 * treinta más. No fallaba nada — la sección existía, tenía título y contenido.
 *
 * La regla ahora es que ninguna ficha se cae: lo que no entra en los diez
 * accionables sigue publicándose, agrupado por día y por delante del contexto.
 */

/** Clave de identidad de una ficha. `today` lleva copias enriquecidas. */
const keyOf = (item) => `${item.date ?? ""}|${item.headline ?? ""}`;

export const HEADLINE_RELEVANCE = 4;

/**
 * Reparte las fichas en las tres cajas, sin perder ninguna.
 *
 * Devuelve `{ destacadas, resto }`: las de relevancia alta que NO están ya en
 * `today`, y las de relevancia baja. La suma de las tres cajas es el total.
 */
export function partition(items, today = []) {
  const yaPintadas = new Set((today ?? []).map(keyOf));
  const destacadas = [];
  const resto = [];
  for (const item of items ?? []) {
    const alta = (item.fantasy_relevance ?? 1) >= HEADLINE_RELEVANCE;
    if (!alta) {
      resto.push(item);
    } else if (!yaPintadas.has(keyOf(item))) {
      destacadas.push(item);
    }
  }
  return { destacadas, resto };
}

/** Agrupa por día conservando el orden de entrada. */
export function byDay(items, sinFecha = "Undated") {
  const out = new Map();
  for (const item of items ?? []) {
    const day = item.date ?? sinFecha;
    if (!out.has(day)) out.set(day, []);
    out.get(day).push(item);
  }
  return out;
}
