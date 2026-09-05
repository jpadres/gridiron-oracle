"use client";

/**
 * Modo draft: sugiere a quién coger y tú vas tachando lo que se van llevando.
 *
 * ## Por qué esto sí lleva JavaScript
 *
 * El resto del sitio no manda ni una línea de JS propio, y es una decisión, no
 * una casualidad. Aquí se rompe a propósito: un tablero de draft **necesita
 * estado** —quién se ha ido, qué llevas tú— y ese estado cambia sesenta veces
 * en dos horas. Resolverlo sin JS exigiría un backend, que es un precio mucho
 * más alto: cuentas, base de datos y superficie de ataque real a cambio de no
 * mandar quince kilobytes.
 *
 * El estado vive en `localStorage`, así que puedes recargar en mitad del draft
 * sin perder nada y nadie más lo ve.
 *
 * ## La red, que aquí sí la hay
 *
 * Esta es la **única** página del sitio que hace una petición en runtime, y sólo
 * si activas la sincronización con Sleeper. Se decidió a sabiendas: durante un
 * draft en vivo los picks caen cada noventa segundos, y marcarlos a mano en un
 * móvil es justo lo que no puedes hacer mientras piensas el tuyo.
 *
 * Lo que se paga: `connect-src` deja de estar vacío y el pie del sitio lo dice.
 * Lo que no se paga: **ninguna credencial**. La API de Sleeper es pública y de
 * sólo lectura —sin clave, sin OAuth— y la CSP sigue siendo una lista blanca de
 * un solo destino: cualquier otro host lo bloquea el navegador.
 *
 * ## Qué sugiere
 *
 * El mejor disponible por VOR, corregido por lo que ya tienes: cada posición
 * pierde valor para ti a medida que la llenas, porque el quinto receptor de tu
 * banquillo no juega. Sin esa corrección un board te manda coger receptores toda
 * la tarde, que es exactamente el error que un board debería evitarte.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

// El formateador compartido, no `toFixed`: el sitio está en español y las
// cifras llevan coma. Escribirlo aparte aquí fue exactamente el fallo que el
// barrido de QA anterior había corregido en el resto de la web.
import { num } from "../../data/model.js";
import { TeamMark, teamVars } from "../sports.jsx";
import { Headshot } from "../headshot.jsx";
import {
  activeIdentity, browserStorage, loadOrMigrateLog, loadPrefs, logScopeFor, migrateLegacy,
  savePrefs, saveLog,
} from "./draftStorage.js";
import {
  ROSTER, SOURCE, fold, providerEvents, takeEvent, undoEvent,
} from "./draftLog.js";
import { bestForMe } from "./candidates.js";
import {
  DRAFT_STATUS, agoLabel, mySlot, pickSchedule, picksUntilMe, reconciliation, syncState,
} from "./draftSync.js";
import { compilePoints, rulesFromSleeper } from "./scoring.js";
import { SLEEPER, useSleeperDraft } from "./useSleeperDraft.js";
import {
  activeBoardFrom, leagueBoardFrom, rosterContext, setComponentOrder, valueConfidence,
} from "./leagueValue.js";
import { replacementPoints } from "./rosterFit.js";
import { syncPool } from "./sleeperAccount.js";
import { splitAvailable } from "./availablePool.js";
import { hasNumber } from "../numbers.js";


// Cuántos titulares tienes ya de cada posición, para DECIRLO como hecho junto
// a la sugerencia. No es un multiplicador: el VOR se enseña puro y lo que
// llevas se cuenta al lado.
const TYPICAL_STARTERS = { QB: 1, RB: 2, WR: 3, TE: 1 };

/**
 * Resumen de puntuación en una línea, sólo con lo que se puede afirmar.
 *
 * Se mira `rec` porque es lo que separa PPR de estándar. NO se dice «PPR»
 * cuando falta el campo: se dice UNKNOWN, porque una etiqueta de puntuación
 * equivocada cambia el orden del board entero.
 */
function scoringSummary(settings) {
  if (!settings || typeof settings !== "object") return "UNKNOWN scoring";
  const rec = Number(settings.rec);
  if (!Number.isFinite(rec)) return "UNKNOWN scoring";
  if (rec === 0) return "Standard";
  if (rec === 0.5) return "Half PPR";
  if (rec === 1) return "PPR";
  return `${rec} pt/rec`;
}

