/**
 * El adaptador de Sleeper: seguir UN draft concreto y decir la verdad sobre él.
 *
 * Vive aquí y no dentro de una pantalla porque lo usan DOS: el board de
 * `/fantasy` y el Draft Assistant. Copiarlo habría sido el mismo fallo que ya
 * costó dos iteraciones en este proyecto —dos traductores del mismo formato con
 * distinta cobertura— aplicado al sitio donde más duele: el estado de un draft
 * en curso.
 *
 * Lo que emite son PICKS CANÓNICOS. Ésa es la frontera que hace de Sleeper un
 * adaptador y no el producto: quien consume esto no sabe de dónde vino, y el
 * modo manual produce exactamente la misma forma.
 *
 * ## Lo ESTABLE se pide una vez; lo VIVO, cada quince segundos
 *
 *     ESTABLE (una vez, en caché)     VIVO (cada sondeo)
 *     -------------------------      ------------------
 *     liga: puntuación, plantilla     los picks del draft
 *     tamaño y temporada              el `status` del draft
 *     rosters: quién es cada uno      mi puesto en la parrilla
 *     mi user_id y mi roster_id       equipos, rondas y reloj
 *
 * Volver a pedir la configuración de la liga cada quince segundos sería gastar
 * la cuota de otro en datos que no cambian durante un draft. Y al revés: el
 * `status` **tiene** que releerse, porque es la tercera condición de `LIVE` y
 * cachearlo dejaba a un draft terminado diciendo LIVE para siempre.
 *
 * El puesto está en la columna de la derecha por la misma razón, y no porque
 * cambie: **aparece tarde**. `draft_order` no existe hasta que se sortea el
 * orden, así que quien abre el asistente antes del sorteo lo derivaba una vez,
 * le salía `null`, y se quedaba sin columna y sin calendario el resto de la
 * noche. La derivación es pura y el objeto del draft ya viene en el sondeo:
 * rehacerla no cuesta ni una petición.
 *
 * ## Un draft, no «los drafts de la liga»
 *
 * La sesión se ata a `{league_id, draft_id, season}`. El id se resuelve una vez
 * —prefiriendo el que está en curso de esta temporada— y a partir de ahí se
 * sondea ESE draft. Sin eso, un mock de la semana pasada o el draft del año
 * anterior entran por la misma puerta y nadie lo nota.
 *
 * ## Identidad: se DERIVA, no se adivina
 *
 * El usuario da su nombre de Sleeper. De ahí se saca su `user_id`, de los
 * rosters su `roster_id`, y del draft su puesto (`draft_order`, y si no
 * `slot_to_roster_id`). Ninguna comparación por nombre visible. Lo que no se
 * pueda establecer queda `null`: un puesto inventado produce un calendario de
 * picks inventado, que es peor que no tener calendario.
 *
 * ## Gridiron NO ficha en Sleeper
 *
 * Sleeper no publica una API de escritura para drafts. Este adaptador es de
 * SÓLO LECTURA y la pantalla lo dice donde se pulsa: tú eliges en Sleeper y
 * Gridiron se entera.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ROSTER } from "./draftLog.js";
import { DRAFT_STATUS, mySlot as slotFromDraft, syncState } from "./draftSync.js";

// El único destino externo de todo el sitio. La CSP no permite ningún otro, y
// CI comprueba que `fetch` no aparezca fuera de los ficheros declarados.
const SLEEPER = "https://api.sleeper.app/v1";

// Cada quince segundos. Sleeper no publica un límite duro para lecturas
// anónimas; quince es cómodo para todos y suficiente para un draft, donde un
// pick tarda de treinta segundos a dos minutos.
export const POLL_MS = 15000;

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.replace(SLEEPER, "")} returned ${response.status}`);
  return response.json();
}

/**
 * Índice de identidad: `sleeper_id` -> fila del board.
 *
 * El mapa viaja HORNEADO en el payload (`fantasy.sleeper_ids`), construido en
 * el build desde los rosters de nflverse, que publican `sleeper_id` junto al
 * `gsis_id` que usa el board. Resolver por identificador es lo único correcto:
 * el nombre abreviado no distingue a los dos «B.Robinson» de Atlanta, y en
 * mitad de un draft tachar al jugador equivocado te borra del tablero a alguien
 * que sí puedes elegir.
 *
 * Sin mapa no hay resolución por nombre de repuesto. Se marca UNMAPPED.
 */
