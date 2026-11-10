/**
 * LA EDAD DEPENDE DE CUÁNDO SE MIRA.
 *
 *     PYTHON CIERRA. EL NAVEGADOR SÓLO PUEDE DEGRADAR, NUNCA REABRIR.
 *
 * La etiqueta de cada fuente se calcula al EXPORTAR el payload, y la página se
 * lee días después. Mientras la exportación corra cada semana da igual; el día
 * que se para, nada vuelve a calcular nada y la página sigue diciendo FRESH
 * para siempre. Pasó: el 10 de noviembre de 2026 enseñaba «10 de 12 FRESH»
 * sobre un payload del 14 de octubre. La página que existe para avisar de que
 * la ingesta se ha parado era ciega justo a eso.
 *
 * Es la misma partición que `gameClock.js`, por la misma razón. «¿De cuándo es
 * el dato?» es un hecho del fichero y lo fija Python (`as_of`). «¿Sigue siendo
 * actual?» depende del instante en que se pregunta, y eso sólo lo sabe el reloj
 * de quien mira. El umbral NO vive aquí: Python publica `fresh_for_hours`
 * leyéndolo de `freshness.WINDOWS`, y este módulo sólo compara.
 *
 * Y con la misma asimetría: lo que Python dio por STALE o BROKEN no vuelve a
 * FRESH porque el reloj del navegador vaya atrasado. Sólo se baja.
 */

import { numberOrNull } from "../numbers.js";

export const LABEL = { FRESH: "FRESH", STALE: "STALE", BROKEN: "BROKEN" };

/**
 * La etiqueta de UNA fuente vista a las `nowMs`.
 *
 * Devuelve `{ label, aged, ageMs }`. `aged` es verdadero sólo cuando ESTE
 * módulo bajó la etiqueta: sirve para que la pantalla diga que el motivo es el
 * tiempo transcurrido y no algo que Python midió. Con `nowMs` nulo —el primer
 * pintado, que tiene que coincidir con el del servidor— no se afirma nada
 * nuevo y vale lo que dijo Python.
 */
export function effective(source, nowMs) {
  const base = { label: source?.label ?? LABEL.BROKEN, aged: false, ageMs: null };
  const t = source?.as_of ? Date.parse(source.as_of) : NaN;
  if (nowMs === null || nowMs === undefined || !Number.isFinite(t)) return base;
  const ageMs = nowMs - t;
  // Un reloj atrasado daría una edad negativa: no es una edad, no se publica.
  if (ageMs >= 0) base.ageMs = ageMs;
  if (base.label !== LABEL.FRESH) return base;         // lo cerrado no se reabre
  const horas = numberOrNull(source.fresh_for_hours);
  if (horas === null) return base;                      // no caduca, o no se sabe
  if (ageMs > horas * 3600_000) return { label: LABEL.STALE, aged: true, ageMs };
  return base;
}

/** Cuántas fuentes hay en cada etiqueta, vistas a las `nowMs`. */
export function tally(sources, nowMs) {
  const out = { FRESH: 0, STALE: 0, BROKEN: 0 };
  for (const s of sources ?? []) {
    const { label } = effective(s, nowMs);
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

/** «27d 4h», «3h 12m», «18m». `null` si no hay edad que decir. */
export function ageLabel(ms) {
  const n = numberOrNull(ms);
  if (n === null || n < 0) return null;
  const total = Math.floor(n / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
