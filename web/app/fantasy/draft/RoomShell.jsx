"use client";

/**
 * La antesala del Draft Room: establecer el contexto antes de entrar.
 *
 * ## Por qué hay una antesala
 *
 * El reloj del draft —de quién es el pick, cuántos faltan para ti— **no se
 * puede derivar sin tamaño de liga, tipo de draft y tu puesto**. Entrar sin eso
 * y suponer «12 equipos, snake, puesto 1» daría un calendario plausible y falso,
 * que es la peor clase de error: nadie lo comprueba porque parece razonable.
 *
 * Así que se pregunta una vez, se guarda por liga, y lo que no se sepa queda en
 * `UNKNOWN` — el Draft Room funciona igual, sólo que sin reloj.
 *
 * ## Independiente de plataforma, a propósito
 *
 * Esta pantalla no menciona Sleeper. Una liga manual se configura aquí y sirve
 * para un draft en ESPN, en Yahoo o alrededor de una mesa. El adaptador de
 * Sleeper, cuando exista, rellenará estos mismos campos solo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import DraftRoom from "../DraftRoom.jsx";
// La misma constante que lee el board para saber en qué draft está: si cada
// pantalla escribiera la suya, volverían a ser dos contextos con un nombre.
import { ROOM_LEAGUE_KEY as KEY, loadPrefs, saveLeagueToCatalog } from "../draftStorage.js";
import {
  activeBoardFrom, leagueBoardFrom, rosterContext, rosterFromCounts, setComponentOrder,
} from "../leagueValue.js";
import { DEFAULT_RULES, compilePoints, rulesFromSleeper, scoringLabel } from "../scoring.js";
import { isMockLeagueId, mockLeagueId } from "../sleeperAccount.js";
import { useSleeperDraft } from "../useSleeperDraft.js";

const SCORING = [
  { id: "ppr", label: "PPR" },
  { id: "half", label: "Half PPR" },
  { id: "standard", label: "Standard" },
];

/**
 * Puntos por recepción de cada preajuste del configurador.
 *
 * El configurador manual ofrece TRES puntuaciones y nada más, así que esto es
 * la traducción completa de lo que puede elegirse — no un valor por defecto
 * colado como configuración. Una liga sincronizada de Sleeper trae sus reglas
 * de verdad por `rulesFromSleeper`; esto es para la liga que se teclea.
 */
const RECEPTION = { ppr: 1, half: 0.5, standard: 0 };
function rulesFor(scoring) {
  const rec = RECEPTION[scoring];
  // Sin puntuación conocida NO se inventa PPR: no hay reglas, y sin reglas no
  // hay board de liga. La pantalla enseña el publicado y lo dice.
  return rec === undefined ? null : { ...DEFAULT_RULES, reception: rec };
}
const TYPES = [
  { id: "snake", label: "Snake" },
  { id: "linear", label: "Linear" },
];

// Los contadores de plantilla del configurador. `null` = SIN CONFIGURAR, que
// no es lo mismo que cero: cero es una liga que decidió no alinear esa
// posición, null es que nadie ha dicho nada. La plantilla sólo se guarda si el
// usuario la tocó o aplicó el preset — una liga sin configurar queda UNKNOWN y
// la vista de plantilla lo dice, no dibuja una alineación estándar.
const NO_ROSTER = Object.freeze({
  QB: null, RB: null, WR: null, TE: null, FLEX: null, SUPER_FLEX: null,
  DEF: null, K: null, BN: null,
});

// El preset del dueño, confirmado explícitamente. Es una COMODIDAD del
// formulario: rellena los contadores para editarlos, nunca se aplica solo.
const STANDARD_PRESET = Object.freeze({
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 0, DEF: 1, K: 1, BN: 6,
});

const ROSTER_FIELDS = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF", "K", "BN"];

const BLANK = {
  name: "", platform: "manual", leagueId: "", draftId: "", sleeperDraftId: "", userId: "",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: null,
  rosterCounts: NO_ROSTER,
};

