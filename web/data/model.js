/**
 * Descompresión del payload del modelo — EN BUILD TIME.
 *
 * `model.b64.js` lleva el payload como gzip+base64 (~24 KB). Este módulo lo
 * descomprime **una sola vez, en el servidor, mientras Next.js genera las
 * páginas**. El resultado acaba dentro del HTML estático.
 *
 * Ese es todo el truco de por qué el sitio no hace ni una petición de red en
 * runtime, no necesita base de datos ni endpoints, y tiene una superficie de
 * ataque de cero: para cuando el navegador ve la página, los datos ya son texto
 * dentro de ella.
 *
 * Comprimido y no un `.json` a secas porque el JSON crudo ronda los 200 KB y
 * git lo versionaría entero en cada regeneración semanal.
 */

import { gunzipSync } from "node:zlib";
import { MODEL_B64 } from "./model.b64.js";

/** Payload vacío: la web se construye igual y lo dice en vez de romperse. */
const EMPTY = {
  placeholder: true,
  generated_at: null,
  week: null,
  predictions: [],
  bets: [],
  ratings: [],
  validation: null,
  fantasy: null,
  fantasy_weekly: null,
};

function decode() {
  if (!MODEL_B64) return EMPTY;
  try {
    return JSON.parse(gunzipSync(Buffer.from(MODEL_B64, "base64")).toString("utf8"));
  } catch (error) {
    // Si el payload está corrupto, es mejor publicar un sitio que lo diga que
    // fallar el build entero y quedarse sin web.
    console.warn("[gridiron-oracle] payload ilegible, se publica vacío:", error.message);
    return EMPTY;
  }
}

export const model = decode();

export const hasData = !model.placeholder && model.predictions.length > 0;

/** Formatea un número, o devuelve un guion si no lo hay. */
export function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(digits);
}

/** Formatea una probabilidad como porcentaje. */
export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}
