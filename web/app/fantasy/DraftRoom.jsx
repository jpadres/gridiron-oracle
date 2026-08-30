"use client";

/**
 * Draft Room: el compañero de draft, independiente de plataforma.
 *
 * ## Qué es y qué no
 *
 * No es un tablero de rankings del que van desapareciendo nombres. Es una
 * pantalla de decisión que **reacciona a cada pick**: cambia quién queda, cuánto
 * queda de cada tier, a cuántos picks estás y qué te falta de plantilla.
 *
 * Consume **eventos de pick canónicos** (`draftLog.js`). De dónde vengan es un
 * detalle del adaptador: hoy los pone el usuario a mano, y ese modo funciona en
 * Sleeper, ESPN, Yahoo, en la app que sea y en un draft presencial. Cuando la
 * sincronización automática esté comprobada, emitirá los mismos eventos y esta
 * pantalla no se entera.
 *
 * ## La regla de velocidad
 *
 *     VER JUGADOR → UN TOQUE → FUERA.
 *
 * Sin modal, sin confirmación, sin formulario. Deshacer aparece en el sitio.
 * Todo el estado es local: **ninguna petición de red entra en la ruta de un
 * pick**, así que la pantalla responde igual con la red caída.
 *
 * ## Lo que NO dice
 *
 * `BEST_PICK_FOR_ME` está BLOCKED: ordenar por «lo que le conviene a mi
 * plantilla» exige valor por liga y una regla de construcción que nadie ha
 * medido. Aquí se enseña BEST AVAILABLE —el board validado— con el contexto de
 * plantilla **al lado**, no fundido dentro. Los dos datos son útiles; mezclarlos
 * sería afirmar una tercera cosa que no está.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { num } from "../../data/model.js";
import { TeamMark, teamVars } from "../sports.jsx";
import {
  ROSTER, SOURCE, fold, isMyTurn, pickLabel, takeEvent, undoEvent, untilMyTurn,
} from "./draftLog.js";
import { loadOrMigrateLog, logScopeFor, saveLog } from "./draftStorage.js";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];

/**
 * Cuántos jugadores de un tier siguen libres.
 *
 * Es un CONTEO, no una predicción. «Quedan 2 en el tier 3 de WR» es un hecho
 * comprobable; «probablemente aguante hasta tu turno» sería una probabilidad que
 * nadie ha calibrado.
 */
function tierDepth(available, position) {
  const rows = available.filter((row) => row.position === position);
  if (rows.length === 0) return null;
  const tier = rows[0].tier;
  return { tier, left: rows.filter((row) => row.tier === tier).length, total: rows.length };
}

