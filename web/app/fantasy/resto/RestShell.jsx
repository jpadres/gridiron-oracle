"use client";

/**
 * RESTO DE TEMPORADA: todos los jugadores, y de quién es cada uno.
 *
 *     UNA TABLA. TODO EL POOL. LA PROPIEDAD AL LADO DEL VALOR.
 *
 * ## Por qué esta pantalla existe si el panel ya existía
 *
 * El resto de temporada vivía dentro del explorador semanal, detrás de otras
 * seis tablas, recortado a sesenta filas y sin más filtro que «sólo libres».
 * Estaba bien y no se encontraba, que para el que lo busca es lo mismo que no
 * estar. Aquí es la pantalla entera: el pool completo, con posición, propiedad
 * y búsqueda, y con la marca de quién lo tiene delante de las cifras.
 *
 * ## Lo que ordena, y lo que NO
 *
 * Ordena por VALOR SOBRE EL REEMPLAZO repartido entre las jornadas que quedan,
 * nunca por puntos (regla 6b). Ordenar los mismos números por puntos puso 52
 * quarterbacks entre los sesenta primeros y el primer receptor en el puesto 13:
 * el quarterback suma más que cualquier receptor y eso no lo hace mejor
 * elección, porque su reemplazo también suma más. Las dos columnas se enseñan
 * juntas para que se pueda comprobar.
 *
 * ## Lo que la propiedad es y lo que no
 *
 * `MINE` / `FA` / el nombre del dueño salen de la instantánea de la liga
 * ENLAZADA, por `sleeper_id`. Sin cuenta no se pinta ninguna marca: inventarse
 * que alguien está libre es peor que no decirlo, porque «libre» es justo la
 * palabra sobre la que se actúa. Y la marca no toca el orden — el número de la
 * fila es el mismo con marca y sin ella.
 */

import { useCallback, useMemo, useState } from "react";

