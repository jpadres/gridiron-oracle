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
  data_dates: null,
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
    console.warn("[gridiron-oracle] unreadable payload, publishing empty:", error.message);
    return EMPTY;
  }
}

/**
 * El `sleeper_id` de cada fila, HORNEADO en el build.
 *
 * El payload trae el mapa `sleeper_id -> player_id` para el adaptador; aquí se
 * invierte una vez y cada fila con `player_id` recibe su `sid`. Es lo que
 * permite pintar la foto de un jugador por identificador sin una sola
 * petición a la API y sin adivinar por nombre. Una fila sin id en el mapa se
 * queda sin `sid`, y la interfaz enseña iniciales.
 */
function attachSleeperIds(payload) {
  const map = payload?.fantasy?.sleeper_ids;
  if (!map || typeof map !== "object") return payload;
  const sidOf = new Map();
  for (const [sid, playerId] of Object.entries(map)) sidOf.set(String(playerId), String(sid));
  const mark = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row && typeof row === "object" && row.player_id != null && !row.sid) {
        const sid = sidOf.get(String(row.player_id));
        if (sid) row.sid = sid;
      }
    }
  };
  const f = payload.fantasy ?? {};
  mark(f.board);
  mark(f.rookies);
  mark(f.specialists?.kickers);
  mark(f.specialists?.defenses);
  const w = payload.fantasy_weekly ?? {};
  if (Array.isArray(w.rankings)) mark(w.rankings);
  else if (w.rankings && typeof w.rankings === "object") Object.values(w.rankings).forEach(mark);
  mark(w.kickers);
  mark(w.defenses);
  return payload;
}

export const model = attachSleeperIds(decode());

export const hasData = !model.placeholder && model.predictions.length > 0;

/**
 * Cuándo se sacó una sección de los datos, o `null` si el payload no lo dice.
 *
 * Devuelve `null` A PROPÓSITO cuando falta, y quien lo pinte tiene que escribir
 * «unknown» en vez de caer al sello de build del pie. El build es cuándo se
 * compiló el SITIO: un commit de documentación lo refresca sin tocar un dato, y
 * prestárselo a una cuota —que caduca en minutos— es fabricar actualidad.
 *
 * Un payload anterior a este campo devuelve `null` y la interfaz dirá que no lo
 * sabe, que es la verdad hasta la siguiente regeneración semanal.
 */
export function dataDate(section) {
  const value = model?.data_dates?.[section];
  return typeof value === "string" && value ? value : null;
}

/**
 * Formatea un número **en inglés de EE. UU.**, o devuelve un guion si no lo hay.
 *
 * `toLocaleString` y no `toFixed`: también agrupa los millares como toca.
 *
 * El locale es `en-US` porque toda la interfaz está en inglés, y mezclar los
 * dos convenios es peor que elegir mal: «VOR 97,7» junto a «12-team league» se
 * lee como un error de datos, no como una decisión de formato. Punto decimal y
 * coma de millares, que es lo que espera quien lee el resto de la página.
 */
export function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", {
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
