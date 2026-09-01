/**
 * El adaptador de Sleeper: sondeo, identidad de jugador y estado de frescura.
 *
 * Vive aquí y no dentro de una pantalla porque AHORA LO USAN DOS: el board de
 * /fantasy y el Live Draft Assistant. Copiarlo habría sido el mismo fallo que
 * ya costó dos iteraciones en este proyecto —dos traductores del mismo formato
 * con distinta cobertura— aplicado al sitio donde más duele: el estado de un
 * draft en curso.
 *
 * Lo que emite son PICKS CANÓNICOS, no dos listas de ids. Ésa es la frontera
 * que hace de Sleeper un adaptador y no el producto: quien consume esto no
 * sabe de dónde vino, y el modo manual produce exactamente la misma forma.
 *
 * ## Sobre `SLEEPER_LIVE_BROWSER`
 *
 * El sondeo corre en el NAVEGADOR del usuario. La CSP ya permite `connect-src`
 * a `api.sleeper.app` —es el único destino externo de todo el sitio— y no hace
 * falta ni backend ni ruta de servidor. Desde el contenedor de desarrollo el
 * proxy devuelve 403, así que aquí no se puede EJERCITAR; eso es exactamente
 * lo que mantiene la capacidad en BLOCKED, y por qué el modo manual no es un
 * plan B sino el camino que se sabe que funciona.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import { ROSTER } from "./draftLog.js";
import { DRAFT_STATUS, syncState } from "./draftSync.js";

// El único destino externo de todo el sitio. La CSP no permite ningún otro, y
// CI comprueba que `fetch` no aparezca fuera de los ficheros declarados.
const SLEEPER = "https://api.sleeper.app/v1";

// Cada quince segundos. Sleeper no publica un límite duro para lecturas
// anónimas; quince es cómodo para todos y suficiente para un draft, donde un
// pick tarda de treinta segundos a dos minutos.
export const POLL_MS = 15000;

function normalize(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Índice para cruzar los picks de Sleeper con este board.
 *
 * Se cruza por **nombre completo y posición**, no por el abreviado que se pinta
 * en la tabla: «B.Robinson» no distingue a Bijan de Brian Robinson, y ese error
 * exacto ya costó una iteración en el dossier. El equipo sólo se usa para
 * deshacer empates, y a propósito no como parte de la clave: en pretemporada el
 * equipo del board y el de Sleeper pueden discrepar legítimamente por un
 * traspaso, y exigir que coincidan haría fallar emparejamientos correctos.
 *
 * Si después del desempate por equipo sigue habiendo dos candidatos, **no se
 * empareja ninguno**. Tachar al jugador equivocado en mitad de un draft es peor
 * que no tachar a nadie: te borra del tablero a alguien que sí puedes elegir.
 */
