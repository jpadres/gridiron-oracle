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

import { useEffect, useMemo, useState } from "react";

// El formateador compartido, no `toFixed`: el sitio está en español y las
// cifras llevan coma. Escribirlo aparte aquí fue exactamente el fallo que el
// barrido de QA anterior había corregido en el resto de la web.
import { num } from "../../data/model.js";

const STORAGE_KEY = "gridiron-draft-v1";

// El único destino externo de todo el sitio. La CSP no permite ningún otro, y
// CI comprueba que este fichero no llame a otra cosa.
const SLEEPER = "https://api.sleeper.app/v1";

// Cada cuánto se preguntan los picks. 15 s es un compromiso: un pick tarda
// entre 30 y 90 segundos, así que nunca vas más de un pick por detrás, y son
// unas 240 peticiones en un draft de dos horas contra un endpoint público que
// devuelve unos kilobytes.
const POLL_MS = 15000;

/**
 * Normaliza un nombre para poder cruzarlo entre fuentes.
 *
 * Quita acentos, puntuación y los sufijos de generación. «Amon-Ra St. Brown» y
 * «Amon Ra St Brown» tienen que dar lo mismo, y «Brian Robinson Jr.» tiene que
 * dar lo mismo que «Brian Robinson»: Sleeper y nflverse no se ponen de acuerdo
 * en ninguna de las dos cosas.
 */
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

// Plantilla de una liga estándar. Lo que de verdad importa no es el número
// exacto, es que exista un tope: sin él, la sugerencia ignora que ya tienes
// cuatro corredores.
const SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1 };

// Cuánto vale para ti el siguiente jugador de una posición que ya has llenado.
// No es cero —un suplente vale algo, por lesiones y por el hueco flexible— pero
// es poco, y de ahí sale el «ya tienes suficientes corredores».
const BENCH_VALUE = 0.35;

function load() {
  if (typeof window === "undefined") return { gone: [], mine: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const state = raw ? JSON.parse(raw) : null;
    return {
      gone: state?.gone ?? [],
      mine: state?.mine ?? [],
      league: state?.league ?? "",
      userId: state?.userId ?? "",
    };
  } catch {
    // Un localStorage corrupto no puede impedirte draftear.
    return { gone: [], mine: [], league: "", userId: "" };
  }
}

/**
 * Sincronización con el draft de Sleeper.
 *
 * Devuelve el estado del sondeo y los picks ya cruzados con el board. Vive en su
 * propio hook para que el modo draft siga funcionando entero sin él: si la red
 * falla, si Sleeper cambia algo o si simplemente no lo activas, lo que queda es
 * el tablero manual de siempre. Una integración que al romperse se lleva por
 * delante la pantalla no vale para un draft.
 */
