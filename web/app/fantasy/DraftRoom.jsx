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
  ROSTER, SOURCE, fold, isMyTurn, pickLabel, slotForOverall, takeEvent, undoEvent,
  untilMyTurn,
} from "./draftLog.js";
import { loadOrMigrateLog, logScopeFor, saveLog } from "./draftStorage.js";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
// El board de VOR sólo ordena estas cuatro. K y DST son alcanzables porque
// existen en la liga, pero no tienen proyección: se dice, no se inventa.
const RANKED = new Set(["ALL", "QB", "RB", "WR", "TE"]);

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

/**
 * Profundidad de cada posición. CONTEO, no consejo.
 *
 * Se llama PROFUNDIDAD y no «¿puedo esperar?» a propósito: cuántos quedan en el
 * tier de arriba es un hecho comprobable; si conviene esperar sería una regla de
 * decisión que nadie ha validado.
 */
function positionDepth(available) {
  return ["QB", "RB", "WR", "TE"]
    .map((position) => ({ position, ...(tierDepth(available, position) ?? {}) }))
    .filter((entry) => entry.total > 0);
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
  const depth = useMemo(() => positionDepth(available), [available]);

  // El contexto del board publicado. Los valores NO son de la liga del usuario:
  // salen del board horneado, y la etiqueta lo dice en vez de dejarlo suponer.
  const boardContext = [context.scoring, context.teams ? `${context.teams}-team` : null]
    .filter(Boolean).join(" · ");
  const leagueDiffers = Boolean(teams && context.teams && teams !== context.teams);

  // Filas con separador de tier: el corte se ve al escanear, sin convertir cada
  // tier en un panel. Sólo cuando la lista está ordenada por valor — con una
  // búsqueda activa el orden es otro y un separador mentiría.
  const rows = useMemo(() => {
    const out = [];
    let previous = null;
    const marking = query.trim().length < 2;
    // El recuento del tier sale del pool DISPONIBLE de esa vista, no de las 60
    // filas que se pintan. Contarlo sobre lo visible decía «3 left» cuando
    // quedaban doce: el corte caía dentro de la ventana y el resto del tier
    // estaba fuera. Un número que se lee como escasez y que era un artefacto
    // del scroll.
    const pool = position === "ALL"
      ? available
      : available.filter((r) => r.position === position);
    for (const row of shown) {
      if (marking && row.tier !== previous) {
        const left = pool.filter((r) => r.tier === row.tier).length;
        out.push({ kind: "tier", tier: row.tier, left, key: `t${row.tier}` });
        previous = row.tier;
      }
      out.push({ kind: "player", row, key: row.player_id });
    }
    return out;
  }, [shown, query, available, position]);

  if (!ready) return <p className="caption">Loading draft room&hellip;</p>;

  const overall = state.count + 1;
  const here = slotForOverall(overall, teams, type);

  return (
    <div className="room">
      {/* --- BANDA DE ESTADO -----------------------------------------------
          Lo más fuerte de la pantalla, con tipografía y no con tamaño de caja.
          Lleva DÓNDE estamos (ronda y pick) además de cuánto falta: sin la
          ronda, «2 picks» no sitúa a nadie en el draft. */}
      <section className={onClock ? "room-state room-state--clock" : "room-state"}
               aria-live="polite">
        <p className="room-where">
          {here ? (
            <>Round <b>{here.round}</b> · Pick <b>{here.inRound}</b></>
          ) : (
            <>Pick <b>{overall}</b></>
          )}
          <span className="room-where-sep" aria-hidden="true">·</span>
          <span className="room-count">
            <strong>{state.count}</strong> recorded
          </span>
        </p>

        {onClock === true ? (
          <p className="room-clock">On the clock</p>
        ) : next ? (
          <p className="room-until">
            <span className="room-until-n">{next.away}</span>
            <span className="room-until-t">
              {next.away === 1 ? "pick until you" : "picks until you"}
              <small>you&rsquo;re up at {next.round}.{String(next.inRound).padStart(2, "0")}</small>
            </span>
          </p>
        ) : (
          <p className="room-until room-until--unknown">
            <span className="room-until-n">—</span>
            <span className="room-until-t">
              Draft slot UNKNOWN
              <small>set your slot to see whose pick it is</small>
            </span>
          </p>
        )}
      </section>

      {/* Deshacer: temporal y discreto. No compite con la banda de estado. */}
      {flash ? (
        <p className="room-flash" role="status">
          <strong>{flash.row.player_full_name ?? flash.row.player_name}</strong>
          <span>
            {flash.roster === ROSTER.MINE
              ? "yours"
              : flash.roster === ROSTER.UNKNOWN ? "taken · roster unknown" : "taken"}
          </span>
          <button type="button" className="room-undo" onClick={() => undo(flash.row.player_id)}>
            Undo
          </button>
        </p>
      ) : null}

      <div className="room-grid">
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
          {!RANKED.has(position) ? (
            /* K y DST existen en la liga y NO tienen proyección. Se dice; no se
               inventa un orden para llenar un filtro que la interfaz ofrece. */
            <p className="room-empty">
              <strong>{position} is not projected.</strong> The kicker model was
              rejected and team defence is design-only, so there is no ranking to
              show here — only what the league needs.
            </p>
          ) : (
            <ol className="room-list">
              {rows.map((entry) =>
                entry.kind === "tier" ? (
                  /* El corte de tier, visible al escanear y sin ser un panel.
                     Es un CONTEO: cuántos quedan de ese tier en esta vista. */
                  <li key={entry.key} className="room-tier" aria-hidden="true">
                    <span>Tier {entry.tier}</span>
                    <span className="room-tier-left">{entry.left} left</span>
                  </li>
                ) : (
                  <li key={entry.key} style={teamVars(entry.row.team)}
                      className={entry.row === best ? "is-best" : undefined}>
                    {/* Toda la fila es el botón: el objetivo táctil es la fila
                        entera, que es lo que hace que un pick sea un toque. */}
                    <button type="button" className="room-row" onClick={() => record(entry.row)}>
                      <span className="room-row-rank">{entry.row.overall_rank}</span>
                      <span className="room-row-who">
                        <span className="nm">
                          {entry.row.player_full_name ?? entry.row.player_name}
                        </span>
                        <span className="meta">
                          <TeamMark abbr={entry.row.team} />
                          <span className={`ptag ptag--${entry.row.position.toLowerCase()}`}>
                            {entry.row.position}{entry.row.position_rank}
                          </span>
                        </span>
                      </span>
                      <span className="room-row-vor">{num(entry.row.vor, 1)}</span>
                    </button>
                  </li>
                )
              )}
              {rows.length === 0 ? (
                /* Board AGOTADO y búsqueda SIN RESULTADOS son cosas distintas y
                   decían lo mismo. En una liga de 32 con banquillo profundo el
                   pool publicado se acaba de verdad —480 huecos contra 344
                   jugadores— y «no player matches that» mandaba a buscar un
                   fallo de filtro donde no lo había. */
                <li className="room-empty">
                  {available.length === 0 ? (
                    <>
                      <strong>Board exhausted.</strong> Every published player is off the
                      board. The published pool is {board.length} deep; a league this size
                      drafts past it.
                    </>
                  ) : query.trim().length >= 2 ? (
                    <>No available player matches &ldquo;{query.trim()}&rdquo;.</>
                  ) : (
                    <>No {position} left on the board.</>
                  )}
                </li>
              ) : null}
            </ol>
          )}
        </section>

        {/* --- contexto: profundidad, plantilla y ticker -------------------- */}
        <aside className="room-side">
          {/* PROFUNDIDAD, no «¿puedo esperar?». Cuántos quedan en el tier de
              arriba es comprobable; si conviene esperar sería una regla de
              decisión que nadie ha validado. */}
          {depth.length > 0 ? (
            <section aria-label="Position depth">
              <h2 className="room-h">Position depth</h2>
              <ul className="room-depth">
                {depth.map((entry) => (
                  <li key={entry.position}>
                    <span className={`ptag ptag--${entry.position.toLowerCase()}`}>
                      {entry.position}
                    </span>
                    <span className="room-depth-tier">Tier {entry.tier}</span>
                    <span className="room-depth-left">
                      <b>{entry.left}</b> left
                    </span>
                    <span className="room-depth-total">{entry.total} on board</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="My roster">
            <h2 className="room-h">
              My roster <span className="room-h-n">{roster.length}</span>
            </h2>
            {roster.length === 0 ? (
              <p className="room-empty">Nothing yet.</p>
            ) : (
              <ul className="room-roster">
                {roster.map((row) => (
                  <li key={row.player_id} style={teamVars(row.team)}>
                    <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                      {row.position}
                    </span>
                    <span className="nm">{row.player_full_name ?? row.player_name}</span>
                    <TeamMark abbr={row.team} />
                    {/* La semana de descanso es un hecho del calendario, no un
                        aviso. Se pinta como dato —«BYE 7»— y no en color de
                        alarma: cuándo descansa un jugador no dice qué hacer con
                        él, y teñirlo de rojo lo convertiría en un consejo que
                        nadie ha validado. */}
                    {context.byes?.[row.team] ? (
                      <span className="room-bye">Bye {context.byes[row.team]}</span>
                    ) : null}
                    <button type="button" className="room-x"
                            aria-label={`Undo ${row.player_full_name ?? row.player_name}`}
                            onClick={() => undo(row.player_id)}>
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {/* Los HUECOS de la plantilla no se pintan: el Draft Room no recoge
                `roster_positions`, así que dibujar QB/RB/WR/TE/FLEX sería
                inventarse la estructura de una liga que no se ha leído. Se
                enseña lo que hay —quién llevas— y se dice qué falta. */}
            <p className="room-note">
              Slots are not drawn: this room does not read your roster structure,
              and drawing one would be inventing it.
            </p>
          </section>

          <section aria-label="Recent picks">
            <h2 className="room-h">Recent picks</h2>
            {state.picks.length === 0 ? (
              <p className="room-empty">The feed fills as you record picks.</p>
            ) : (
              <ol className="room-feed">
                {[...state.picks].reverse().slice(0, 12).map((pick) => {
                  const row = board.find((r) => r.player_id === pick.playerId);
                  const name = row?.player_full_name ?? row?.player_name ?? pick.playerId;
                  return (
                    <li key={pick.playerId} style={teamVars(row?.team)}
                        className={pick.roster === ROSTER.MINE ? "is-mine" : undefined}>
                      <span className="feed-pick">{pickLabel(pick.overall, teams, type)}</span>
                      <span className="feed-who">{name}</span>
                      {row ? (
                        <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                          {row.position}
                        </span>
                      ) : null}
                      {/* Deshacer está, y no compite: un aspa recesiva con su
                          etiqueta accesible, no un botón por cada pick pasado. */}
                      <button type="button" className="room-x"
                              aria-label={`Undo ${name}`}
                              onClick={() => undo(pick.playerId)}>
                        &times;
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* La metodología, detrás de una divulgación progresiva. Nadie en
              mitad de un draft debe leer prosa de validación antes de ver
              jugadores. */}
          <details className="room-method">
            <summary>What these numbers are</summary>
            <p>
              Values come from the published board{boardContext ? ` (${boardContext})` : ""} —
              best available by VOR, <strong>not</strong> a recommendation tuned to your
              roster. Your roster context sits beside it, never folded into it.
            </p>
            {leagueDiffers ? (
              <p>
                Your league has <strong>{teams} teams</strong> and the published board is
                built for {context.teams}. Replacement level moves with league size, so
                treat the ordering as a starting point, not your league&rsquo;s board.
              </p>
            ) : null}
          </details>
        </aside>
      </div>
    </div>
  );
}