function buildIndex(pool, idMap) {
  const byPlayerId = new Map();
  for (const row of pool) byPlayerId.set(String(row.player_id), row);
  const index = new Map();
  for (const [sleeperId, playerId] of Object.entries(idMap ?? {})) {
    const row = byPlayerId.get(String(playerId));
    if (row) index.set(String(sleeperId), row);
  }
  return index;
}

/**
 * Sincronización con UN draft de Sleeper.
 *
 * Devuelve el estado del sondeo, los picks ya resueltos contra el board y lo
 * que se pudo establecer de la liga y de mi identidad. Vive en su propio hook
 * para que la pantalla siga funcionando entera sin él: si la red falla, si
 * Sleeper cambia algo o si simplemente no lo activas, lo que queda es el
 * tablero manual de siempre. Una integración que al romperse se lleva por
 * delante la pantalla no vale para un draft.
 */
export function useSleeperDraft(pool, { leagueId, season, userId, idMap } = {}) {
  const [status, setStatus] = useState({ state: "idle" });
  const [tick, setTick] = useState(0);
  const index = useMemo(() => buildIndex(pool, idMap), [pool, idMap]);
  // El índice cambia de identidad en cada render del padre aunque su contenido
  // sea el mismo; guardarlo en una ref evita reiniciar el sondeo —y con él la
  // reconciliación entera— por un cambio que no es un cambio.
  const indexRef = useRef(index);
  indexRef.current = index;

  // Reloj de pantalla. Sin él, «última sincronización hace 8s» se congela en 8s
  // hasta el siguiente sondeo: la etiqueta envejecería a saltos de 15 segundos
  // y en los huecos diría algo falso.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!leagueId) {
      setStatus({ state: "idle" });
      return undefined;
    }
    let cancelled = false;
    // LO ESTABLE, resuelto una vez y reutilizado en cada sondeo.
    let stable = null;

    /** Liga, rosters, draft e identidad. Una vez por liga. */
    async function resolveStable() {
      const league = await getJSON(`${SLEEPER}/league/${leagueId}`);
      const drafts = await getJSON(`${SLEEPER}/league/${leagueId}/drafts`);
      if (!Array.isArray(drafts) || drafts.length === 0) {
        throw new Error("that league has no draft yet");
      }
      // El draft de ESTA temporada, prefiriendo el que está en curso. Sin este
      // filtro, un mock de la semana pasada o el draft del año anterior entran
      // por la misma puerta y se pintan igual que uno vivo.
      const wanted = String(season ?? league?.season ?? "");
      const sameSeason = drafts.filter((d) => !wanted || String(d.season ?? "") === wanted);
      const pool_ = sameSeason.length > 0 ? sameSeason : drafts;

      // EL DRAFT DE LA LIGA MANDA SOBRE CUALQUIER MOCK.
      //
      // `/league/{id}/drafts` devuelve también los mocks creados desde esa liga,
      // y elegir «el que esté drafting» dejaba que un mock abandonado en ese
      // estado SECUESTRARA la sesión: el asistente seguía el draft equivocado y
      // nada en pantalla lo decía. Peor, el id se fija en la primera resolución,
      // así que se quedaba con el mock toda la noche.
      //
      // El objeto de la liga trae su `draft_id` —el de verdad— y ésa es la
      // fuente autoritativa. La heurística por estado queda sólo para cuando la
      // liga no lo publica.
      const oficial = league?.draft_id
        ? pool_.find((d) => String(d.draft_id) === String(league.draft_id))
        : null;
      const chosen = oficial
        ?? pool_.find((d) => d.status === DRAFT_STATUS.DRAFTING)
        ?? pool_.find((d) => d.status === DRAFT_STATUS.PRE)
        ?? pool_[0];
      const draftId = String(chosen.draft_id);
      // El objeto completo del draft: `draft_order` y `slot_to_roster_id` no
      // vienen en el listado de la liga, y son de donde sale mi puesto.
      const draft = await getJSON(`${SLEEPER}/draft/${draftId}`).catch(() => chosen);

      // IDENTIDAD, derivada. El usuario escribe su nombre de Sleeper; de ahí
      // sale el `user_id`, de los rosters el `roster_id` y del draft el puesto.
      let resolvedUser = null;
      let rosterId = null;
      if (userId) {
        resolvedUser = await getJSON(`${SLEEPER}/user/${encodeURIComponent(userId)}`)
          .then((u) => (u?.user_id ? String(u.user_id) : null))
          .catch(() => null);
        // Si `/user` no lo reconoce puede ser que ya sea un user_id.
        if (!resolvedUser && /^\d+$/.test(String(userId))) resolvedUser = String(userId);
        const rosters = await getJSON(`${SLEEPER}/league/${leagueId}/rosters`).catch(() => []);
        const mine = (Array.isArray(rosters) ? rosters : []).find(
          (r) => String(r?.owner_id) === String(resolvedUser)
            || (Array.isArray(r?.co_owners) && r.co_owners.map(String).includes(String(resolvedUser)))
        );
        if (mine?.roster_id != null) rosterId = String(mine.roster_id);
      }
      const slot = slotFromDraft({ draft, userId: resolvedUser, rosterId });
      return {
        leagueId: String(leagueId),
        draftId,
        season: String(draft?.season ?? chosen?.season ?? wanted ?? ""),
        league,
        draft,
        userId: resolvedUser,
        rosterId,
        slot,
        // La configuración REAL de la liga. Lo que no venga queda fuera: el
        // preajuste manual es respaldo, no relleno silencioso.
        settings: {
          teams: Number(draft?.settings?.teams ?? league?.total_rosters) || null,
          rounds: Number(draft?.settings?.rounds) || null,
          type: typeof draft?.type === "string" ? draft.type : null,
          rosterPositions: Array.isArray(league?.roster_positions)
            ? league.roster_positions : null,
          scoringSettings: league?.scoring_settings ?? null,
          name: typeof league?.name === "string" ? league.name : null,
          pickTimer: Number(draft?.settings?.pick_timer) || null,
        },
      };
    }

    async function poll() {
      try {
        setStatus((previous) => ({ ...previous, syncing: true }));
        if (!stable) stable = await resolveStable();
        // LO VIVO: el estado del draft y sus picks, y nada más.
        const [draft, picks] = await Promise.all([
          getJSON(`${SLEEPER}/draft/${stable.draftId}`).catch(() => stable.draft),
          getJSON(`${SLEEPER}/draft/${stable.draftId}/picks`),
        ]);
        if (cancelled) return;

        // EL PUESTO SE REDERIVA EN CADA SONDEO, PORQUE APARECE TARDE.
        //
        // Sleeper no publica `draft_order` hasta que se sortea el orden, que en
        // una liga corriente pasa minutos antes de empezar. Derivarlo sólo en la
        // primera resolución dejaba el puesto en UNKNOWN para toda la sesión si
        // abrías el asistente antes del sorteo: la parrilla no marcaba tu
        // columna y el calendario de picks no existía, y lo único que lo
        // arreglaba era recargar la página — algo que nadie hace en mitad de un
        // draft porque nada en pantalla dice que haga falta.
        //
        // La derivación es pura y sobre el draft que ya se acaba de pedir, así
        // que no cuesta ninguna petición extra. `stable` se sustituye sólo
        // cuando el valor CAMBIA de verdad: reasignarlo en cada sondeo obligaría
        // a recalcular la parrilla y la plantilla cada quince segundos.
        const freshSlot = slotFromDraft({
          draft, userId: stable.userId, rosterId: stable.rosterId,
        });
        const freshSettings = {
          ...stable.settings,
          teams: Number(draft?.settings?.teams ?? stable.league?.total_rosters)
            || stable.settings.teams,
          rounds: Number(draft?.settings?.rounds) || stable.settings.rounds,
          pickTimer: Number(draft?.settings?.pick_timer) || stable.settings.pickTimer,
          type: typeof draft?.type === "string" ? draft.type : stable.settings.type,
        };
        const settingsChanged = ["teams", "rounds", "pickTimer", "type"].some(
          (key) => freshSettings[key] !== stable.settings[key]
        );
        if ((freshSlot != null && freshSlot !== stable.slot) || settingsChanged) {
          stable = { ...stable, draft, slot: freshSlot ?? stable.slot, settings: freshSettings };
        }

        // Resolución POR IDENTIFICADOR. Un pick que no está en el mapa se
        // cuenta como UNMAPPED y no se resuelve por nombre: emparejar al
        // jugador equivocado es peor que no emparejar a nadie.
        //
        // La reconciliación es total en cada sondeo —se recorre la lista
        // entera, no «lo nuevo»— así que reconectar después de perderse cuatro
        // picks los recupera sin duplicar ninguno: la lista de Sleeper ES el
        // estado, y `pick_no` la hace idempotente.
        const canonical = [];
        const unmapped = [];
        const current = indexRef.current;
        for (const pick of Array.isArray(picks) ? picks : []) {
          if (!pick?.player_id) continue;
          const row = current.get(String(pick.player_id));
          if (!row) {
            unmapped.push(pick);
            continue;
          }
          // El dueño sale del `roster_id`, que Sleeper rellena también en los
          // autopicks, y `picked_by` sólo como respaldo. Sin identidad
          // establecida es UNKNOWN y no OPPONENT: «no sé de quién es» y «es de
          // otro» no son lo mismo, y el segundo te borraría tus propios picks
          // de tu plantilla sin decir nada.
          const mineByRoster = stable.rosterId != null && pick.roster_id != null
            && String(pick.roster_id) === String(stable.rosterId);
          const mineByUser = stable.userId != null && pick.picked_by != null
            && String(pick.picked_by) === String(stable.userId);
          const known = stable.rosterId != null || stable.userId != null;
          canonical.push({
            playerId: row.player_id,
            roster: !known
              ? ROSTER.UNKNOWN
              : (mineByRoster || mineByUser) ? ROSTER.MINE : ROSTER.OPPONENT,
            pickNo: Number(pick.pick_no) || null,
            providerId: String(pick.player_id),
          });
        }
        setStatus({
          state: "ok",
          syncing: false,
          // `lastSyncAt` es el instante del último sondeo CORRECTO, y es lo que
          // se pinta. La versión anterior lo guardaba y no lo enseñaba nunca.
          lastSyncAt: Date.now(),
          draft,
          stable,
          total: Array.isArray(picks) ? picks.length : 0,
          canonical,
          unmapped,
        });
      } catch (error) {
        // El error NO borra `lastSyncAt` ni los picks ya reconciliados: «falló
        // hace un momento, pero lo último bueno es de hace 40 segundos» son dos
        // hechos distintos y los dos importan. El tablero se queda en pantalla.
        if (!cancelled) {
          setStatus((previous) => ({
            ...previous,
            state: "error",
            syncing: false,
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
  }, [leagueId, season, userId]);

  // `tick` entra en la dependencia para que la etiqueta de antigüedad se
  // recalcule cada segundo aunque no haya llegado ningún sondeo nuevo.
  return useMemo(() => {
    const draft = status.draft ?? null;
    const stable = status.stable ?? null;
    return {
      ...status,
      draft,
      stable,
      view: syncState({
        connected: Boolean(leagueId),
        error: status.state === "error" ? status.message : null,
        lastSyncAt: status.lastSyncAt ?? null,
        draftStatus: draft?.status,
        syncing: Boolean(status.syncing),
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, leagueId, tick]);
}
