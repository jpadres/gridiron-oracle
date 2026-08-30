"use client";

/**
 * La zona principal del board: una vista, un filtro de posición, un sitio.
 *
 * ## Qué problema resuelve
 *
 * La página anterior era un documento con nueve anclas. Pulsar «WR» bajaba a
 * una sección de receptores escrita más abajo, y las cinco tablas del board
 * —global más una por posición— estaban todas montadas a la vez. Medido: el
 * primer jugador aparecía a 5.149 px en un móvil de 390. Seis pantallas de
 * scroll antes de ver a alguien.
 *
 * Aquí el contenido cambia **en el sitio**: una sola tabla, filtrada.
 *
 * ## Por qué el estado vive en la URL
 *
 * `?view=draft&pos=WR` da enlace profundo, botón atrás y recarga. Se hace con
 * `history.pushState` en vez de con el router de Next a propósito: el router
 * arrastra un `Suspense` y una dependencia que este sitio estático no necesita,
 * y lo que se gana son quince líneas.
 *
 * Perder la vista al recargar es justo lo que más duele en mitad de un draft.
 *
 * ## Por qué `DraftMode` nunca se desmonta
 *
 * Se queda montado y oculto al cambiar de vista. Su estado sobrevive en
 * `localStorage`, pero desmontarlo reiniciaría el sondeo a Sleeper mientras
 * corre el reloj del pick. Cambiar de posición sólo le cambia la lista.
 */

import { useCallback, useEffect, useState } from "react";

import { num } from "../../data/model.js";
import { BustCell, Callout, RankTable } from "../ui.jsx";
import DraftMode from "./DraftMode.jsx";

// Las columnas viven aquí y no en la página porque llevan funciones `format`,
// y una función no cruza la frontera de servidor a cliente. Además son
// presentación pura, que es de lo que este componente se ocupa.
//
// Sólo números comparables: el nombre, la posición y el equipo van apilados en
// la celda del jugador, que es donde se leen juntos.
const BOARD_COLUMNS = [
  { key: "projected_points", label: "Proj", format: (v) => num(v, 1) },
  { key: "vor", label: "VOR", format: (v) => num(v, 1) },
  // Las dos columnas de riesgo van a la derecha de la proyección, no a su
  // izquierda: primero cuánto vale el jugador, después qué puede salir mal. Al
  // revés se lee como si el riesgo fuese el criterio de ordenación, y no lo es.
  { key: "p_bust", label: "Bust", format: (_v, row) => <BustCell row={row} /> },
  {
    key: "missed_games",
    label: "Missed",
    format: (v) => (v === null || v === undefined ? "—" : num(v, 1)),
  },
];

const VIEWS = [
  { id: "draft", label: "Draft" },
  { id: "consensus", label: "Consensus" },
  { id: "risk", label: "Risk" },
  { id: "validation", label: "Validation" },
];

/**
 * Las siete posiciones del selector.
 *
 * K y DST estaban ausentes, y su ausencia no era una decisión: el board sólo
 * proyecta las cuatro posiciones con historial de volumen. Que no haya
 * proyección no es motivo para esconder la posición — **disponibilidad de dato y
 * autoridad para recomendar son cosas distintas**, y cada una se dice por
 * separado en su panel.
 *
 * Una sola etiqueta por posición en todo el producto: `DST`, nunca DEF, D/ST ni
 * Defense. Alternarlas hace pensar que son cosas distintas.
 */
const POSITION_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];

// Las que el board de VOR sí ordena. El resto tiene panel propio.
const BOARD_POSITIONS = new Set(["ALL", "QB", "RB", "WR", "TE"]);

const VIEW_IDS = new Set(VIEWS.map((view) => view.id));

/** Lo que diga la URL, si dice algo válido. Si no, el defecto. */
function readUrl() {
  if (typeof window === "undefined") return { view: "draft", position: "ALL" };
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const position = params.get("pos")?.toUpperCase();
  return {
    view: VIEW_IDS.has(view) ? view : "draft",
    position: POSITION_FILTERS.includes(position) ? position : "ALL",
  };
}

/**
 * Numera dentro de la lista que se enseña.
 *
 * En ALL el número es el orden global; dentro de una posición es el de esa
 * posición. Reusar `overall_rank` en la lista de receptores daría un «#47» en
 * la primera fila, que es la clase de detalle que hace dudar de todo lo demás.
 */