export default function DraftRoom({ board, context, league }) {
  const [events, setEvents] = useState([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);

  const teams = league?.teams ?? null;
  const type = league?.draftType ?? null;
  const mySlot = league?.mySlot ?? null;
  const rounds = league?.rounds ?? null;

  const scope = useMemo(
    () => logScopeFor({
      platform: league?.platform ?? "local",
      season: context.season,
      leagueId: league?.leagueId,
      draftId: league?.draftId,
    }),
    [league, context.season]
  );

  // Se lee después de montar: en el servidor no hay `localStorage`, y pintar
  // cosas distintas en los dos sitios rompe la hidratación.
  useEffect(() => {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    // La MISMA carga que hace el board, y por eso está en `draftStorage`. Antes
    // cada pantalla decidía por su cuenta qué heredar de las marcas v2, así que
    // cada una se construía su propia versión del mismo draft.
    setEvents(loadOrMigrateLog(scope, storage));
    setReady(true);
  }, [scope]);

  useEffect(() => {
    if (!ready) return;
    saveLog(scope, events, typeof window === "undefined" ? null : window.localStorage);
  }, [scope, events, ready]);

  const state = useMemo(() => fold(events), [events]);
  const available = useMemo(
    () => board.filter((row) => !state.byPlayer.has(row.player_id)),
    [board, state]
  );
  const roster = useMemo(
    () => board.filter((row) => state.mine.has(row.player_id)),
    [board, state]
  );

  const onClock = isMyTurn({ overall: state.count + 1, teams, type, mySlot });
  const next = untilMyTurn({ count: state.count, teams, type, mySlot, rounds });

  /**
   * Registrar un pick. **Una sola interacción.**
   *
   * El roster se deriva del puesto cuando se puede y se declara cuando no. Si no
   * se puede establecer, queda `UNKNOWN`: el jugador sale del board y **no entra
   * en la plantilla de nadie**. Asignarlo mal corrompe todas las decisiones
   * siguientes, así que aquí no se adivina.
   */
  const record = useCallback((row, declared) => {
    const derived = isMyTurn({ overall: state.count + 1, teams, type, mySlot });
    const roster = declared ?? (derived === null
      ? ROSTER.UNKNOWN
      : derived ? ROSTER.MINE : ROSTER.OPPONENT);
    setEvents((previous) => [
      ...previous,
      takeEvent({
        playerId: row.player_id,
        roster,
        rosterSource: declared ? "DECLARED" : derived === null ? "UNKNOWN" : "DERIVED",
        source: SOURCE.MANUAL,
      }),
    ]);
    setQuery("");
    setFlash({ row, roster });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 6000);
  }, [state.count, teams, type, mySlot]);

  const undo = useCallback((playerId) => {
    setEvents((previous) => [...previous, undoEvent({ playerId, source: SOURCE.MANUAL })]);
    setFlash(null);
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    let rows = position === "ALL" ? available : available.filter((r) => r.position === position);
    if (text.length >= 2) {
      rows = rows.filter(
        (row) =>
          (row.player_full_name ?? row.player_name).toLowerCase().includes(text) ||
          row.player_name.toLowerCase().includes(text) ||
          row.team?.toLowerCase() === text
      );
    }
    return rows.slice(0, 60);
  }, [available, position, query]);

  const best = available[0] ?? null;
  const depth = best ? tierDepth(available, best.position) : null;

  if (!ready) return <p className="caption">Loading draft room&hellip;</p>;

  return (
    <div className="room">
      {/* --- estado del draft: siempre lo primero --------------------------- */}
      <section className={onClock ? "room-state room-state--clock" : "room-state"}
               aria-live="polite">
        {onClock === true ? (
          <>
            <p className="eyebrow">You&rsquo;re on the clock</p>
            <p className="room-pick">{pickLabel(state.count + 1, teams, type)}</p>
          </>
        ) : next ? (
          <>
            <p className="eyebrow">Until your pick</p>
            <p className="room-pick">
              {next.away}
              <small>{next.away === 1 ? "pick" : "picks"} · you&rsquo;re up at {next.round}.{String(next.inRound).padStart(2, "0")}</small>
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">Draft position</p>
            <p className="room-pick room-pick--unknown">
              UNKNOWN
              <small>Set your slot to see whose pick it is</small>
            </p>
          </>
        )}
        <p className="room-count">
          Manual draft · <strong>{state.count}</strong> {state.count === 1 ? "pick" : "picks"} recorded
        </p>
      </section>

      {/* --- deshacer, en el sitio ------------------------------------------ */}
      {flash ? (
        <p className="room-flash" role="status">
          <strong>{flash.row.player_full_name ?? flash.row.player_name}</strong>
          {flash.roster === ROSTER.MINE ? " — yours" : flash.roster === ROSTER.UNKNOWN ? " — taken, roster unknown" : " — taken"}
          <button type="button" className="link" onClick={() => undo(flash.row.player_id)}>
            Undo
          </button>
        </p>
      ) : null}

      <div className="room-grid">
        {/* --- decisión ---------------------------------------------------- */}
        <section className="room-decision" aria-label="Best available">
          <p className="eyebrow">Best available</p>
          {best ? (
            <article className="room-best" style={teamVars(best.team)}>
              <span className="rank-numeral rank-numeral--hero">{best.position_rank}</span>
              <div className="room-best-who">
                <h3>{best.player_full_name ?? best.player_name}</h3>
                <p className="room-best-meta">
                  <TeamMark abbr={best.team} solid />
                  <span className={`ptag ptag--${best.position.toLowerCase()}`}>{best.position}</span>
                  <span>Tier {best.tier}</span>
                </p>
              </div>
              <span className="room-best-vor">{num(best.vor, 1)}<small>VOR</small></span>
            </article>
          ) : (
            <p className="caption">Board exhausted.</p>
          )}

          {depth ? (
            <p className="room-depth">
              <strong>{depth.left}</strong> left in {best.position} tier {depth.tier} ·{" "}
              <strong>{depth.total}</strong> {best.position}s on the board
            </p>
          ) : null}

          {best ? (
            <div className="room-actions">
              {/* La acción principal cambia según de quién sea el pick, así que
                  el gesto es siempre uno. Cuando no se sabe, las dos pesan igual
                  y el usuario decide — nunca se asigna por defecto. */}
              {onClock === true ? (
                <>
                  <button type="button" className="act act--mine"
                          onClick={() => record(best, ROSTER.MINE)}>
                    Draft him
                  </button>
                  <button type="button" className="act act--gone"
                          onClick={() => record(best, ROSTER.OPPONENT)}>
                    Someone else took him
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="act act--gone"
                          onClick={() => record(best, onClock === null ? undefined : ROSTER.OPPONENT)}>
                    Taken
                  </button>
                  <button type="button" className="act act--mine"
                          onClick={() => record(best, ROSTER.MINE)}>
                    I took him
                  </button>
                </>
              )}
            </div>
          ) : null}

          {/* La limitación va pegada a la decisión, no escondida abajo. */}
          <p className="caption room-limit">
            Best available on the published board, not a recommendation tuned to your roster.
            Your roster context is beside it, not folded into it.
          </p>
        </section>

        {/* --- tablero disponible ------------------------------------------ */}
        <section className="room-board" aria-label="Available players">
          <div className="room-tools">
            <input
              type="search"
              className="draft-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a player"
              aria-label="Search available players"
            />
            <div className="pos-filter" role="group" aria-label="Filter by position">
              {POSITIONS.map((entry) => (
                <button key={entry} type="button" className="pos-option"
                        aria-pressed={position === entry}
                        onClick={() => setPosition(entry)}>
                  {entry}
                </button>
              ))}
            </div>
          </div>
          <ol className="room-list">
            {shown.map((row) => (
              <li key={row.player_id} style={teamVars(row.team)}>
                {/* Toda la fila es el botón: el objetivo táctil es la fila
                    entera, que es lo que hace que un pick sea un toque. */}
                <button type="button" className="room-row" onClick={() => record(row)}>
                  <span className="room-row-rank">{row.overall_rank}</span>
                  <span className="room-row-who">
                    <span className="nm">{row.player_full_name ?? row.player_name}</span>
                    <span className="meta">
                      <TeamMark abbr={row.team} />
                      <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                        {row.position}{row.position_rank}
                      </span>
                      <span>T{row.tier}</span>
                    </span>
                  </span>
                  <span className="room-row-vor">{num(row.vor, 1)}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="caption">No available player matches that.</li>
            ) : null}
          </ol>
        </section>

        {/* --- plantilla y picks recientes --------------------------------- */}
        <aside className="room-side">
          <section aria-label="My roster">
            <p className="eyebrow">My roster ({roster.length})</p>
            {roster.length === 0 ? (
              <p className="caption">Nothing yet.</p>
            ) : (
              <ul className="room-roster">
                {roster.map((row) => (
                  <li key={row.player_id} style={teamVars(row.team)}>
                    <span className={`ptag ptag--${row.position.toLowerCase()}`}>{row.position}</span>
                    <span className="nm">{row.player_full_name ?? row.player_name}</span>
                    <TeamMark abbr={row.team} />
                    <button type="button" className="link" onClick={() => undo(row.player_id)}>
                      undo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Recent picks">
            <p className="eyebrow">Recent picks</p>
            {state.picks.length === 0 ? (
              <p className="caption">The feed fills as you record picks.</p>
            ) : (
              <ol className="room-feed">
                {[...state.picks].reverse().slice(0, 10).map((pick) => {
                  const row = board.find((r) => r.player_id === pick.playerId);
                  return (
                    <li key={pick.playerId} style={teamVars(row?.team)}
                        className={pick.roster === ROSTER.MINE ? "is-mine" : undefined}>
                      <span className="feed-pick">{pickLabel(pick.overall, teams, type)}</span>
                      <span className="feed-who">
                        {row?.player_full_name ?? row?.player_name ?? pick.playerId}
                      </span>
                      {row ? <TeamMark abbr={row.team} /> : null}
                      <button type="button" className="link" onClick={() => undo(pick.playerId)}>
                        undo
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
