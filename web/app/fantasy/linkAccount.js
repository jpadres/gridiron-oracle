/**
 * Enlazar la cuenta de Sleeper, desde CUALQUIER pantalla.
 *
 *     UNA CUENTA, UNA LECTURA, UN SITIO DONDE VIVE.
 *
 * Esto vivía dentro de `LeaguesShell.jsx`, así que enlazar sólo se podía hacer
 * en Leagues: el semanal y el analizador tenían que mandarte allí y volver.
 * Copiarlo en cada pantalla habría sido la quinta vez que dos traductores del
 * mismo formato divergen en este proyecto — y aquí decidiría qué ligas ves.
 *
 * No hay red en este fichero: la lectura la hace `readSleeperAccount`, que está
 * en el adaptador, el único con `fetch` junto a `DraftMode.jsx`. Aquí sólo se
 * traduce y se guarda, que es lo que se puede probar sin levantar nada.
 */

import { saveLeagueToCatalog } from "./draftStorage.js";
import {
  leagueConfigFrom, leagueSnapshotFrom, mockDrafts, saveAccount,
} from "./sleeperAccount.js";
import { readSleeperAccount } from "./useSleeperDraft.js";

/**
 * Traduce lo que devuelve la API a la cuenta que guarda el producto.
 *
 * Puro: recibe la lectura ya hecha. Se prueba con `node --test` contra
 * fixtures con la forma real de Sleeper, sin navegador y sin red.
 */
export function accountFrom({ read, season, week = null, storage = null }) {
  const leagues = (read?.leagues ?? []).map(({ league, draft, rosters, users, matchups }) => {
    const snap = leagueSnapshotFrom({
      league, draft, rosters, users, userId: read.user.userId, season, matchups, week,
    });
    // El catálogo es lo que lee la antesala del Draft Room: una liga enlazada
    // tiene que poder abrirse allí sin volver a teclearla.
    if (snap.config?.leagueId && snap.config?.draftId) saveLeagueToCatalog(snap.config, storage);
    return snap;
  });
  // Un mock es un draft SIN liga. Y lo que ya es el draft de una liga de la
  // cuenta no puede ser además un mock: dos entradas para el mismo draft serían
  // dos contextos con un nombre.
  const leagueDraftIds = new Set(leagues.map((l) => l.draftId).filter(Boolean));
  const mocks = mockDrafts(read?.drafts ?? [], season)
    .filter((draft) => !leagueDraftIds.has(String(draft.draft_id)))
    .map((draft) => ({
      draftId: String(draft.draft_id),
      status: draft.status ?? null,
      created: Number(draft.created) || null,
      config: leagueConfigFrom({ draft, userId: read.user.userId, season }),
    }));
  return {
    username: read.user.username,
    displayName: read.user.displayName,
    userId: read.user.userId,
    season,
    retrievedAt: read.retrievedAt,
    leagues,
    mocks,
  };
}

/**
 * Lee la cuenta entera y la guarda. Devuelve la cuenta; lanza con el mensaje
 * de Sleeper si el nombre no existe o la red falla — quien llama lo enseña.
 */
export async function linkSleeperAccount({ username, season, week = null, storage = null }) {
  const wanted = String(username ?? "").trim();
  if (!wanted) throw new Error("no Sleeper username");
  const read = await readSleeperAccount({ username: wanted, season, week });
  const account = accountFrom({ read, season, week, storage });
  saveAccount(account, storage);
  return account;
}