export default function DraftMode({ board, positionFilter = "ALL", context = {} }) {
  const season = context.season ?? 2026;
  // El estado de draft es el REGISTRO, la misma clave que lee el Draft Room.
  // Antes esta pantalla guardaba `{gone, mine}` en su propia clave y la otra
  // guardaba eventos en la suya: dos versiones del mismo draft que nunca se
  // veían. Un jugador cogido está cogido, mires donde mires.
  //
  // Las preferencias de conexión siguen aparte y en su propio `useState`
  // (`prefs`): no son estado de draft, viven en otra clave y sobreviven a
  // «empezar de cero» — que fue exactamente el fallo de la versión anterior,
  // donde el botón reemplazaba el objeto entero y de paso te desconectaba.
  const [events, setEvents] = useState([]);
  const [prefs, setPrefs] = useState({ league: "", userId: "" });
  const [ready, setReady] = useState(false);
  // `false` = el navegador bloquea el almacenamiento: se draftea igual, sin memoria.
  const [storageOk, setStorageOk] = useState(true);
  const [query, setQuery] = useState("");
  const [leagueDraft, setLeagueDraft] = useState("");
  const [members, setMembers] = useState(null);
  // Catálogo de MIS LIGAS. `null` = no se ha buscado; `[]` = se buscó y no hay.
  // La distinción importa: colapsarlas haría que «no tienes ligas» apareciera
  // antes de preguntar.
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [username, setUsername] = useState("");
  // La configuración de la liga conectada. Es lo que decide si su board se puede
  // calcular; sin ella no se afirma nada sobre la liga.
  const [leagueInfo, setLeagueInfo] = useState(null);

  // EL MISMO POOL QUE EL DRAFT ROOM. Antes aquí iba `board` a secas, así que el
  // pick de una defensa o de un pateador no se tachaba nunca en esta pantalla y
  // sí en la otra — en la ronda donde todo el mundo ficha justo eso.
  const pool = useMemo(() => syncPool(board, context), [board, context]);
  const sync = useSleeperDraft(pool, {
    leagueId: ready ? prefs.league : "",
    season: context.season,
    userId: prefs.userId,
    idMap: context.sleeperIds,
  });
  const draft = sync.draft;
  // LEÍDOS ≠ APLICADOS. La resta que faltaba: la pantalla decía «N picks read»
  // con el tablero intacto y las dos cosas por separado parecían normales.
  const recon = useMemo(
    () => reconciliation({
      total: sync.total, applied: sync.canonical?.length ?? 0, unmapped: sync.unmapped?.length ?? 0,
    }),
    [sync.total, sync.canonical, sync.unmapped]
  );

  // La identidad del contexto. Sin las tres partes no hay clave, y sin clave no
  // se persiste: perder el estado al recargar es malo, escribirlo en una clave
  // compartida y contaminar otra liga es peor y además no se ve.
  // El contexto activo, resuelto por la MISMA función que usa el Draft Room. Que
  // las dos pantallas deriven su ámbito del mismo sitio es lo que hace que
  // converjan; que la función siga exigiendo temporada, liga y draft es lo que
  // hace que E14 siga valiendo.
  //
  // `ready` entra en la dependencia porque la identidad se lee de
  // `localStorage`, que en el servidor no existe: antes de montar, el contexto
  // es el local y no se persiste nada en el equivocado.
  const identity = useMemo(
    () =>
      activeIdentity({
        storage: ready ? browserStorage() : null,
        season,
        sleeperDraft: draft,
        leagueId: prefs.league,
      }),
    [draft, prefs.league, season, ready]
  );
  const scope = useMemo(() => logScopeFor(identity), [identity]);

  // El estado se lee después del primer render y no durante: el HTML lo genera
  // el servidor, donde no hay localStorage, y pintar cosas distintas en los dos
  // sitios rompe la hidratación de React.
  useEffect(() => {
    const storage = browserStorage();
    setStorageOk(storage !== null);
    migrateLegacy(storage, season);
    setPrefs(loadPrefs(storage));
    setReady(true);
  }, [season]);

  // Al cambiar de contexto se CARGA el del nuevo y se descartan las marcas del
  // anterior. Es la línea que hace que cambiar de liga no contamine.
  useEffect(() => {
    if (!ready) return;
    setEvents(loadOrMigrateLog(scope, browserStorage()));
  }, [scope, ready]);

  useEffect(() => {
    if (!ready) return;
    saveLog(scope, events, browserStorage());
  }, [scope, events, ready]);

  useEffect(() => {
    if (!ready) return;
    savePrefs(prefs, browserStorage());
  }, [prefs, ready]);

  // El estado canónico: lo guardado MÁS lo que trae el sondeo, fundido en cada
  // render y no persistido. Los eventos del proveedor son efímeros a propósito
  // —`SLEEPER_LIVE_BROWSER` sigue BLOCKED— pero pasan por el mismo `fold`, así
  // que un pick sincronizado y uno marcado a mano son el mismo tipo de cosa.
  //
  // Y de ahí sale gratis lo que antes no se podía: deshacer un pick del sondeo
  // aguanta, porque el UNDO lleva reloj de verdad y el evento del proveedor
  // lleva un ordinal. Antes volvía a aparecer quince segundos después.
  /* MI PUESTO, arriba del todo: el estado plegado lo necesita para atribuir los
     picks que el proveedor no puede (draft seguido por id, sin cuenta). Estaba
     doscientas líneas más abajo, junto al calendario, que es donde se usaba
     antes — leerlo desde aquí sin moverlo es un ReferenceError en el render. */
  const slot = useMemo(
    () => mySlot({ draft, userId: prefs.userId }),
    [draft, prefs.userId]
  );
  const state = useMemo(
    () => fold([...events, ...providerEvents(sync.canonical ?? [], { mySlot: slot })]),
    [events, sync.canonical, slot]
  );

  // --- ¿se puede valorar EN ESTA liga? ---------------------------------------
  //
  // Dos preguntas separadas a propósito: la puntuación y la estructura. Se puede
  // saber traducir la una y no la otra, y en ese caso el board sigue sin ser de
  // tu liga. Sólo con las DOS soportadas se dice que lo es.
  //
  // Mientras `LEAGUE_SPECIFIC_VALUE` sea NOT_READY el board publicado se sigue
  // calculando en PPR de 12 equipos, así que la etiqueta dice lo que hay: los
  // datos de la liga se leen y se enseñan, y el valor todavía no es suyo.
  const leagueFit = useMemo(() => {
    if (!leagueInfo) return { known: false };
    const scoring = rulesFromSleeper(leagueInfo.scoring_settings);
    const roster = rosterContext(leagueInfo.roster_positions, leagueInfo.total_rosters);
    return {
      known: true,
      scoring,
      roster,
      supported: scoring.supported && roster.supported,
      reason: scoring.supported ? roster.reason : scoring.reason,
    };
  }, [leagueInfo]);

  /**
   * El board RECOMPILADO en la liga del usuario. Es lo que E18 valida.
   *
   * Se recompila entero —puntos, reemplazo y VOR— y no se ajusta el publicado:
   * el encogimiento hacia la media posicional ocurre en espacio de puntos, así
   * que la media a la que se encoge depende de la puntuación. Un board estándar
   * obtenido restándole recepciones a uno de PPR no es de esa liga.
   *
   * Lo que NO se recalcula son los TIERS. Salen de los huecos de VOR y se
   * moverían solos, pero nadie ha validado que los cortes signifiquen algo en
   * una liga distinta de la publicada, así que el tier que se enseña sigue
   * siendo el global y la interfaz lo dice.
   */
  const leagueBoard = useMemo(() => {
    if (!leagueFit.supported) return null;
    if (context.componentOrder) setComponentOrder(context.componentOrder);
    return leagueBoardFrom({
      board, context, rules: leagueFit.scoring.rules,
      roster: leagueFit.roster, compilePoints,
    });
  }, [board, leagueFit, context]);

  // El board efectivo: el de tu liga si se pudo compilar, el publicado si no.
  // Nunca una mezcla — un VOR de una liga con el orden de otra sería el error
  // que E18 existe para impedir.
  const activeBoard = useMemo(
    () => activeBoardFrom(leagueBoard, board), [leagueBoard, board]
  );

  /* MIS JUGADORES. Se lee AQUÍ y no después del `if (!ready)` porque la
     sugerencia lo necesita para ordenar por lo que cada uno añade: leerlo más
     abajo era un ReferenceError, y leerlo dos veces sería otra fuente. */
  const picked = activeBoard.filter((row) => state.mine.has(row.player_id));

  const counts = useMemo(() => {
    const out = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const row of activeBoard) if (state.mine.has(row.player_id)) out[row.position] += 1;
    return out;
  }, [activeBoard, state]);

  // La MISMA partición que el Draft Room (`availablePool.js`): `available` es
  // quien puede jugar; `unavailable` quien no va a jugar, aparte y con su
  // valor; `untaken` los dos, que es sobre lo que se busca para tachar.
  const { available, unavailable, untaken } = useMemo(
    () => splitAvailable(activeBoard, state.byPlayer),
    [activeBoard, state]
  );

  // La lista: BEST AVAILABLE POR VOR, sin ajustar. Una sola definición, dicha
  // en la etiqueta. El «ya tienes N» va como hecho al lado, no dentro del
  // número: mezclarlo era fabricar una recomendación personalizada sin modelo.
  //
  // `positionFilter` se aplica AL FINAL, sobre la lista ya ordenada, y nunca
  // sobre `board`. La distinción no es de estilo: `board` alimenta también el
  // índice que empareja los picks de Sleeper, el recuento de tu plantilla y el
  // ajuste por posición. Filtrarlo aguas arriba hacía que un pick sincronizado
  // de otra posición no se tachara y que tu plantilla apareciera vacía en
  // cuanto filtrabas — con el filtro en WR, el corredor que acababas de coger
  // desaparecía del recuento.
  /* EL NIVEL DE REEMPLAZO, leído del pool por la identidad `proj − vor`. Sale
     del board que se esté usando —el de tu liga si se pudo compilar—, así que
     una superflex trae el suyo sin que esta pantalla sepa qué es. */
  const replacement = useMemo(() => replacementPoints(pool), [pool]);

  const declaredRoster = leagueInfo?.roster_positions ?? null;

  /* ESTA LISTA ES EL BOARD, Y NO SE TOCA.
     La versión anterior la REORDENABA por ajuste a la plantilla y le cambiaba
     el nombre — que es exactamente lo que se quitó del Draft Room, porque
     entonces no queda dónde ver el orden puro. Que las dos pantallas hicieran
     cosas distintas con el mismo nombre habría sido la séptima vez que dos
     traductores del mismo formato divergen aquí. La adaptación vive abajo, en
     su propia sección, igual que allí. */
  const suggestions = useMemo(() => {
    const scored = available.map((row) => ({
      ...row,
      have: counts[row.position] ?? 0,
      typical: TYPICAL_STARTERS[row.position] ?? 1,
    }));
    scored.sort((a, b) => b.vor - a.vor);
    const visible =
      positionFilter === "ALL"
        ? scored
        : scored.filter((row) => row.position === positionFilter);
    return visible.slice(0, 8);
  }, [available, counts, positionFilter]);


  // Búsqueda sobre el board entero, no sólo sobre las sugerencias.
  //
  // Sin esto el modo draft tenía un agujero funcional: cuando alguien se lleva
  // al número 40, no había forma de tacharlo, y a partir de ahí las sugerencias
  // proponen a gente que ya no está. En un draft real eso pasa en la segunda
  // ronda.
  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return untaken
      .filter(
        (row) =>
          row.player_name.toLowerCase().includes(needle) ||
          row.team?.toLowerCase() === needle ||
          row.position?.toLowerCase() === needle
      )
      .slice(0, 10);
  }, [untaken, query]);

  // Los miembros de la liga, para saber cuál de los picks son tuyos. Se pide una
  // vez al conectar y no en cada sondeo: no cambia durante un draft.
  useEffect(() => {
    if (!ready || !prefs.league) {
      setMembers(null);
      return;
    }
    let cancelled = false;
    fetch(`${SLEEPER}/league/${prefs.league}/users`)
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        if (!cancelled) setMembers(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        // Sin la lista se sigue pudiendo sincronizar: todo entra como «fuera» y
        // tú marcas los tuyos a mano. Es peor, pero no es un bloqueo.
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, prefs.league]);

  /**
   * Tachar desde el board. Sigue siendo UN toque y sin salir de la página: el
   * board rápido es lo que se usa cuando no estás en tu turno, y meterlo dentro
   * del Draft Room habría cambiado el gesto por una navegación.
   *
   * `mine` es la declaración del usuario, y es lo que separa JUGADOR FUERA DEL
   * BOARD de JUGADOR EN MI PLANTILLA. Aquí no se deriva del puesto: el board no
   * tiene por qué conocer el calendario de picks, y derivarlo mal metería a
   * alguien en tu plantilla sin que nadie lo haya dicho.
   */
  const take = (id, mine) =>
    setEvents((previous) => [
      ...previous,
      takeEvent({
        playerId: id,
        roster: mine ? ROSTER.MINE : ROSTER.OPPONENT,
        rosterSource: "DECLARED",
        source: SOURCE.MANUAL,
      }),
    ]);

  // Deshacer es un EVENTO, no un borrado: por eso funciona igual sobre un pick
  // marcado aquí, uno registrado en el Draft Room y uno traído por el sondeo.
  const undo = (id) =>
    setEvents((previous) => [...previous, undoEvent({ playerId: id, source: SOURCE.MANUAL })]);

  // Empezar de cero vacía el REGISTRO y no toca las preferencias. La versión
  // anterior reemplazaba el objeto de estado entero, así que de paso borraba la
  // liga conectada: pulsabas «start over» y se desconectaba Sleeper.
  const startOver = () => setEvents([]);

  // Estos hooks van ANTES del guard de `!ready`. Colocados después, en el primer
  // render no se ejecutaban y en el segundo sí: React cuenta más hooks que en el
  // render anterior y la página entera deja de montarse (error #310). No lo caza
  // el build ni el servidor — sólo el navegador.
  // --- contexto del draft, de campos que Sleeper ya publicaba y no se leían ---
  //
  // Todo lo que no se pueda establecer sale como UNKNOWN. Suponer 12 equipos,
  // snake y puesto 1 daría un calendario de picks plausible y falso, que es
  // peor que no dar ninguno.
  const draftTeams = Number(draft?.settings?.teams) || null;
  const draftRounds = Number(draft?.settings?.rounds) || null;
  const draftType = typeof draft?.type === "string" ? draft.type : null;
  const schedule = useMemo(
    () => pickSchedule({ slot, teams: draftTeams, rounds: draftRounds, type: draftType }),
    [slot, draftTeams, draftRounds, draftType]
  );

  /* BEST PICK FOR YOU: la MISMA función que el Draft Room, con la misma caja de
     motivos. El filtro visual de posición NO entra aquí a propósito: si filtras
     a RB+WR, los quarterbacks no dejan de existir para decidir qué te conviene.
     `picksLeftForMe` sale del calendario del proveedor cuando lo hay. */
  const forMe = useMemo(
    () => bestForMe(available, {
      roster: picked, rosterPositions: declaredRoster, replacement,
      // `hasNumber` y no `Number.isFinite(Number(...))`: sin rondas declaradas
      // `draftRounds` es null, `Number(null)` es CERO y esto fabricaba «te
      // quedan 0 picks». `candidates.js` ya exige `picksLeftForMe === null`
      // explícito para no caer en eso — pero el guardia estaba en el callee y
      // aquí se le entregaba un cero, así que no lo veía nunca: el aviso de
      // pateador/defensa saltaba desde el primer turno. Mismo fallo, otro lado
      // de la llamada.
      picksLeftForMe: hasNumber(draftRounds) && schedule?.next
        ? Math.max(0, Number(draftRounds) - Math.floor((schedule.next.overall - 1) / (draftTeams || 1)))
        : null,
      limit: 4,
    }),
    [available, picked, declaredRoster, replacement, draftRounds, draftTeams, schedule]
  );
  const nextPick = useMemo(
    // En un draft terminado no hay «siguiente turno»: enseñarlo invita a
    // esperar un pick que ya no llega.
    () =>
      draft?.status === DRAFT_STATUS.COMPLETE
        ? null
        : picksUntilMe({ schedule, picksMade: sync.total ?? null }),
    [schedule, sync.total, draft]
  );

  /**
   * Mis ligas de esta temporada, desde Sleeper.
   *
   * Dos peticiones: el usuario y sus ligas. Lo que devuelve `/leagues` ya trae
   * nombre, `total_rosters`, `scoring_settings` y `draft_id`, así que el
   * catálogo se puede pintar entero sin una petición por liga.
   *
   * La temporada se pasa, no se supone: preguntar por la que toca es lo que
   * distingue «mis ligas» de «las ligas que tuve alguna vez».
   */
  useEffect(() => {
    if (!ready || !prefs.league) {
      setLeagueInfo(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${SLEEPER}/league/${prefs.league}`);
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (!cancelled) setLeagueInfo(data);
      } catch {
        // Sin configuración no se supone ninguna: `leagueInfo` se queda en null
        // y la interfaz dice UNKNOWN en vez de «12 equipos PPR».
        if (!cancelled) setLeagueInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, prefs.league]);

  const lookupLeagues = useCallback(async () => {
    const name = username.trim();
    if (!name) return;
    setCatalogError("");
    setCatalog(null);
    try {
      const userResponse = await fetch(`${SLEEPER}/user/${encodeURIComponent(name)}`);
      if (!userResponse.ok) throw new Error(`user lookup returned ${userResponse.status}`);
      const account = await userResponse.json();
      if (!account?.user_id) throw new Error("no Sleeper account with that name");
      const response = await fetch(`${SLEEPER}/user/${account.user_id}/leagues/nfl/${season}`);
      if (!response.ok) throw new Error(`leagues returned ${response.status}`);
      const list = await response.json();
      setCatalog(Array.isArray(list) ? list : []);
      // El `user_id` se guarda ya: es lo que separa TUS picks de los del resto,
      // y pedirlo dos veces sería pedirlo dos veces.
      setPrefs((previous) => ({ ...previous, userId: String(account.user_id) }));
    } catch (error) {
      setCatalog([]);
      setCatalogError(String(error.message ?? error));
    }
  }, [username, season]);


  if (!ready) {
    return <p className="caption">Loading draft mode…</p>;
  }


  // El recuento real, sincronizados incluidos. La versión anterior sumaba sólo
  // las marcas manuales, así que con Sleeper conectado decía «3 off the board»
  // con treinta jugadores tachados.
  const total = state.count;

  // La sugerencia ya puntuada se PARTE en dos para pintarla: la primera es la
  // decisión, el resto es la cola. No se recalcula nada — `suggestions` sale del
  // mismo `useMemo` de siempre, con el mismo ajuste posicional.
  const onClock = suggestions[0] ?? null;
  const next = suggestions.slice(1, 5);
  /* TRES estados, igual que en el Draft Room y con las mismas palabras:
       · sin huecos declarados          -> orden del board, y se dice por qué
       · con huecos que alguien mejora  -> orden por lo que añade a tu alineación
       · con TODOS los titulares llenos -> orden del board otra vez, y se dice
     Reordenar en silencio sería indistinguible de un board roto, y rotular la
     lista «lo que más añade» con un +0 serían dos frases que se contradicen. */


  // «¿Puedo esperar?» es un CONTEO, no una predicción: cuántos jugadores de su
  // misma posición y su mismo tier siguen disponibles. No dice si esperar es
  // buena idea —eso sería una afirmación que nadie ha validado— dice cuántos
  // quedan, que es el dato con el que se decide.
  /* Se cuenta sobre el POOL DISPONIBLE, no sobre las ocho sugerencias pintadas.
     Contarlo sobre lo renderizado decía «2 left in tier» con doce disponibles:
     un número que se lee como escasez y era un artefacto del recorte. Ya estaba
     corregido en el Draft Room y aquí no — el fallo de los dos traductores. */
  const sameTier = onClock
    ? available.filter(
        (row) => row.position === onClock.position && row.tier === onClock.tier
      ).length
    : 0;
  const waitAdvice = onClock
    ? sameTier <= 1
      ? `Last ${onClock.position} in tier ${onClock.tier}. The next one is a tier down.`
      : `${sameTier} ${onClock.position}s left in tier ${onClock.tier}.`
    : "";

  return (
    <div className="draft">
      {draft ? (
        <section className="draft-context" aria-label="Draft context">
          <span className={`sync-pill sync-pill--${sync.view.level.toLowerCase()}`}>
            {sync.view.label}
          </span>
          <span className="ctx">
            <span className="k">Slot</span>
            <span className="v">{slot ?? "UNKNOWN"}</span>
          </span>
          <span className="ctx">
            <span className="k">Type</span>
            <span className="v">{draftType ?? "UNKNOWN"}</span>
          </span>
          <span className="ctx">
            <span className="k">Rounds</span>
            <span className="v">{draftRounds ?? "UNKNOWN"}</span>
          </span>
          <span className="ctx">
            <span className="k">Teams</span>
            <span className="v">{draftTeams ?? "UNKNOWN"}</span>
          </span>
          {/* La limitación va DENTRO de la tira de contexto, no escondida en un
              desplegable: el estado de la liga es real y el valor de los
              jugadores no está personalizado a ella, y las dos cosas se leen
              juntas o la primera hace creer la segunda. */}
          {/* Qué board se está enseñando, nombrado. La versión anterior decía
              «not league-specific» incluso cuando la liga era legible, porque
              LEAGUE_SPECIFIC_VALUE estaba NOT_READY. Con E18 el valor por liga
              está validado, así que la etiqueta pasa a nombrar la liga de
              verdad — y sigue diciendo lo que NO se ha validado, que son los
              tiers. */}
          <span
            className={leagueBoard ? "ctx ctx--ready" : "ctx ctx--warn"}
            title={
              leagueBoard
                ? "Projections, replacement level and VOR are recomputed for this league's scoring and roster (E18). Tiers are not: they come from the published board and are not validated per league."
                : leagueFit.known
                  ? `Cannot compile this league's board: ${leagueFit.reason}. Showing the published board — 12-team PPR, QB1/RB2/WR3/TE1.`
                  : "League settings not read. Showing the published board — 12-team PPR, QB1/RB2/WR3/TE1."
            }
          >
            <span className="k">Board</span>
            <span className="v">
              {leagueBoard
                ? `${leagueFit.roster.teams}-team · ${leagueFit.scoring.label}${
                    leagueFit.roster.isSuperflex ? " · Superflex" : ""
                  }`
                : "published board · not yours"}
            </span>
          </span>
          {leagueBoard && leagueFit.roster
            && valueConfidence(leagueFit.roster) === "UNVALIDATED_DEPTH" ? (
            <span className="ctx ctx--warn"
                  title="E18 validated league-specific value at 10-14 teams. In a league this deep the replacement level lands where projections are mostly the positional prior — between QB33 and QB65 there are 30 raw points and 11 after shrinkage. The structure still responds correctly; the size of the value does not hold up. The board is computed, not validated at this depth.">
              <span className="k">Depth</span>
              <span className="v">{leagueFit.roster.teams} teams · value not validated</span>
            </span>
          ) : null}
          {leagueBoard?.short?.length ? (
            <span className="ctx ctx--warn"
                  title="This league's replacement level for those positions falls outside the published player pool, so their value cannot be computed. They are left out rather than given a number that would be wrong.">
              <span className="k">Not valued</span>
              <span className="v">{leagueBoard.short.join(", ")} · pool too shallow</span>
            </span>
          ) : null}
          {nextPick ? (
            <span className="ctx ctx--next">
              <span className="k">Next pick</span>
              <span className="v">
                {nextPick.label} · {nextPick.away} away
              </span>
            </span>
          ) : null}
        </section>
      ) : null}

      {/* --- BEST PICK FOR YOU ---------------------------------------------
             La MISMA función y la misma caja de motivos que el Draft Room. Las
             dos pantallas enseñan la misma decisión, así que enseñan lo mismo:
             cada una con su propia versión es cómo este proyecto ha divergido
             seis veces ya. Si no se puede sostener, esta sección no se pinta y
             abajo queda el board, que es lo que sí se puede afirmar. */}
      {forMe?.primary && sync.view.canRecommend ? (
        <section className="room-pick" aria-label="Best pick for you"
                 style={teamVars(forMe.primary.row.team)}>
          <p className="eyebrow">Best pick for you</p>
          <button type="button" className="room-pick-hero"
                  onClick={() => take(forMe.primary.row.player_id, true)}>
            <Headshot sid={forMe.primary.row.sid} team={forMe.primary.row.team}
                      position={forMe.primary.row.position}
                      name={forMe.primary.row.player_full_name ?? forMe.primary.row.player_name}
                      size={56} className="hs--hero" />
            <span className="room-pick-who">
              <b>{forMe.primary.row.player_full_name ?? forMe.primary.row.player_name}</b>
              <span className="meta">
                <TeamMark abbr={forMe.primary.row.team} />
                <span className={`ptag ptag--${forMe.primary.row.position.toLowerCase()}`}>
                  {forMe.primary.row.position}{forMe.primary.row.position_rank}
                </span>
              </span>
            </span>
            <span className="room-cand-vor">
              {/* `fit` es null cuando NADIE supera el nivel de reemplazo y lo
                  que se ofrece es llenar un hueco titular vacío: ahí no hay
                  marginal que enseñar y no se inventa uno. Leerlo a pelo era un
                  `TypeError` en un componente de cliente — la caída en blanco. */}
              {forMe.primary.fit
                ? <>{num(forMe.primary.fit.marginal, 1)}<small>to your lineup</small></>
                : <><span className="room-cand-slot">fills slot</span><small>no one beats replacement</small></>}
              <em>{num(forMe.primary.row.vor, 1)} VOR</em>
            </span>
          </button>
          <ul className="room-why room-why--pick">
            {forMe.primary.reasons.map((r) => <li key={r.kind}>{r.text}</li>)}
          </ul>
          {forMe.alternates.length > 0 ? (
            <ol className="room-alts">
              {forMe.alternates.map((entry) => (
                <li key={entry.row.player_id} style={teamVars(entry.row.team)}>
                  <button type="button" onClick={() => take(entry.row.player_id, true)}>
                    <span className={`ptag ptag--${entry.row.position.toLowerCase()}`}>
                      {entry.row.position}
                    </span>
                    <span className="nm">
                      {entry.row.player_full_name ?? entry.row.player_name}
                    </span>
                    <span className="alt-why">{entry.reasons[0]?.text ?? ""}</span>
                    <span className="alt-n">{entry.fit ? num(entry.fit.marginal, 0) : "—"}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          {forMe.mustFillSpecialist ? (
            <p className="room-must">
              {forMe.state.openSpecialist.map((x) => x.slot).join(" + ")} still open with about
              as many picks left as starting slots — fill them before the draft ends.
            </p>
          ) : null}
        </section>
      ) : null}

      {onClock && sync.view.canRecommend ? (
        <section className="onclock" style={teamVars(onClock.team)} aria-label="On the clock">
          <p className="eyebrow">Best available by VOR</p>
          <div className="onclock-body">
            <span className="rank-numeral rank-numeral--hero">{onClock.position_rank}</span>
            <div className="onclock-who hs-who">
              <Headshot sid={onClock.sid} team={onClock.team} position={onClock.position} name={onClock.player_full_name ?? onClock.player_name} size={56} className="hs--hero" />
              <h3 className="onclock-name">{onClock.player_full_name ?? onClock.player_name}</h3>
              <p className="onclock-meta">
                <TeamMark abbr={onClock.team} solid />
                <span className={`ptag ptag--${onClock.position.toLowerCase()}`}>
                  {onClock.position}
                </span>
                <span>Tier {onClock.tier}</span>
                {onClock.risk_label && onClock.risk_label !== "Normal" ? (
                  <span className={`risk risk--${onClock.risk_label === "Volatile" ? "high" : "low"}`}>
                    {onClock.risk_label}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="onclock-signal">
              <span className="value">{num(onClock.vor, 1)}</span>
              <span className="label">VOR</span>
            </div>
          </div>
          <p className="onclock-wait">{waitAdvice}</p>
          <p className="onclock-why">
            Board order, and it never looks at your roster.{" "}
            {forMe?.primary
              ? "What fits your team is above."
              : declaredRoster?.length
                ? "Nothing on your roster improves with what is left, so this is also the right order for a bench pick."
                : "This league has not declared its roster slots, so nothing here is adapted to your team."}
          </p>
          <div className="onclock-actions">
            <button type="button" className="act act--mine" onClick={() => take(onClock.player_id, true)}>
              Drafted by me
            </button>
            <button type="button" className="act act--gone" onClick={() => take(onClock.player_id, false)}>
              Someone took him
            </button>
          </div>
        </section>
      ) : onClock ? (
        <section className="onclock onclock--held">
          <p className="eyebrow">Suggestion held</p>
          <p className="onclock-wait">
            {sync.view.detail} The board below is still accurate as of the last sync.
          </p>
        </section>
      ) : null}

      {next.length > 0 ? (
        <>
          <p className="eyebrow next-h">Next best</p>
          <ol className="picks deal">
            {next.map((row, index) => (
              <li key={row.player_id} className="pick" style={teamVars(row.team)}>
                <span className="pick-rank">{index + 2}</span>
                <span className="pick-who hs-who">
                  <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={32} />
                  <span className="nm">{row.player_full_name ?? row.player_name}</span>
                  <span className="meta">
                    <TeamMark abbr={row.team} />
                    <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                      {row.position}{row.position_rank}
                    </span>
                    <span>T{row.tier}</span>
                    {row.risk_label && row.risk_label !== "Normal" ? (
                      <span className={`risk risk--${row.risk_label === "Volatile" ? "high" : "low"}`}>
                        {row.risk_label}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="pick-vor">{num(row.vor, 1)}<small>VOR</small></span>
                <span className="pick-actions">
                  <button type="button" onClick={() => take(row.player_id, true)}>Mine</button>
                  <button type="button" className="ghost" onClick={() => take(row.player_id, false)}>
                    Gone
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {unavailable.length > 0 ? (
        /* Quien NO VA A JUGAR, aparte y nombrado, como en el Draft Room: el
           valor es el mismo con marca y sin ella; lo que cambia es que se dice
           y que no encabeza. Sigue siendo drafteable — Mine/Gone funcionan. */
        <>
          <p className="eyebrow next-h">Unavailable · {unavailable.length} — suspended, exempt, IR or PUP. Value unchanged; listed last.</p>
          <ol className="picks picks--found" aria-label="Unavailable players">
            {unavailable.slice(0, 6).map((row) => (
              <li key={row.player_id} className="pick is-out" style={teamVars(row.team)}>
                <span className="pick-rank">{row.overall_rank}</span>
                <span className="pick-who hs-who">
                  <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={28} />
                  <span className="nm">{row.player_full_name ?? row.player_name}</span>
                  <span className="meta">
                    <span className="room-row-out">{row.status_label ?? "OUT"}</span>
                    {" "}{row.position}{row.position_rank} · {row.team} · VOR {num(row.vor, 1)}
                  </span>
                </span>
                <span className="pick-actions">
                  <button type="button" onClick={() => take(row.player_id, true)}>Mine</button>
                  <button type="button" className="ghost" onClick={() => take(row.player_id, false)}>
                    Gone
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <div className="draft-tools">
      <div className="draft-head">
        <div>
          <strong>{picked.length}</strong> yours · <strong>{total}</strong> off the board
          {total > 0 ? (
            <>
              {" · "}
              <button type="button" className="link" onClick={startOver}>
                start over
              </button>
            </>
          ) : null}
        </div>
        <div className="draft-roster" title="Your picks so far, against a TYPICAL starting lineup — not your league's declared roster. The Draft Assistant draws the real structure once you configure it.">
          {Object.keys(TYPICAL_STARTERS).map((position) => (
            <span
              key={position}
              className={`slot ${counts[position] >= TYPICAL_STARTERS[position] ? "slot--full" : ""}`}
            >
              {position} {counts[position]}/{TYPICAL_STARTERS[position]}
            </span>
          ))}
        </div>
      </div>

      <p className="caption">
        Tap <strong>Mine</strong> or <strong>Gone</strong> as players come off the board.
        {storageOk ? (
          <>Saved in your browser — you can reload mid-draft.{" "}</>
        ) : (
          <><strong>This browser blocks site storage</strong>, so nothing is saved between
          reloads and the Sleeper connection cannot be remembered. Everything else works.{" "}</>
        )}
        {/* Qué draft se está tachando. Sin esta línea el board y el Draft Room
            comparten estado sin decir cuál, y en cuanto hay dos ligas no hay
            forma de saber en cuál estás marcando. */}
        {identity.platform === "local" ? (
          <>Marking the <strong>local board</strong> — not tied to a league.</>
        ) : (
          <>
            Marking <strong>{identity.name || `league ${identity.leagueId}`}</strong>, the
            same draft as the room.
          </>
        )}
      </p>

      <div className="sleeper">
        {prefs.league ? (
          <>
            <div className="sleeper-line">
              <span className={`dot dot--${sync.view.level.toLowerCase()}`} aria-hidden="true" />
              <strong className="sync-label">{sync.view.label}</strong>
              <span className="outlet">league {prefs.league}</span>
              <button
                type="button"
                className="link"
                onClick={() => setPrefs({ league: "", userId: "" })}
              >
                disconnect
              </button>
            </div>

            {members && members.length > 0 ? (
              <label className="field-label" htmlFor="draft-me">
                Which one are you — so your picks are kept apart from everyone else&rsquo;s
                <select
                  id="draft-me"
                  value={prefs.userId}
                  onChange={(event) =>
                    setPrefs((p) => ({ ...p, userId: event.target.value }))
                  }
                >
                  <option value="">(not set: everything counts as gone)</option>
                  {members.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.display_name ?? member.user_id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <p className="caption sync-detail">
              {sync.view.detail}
              {sync.state === "ok" && recon ? (
                <>
                  {" "}· <strong className={`recon recon--${recon.level.toLowerCase()}`}>{recon.label}</strong>
                  {recon.detail ? ` ${recon.detail}` : null}
                  {/* Los ids que Sleeper mandó y el mapa no conoce, por nombre
                      SÓLO para leerlos: no se emparejan por él. Antes esta
                      lista leía `sync.unmatched`, que el adaptador no emite —
                      así que el aviso no salió nunca y un tablero que no se
                      tachaba no tenía explicación en pantalla. */}
                  {sync.unmapped?.length ? (
                    <>
                      {" "}Unmatched:{" "}
                      {sync.unmapped
                        .slice(0, 5)
                        .map((pick) =>
                          `${pick.metadata?.first_name ?? ""} ${pick.metadata?.last_name ?? ""}`.trim()
                          || String(pick.player_id)
                        )
                        .filter(Boolean)
                        .join(", ")}
                      {sync.unmapped.length > 5 ? "…" : ""}.
                    </>
                  ) : null}
                </>
              ) : null}
            </p>

            {sync.state === "error" ? (
              <p className="caption sleeper-error">
                Could not read the draft: {sync.message}. The manual board still works and
                nothing already synced was lost.
                {sync.lastSyncAt ? ` Last good sync ${agoLabel(sync.lastSyncAt)}.` : ""}
              </p>
            ) : null}
          </>
        ) : (
          <details className="sleeper-setup">
            <summary>Sync with your Sleeper draft (optional)</summary>
          <form
            className="sleeper-connect"
            onSubmit={(event) => {
              event.preventDefault();
              const value = leagueDraft.trim().match(/\d{6,}/)?.[0];
              if (value) setPrefs((p) => ({ ...p, league: value }));
            }}
          >
            <label className="field-label" htmlFor="draft-user">
              Your Sleeper username — lists your {season} leagues
              <span className="field-row">
                <input
                  id="draft-user"
                  type="text"
                  autoComplete="off"
                  placeholder="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <button type="button" className="pick pick--mine" onClick={lookupLeagues}>
                  Find
                </button>
              </span>
            </label>

            {catalogError ? (
              <p className="caption sleeper-error">Could not read your leagues: {catalogError}</p>
            ) : null}

            {catalog?.length ? (
              <ul className="league-list">
                {catalog.map((entry) => (
                  <li key={entry.league_id}>
                    <button
                      type="button"
                      className="league-row"
                      onClick={() =>
                        setPrefs((previous) => ({
                          ...previous,
                          league: String(entry.league_id),
                        }))
                      }
                    >
                      <span className="league-name">{entry.name ?? entry.league_id}</span>
                      <span className="league-meta">
                        {/* Cada campo dice UNKNOWN si Sleeper no lo trae. Suponer
                            «12 equipos PPR» sería inventarse la configuración de
                            una liga ajena, y en una superflex el board saldría
                            mal en el orden entero. */}
                        <span>{entry.total_rosters ?? "UNKNOWN"} teams</span>
                        <span>{scoringSummary(entry.scoring_settings)}</span>
                        <span>{entry.status ?? "UNKNOWN"}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : catalog ? (
              <p className="caption">No {season} leagues on that account.</p>
            ) : null}

            <label className="field-label" htmlFor="draft-league">
              Or paste a league URL or id
              <input
                id="draft-league"
                type="text"
                inputMode="numeric"
                placeholder="paste your league URL or id"
                value={leagueDraft}
                onChange={(event) => setLeagueDraft(event.target.value)}
              />
            </label>
            <button type="submit" className="pick pick--mine">Connect</button>
            <p className="caption">
              Crosses off only the players already taken. This is the only network request
              on the whole site and it happens only if you turn it on: the Sleeper API is
              public and read-only, no credential is sent, and the only thing that leaves here
              is your league id, which is already public in its own URL.
            </p>
          </form>
          </details>
        )}
      </div>

      <label className="field-label" htmlFor="draft-search">
        Search to cross off players as they go
      </label>
      <input
        id="draft-search"
        className="draft-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name, team or position"
      />

      {query.trim().length >= 2 ? (
        found.length > 0 ? (
          <ol className="picks picks--found">
            {found.map((row) => (
              <li className="pick" key={row.player_id}>
                <span className="pick-rank">{row.overall_rank}</span>
                <span className="pick-who hs-who">
                  <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={28} />
                  <span className="nm">{row.player_name}</span>
                  <span className="meta">
                    {row.status_severity === "OUT" ? (
                      <span className="room-row-out">{row.status_label ?? "OUT"}</span>
                    ) : null}{row.status_severity === "OUT" ? " " : null}
                    {row.position}
                    {row.position_rank} · {row.team} · VOR {num(row.vor, 1)}
                  </span>
                </span>
                <span className="pick-actions">
                  <button type="button" onClick={() => take(row.player_id, true)}>Mine</button>
                  <button type="button" className="ghost" onClick={() => take(row.player_id, false)}>
                    Gone
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="caption">
            Nobody available matching &ldquo;{query.trim()}&rdquo;. If you already crossed
            him off, he stays crossed off.
          </p>
        )
      ) : null}

      </div>

      {picked.length > 0 ? (
        <>
          <h3>Your roster</h3>
          <ul className="mine">
            {picked.map((row) => (
              <li key={row.player_id}>
                <span className={`ptag ptag--${row.position.toLowerCase()}`}>{row.position}</span>
                {row.player_name} <span className="outlet">{row.team}</span>
                <button type="button" className="link" onClick={() => undo(row.player_id)}>
                  undo
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