function useSleeperDraft(board, league, userId) {
  const [status, setStatus] = useState({ state: "idle" });
  const index = useMemo(() => buildIndex(board), [board]);

  useEffect(() => {
    if (!league) {
      setStatus({ state: "idle" });
      return undefined;
    }
    let cancelled = false;
    let draftId = null;

    async function tick() {
      try {
        if (!draftId) {
          const response = await fetch(`${SLEEPER}/league/${league}/drafts`);
          if (!response.ok) throw new Error(`the league returned ${response.status}`);
          const drafts = await response.json();
          if (!Array.isArray(drafts) || drafts.length === 0) {
            throw new Error("that league has no draft yet");
          }
          drafts.sort((a, b) => String(b.season ?? "").localeCompare(String(a.season ?? "")));
          draftId = drafts[0].draft_id;
        }
        const response = await fetch(`${SLEEPER}/draft/${draftId}/picks`);
        if (!response.ok) throw new Error(`the picks returned ${response.status}`);
        const picks = await response.json();
        if (cancelled) return;

        const gone = [];
        const mine = [];
        const unmatched = [];
        for (const pick of Array.isArray(picks) ? picks : []) {
          if (!pick?.player_id) continue;
          const row = resolvePick(index, pick);
          if (!row) {
            unmatched.push(pick);
            continue;
          }
          if (userId && String(pick.picked_by) === String(userId)) mine.push(row.player_id);
          else gone.push(row.player_id);
        }
        setStatus({
          state: "live",
          at: Date.now(),
          total: Array.isArray(picks) ? picks.length : 0,
          gone,
          mine,
          unmatched,
        });
      } catch (error) {
        if (!cancelled) setStatus({ state: "error", message: String(error.message ?? error) });
      }
    }

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [league, userId, index]);

  return status;
}

export default function DraftMode({ board, positionFilter = "ALL" }) {
  const [state, setState] = useState({ gone: [], mine: [], league: "", userId: "" });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [leagueDraft, setLeagueDraft] = useState("");
  const [members, setMembers] = useState(null);

  const sync = useSleeperDraft(board, ready ? state.league : "", state.userId);

  // El estado se lee después del primer render y no durante: el HTML lo genera
  // el servidor, donde no hay localStorage, y pintar cosas distintas en los dos
  // sitios rompe la hidratación de React.
  useEffect(() => {
    setState(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* modo privado o cuota llena: se sigue pudiendo draftear, sin recordar */
    }
  }, [state, ready]);

  // Lo que llega de Sleeper se **une** a lo marcado a mano, no lo sustituye.
  //
  // Los dos caminos son válidos a la vez: Sleeper no sabe de los rookies que no
  // pudo emparejar, y tú puedes querer tachar a alguien por tu cuenta. Y si la
  // red se cae en mitad del draft, lo sincronizado hasta ese momento no se
  // borra de la pantalla — sólo deja de crecer.
  const goneSet = useMemo(
    () => new Set([...state.gone, ...(sync.gone ?? [])]),
    [state.gone, sync.gone]
  );
  const mineSet = useMemo(
    () => new Set([...state.mine, ...(sync.mine ?? [])]),
    [state.mine, sync.mine]
  );

  const counts = useMemo(() => {
    const out = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const row of board) if (mineSet.has(row.player_id)) out[row.position] += 1;
    return out;
  }, [board, mineSet]);

  const available = useMemo(
    () => board.filter((row) => !goneSet.has(row.player_id) && !mineSet.has(row.player_id)),
    [board, goneSet, mineSet]
  );

  // La sugerencia: VOR ajustado por lo que ya tienes en esa posición.
  //
  // `positionFilter` se aplica AL FINAL, sobre la lista ya puntuada, y nunca
  // sobre `board`. La distinción no es de estilo: `board` alimenta también el
  // índice que empareja los picks de Sleeper, el recuento de tu plantilla y el
  // ajuste por posición. Filtrarlo aguas arriba hacía que un pick sincronizado
  // de otra posición no se tachara y que tu plantilla apareciera vacía en
  // cuanto filtrabas — con el filtro en WR, el corredor que acababas de coger
  // desaparecía del recuento.
  const suggestions = useMemo(() => {
    const scored = available.map((row) => {
      const filled = counts[row.position] ?? 0;
      const need = filled < (SLOTS[row.position] ?? 1) ? 1 : BENCH_VALUE;
      return { ...row, adjusted: row.vor * need };
    });
    scored.sort((a, b) => b.adjusted - a.adjusted);
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
    return available
      .filter(
        (row) =>
          row.player_name.toLowerCase().includes(needle) ||
          row.team?.toLowerCase() === needle ||
          row.position?.toLowerCase() === needle
      )
      .slice(0, 10);
  }, [available, query]);

  // Los miembros de la liga, para saber cuál de los picks son tuyos. Se pide una
  // vez al conectar y no en cada sondeo: no cambia durante un draft.
  useEffect(() => {
    if (!ready || !state.league) {
      setMembers(null);
      return;
    }
    let cancelled = false;
    fetch(`${SLEEPER}/league/${state.league}/users`)
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
  }, [ready, state.league]);

  const take = (id, mine) =>
    setState((previous) => ({
      gone: mine ? previous.gone : [...previous.gone, id],
      mine: mine ? [...previous.mine, id] : previous.mine,
    }));

  const undo = (id) =>
    setState((previous) => ({
      gone: previous.gone.filter((x) => x !== id),
      mine: previous.mine.filter((x) => x !== id),
    }));

  if (!ready) {
    return <p className="caption">Loading draft mode…</p>;
  }

  const picked = board.filter((row) => mineSet.has(row.player_id));
  const total = state.gone.length + state.mine.length;

  return (
    <div className="draft">
      <div className="draft-head">
        <div>
          <strong>{picked.length}</strong> yours · <strong>{total}</strong> off the board
          {total > 0 ? (
            <>
              {" · "}
              <button type="button" className="link" onClick={() => setState({ gone: [], mine: [] })}>
                start over
              </button>
            </>
          ) : null}
        </div>
        <div className="draft-roster">
          {Object.keys(SLOTS).map((position) => (
            <span
              key={position}
              className={`slot ${counts[position] >= SLOTS[position] ? "slot--full" : ""}`}
            >
              {position} {counts[position]}/{SLOTS[position]}
            </span>
          ))}
        </div>
      </div>

      <p className="caption">
        Tap <strong>Mine</strong> or <strong>Gone</strong> as players come off the board.
        Saved in your browser — you can reload mid-draft.
      </p>

      <div className="sleeper">
        {state.league ? (
          <>
            <div className="sleeper-line">
              <span className={`dot dot--${sync.state}`} aria-hidden="true" />
              <strong>Sleeper</strong>
              <span className="outlet">league {state.league}</span>
              <button
                type="button"
                className="link"
                onClick={() => setState((p) => ({ ...p, league: "", userId: "" }))}
              >
                disconnect
              </button>
            </div>

            {members && members.length > 0 ? (
              <label className="field-label" htmlFor="draft-me">
                Which one are you — so your picks are kept apart from everyone else&rsquo;s
                <select
                  id="draft-me"
                  value={state.userId}
                  onChange={(event) =>
                    setState((p) => ({ ...p, userId: event.target.value }))
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

            {sync.state === "live" ? (
              <p className="caption">
                {sync.total} picks read
                {sync.unmatched?.length ? (
                  <>
                    {" "}·{" "}
                    <strong>
                      {sync.unmatched.length} unmatched, still counted as available
                    </strong>
                    : {sync.unmatched
                      .slice(0, 5)
                      .map((pick) =>
                        `${pick.metadata?.first_name ?? ""} ${pick.metadata?.last_name ?? ""}`.trim()
                      )
                      .filter(Boolean)
                      .join(", ")}
                    {sync.unmatched.length > 5 ? "…" : ""}. Casi siempre son rookies: sin
                    partido NFL no están en el board.
                  </>
                ) : null}
                . Refreshes every 15 seconds.
              </p>
            ) : null}
            {sync.state === "error" ? (
              <p className="caption sleeper-error">
                Could not read the draft: {sync.message}. The manual board still works and
                nothing already synced was lost.
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
              if (value) setState((p) => ({ ...p, league: value }));
            }}
          >
            <label className="field-label" htmlFor="draft-league">
              League URL or id
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
                <span className="pick-who">
                  <span className="nm">{row.player_name}</span>
                  <span className="meta">
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
            Nadie disponible con «{query.trim()}». Si ya lo tachaste, sigue tachado.
          </p>
        )
      ) : null}

      <h3 className="draft-h">Suggestions</h3>
      <ol className="picks">
        {suggestions.map((row, index) => (
          <li key={row.player_id} className={index === 0 ? "pick pick--top" : "pick"}>
            <span className="pick-rank">{index === 0 ? "★" : index + 1}</span>
            <span className="pick-who">
              <span className="nm">{row.player_name}</span>
              <span className="meta">
                {row.position}
                {row.position_rank} · {row.team} · VOR {num(row.vor, 1)}
                {row.risk_label && row.risk_label !== "Normal" ? (
                  <span className={`risk risk--${row.risk_label === "Volatile" ? "high" : "low"}`}>
                    {row.risk_label}
                  </span>
                ) : null}
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
