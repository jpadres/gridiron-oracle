/**
 * El doble de la API de Sleeper, en UN sitio.
 *
 * Tres laboratorios necesitan servir Sleeper y copiarlo habría sido, por
 * cuarta vez en este proyecto, dos traductores del mismo formato con distinta
 * cobertura. Aquí duele especialmente: el adaptador resuelve POR ID contra el
 * mapa horneado y deriva la identidad de `draft_order` y de los rosters, así
 * que un doble al que le falte un campo no falla — prueba otra cosa y sale
 * verde. Ya pasó con un fixture sin `metadata.position`, que hizo esperar 180
 * timeouts seguidos.
 *
 * Sirve lo que el adaptador pide y nada más:
 *
 *     /user/{username}              -> user_id
 *     /league/{id}                  -> ajustes, plantilla, puntuación
 *     /league/{id}/drafts           -> los drafts (con ruido: mocks y el año pasado)
 *     /league/{id}/rosters          -> owner_id -> roster_id
 *     /draft/{id}                   -> orden, puestos y `status`
 *     /draft/{id}/picks             -> los picks
 */

export const USER_ID = "884444";
export const USERNAME = "jpadres";

export const PPR = { rec: 1 };
export const HALF = { rec: 0.5 };
export const STANDARD = { rec: 0 };

/** Una liga del doble: identidad, ajustes reales y su propio estado. */
export function crearLiga({
  id, draftId, teams, roster, scoring = PPR, mySlot, rounds = 15,
  season = "2026", type = "snake", name = null,
}) {
  const slotToRoster = {};
  const order = {};
  for (let s = 1; s <= teams; s += 1) {
    slotToRoster[s] = s;
    // Mi `user_id` ocupa MI puesto. Es de donde el adaptador lo deriva: si esto
    // no está, la identidad no se puede establecer y el puesto queda UNKNOWN.
    order[s === mySlot ? USER_ID : `u${id}${s}`] = s;
  }
  return {
    id, draftId, teams, mySlot, season, rounds,
    league: {
      league_id: id, name: name ?? `League ${id}`, season,
      total_rosters: teams, roster_positions: roster,
      scoring_settings: scoring, draft_id: draftId,
    },
    rosters: Array.from({ length: teams }, (_, i) => ({
      roster_id: i + 1,
      owner_id: i + 1 === mySlot ? USER_ID : `u${id}${i + 1}`,
    })),
    draft: {
      draft_id: draftId, status: "drafting", season, type,
      settings: { teams, rounds },
      draft_order: order, slot_to_roster_id: slotToRoster,
    },
    picks: [],
    caido: false,
  };
}

export const slotOf = (no, teams) => {
  const round = Math.floor((no - 1) / teams) + 1;
  const inRound = ((no - 1) % teams) + 1;
  return round % 2 === 0 ? teams - inRound + 1 : inRound;
};

/**
 * Emite el pick `no` con `row` del board.
 *
 * `sleeperOf` traduce el id del board al de Sleeper con el MISMO mapa horneado
 * que usa el producto. Inventarse el id aquí probaría el laboratorio, no el
 * emparejamiento.
 */
export function emitir(L, no, row, sleeperOf) {
  const slot = slotOf(no, L.teams);
  L.picks.push({
    pick_no: no,
    round: Math.floor((no - 1) / L.teams) + 1,
    draft_slot: slot,
    roster_id: slot,
    picked_by: slot === L.mySlot ? USER_ID : `u${L.id}${slot}`,
    player_id: sleeperOf[row.player_id] ?? `sin-mapear-${row.player_id}`,
    // Deliberadamente inútil: si algún día alguien vuelve a emparejar por
    // nombre, estos tests se ponen rojos en vez de pasar por la puerta de atrás.
    metadata: { first_name: "NO", last_name: "USAR", position: "XX", team: "XX" },
  });
}

/** Las filas del board que siguen libres en esa liga. */
export const libres = (L, board, sleeperOf) =>
  board.filter((r) => !L.picks.some((p) => p.player_id === sleeperOf[r.player_id]));

/** Intercepta la red del contexto y sirve las ligas dadas. */
export async function montar(ctx, ligas) {
  const porLiga = Object.fromEntries(ligas.map((l) => [l.id, l]));
  const porDraft = Object.fromEntries(ligas.map((l) => [l.draftId, l]));
  await ctx.route("**/api.sleeper.app/**", async (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(b),
    });
    const caido = () => route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    let m;
    if ((m = /\/user\/([^/?]+)/.exec(url))) {
      return decodeURIComponent(m[1]) === USERNAME
        ? json({ user_id: USER_ID, username: USERNAME })
        : route.fulfill({ status: 404, body: "null" });
    }
    if ((m = /\/league\/([^/?]+)\/drafts/.exec(url))) {
      const L = porLiga[m[1]];
      if (!L) return route.fulfill({ status: 404, body: "[]" });
      if (L.caido) return caido();
      // Ruido A PROPÓSITO: un mock y el draft del año pasado. Si el adaptador
      // cogiera «el primero» en vez del de esta temporada y en curso, se vería.
      return json([
        { draft_id: `${L.draftId}-mock`, status: "complete", season: L.season,
          settings: { teams: L.teams, rounds: L.rounds }, type: "snake" },
        { draft_id: `${L.draftId}-viejo`, status: "complete", season: "2025",
          settings: { teams: L.teams, rounds: L.rounds }, type: "snake" },
        L.draft,
      ]);
    }
    if ((m = /\/league\/([^/?]+)\/rosters/.exec(url))) {
      const L = porLiga[m[1]];
      if (!L) return route.fulfill({ status: 404, body: "[]" });
      return L.caido ? caido() : json(L.rosters);
    }
    if ((m = /\/league\/([^/?]+)$/.exec(url))) {
      const L = porLiga[m[1]];
      if (!L) return route.fulfill({ status: 404, body: "null" });
      return L.caido ? caido() : json(L.league);
    }
    if ((m = /\/draft\/([^/?]+)\/picks/.exec(url))) {
      const L = porDraft[m[1]];
      if (!L) return json([]);
      return L.caido ? caido() : json(L.picks);
    }
    if ((m = /\/draft\/([^/?]+)$/.exec(url))) {
      const L = porDraft[m[1]];
      if (!L) return route.fulfill({ status: 404, body: "null" });
      return L.caido ? caido() : json(L.draft);
    }
    return route.fulfill({ status: 404, body: "[]" });
  });
}