function load() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function RoomShell({ board, context }) {
  const [league, setLeague] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);

  // Entrar en edición SIEMBRA el formulario desde la liga guardada, una vez.
  // Los contadores se derivan de la lista canónica: la lista es lo que se
  // guarda y los contadores son su vista de formulario.
  const beginEdit = useCallback(() => {
    setDraft({
      ...league,
      rosterCounts: Array.isArray(league?.roster)
        ? Object.fromEntries(ROSTER_FIELDS.map((f) => [
            f, league.roster.filter((slot) => slot === f).length,
          ]))
        : NO_ROSTER,
    });
    setEditing(true);
  }, [league]);

  useEffect(() => {
    const saved = load();
    if (saved) {
      setLeague(saved);
      // Rellenar el catálogo con la liga activa que ya existía: las ligas
      // configuradas antes de que hubiera catálogo también son ligas.
      saveLeagueToCatalog(saved, window.localStorage);
    } else {
      // Si ya conectaste Sleeper en el Draft Board, el formulario llega
      // relleno. Vivían en dos claves distintas y NADA las puenteaba, así que
      // había que teclear la liga dos veces — o, peor, no encontrar dónde.
      const prefs = loadPrefs(window.localStorage);
      if (prefs?.league) {
        setDraft((d) => ({
          ...d, leagueId: String(prefs.league), userId: String(prefs.userId ?? ""),
          platform: "sleeper",
        }));
      }
    }
    setReady(true);
  }, []);

  const enter = useCallback((entry) => {
    // La plantilla se materializa SÓLO si hay algún contador puesto. Todo en
    // null significa que el usuario no la configuró, y eso se guarda como
    // ausencia — no como el preset. La fuente queda anotada: esta ruta es
    // siempre MANUAL; un adaptador que la rellene pondrá la suya.
    const counts = entry.rosterCounts ?? NO_ROSTER;
    const configured = ROSTER_FIELDS.some((f) => counts[f] !== null && counts[f] !== undefined);
    // Cada liga y cada draft tienen su propio id: es lo que hace que el estado
    // de una no pueda contaminar a otra, igual que en el board.
    // UN MOCK DRAFT no tiene liga en Sleeper. Se le da una liga SINTÉTICA
    // `draft-<id>` sólo para que su estado tenga clave propia y no se mezcle
    // con nada (regla 6): el adaptador sabe que no debe pedir `/league/`.
    const mockId = String(entry.sleeperDraftId ?? "").trim();
    const isMock = Boolean(mockId) && !entry.leagueId;
    const complete = {
      ...entry,
      // Con id de Sleeper la plataforma es sleeper; sin él, manual. Se deriva
      // del dato y no de un interruptor aparte, que es como acaban discrepando.
      platform: entry.leagueId || mockId ? "sleeper" : "manual",
      userId: entry.userId ?? "",
      leagueId: entry.leagueId || (isMock ? mockLeagueId(mockId) : `manual-${Date.now().toString(36)}`),
      draftId: mockId || entry.draftId || `d-${Date.now().toString(36)}`,
      isMock,
      roster: configured
        ? rosterFromCounts(Object.fromEntries(
            ROSTER_FIELDS.map((f) => [f, counts[f] ?? 0])))
        : null,
      rosterSource: configured ? "MANUAL" : null,
    };
    setLeague(complete);
    setEditing(false);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(complete));
      // La clave activa dice EN QUÉ liga estás; el catálogo recuerda TODAS las
      // que has configurado. Cambiar de liga deja de borrar a la anterior del
      // mapa — que era la limitación que impedía un centro de mando.
      saveLeagueToCatalog(complete, window.localStorage);
    } catch { /* modo privado: se puede draftear igual, sin recordar la liga */ }
  }, []);

  /* El board RECOMPILADO en ESTA liga, por el MISMO compilador que usa el
     board de `/fantasy`. Antes el asistente enseñaba el publicado mientras el
     encabezado decía «by your league's value»: la superflex de 12 y la PPR de
     12 daban exactamente el mismo orden porque nadie recalculaba nada. Lo
     encontró la matriz de configuraciones, no un test unitario. */
  /* EL POOL COMPLETO. El adaptador resuelve por id contra él, así que un
     pateador o una defensa fichados en Sleeper también salen del tablero. */
  const pool = useMemo(() => {
    const s = context.specialists;
    // Los NOVATOS entran aquí. Sin ellos el adaptador no los tiene en su índice
    // y el pick de un novato sale UNMAPPED — «identidad no resuelta», que es
    // justo lo que NO pasa: su identidad de Sleeper está verificada; lo que le
    // falta es valor. Y un UNMAPPED de más descuadra el contador del draft.
    return [...board, ...(s?.kickers ?? []), ...(s?.defenses ?? []), ...(context.rookies ?? [])];
  }, [board, context.specialists, context.rookies]);

  /* La sincronización vive AQUÍ y no dentro del asistente porque de ella sale
     también la configuración real de la liga, y con ella el valor. Si la
     pidiera la pantalla de abajo habría dos respuestas a «cuántos equipos
     tiene esta liga» —la tecleada y la del proveedor— y ninguna forma de saber
     cuál se usó. */
  // Una liga sintética `draft-<id>` NO se pide como liga: es un mock y se sigue
  // por su id de draft. Las entradas guardadas antes de que existiera `isMock`
  // se reconocen por el prefijo, para no romper lo que ya estaba en el catálogo.
  const sleeperMock = league?.platform === "sleeper"
    && (league.isMock || isMockLeagueId(String(league.leagueId ?? "")));
  const sync = useSleeperDraft(pool, {
    leagueId: league?.platform === "sleeper" && !sleeperMock ? String(league.leagueId ?? "") : "",
    draftId: sleeperMock ? String(league.draftId ?? "") : "",
    season: context.season,
    userId: league?.userId ?? "",
    idMap: context.sleeperIds,
  });

  /**
   * La liga EFECTIVA: lo que dice Sleeper manda sobre lo que se tecleó.
   *
   * El preajuste manual es respaldo, no relleno. Si el proveedor dice 10
   * equipos y el formulario decía 12, el asistente trabaja con 10 —y con el
   * puesto DERIVADO del `draft_order`, no con el que alguien escribió—, porque
   * un calendario de picks construido sobre el tamaño equivocado es plausible y
   * falso. Lo que el proveedor no diga se queda como estaba.
   */
  const effectiveLeague = useMemo(() => {
    const provider = sync.stable;
    if (!league || !provider) return league;
    const s = provider.settings ?? {};
    const merged = { ...league, providerBacked: true };
    if (s.teams) merged.teams = s.teams;
    if (s.rounds) merged.rounds = s.rounds;
    if (s.type === "snake" || s.type === "linear") merged.draftType = s.type;
    if (Array.isArray(s.rosterPositions) && s.rosterPositions.length > 0) {
      merged.roster = s.rosterPositions;
      merged.rosterSource = "SLEEPER";
    }
    if (provider.slot) merged.mySlot = provider.slot;
    if (provider.draftId) merged.draftId = provider.draftId;
    if (s.name) merged.name = s.name;
    return merged;
  }, [league, sync.stable]);

  const leagueValue = useMemo(() => {
    const active = effectiveLeague;
    if (!active) return { board: null, roster: null, rules: null };
    if (context.componentOrder) setComponentOrder(context.componentOrder);
    // La puntuación REAL de la liga si el proveedor la da; el preajuste sólo
    // como respaldo. `rulesFromSleeper` deriva además la etiqueta de las
    // reglas y no de un argumento — publicar «PPR» sobre un board de media
    // recepción porque lo decía el parámetro ya costó una iteración.
    const fromProvider = sync.stable?.settings?.scoringSettings
      ? rulesFromSleeper(sync.stable.settings.scoringSettings)
      : null;
    const rules = fromProvider?.supported ? fromProvider.rules : rulesFor(active.scoring);
    const roster = rosterContext(active.roster, active.teams);
    const built = leagueBoardFrom({ board, context, rules, roster, compilePoints });
    return {
      board: built,
      roster: roster.supported ? roster : null,
      rules,
      label: rules ? scoringLabel(rules) : null,
      // Por qué NO se pudo, para poder decirlo en vez de callarlo.
      reason: built ? null : (!rules ? "UNKNOWN scoring" : roster.reason || "board unavailable"),
    };
  }, [board, context, effectiveLeague, sync.stable]);
  const activeBoard = useMemo(
    () => activeBoardFrom(leagueValue.board, board), [leagueValue, board]
  );

  if (!ready) return <p className="caption">Loading&hellip;</p>;

  if (!league || editing) {
    // El formulario SIEMPRE lee el estado `draft`; al entrar en edición se
    // siembra una vez desde la liga guardada (ver `beginEdit`). La versión
    // anterior re-derivaba `entry` de `league` en cada render, así que lo que
    // se tecleaba en la edición se descartaba en el render siguiente: el
    // formulario parecía funcionar y no escribía nada. Interacción muerta que
    // no falla — la clase de bug que sólo se ve tecleando.
    const entry = draft;
    const set = (patch) => setDraft({ ...entry, ...patch });
    return (
      <>
        <p className="eyebrow">{context.season} · Draft Assistant</p>
        <h1>Set up your league</h1>
        <p className="lede">
          Works with any platform. Draft on Sleeper, ESPN, Yahoo or around a kitchen table —
          mark picks here and the board reacts.
        </p>
        <form
          className="room-setup"
          onSubmit={(event) => {
            event.preventDefault();
            enter(entry);
          }}
        >
          <label className="field-label">
            League name
            <input type="text" value={entry.name}
                   onChange={(e) => set({ name: e.target.value })}
                   placeholder="Work league" />
          </label>

          {/* SLEEPER. Los dos campos que encienden la sincronización. Vacíos, el
              asistente funciona igual en modo manual — que no es un plan B: es
              el modo que funciona en ESPN, en Yahoo y alrededor de una mesa.
              Con ellos, lo que diga Sleeper manda sobre el resto del formulario:
              tamaño, rondas, tipo, plantilla, puntuación y tu puesto se
              DERIVAN, y estos campos de abajo pasan a ser sólo el respaldo. */}
          <label className="field-label">
            Sleeper league ID <span className="caption">optional — turns on live sync</span>
            <input type="text" inputMode="numeric" value={entry.leagueId}
                   onChange={(e) => set({
                     leagueId: e.target.value.trim(),
                     platform: e.target.value.trim() ? "sleeper" : "manual",
                   })}
                   placeholder="1234567890123456789" />
          </label>

          {/* MOCK DRAFTS. Un mock de Sleeper no pertenece a ninguna liga, así
              que no aparece en `/league/{id}/drafts` de ninguna: se sigue por
              su propio id, que es el número de la URL sleeper.com/draft/nfl/…
              Es la forma de PROBAR el asistente en vivo sin esperar al draft
              de verdad, y también sirve para un draft de liga concreto. */}
          <label className="field-label">
            Sleeper draft ID <span className="caption">optional — a mock draft, or one specific draft</span>
            <input type="text" inputMode="numeric" value={entry.sleeperDraftId ?? ""}
                   onChange={(e) => set({
                     sleeperDraftId: e.target.value.trim().match(/\d{6,}/)?.[0] ?? e.target.value.trim(),
                     platform: e.target.value.trim() || entry.leagueId ? "sleeper" : "manual",
                   })}
                   placeholder="paste the mock draft URL or id" />
          </label>

          <label className="field-label">
            Sleeper username <span className="caption">so it knows which picks are yours</span>
            <input type="text" value={entry.userId}
                   onChange={(e) => set({ userId: e.target.value.trim() })}
                   placeholder="your Sleeper handle" />
          </label>

          <label className="field-label">
            Teams
            <input type="number" min="4" max="32" value={entry.teams}
                   onChange={(e) => set({ teams: Number(e.target.value) || null })} />
          </label>

          <fieldset className="field-label">
            <legend>Scoring</legend>
            <div className="pos-filter" role="group">
              {SCORING.map((option) => (
                <button key={option.id} type="button" className="pos-option"
                        aria-pressed={entry.scoring === option.id}
                        onClick={() => set({ scoring: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field-label">
            <legend>Draft type</legend>
            <div className="pos-filter" role="group">
              {TYPES.map((option) => (
                <button key={option.id} type="button" className="pos-option"
                        aria-pressed={entry.draftType === option.id}
                        onClick={() => set({ draftType: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field-label">
            Your draft slot
            <input type="number" min="1" max={entry.teams ?? 20}
                   value={entry.mySlot ?? ""}
                   onChange={(e) => set({ mySlot: Number(e.target.value) || null })}
                   placeholder="leave blank if unknown" />
            {/* Sin puesto el Draft Room funciona igual: lo que se pierde es el
                reloj. Es mejor que inventar un puesto y dar un turno falso. */}
            <span className="caption">
              Optional. Without it there is no pick clock — nothing is guessed.
            </span>
          </label>

          <label className="field-label">
            Rounds
            <input type="number" min="1" max="30" value={entry.rounds}
                   onChange={(e) => set({ rounds: Number(e.target.value) || null })} />
          </label>

          <fieldset className="field-label room-roster-config">
            <legend>
              Roster
              <button type="button" className="link"
                      onClick={() => set({ rosterCounts: { ...STANDARD_PRESET } })}>
                use standard
              </button>
            </legend>
            {/* Sin configurar, la plantilla queda UNKNOWN y la vista lo dice.
                El preset rellena los contadores PARA EDITARLOS — nunca se
                aplica solo, y cero es una decisión, no una ausencia. */}
            <span className="caption">
              Optional. Unconfigured stays unknown — nothing is assumed. Zero is a
              real value: a league with no TE slot keeps zero.
            </span>
            <div className="roster-counts">
              {ROSTER_FIELDS.map((field) => (
                <label key={field} className="roster-count">
                  <span>{field === "SUPER_FLEX" ? "SFLX" : field}</span>
                  <input
                    type="number" min="0" max="12" inputMode="numeric"
                    value={entry.rosterCounts?.[field] ?? ""}
                    placeholder="–"
                    onChange={(e) => set({
                      rosterCounts: {
                        ...(entry.rosterCounts ?? NO_ROSTER),
                        [field]: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="act act--mine">Enter draft room</button>
        </form>
      </>
    );
  }

  return (
    <>
      {/* Cabecera de UNA línea. El titular de portada y su antetítulo ocupaban
          250px por encima de la banda de estado — un cuarto de la pantalla del
          móvil gastado en decir dónde estás cuando ya lo sabes: has entrado tú.
          Lo que sí hace falta es la identidad de la liga, y cabe en la línea. */}
      <header className="room-head">
        <h1>Draft Assistant</h1>
        {/* La cabecera lee la liga EFECTIVA, no la tecleada. Con Sleeper
            conectado enseñaba «12-team · slot 9» mientras la parrilla dibujaba
            10 columnas y marcaba el puesto 2: los dos números en pantalla a la
            vez, y el equivocado en el sitio que se lee primero. */}
        <p>
          <b>{effectiveLeague.name || "Manual league"}</b>
          <span>{effectiveLeague.teams}-team</span>
          <span>
            {leagueValue.label
              ?? SCORING.find((s) => s.id === effectiveLeague.scoring)?.label
              ?? effectiveLeague.scoring}
          </span>
          <span>{effectiveLeague.draftType}</span>
          <span>
            {effectiveLeague.mySlot ? `slot ${effectiveLeague.mySlot}` : "slot UNKNOWN"}
          </span>
          {effectiveLeague.providerBacked ? (
            <span className="room-head-src">from Sleeper</span>
          ) : null}
          <button type="button" className="link" onClick={beginEdit}>edit</button>
        </p>
      </header>
      <DraftRoom board={activeBoard} context={context} league={effectiveLeague}
                 leagueValue={leagueValue} sync={sync} />
    </>
  );
}