import { num } from "../../../data/model.js";
import { Headshot } from "../../headshot.jsx";
import { TeamMark } from "../../sports.jsx";
import LeagueBar from "../LeagueBar.jsx";
import { GAMES_IN_SEASON, LAST_WEEK, restOfSeason } from "../leagueAdvice.js";
import { OwnMark, RowMarks } from "../rowMarks.jsx";
import { ownershipLabel, ownershipOf } from "../sleeperAccount.js";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];
const OWNERSHIP = [
  { key: "ALL", label: "Everyone" },
  { key: "MINE", label: "Mine" },
  { key: "FREE_AGENT", label: "Free agents" },
  { key: "TAKEN", label: "Rostered elsewhere" },
];
/** Cuántas filas se pintan. Es un límite de RENDER, y se dice cuál es. */
const SHOWN = 120;

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function RestShell({
  board = [], byes = {}, week = null, season = null, notes = {}, news = {},
  availability = {},
}) {
  const [league, setLeague] = useState(null);
  const [position, setPosition] = useState("ALL");
  const [owner, setOwner] = useState("ALL");
  const [query, setQuery] = useState("");
  const onLeague = useCallback((next) => setLeague(next), []);

  const ownership = useMemo(() => (league ? ownershipOf(league) : null), [league]);
  const ownersByRoster = useMemo(() => {
    const out = {};
    for (const team of league?.teams ?? []) out[String(team.rosterId)] = team.owner ?? `roster ${team.rosterId}`;
    return out;
  }, [league]);
  const ownOf = useCallback(
    (row) => (league ? ownershipLabel({ ownership, sid: row?.sid, myRosterId: league.rosterId }) : null),
    [league, ownership]
  );

  // El reparto se calcula UNA vez sobre el board entero y los filtros trabajan
  // encima. Filtrar antes cambiaría el orden, que es lo que pasó con los tiers
  // cuando el corte dependía de la población.
  const all = useMemo(
    () => restOfSeason({ board, byes, week }).filter((r) => r.ros_vor != null),
    [board, byes, week]
  );

  const filtered = useMemo(() => {
    const q = norm(query).trim();
    return all.filter((row) => {
      if (position !== "ALL" && row.position !== position) return false;
      if (owner !== "ALL") {
        const own = ownOf(row);
        if (!own || own.status !== owner) return false;
      }
      if (q && !norm(row.player_full_name ?? row.player_name).includes(q)
          && !norm(row.team).includes(q)) return false;
      return true;
    });
  }, [all, position, owner, query, ownOf]);

  // El conteo se hace sobre el POOL filtrado, no sobre las filas pintadas: «2
  // left in tier» contado sobre lo renderizado ya costó una iteración, y
  // reapareció una segunda vez en un laboratorio. Aquí se cuenta el pool.
  const shown = filtered.slice(0, SHOWN);
  const mine = league ? filtered.filter((r) => ownOf(r)?.status === "MINE").length : null;
  const free = league ? filtered.filter((r) => ownOf(r)?.status === "FREE_AGENT").length : null;

  return (
    <>
      <LeagueBar season={season} week={week} id="ros-league" onLeague={onLeague} />

      <div className="ros-filters">
        <div className="pos-filter" role="group" aria-label="Position">
          {POSITIONS.map((p) => (
            <button key={p} type="button" className="pos-option" aria-pressed={position === p}
                    onClick={() => setPosition(p)}>
              {p === "ALL" ? "All" : p}
            </button>
          ))}
        </div>
        {/* Los filtros de propiedad sólo existen con liga: sin cuenta enlazada
            no hay nada que filtrar y un botón que no puede funcionar es peor
            que un botón que no está. */}
        {league ? (
          <div className="pos-filter" role="group" aria-label="Ownership">
            {OWNERSHIP.map((o) => (
              <button key={o.key} type="button" className="pos-option" aria-pressed={owner === o.key}
                      onClick={() => setOwner(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null}
        <label className="ros-search">
          <span className="sr-only">Search player or team</span>
          <input type="search" value={query} placeholder="Search player or team"
                 onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <p className="caption ros-count">
        {filtered.length === 0
          ? "No player matches these filters."
          : <>
              <strong>{filtered.length}</strong> player{filtered.length === 1 ? "" : "s"} in the
              pool{filtered.length > SHOWN ? `, showing the top ${SHOWN}` : ""}
              {league ? <> · <b className="own own--mine">MINE</b> {mine} ·{" "}
                <b className="own own--fa">FA</b> {free}</> : null}
              .
            </>}
        {league ? null : (
          <> Link your Sleeper account above to see who is on your roster and who is a free
          agent in your league.</>
        )}
      </p>

      <div className="table-wrap">
        <table className="rank-table wk-table">
          <thead>
            <tr>
              <th className="rk">#</th>
              <th className="who">Player</th>
              <th className="wk-proj">ROS value</th>
              <th>ROS pts</th>
              <th>Games left</th>
              <th>Bye</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => {
              const own = ownOf(row);
              return (
                <tr key={row.player_id} className={own?.status === "MINE" ? "is-mine" : undefined}>
                  <td className="rk">{index + 1}</td>
                  <td className="who hs-who">
                    <Headshot sid={row.sid} team={row.team} position={row.position}
                              name={row.player_full_name ?? row.player_name} size={28} />
                    <span className="nm">
                      {row.player_name}
                      <OwnMark own={own} owners={ownersByRoster} />
                      <RowMarks row={row} id={row.player_id} notes={notes} news={news}
                                availability={availability}
                                statusVerifiedAt={row.status_verified_at} />
                    </span>
                    <span className="meta">
                      <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                        {row.position}{row.ros_position_rank}
                      </span>
                      <TeamMark abbr={row.team} />
                    </span>
                  </td>
                  <td className="wk-proj"><strong>{num(row.ros_vor, 1)}</strong></td>
                  <td>{num(row.ros_points, 1)}</td>
                  <td>{row.ros_games_left}</td>
                  <td>{byes?.[row.team] ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="room-method">
        <summary>How this order is built — and what it does not know</summary>
        <p>
          The board&rsquo;s season projection, spread over the game weeks each player has
          left: <strong>× games left ÷ {GAMES_IN_SEASON}</strong>, counting from week{" "}
          {week ?? "—"} to {LAST_WEEK}. In week 1 the factor is 1 and the order is the
          board&rsquo;s, which is correct — nothing has been played. From there the bye does
          the work: two equal players are not worth the same if one still has his bye ahead.
          A player whose bye is unknown gets no number at all rather than an estimate, and
          drops out of this list.
        </p>
        <p>
          <strong>Ordered by value over replacement, not by points.</strong> Both columns are
          shown so you can check it. It does not know recent form, a role change since the
          board was built, or an injury — the status marks beside a name come from reporting
          and, by design, change no number on the row.
        </p>
      </details>
    </>
  );
}
