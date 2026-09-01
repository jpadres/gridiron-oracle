"use client";

/**
 * El centro de mando: la cola de hechos y el catálogo de ligas.
 *
 * ## Lo que es y lo que no
 *
 * Responde «¿dónde está pasando algo?» con HECHOS: estás en el reloj, faltan
 * dos picks, hay huecos titulares abiertos en un draft vivo, una estructura
 * está sin configurar. No responde «¿a quién ficho?» ni «¿qué liga va mal?» —
 * eso serían recomendaciones, y ninguna está validada.
 *
 * ## Composición
 *
 * Una cola compacta arriba (sólo lo operativo) y la lista de ligas debajo, en
 * filas y no en tarjetas: con veinte ligas un muro de tarjetas no se escanea.
 * Cuando no hay nada operativo, se dice «nothing needs your eyes» y ya — el
 * blanco no se rellena con contenido inventado.
 *
 * Todo sale del almacenamiento local: catálogo + registros. Sin red, y las
 * ligas manuales son primera clase — el proveedor es contexto de capacidad, no
 * un escalafón.
 */

import { useEffect, useMemo, useState } from "react";

import { TeamMark } from "../../sports.jsx";
import {
  attentionItems, labelFor, leagueSnapshot, sortAttention, sortLeagues,
} from "../attention.js";
import { ROOM_LEAGUE_KEY, knownLeagues } from "../draftStorage.js";
import { providerLabel } from "../providers.js";

export default function LeaguesShell({ board, context }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    setEntries(knownLeagues(window.localStorage));
  }, []);

  const snapshots = useMemo(() => {
    if (!entries) return [];
    const storage = typeof window === "undefined" ? null : window.localStorage;
    return sortLeagues(entries.map((entry) =>
      leagueSnapshot(entry, { storage, board, byes: context.byes })));
  }, [entries, board, context.byes]);

  const queue = useMemo(
    () => sortAttention(snapshots.flatMap((snapshot) => attentionItems(snapshot))),
    [snapshots]
  );

  /**
   * Abrir una liga = hacerla la ACTIVA del Draft Room y navegar. Es la misma
   * clave que escribe la antesala; una liga sin configuración no ofrece esta
   * acción, porque no se puede activar lo que no se conoce — y un botón que no
   * puede cumplir su etiqueta es peor que ninguno.
   */
  const open = (snapshot) => {
    if (!snapshot.config) return;
    try {
      window.localStorage.setItem(ROOM_LEAGUE_KEY, JSON.stringify(snapshot.config));
    } catch { /* modo privado: se navega igual y la antesala preguntará */ }
    window.location.href = "/fantasy/draft";
  };
  const byScope = useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.scope, snapshot])),
    [snapshots]
  );

  if (entries === null) return <p className="caption">Reading your leagues&hellip;</p>;

  return (
    <div className="cc">
      <p className="eyebrow">{context.season} season</p>
      <h1>Leagues</h1>

      {entries.length === 0 ? (
        /* Sin ligas no hay página rota: están los dos caminos que existen. */
        <div className="cc-empty">
          <p className="lede">No leagues yet.</p>
          <p>
            Set up a manual league in the <a href="/fantasy/draft">Draft Assistant</a> — it works
            for drafts on any platform — or connect a Sleeper league from the{" "}
            <a href="/fantasy">Draft Board</a>.
          </p>
        </div>
      ) : (
        <>
          {/* --- LA COLA: sólo lo operativo ------------------------------- */}
          {queue.length > 0 ? (
            <ol className="cc-queue" aria-label="Needs your eyes">
              {queue.map((item) => (
                <li key={`${item.scope}:${item.type}`}
                    className={`cc-item cc-item--${item.type === "ON_THE_CLOCK" ? "clock" : item.category.toLowerCase()}`}>
                  <span className="cc-item-what">
                    <b>{item.message}</b>
                    {item.detail ? <small>{item.detail}</small> : null}
                  </span>
                  <span className="cc-item-league">{item.league}</span>
                  {byScope.get(item.scope)?.config ? (
                    <button type="button" className="cc-item-go"
                            onClick={() => open(byScope.get(item.scope))}>
                      {item.action}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="cc-clear">
              Nothing needs your eyes right now.
            </p>
          )}

          {/* --- EL CATÁLOGO: filas, no tarjetas --------------------------- */}
          <ol className="cc-list" aria-label="All leagues">
            {snapshots.map((snapshot) => (
              <li key={snapshot.scope} className="cc-league">
                <span className="cc-league-who">
                  <span className="nm">{snapshot.name || labelFor(snapshot)}</span>
                  <span className="meta">
                    <span>{providerLabel(snapshot.platform)}</span>
                    {snapshot.config?.teams ? <span>{snapshot.config.teams}-team</span> : null}
                    {snapshot.identity?.season ? <span>{snapshot.identity.season}</span> : null}
                    {snapshot.config?.scoring ? <span>{snapshot.config.scoring}</span> : null}
                  </span>
                </span>

                <span className="cc-league-state">
                  {snapshot.onClock === true ? (
                    <b className="cc-live">On the clock</b>
                  ) : snapshot.next ? (
                    <b>{snapshot.next.away} picks until you</b>
                  ) : snapshot.active ? (
                    <b>
                      Draft in progress
                      <small>
                        {snapshot.total
                          ? ` · ${snapshot.count}/${snapshot.total}`
                          : ` · ${snapshot.count} picks`}
                      </small>
                    </b>
                  ) : snapshot.complete === true ? (
                    <span>Draft complete</span>
                  ) : snapshot.count === 0 ? (
                    <span>No picks yet</span>
                  ) : (
                    <span>{snapshot.count} picks recorded</span>
                  )}

                  {/* Los huecos: estado de plantilla, en lenguaje de huecos. */}
                  {snapshot.rosterKnown ? (
                    <small>
                      {snapshot.openStarters === 0
                        ? "roster complete"
                        : `${snapshot.openStarters} starter ${snapshot.openStarters === 1 ? "slot" : "slots"} open`}
                    </small>
                  ) : snapshot.config ? (
                    <small>roster setup unknown</small>
                  ) : (
                    <small>configuration unknown</small>
                  )}

                  {/* Descansos de MI plantilla: dato de temporada, sin urgencia. */}
                  {snapshot.byeGroups ? (
                    <small className="cc-byes">
                      {Object.entries(snapshot.byeGroups)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([week, players]) =>
                          `Bye ${week} · ${players.length} ${players.length === 1 ? "player" : "players"}`)
                        .join("  ·  ")}
                    </small>
                  ) : null}
                </span>

                <span className="cc-league-act">
                  {!snapshot.config ? null : snapshot.complete === true && snapshot.count > 0 ? (
                    <button type="button" onClick={() => open(snapshot)}>Review draft</button>
                  ) : (
                    <button type="button" onClick={() => open(snapshot)}>Open draft</button>
                  )}
                </span>
              </li>
            ))}
          </ol>

          <p className="caption cc-note">
            Everything here is recorded state: your picks, your configuration, the published
            schedule. Nothing is recommended — an open slot is a fact, not advice. Opening a
            league makes it the active one in the Draft Assistant.
          </p>
        </>
      )}
    </div>
  );
}