function buildIndex(board) {
  const index = new Map();
  for (const row of board) {
    const key = `${normalize(row.player_full_name ?? row.player_name)}|${row.position}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function resolvePick(index, pick) {
  const metadata = pick?.metadata ?? {};
  const name = normalize(`${metadata.first_name ?? ""} ${metadata.last_name ?? ""}`);
  if (!name) return null;
  const candidates = index.get(`${name}|${metadata.position}`);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const byTeam = candidates.filter((row) => row.team === metadata.team);
  return byTeam.length === 1 ? byTeam[0] : null;
}

// Cuántos titulares tienes ya de cada posición, para DECIRLO como hecho junto
// a la sugerencia. Antes esto era un multiplicador (VOR × 0,35 si la posición
// «estaba llena» según una plantilla estándar hardcodeada) que convertía el
// board validado en una recomendación personalizada que ningún experimento
// midió — y encima sobre una estructura que nadie había declarado. El VOR se
// enseña puro; lo que tienes se enseña aparte, como conteo.
const TYPICAL_STARTERS = { QB: 1, RB: 2, WR: 3, TE: 1 };

/**
 * Sincronización con el draft de Sleeper.
 *
 * Devuelve el estado del sondeo y los picks ya cruzados con el board. Vive en su
 * propio hook para que el modo draft siga funcionando entero sin él: si la red
 * falla, si Sleeper cambia algo o si simplemente no lo activas, lo que queda es
 * el tablero manual de siempre. Una integración que al romperse se lleva por
 * delante la pantalla no vale para un draft.
 */
/**
 * Resumen de puntuación en una línea, sólo con lo que se puede afirmar.
 *
 * Se mira `rec` porque es lo que separa PPR de estándar y es lo que primero se
 * pregunta. **No se dice «PPR» cuando falta el campo**: se dice UNKNOWN. Una
 * etiqueta de puntuación equivocada cambia el orden del board entero, así que
 * es exactamente el sitio donde un valor por defecto hace más daño.
 */

export function useSleeperDraft(board, league, userId) {
  const [status, setStatus] = useState({ state: "idle" });
  const [tick, setTick] = useState(0);
  const index = useMemo(() => buildIndex(board), [board]);

  // Reloj de pantalla. Sin él, «última sincronización hace 8s» se congela en 8s
  // hasta el siguiente sondeo: la etiqueta envejecería a saltos de 15 segundos
  // y en los huecos diría algo falso.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!league) {
      setStatus({ state: "idle" });
      return undefined;
    }
    let cancelled = false;
    // El draft ELEGIDO se fija una vez; su ESTADO se relee en cada sondeo.
    //
    // Antes se cacheaba el objeto entero y no se volvía a mirar nunca. Como
    // `status` es la tercera condición de LIVE, un draft que TERMINABA mientras
    // mirabas seguía diciendo LIVE para siempre: el sondeo de picks seguía
    // saliendo bien y la copia en memoria seguía diciendo `drafting`. Exactamente
    // el fallo que `draftSync.js` existe para impedir, colado por la puerta de
    // atrás de una caché. Lo encontró la matriz de frescura.
    //
    // El id se mantiene pinneado a propósito: releer la lista no debe hacernos
    // SALTAR de draft a mitad de uno en curso.
    let draftId = null;

    async function poll() {
      try {
        const response = await fetch(`${SLEEPER}/league/${league}/drafts`);
        if (!response.ok) throw new Error(`the league returned ${response.status}`);
        const drafts = await response.json();
        if (!Array.isArray(drafts) || drafts.length === 0) {
          throw new Error("that league has no draft yet");
        }
        // Se prefiere el que está EN CURSO, y sólo si no hay ninguno se coge
        // el más reciente. Antes se cogía `drafts[0]` sin mirar `status`, así
        // que un draft terminado hace tres semanas se sondeaba y se pintaba
        // igual que uno vivo.
        const sorted = [...drafts].sort(
          (a, b) => String(b.season ?? "").localeCompare(String(a.season ?? ""))
        );
        const draft = (draftId && sorted.find((d) => d.draft_id === draftId))
          ?? sorted.find((d) => d.status === DRAFT_STATUS.DRAFTING)
          ?? sorted[0];
        draftId = draft.draft_id;
        const picksResponse = await fetch(`${SLEEPER}/draft/${draft.draft_id}/picks`);
        if (!picksResponse.ok) throw new Error(`the picks returned ${picksResponse.status}`);
        const picks = await picksResponse.json();
        if (cancelled) return;

        // El sondeo emite PICKS CANÓNICOS, no dos listas de ids. Es lo que
        // convierte a Sleeper en un adaptador: quien consume esto no sabe de
        // dónde vino, y el modo manual produce exactamente la misma forma.
        //
        // Sin `userId` el dueño es UNKNOWN y no OPPONENT: «no sé de quién es»
        // y «es de otro» no son lo mismo, y el segundo te borraría tus propios
        // picks de tu plantilla sin decir nada.
        const canonical = [];
        const unmatched = [];
        for (const pick of Array.isArray(picks) ? picks : []) {
          if (!pick?.player_id) continue;
          const row = resolvePick(index, pick);
          if (!row) {
            unmatched.push(pick);
            continue;
          }
          canonical.push({
            playerId: row.player_id,
            roster: !userId
              ? ROSTER.UNKNOWN
              : String(pick.picked_by) === String(userId)
                ? ROSTER.MINE
                : ROSTER.OPPONENT,
            pickNo: Number(pick.pick_no) || null,
            providerId: String(pick.player_id),
          });
        }
        setStatus({
          state: "ok",
          // `lastSyncAt` es el instante del último sondeo CORRECTO, y es lo que
          // se pinta. La versión anterior lo guardaba y no lo enseñaba nunca.
          lastSyncAt: Date.now(),
          draft,
          total: Array.isArray(picks) ? picks.length : 0,
          canonical,
          unmatched,
        });
      } catch (error) {
        // El error NO borra `lastSyncAt`: «falló hace un momento, pero lo último
        // bueno es de hace 40 segundos» son dos hechos distintos y los dos
        // importan.
        if (!cancelled) {
          setStatus((previous) => ({
            ...previous,
            state: "error",
            message: String(error.message ?? error),
          }));
        }
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [league, userId, index]);

  // `tick` entra en la dependencia para que la etiqueta de antigüedad se
  // recalcule cada segundo aunque no haya llegado ningún sondeo nuevo.
  return useMemo(() => {
    const draft = status.draft ?? null;
    return {
      ...status,
      draft,
      view: syncState({
        connected: Boolean(league),
        error: status.state === "error" ? status.message : null,
        lastSyncAt: status.lastSyncAt ?? null,
        draftStatus: draft?.status,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, league, tick]);
}