function numbered(rows) {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function GapList({ rows }) {
  if (rows.length === 0) {
    return <p className="caption">No disagreements at this position.</p>;
  }
  return (
    <ol className="gap">
      {rows.map((row) => (
        <li key={row.player_id ?? row.player_name}>
          <span className="gap-who">
            <span className={`ptag ptag--${row.position.toLowerCase()}`}>{row.position}</span>
            <strong>{row.player_name}</strong> <span className="outlet">{row.team}</span>
          </span>
          <span className="gap-nums">
            <span className="outlet">
              here #{row.model_rank} · consensus #{row.consensus_rank}
            </span>
            <span className={row.gap > 0 ? "gap-up" : "gap-down"}>
              {row.gap > 0 ? `+${row.gap}` : row.gap}
            </span>
          </span>
          {row.analysis ? <span className="gap-note">{row.analysis}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export default function BoardShell({
  board,
  gap,
  availability,
  briefs,
  context,
  methodology,
  draftNote,
  consensusNotes,
  riskNotes,
  boardFooter,
  validationPanel,
}) {
  const [{ view, position }, setState] = useState({ view: "draft", position: "ALL" });

  // La URL se lee DESPUÉS de montar, no durante el render. El servidor pinta
  // siempre el defecto, así que el HTML estático y la primera pasada del
  // cliente coinciden y no hay desajuste de hidratación.
  useEffect(() => {
    setState(readUrl());
    const onPop = () => setState(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next) => {
    setState((current) => {
      const merged = { ...current, ...next };
      const params = new URLSearchParams();
      if (merged.view !== "draft") params.set("view", merged.view);
      if (merged.position !== "ALL") params.set("pos", merged.position);
      const query = params.toString();
      // `pushState` y no `replaceState`: sin una entrada nueva el botón atrás
      // se saltaría la página entera en vez de deshacer el filtro.
      window.history.pushState({}, "", query ? `?${query}` : window.location.pathname);
      return merged;
    });
  }, []);

  const filtered = position === "ALL" ? board : board.filter((row) => row.position === position);
  const filteredGap = position === "ALL" ? gap : gap.filter((row) => row.position === position);
  const showBoard = (view === "draft" || view === "risk") && BOARD_POSITIONS.has(position);

  return (
    <>
      <h1>{context.season} Draft Board</h1>
      <p className="board-context">
        {context.scoring} · {context.teams}-team league · {board.length} players
        {context.league ? <> · synced from Sleeper: <strong>{context.league}</strong></> : null}
      </p>

      <div className="board-controls">
        <nav className="view-tabs" aria-label="Board view">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="view-tab"
              aria-current={view === entry.id ? "page" : undefined}
              onClick={() => go({ view: entry.id })}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        {view === "validation" ? null : (
          <div
            className="pos-filter"
            role="group"
            aria-label="Filter by position"
          >
            {POSITION_FILTERS.map((entry) => (
              <button
                key={entry}
                type="button"
                className="pos-option"
                aria-pressed={position === entry}
                // La activa se lleva a la vista: con siete opciones en una tira
                // que se desplaza, DST puede quedar fuera de pantalla y parecer
                // que no existe.
                ref={(node) => {
                  if (node && position === entry) {
                    node.scrollIntoView({ block: "nearest", inline: "center" });
                  }
                }}
                onClick={() => go({ position: entry })}
              >
                {entry}
              </button>
            ))}
          </div>
        )}
      </div>

      <details className="methodology">
        <summary>How it works</summary>
        {methodology}
      </details>

      {/* Siempre montado. Ocultarlo en vez de desmontarlo es lo que conserva el
          draft en curso: el roster, los jugadores ya tomados y el sondeo a
          Sleeper sobreviven al cambio de vista. */}
      {/* También se oculta en K y DST: el modo draft trabaja sobre el board de
          VOR, que no contiene ninguna de las dos posiciones. Enseñar ahí el
          contador de plantilla y el buscador sugiere que se puede draftear un
          pateador desde esta lista, y no se puede. Sigue MONTADO: el draft en
          curso no se pierde al mirar K un momento. */}
      <div hidden={view !== "draft" || !BOARD_POSITIONS.has(position)}>
        {/* El board va ENTERO. El filtro viaja aparte porque DraftMode lo usa
            para el índice de Sleeper, el recuento de tu plantilla y el ajuste
            por posición: recortarlo aquí le rompía las tres cosas. */}
        <DraftMode board={board} positionFilter={position} season={context.season} />
        {draftNote}
      </div>

      {!BOARD_POSITIONS.has(position) ? (
        <SpecialTeamsPanel position={position} league={context.league} />
      ) : null}

      {view === "consensus" ? (
        <section aria-label="Consensus disagreement">
          <div className="two-up">
            <div>
              <h2>The model ranks these higher</h2>
              <p className="caption">Above where expert consensus has them.</p>
              <GapList rows={filteredGap.slice(0, 8)} />
            </div>
            <div>
              <h2>The model ranks these lower</h2>
              <p className="caption">Below where consensus has them.</p>
              <GapList rows={[...filteredGap].slice(-8).reverse()} />
            </div>
          </div>
          {consensusNotes}
        </section>
      ) : null}

      {view === "validation" ? validationPanel : null}

      {showBoard ? (
        <section aria-label="Player board">
          {filtered.length === 0 ? (
            <p className="caption">No players at this position.</p>
          ) : (
            <RankTable
              rows={numbered(filtered)}
              columns={BOARD_COLUMNS}
              availability={availability}
              briefs={briefs}
              risk
              tiers={position === "ALL"}
            />
          )}
          {/* La curva va DEBAJO de la tabla: es contexto de por qué el orden es
              el que es, no la decisión. Encima costaba 243 px antes del primer
              jugador. */}
          {boardFooter}
        </section>
      ) : null}

      {view === "risk" ? riskNotes : null}
    </>
  );
}

/**
 * Pateador y defensa: lo que de verdad hay, dicho sin adornos.
 *
 * Ninguna de las dos posiciones tiene proyección publicada, y los motivos son
 * distintos y están medidos — no son un «todavía no me ha dado tiempo»:
 *
 * - **K.** El modelo de pateadores existe (`fantasy/kickers.py`) y su ordenación
 *   está **RECHAZADA** por el experimento E8b: la separación entre K1-K6 y
 *   K7-K12 es de 0,26 puntos por partido con IC95% [−0,36, +0,87], que incluye
 *   el cero. Y su proyección depende **enteramente** de los puntos del equipo,
 *   que para una temporada completa este proyecto no publica. Así que no hay
 *   número que enseñar y tampoco habría orden que defender.
 *
 * - **DST.** nflverse no trae una entidad de defensa de equipo: las estadísticas
 *   defensivas son por jugador. Cero filas. `DST_STREAMING` está en DESIGN_ONLY
 *   justamente por eso: hay una señal medida, pero no hay modelo construido.
 *
 * Lo que sí se puede afirmar se afirma, con su número y su experimento al lado.
 * Inventar un ranking de doce pateadores sería exactamente el tipo de número
 * fabricado que el resto del sitio existe para no publicar.
 */
function SpecialTeamsPanel({ position, league }) {
  const kicker = position === "K";
  return (
    <section className="special" aria-label={kicker ? "Kicker" : "Team defense"}>
      <p className="eyebrow">{kicker ? "Kicker" : "Team defense / special teams"}</p>
      <h2>{kicker ? "No kicker rankings, on purpose" : "No DST rankings, and not for lack of trying"}</h2>

      {kicker ? (
        <>
          <p className="lede">
            This board does not rank kickers. That is a measured decision, not a gap:{" "}
            <strong>the gap between K1&ndash;K6 and K7&ndash;K12 is 0.26 points per
            game</strong>, 95% CI [&minus;0.36, +0.87]. The interval contains zero, so the
            order inside the top twelve is not distinguishable from noise.
          </p>
          <p>
            A separate experiment asked whether kicker <em>skill</em> is measurable at all.
            Field-goal percentage does not predict the next year&rsquo;s (r 0.024) and its
            spread barely exceeds coin-flip variance. About{" "}
            <strong>13% of the variance is skill</strong>; the rest is chance.
          </p>
          <p>
            What the projection does track is <strong>the offense</strong>: attempts follow
            team scoring, and the kicker contributes no parameter of his own. So the only
            defensible rule is the boring one.
          </p>
          <Callout title="What to do instead">
            <p>
              Take a kicker on a good offense in the last round, and stream. Do not spend a
              pick on the &ldquo;right&rdquo; kicker — the evidence says there is no right
              one to find.
            </p>
          </Callout>
        </>
      ) : (
        <>
          <p className="lede">
            There is <strong>no team-defense projection here at all</strong>, and the reason
            is upstream of the model: nflverse publishes defensive statistics{" "}
            <strong>per player</strong>, not as a team-defense entity. Zero rows exist to
            project from.
          </p>
          <p>
            One signal has been measured and it is the useful one:{" "}
            <strong>the opponent&rsquo;s implied total predicts points allowed at r
            0.388</strong>, against r 0.060 for the defense&rsquo;s own last game. In other
            words, who a defense plays predicts its week far better than how it just played.
          </p>
          <p>
            And what does <em>not</em> hold: forced turnovers are not a stable quality.
            Fumble recoveries year over year come in at <strong>r 0.044</strong>.
          </p>
          <Callout title="What to do instead">
            <p>
              Stream on schedule, not on reputation. Take the defense facing the lowest
              implied total that week. A ranked DST list would be a number invented to fill
              a column.
            </p>
          </Callout>
        </>
      )}

      <p className="caption">
        {league
          ? "Your league's roster settings decide whether you need one of these at all."
          : "Connect your league in Draft mode and this will use your actual roster slots."}
      </p>
    </section>
  );
}
