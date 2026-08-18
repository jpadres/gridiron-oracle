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
  research: null,
  narrative: null,
  dossier: null,
  survivor: null,
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

/**
 * Formatea un número **en español**, o devuelve un guion si no lo hay.
 *
 * Con coma decimal, no con punto. El sitio entero está en español y la prosa ya
 * escribe «0,6 puntos de MAE»; que la tabla de al lado ponga «0.2128» es la
 * clase de incoherencia que hace dudar del resto.
 *
 * `toLocaleString` y no `toFixed`: también agrupa los millares como toca. Ojo
 * con una peculiaridad del español —la agrupación **empieza en cinco cifras**,
 * así que 3829 se escribe sin punto y 10.000 con él. Es correcto, no un fallo.
 */
export function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Formatea una probabilidad como porcentaje, también con coma decimal. */
export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${num(Number(value) * 100, digits)}%`;
}

/**
 * Índice `player_id` -> peor situación médica conocida del dossier.
 *
 * Peor y no la más reciente: si un jugador arrastra dos avisos y uno dice
 * FUERA, para alinear manda el FUERA aunque el otro sea de ayer.
 *
 * Vive aquí y no en cada página porque lo usan el board de draft y el ranking
 * semanal, y dos copias del mismo criterio se desincronizan a la primera.
 */
const LEVELS = ["FUERA", "DUDA", "SEGUIR"];

export function availabilityByPlayer(dossier) {
  const worst = {};
  for (const entry of dossier?.medical ?? []) {
    if (!entry.player_id) continue;
    const current = worst[entry.player_id];
    if (!current || LEVELS.indexOf(entry.level) < LEVELS.indexOf(current.level)) {
      worst[entry.player_id] = entry;
    }
  }
  return worst;
}

/**
 * Una línea de research por jugador, para colgarla de su fila del ranking.
 *
 * Prioridad deliberada: primero lo que **cambia la disponibilidad**, luego lo
 * que cambia el papel, y sólo al final el contexto. Si un jugador está
 * descartado, eso manda sobre cualquier crónica de campamento por buena que
 * sea; y un cambio de depth chart manda sobre un elogio de agosto.
 *
 * El texto se recorta a una frase. La ficha completa, con su fuente y su fecha,
 * está en /research — aquí sólo cabe el aviso.
 */
export function briefsByPlayer(dossier, research) {
  const briefs = {};

  // 3. Contexto de campamento, sólo el de sustancia alta.
  for (const entry of dossier?.camp ?? []) {
    if (entry.player_id && entry.substance === "alta") {
      briefs[entry.player_id] = firstSentence(entry.report);
    }
  }
  // 2. Prensa reciente enlazada a un jugador.
  for (const item of research?.items ?? []) {
    for (const id of item.player_ids ?? []) briefs[id] = item.headline;
  }
  // 1. Parte médico: lo último que se escribe es lo que gana.
  for (const entry of dossier?.medical ?? []) {
    if (entry.player_id && entry.level !== "SEGUIR") {
      briefs[entry.player_id] = `${entry.situation}. ${entry.status}`;
    }
  }
  return briefs;
}

function firstSentence(text, max = 150) {
  if (!text) return "";
  const cut = text.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return stop > 40 ? cut.slice(0, stop + 1) : `${cut.trim()}…`;
}
