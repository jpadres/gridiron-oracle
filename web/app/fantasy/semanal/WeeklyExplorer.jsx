"use client";

/**
 * El explorador del ranking semanal: seis posiciones, una tabla, cero red.
 *
 * ## Por qué es un componente de cliente
 *
 * La versión anterior era una página de anclas: seis tablas apiladas y un
 * índice de saltos. Con K y DST son ocho, y la pregunta real del usuario es
 * combinatoria — «¿a quién arranco en el flex?» es RB+WR+TE, no tres tablas
 * lejos. Filtrar exige estado, y el estado exige cliente. Sigue sin hacer ni
 * una petición: todos los datos llegan horneados como props.
 *
 * ## La frontera de autoridad, en el código y no en la prosa
 *
 * QB/RB/WR/TE llevan rank porque su proyección Y su orden están validados
 * (E7, E11). El pateador lleva proyección SIN rank ordinal: E8 valida los
 * puntos, E8b rechaza el orden K1…K12. La defensa no lleva ni proyección:
 * DST_STREAMING es DESIGN_ONLY y lo único que se publica son hechos — el
 * total implícito del rival y las medias recientes observadas. Si algún día
 * esas autoridades cambian, cambia el registro primero y esta pantalla
 * después, nunca al revés.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { num } from "../../../data/model.js";
import { availabilityMark } from "../../availability.js";
import { Headshot } from "../../headshot.jsx";
import { TeamMark } from "../../sports.jsx";
import { browserStorage } from "../draftStorage.js";
import {
  GAMES_IN_SEASON, LAST_WEEK, freeAgentUpgrades, freeSpecialists, restOfSeason,
} from "../leagueAdvice.js";
import {
  loadAccount, loadActiveLeagueId, ownershipLabel, ownershipOf, saveActiveLeagueId,
} from "../sleeperAccount.js";

const OFFENSE = ["QB", "RB", "WR", "TE"];
const CHIPS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];

/**
 * Marcas de contexto de una fila: estado, nota del modelo, prensa, dossier.
 *
 * El ESTADO va primero y va SIEMPRE, igual que en el board: que alguien no
 * pueda jugar es lo primero que hay que ver de una fila, antes que la nota y
 * antes que la prensa. Esta pantalla no lo pintaba —sólo salía la ficha del
 * dossier, que es de agosto—, así que el ranking semanal enseñaba la
 * afirmación vieja y se callaba la de hoy. El fallo de las dos superficies con
 * distinta cobertura, esta vez sobre quién puede jugar.
 */
function RowMarks({ row, id, notes, news, availability, statusVerifiedAt }) {
  const health = availabilityMark(availability?.[id], statusVerifiedAt, row?.status_label);
  return (
    <>
      {row?.status_label ? (
        <span className={row.status_severity === "OUT" ? "mark mark--out" : "mark mark--risk"}
              title={`${row.status_detail} `
                + (row.status_freshness === "CURRENT"
                  ? `Verified ${row.status_verified_at}.`
                  : `LAST VERIFIED ${row.status_verified_at}.`)
                + " Changes no number on this row."}>
          {row.status_label}
        </span>
      ) : null}
      {notes?.[id] ? (
        <span className="mark mark--why" title="The model explains this ranking below">?</span>
      ) : null}
      {news?.[id] ? (
        <span className="mark mark--news" title="Recent reporting on this player">!</span>
      ) : null}
      {health ? (
        <span className={health.className} title={health.title}>{health.text}</span>
      ) : null}
    </>
  );
}

/**
 * La marca de propiedad de una fila EN LA LIGA ACTIVA: mío, agente libre o
 * de otro (con su dueño). Sale de la instantánea de la cuenta enlazada, por
 * `sleeper_id`; sin cuenta o sin id no se pinta nada, que es la verdad.
 */
function OwnMark({ own, owners }) {
  if (!own) return null;
  if (own.status === "MINE") return <span className="own own--mine" title="On your roster in this league">MINE</span>;
  if (own.status === "FREE_AGENT") return <span className="own own--fa" title="Not on any roster in this league">FA</span>;
  const who = owners?.[String(own.rosterId)] ?? `roster ${own.rosterId}`;
  return <span className="own own--taken" title={`On ${who}'s roster`}>{who}</span>;
}

export default function WeeklyExplorer({
  rankings, kickers, defenses, notes = {}, news = {}, availability = {},
  board = [], byes = {}, week = null,
}) {
  // El conjunto vacío significa ALL. Multi-selección: cada chip conmuta, y
  // elegirlo todo explícitamente equivale a no filtrar.
  const [picked, setPicked] = useState(() => new Set());
  const [detail, setDetail] = useState(false);

  // LA LIGA ACTIVA del ranking. La cuenta enlazada se lee después de montar
  // (en el servidor no hay localStorage) y la liga elegida se recuerda por
  // navegador. Sin cuenta, el ranking es el de siempre y no marca nada.
  const [account, setAccount] = useState(null);
  const [leagueId, setLeagueId] = useState("");
  useEffect(() => {
    const storage = browserStorage();
    const saved = loadAccount(storage);
    setAccount(saved);
    const wanted = loadActiveLeagueId(storage);
    const leagues = saved?.leagues ?? [];
    const first = leagues.find((l) => l.leagueId === wanted) ?? leagues[0];
    setLeagueId(first?.leagueId ?? "");
  }, []);
  const pickLeague = (id) => {
    setLeagueId(id);
    saveActiveLeagueId(browserStorage(), id);
  };
  const league = useMemo(
    () => (account?.leagues ?? []).find((l) => l.leagueId === leagueId) ?? null,
    [account, leagueId]
  );
  const ownership = useMemo(() => (league ? ownershipOf(league) : null), [league]);
  const ownersByRoster = useMemo(() => {
    const out = {};
    for (const team of league?.teams ?? []) out[String(team.rosterId)] = team.owner ?? `roster ${team.rosterId}`;
    return out;
  }, [league]);
  const ownOf = (sid) => (league ? ownershipLabel({ ownership, sid, myRosterId: league.rosterId }) : null);
  // La propiedad POR FILA: un jugador se posee por su `sleeper_id` y una
  // defensa por su código de equipo, que es su id en Sleeper.
  const ownRow = useCallback(
    (row) => ownOf(row?.sid ?? (row?.position === "DEF" || row?.opponent_implied != null ? row?.team : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, ownership]
  );

  /* LO QUE LA LIGA PERMITE DECIR. Nada de esto es un consejo de fichaje: son
     restas entre proyecciones ya publicadas, y la interfaz lo dice con esas
     palabras. La versión que multiplicaba valor por «necesidad» se retiró en
     agosto por inventarse el segundo factor. */
  const gaps = useMemo(
    () => (league ? freeAgentUpgrades({ rows: rankings, own: ownRow }) : []),
    [league, rankings, ownRow]
  );
  const freeSpecs = useMemo(
    () => (league ? freeSpecialists({ kickers, defenses, own: ownRow }) : { kickers: [], defenses: [] }),
    [league, kickers, defenses, ownRow]
  );
  const [rosOnlyFree, setRosOnlyFree] = useState(false);
  const ros = useMemo(() => {
    const rows_ = restOfSeason({ board, byes, week }).filter((r) => r.ros_vor != null);
    if (!league || !rosOnlyFree) return rows_.slice(0, 100);
    return rows_.filter((r) => ownRow(r)?.status === "FREE_AGENT").slice(0, 100);
  }, [board, byes, week, league, rosOnlyFree, ownRow]);

  const toggle = (chip) => {
    setPicked((prev) => {
      if (chip === "ALL") return new Set();
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      if (next.size === CHIPS.length - 1) return new Set();
      return next;
    });
  };

  const all = picked.size === 0;
  const offenseSelected = all ? OFFENSE : OFFENSE.filter((p) => picked.has(p));
  const showK = all || picked.has("K");
  const showDst = all || picked.has("DST");
  const singleOffense = !all && offenseSelected.length === 1 && picked.size === 1;

  const rows = useMemo(() => {
    const wanted = new Set(offenseSelected);
    return rankings
      .filter((row) => wanted.has(row.position))
      .map((row) => ({ ...row, delta: row.projected_points - row.baseline_points }))
      .sort((a, b) => b.projected_points - a.projected_points)
      .map((row, index) => ({ ...row, shown_rank: index + 1 }));
  }, [rankings, offenseSelected]);

  const label = all
    ? "All positions"
    : [...offenseSelected, ...(picked.has("K") ? ["K"] : []), ...(picked.has("DST") ? ["DST"] : [])]
        .join(" + ");

  return (
    <section className="wk">
      {account?.leagues?.length ? (
        <div className="wk-league">
          <label htmlFor="wk-league">
            League
            <select id="wk-league" value={leagueId} onChange={(e) => pickLeague(e.target.value)}>
              {account.leagues.map((l) => (
                <option key={l.leagueId} value={l.leagueId}>{l.name ?? l.leagueId}</option>
              ))}
            </select>
          </label>
          <span className="caption">
            <b className="own own--mine">MINE</b> on your roster · <b className="own own--fa">FA</b>{" "}
            free agent in this league · otherwise the owner. From Sleeper as last read on Leagues.
          </span>
        </div>
      ) : null}
      <div className="wk-bar">
        <div className="pos-filter" role="group" aria-label="Filter by position">
          {CHIPS.map((chip) => (
            <button key={chip} type="button" className="pos-option"
                    aria-pressed={chip === "ALL" ? all : picked.has(chip)}
                    onClick={() => toggle(chip)}>
              {chip}
            </button>
          ))}
        </div>
        {rows.length > 0 ? (
          <button type="button" className="wk-detail" aria-pressed={detail}
                  onClick={() => setDetail((v) => !v)}>
            {detail ? "Less detail" : "More detail"}
          </button>
        ) : null}
      </div>
      {/* La línea de contexto habla de la vista que HAY: la de rank ordinal
          sólo aplica a la tabla ofensiva, y pintarla sobre el panel de K —
          donde el rank no existe a propósito — la contradiría. */}
      {offenseSelected.length > 0 ? (
        <p className="caption wk-context">
          <strong>{label}</strong> · ordered by projected points (PPR). A projection is
          points, not advice: for a fixed lineup slot, each position&rsquo;s own rank is
          what counts.
        </p>
      ) : (
        <p className="caption wk-context">
          <strong>{label}</strong> · the two positions with different authority: each
          panel states exactly what is and is not claimed.
        </p>
      )}

      {offenseSelected.length > 0 && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="rank-table wk-table">
            <thead>
              <tr>
                <th className="rk">#</th>
                <th className="who">Player</th>
                <th className="wk-proj">Proj pts</th>
                <th>Last 6</th>
                <th>Diff</th>
                {singleOffense ? <th>Matchup</th> : null}
                {detail ? <th>Model</th> : null}
                {detail ? <th>Blend</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map((row) => (
                <tr key={row.player_id}>
                  <td className="rk">{row.shown_rank}</td>
                  <td className="who hs-who">
                    <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_name} size={32} />
                    <span className="nm">
                      {row.player_name}
                      <OwnMark own={ownOf(row.sid)} owners={ownersByRoster} />
                      <RowMarks row={row} id={row.player_id} notes={notes} news={news}
                                availability={availability}
                                statusVerifiedAt={row.status_verified_at} />
                    </span>
                    <span className="meta">
                      <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                        {row.position}{row.position_rank}
                      </span>
                      <TeamMark abbr={row.team} />
                      <span>{row.is_home === 0 ? "@" : "vs"} {row.opponent}</span>
                    </span>
                  </td>
                  <td className="wk-proj"><strong>{num(row.projected_points, 1)}</strong></td>
                  <td>{num(row.baseline_points, 1)}</td>
                  <td className={row.delta >= 0 ? "wk-up" : "wk-down"}>
                    {row.delta > 0 ? "+" : ""}{num(row.delta, 1)}
                  </td>
                  {singleOffense ? <td>{num(row.matchup_multiplier, 2)}</td> : null}
                  {detail ? <td>{num(row.model_points, 1)}</td> : null}
                  {detail ? <td>{num(row.blend_weight, 2)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* --- PATEADORES: proyección validada, orden a propósito ausente ------ */}
      {showK && kickers?.length > 0 ? (
        <div className="wk-panel" id="k">
          <h3>Kickers <small>projection without a rank</small></h3>
          <p className="caption">
            The projection is validated (it beats both baselines on error). The ORDER is
            not: within the top 12, measured separation is 0.26 points per game with a
            confidence interval that crosses zero — so no K1&hellip;K12 column exists here,
            on purpose. A kicker ranking is mostly a ranking of offenses.
          </p>
          <div className="table-wrap">
            <table className="rank-table wk-table">
              <thead>
                <tr>
                  <th className="who">Kicker</th>
                  <th className="wk-proj">Proj pts</th>
                  <th>Team implied</th>
                  <th>Game</th>
                </tr>
              </thead>
              <tbody>
                {kickers.map((k) => (
                  <tr key={k.player_id}>
                    <td className="who hs-who">
                      <Headshot sid={k.sid} team={k.team} position="K" name={k.player_full_name ?? k.player_name} size={28} />
                      <span className="nm">
                        {k.player_full_name ?? k.player_name}
                        <OwnMark own={ownOf(k.sid)} owners={ownersByRoster} />
                        <RowMarks row={k} id={k.player_id} notes={notes} news={news}
                                  availability={availability}
                                  statusVerifiedAt={k.status_verified_at} />
                      </span>
                      <span className="meta">
                        <span className="ptag ptag--k">K</span>
                        <TeamMark abbr={k.team} />
                      </span>
                    </td>
                    <td className="wk-proj"><strong>{num(k.projected_points, 1)}</strong></td>
                    <td>{num(k.team_points, 1)}</td>
                    <td>{k.is_home === 0 ? "@" : "vs"} {k.opponent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* --- LO QUE HAY LIBRE EN TU LIGA --------------------------------------
           Tres listas y ninguna recomendación. La diferencia entre «este libre
           proyecta 3,5 puntos más que tu más flojo» y «fíchalo» es todo lo que
           este proyecto no puede afirmar: el banquillo, los descansos que
           vienen y lo que cuesta soltar a alguien no están en ningún número de
           aquí. Se enseña la resta y se dice qué no sabe. */}
      {league ? (
        <div className="wk-panel wk-free" id="free">
          <h3>Free in {league.name ?? "this league"} <small>projection gaps, not advice</small></h3>
          <p className="caption">
            Read as arithmetic on the numbers already published above: what a free agent
            projects this week minus what your weakest starter at that position projects.
            It does not know your bench, the byes ahead, or what dropping someone costs —
            <strong> the decision is yours and this page does not make it</strong>.
          </p>
          {gaps.length > 0 ? (
            <ul className="wk-gaps">
              {gaps.map((gap) => (
                <li key={gap.position}>
                  <span className={`ptag ptag--${gap.position.toLowerCase()}`}>{gap.position}</span>{" "}
                  <b className="own own--fa">FA</b> <strong>{gap.free.player_name}</strong>{" "}
                  <span className="attrib">{gap.free.team}</span>{" "}
                  <span className="wk-gap-num">{num(gap.free.projected_points, 1)}</span>
                  {" vs your "}
                  <strong>{gap.weakest.player_name}</strong>{" "}
                  <span className="wk-gap-num">{num(gap.weakest.projected_points, 1)}</span>
                  {" · "}
                  <span className="wk-gap-delta">+{num(gap.delta, 1)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="caption">
              No free agent projects more than your weakest starter at any position this
              week. That is the normal case and it is worth saying out loud.
            </p>
          )}
          <div className="wk-free-cols">
            <div>
              <h4>Kickers nobody has</h4>
              {freeSpecs.kickers.length > 0 ? (
                <ul className="wk-free-list">
                  {freeSpecs.kickers.map((k) => (
                    <li key={k.player_id}>
                      <strong>{k.player_full_name ?? k.player_name}</strong>{" "}
                      <span className="attrib">{k.team} {k.is_home === 0 ? "@" : "vs"} {k.opponent}</span>{" "}
                      <span className="wk-gap-num">{num(k.projected_points, 1)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="caption">Every kicker in the pool is rostered in this league.</p>}
            </div>
            <div>
              <h4>Defenses nobody has</h4>
              <p className="caption">
                Sorted by the opponent&rsquo;s implied total, lowest first — the same order as
                the table below, and for the same reason: there is no validated DST
                projection, so there is no number to rank them by.
              </p>
              {freeSpecs.defenses.length > 0 ? (
                <ul className="wk-free-list">
                  {freeSpecs.defenses.map((d) => (
                    <li key={d.team}>
                      <TeamMark abbr={d.team} solid /> <strong>{d.team}</strong>{" "}
                      <span className="attrib">{d.is_home === 0 ? "@" : "vs"} {d.opponent}</span>{" "}
                      <span className="wk-gap-num">{num(d.opponent_implied, 1)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="caption">Every defense is rostered in this league.</p>}
            </div>
          </div>
        </div>
      ) : null}

      {/* --- RESTO DE TEMPORADA ------------------------------------------------
           La proyección de temporada del board repartida entre las jornadas que
           quedan, descontando el descanso si aún no ha pasado. Es un reparto
           declarado, no un modelo nuevo. */}
      {ros.length > 0 ? (
        <div className="wk-panel" id="ros">
          <h3>Rest of season <small>week {week} to {LAST_WEEK}</small></h3>
          <p className="caption">
            What the board projects for the season, spread over the game weeks each player
            has left: <strong>× games left ÷ {GAMES_IN_SEASON}</strong>. In week 1 that
            factor is 1 and the order is the board&rsquo;s, which is correct — nothing has been
            played. From there the bye does the work: two equal players are not worth the
            same if one still has his bye ahead.
          </p>
          <p className="caption">
            <strong>Ordered by value over replacement, not by points.</strong> Sorting the
            same numbers by points put 52 quarterbacks in the top 60 and the first receiver
            at 13 — a quarterback outscores every receiver and that does not make him the
            better pick, because his replacement outscores them too. It does not know recent
            form, a role change since the board was built, or an injury.
          </p>
          {league ? (
            <button type="button" className="wk-detail" aria-pressed={rosOnlyFree}
                    onClick={() => setRosOnlyFree((v) => !v)}>
              {rosOnlyFree ? "Show everyone" : `Only free agents in ${league.name ?? "this league"}`}
            </button>
          ) : null}
          <div className="table-wrap">
            <table className="rank-table wk-table">
              <thead>
                <tr>
                  <th className="rk">#</th><th className="who">Player</th><th className="wk-proj">ROS value</th><th>ROS pts</th><th>Games left</th>
                </tr>
              </thead>
              <tbody>
                {ros.slice(0, 60).map((row, index) => {
                  const own = ownRow(row);
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* --- DEFENSAS: hechos, sin proyección --------------------------------- */}
      {showDst && defenses?.length > 0 ? (
        <div className="wk-panel" id="dst">
          <h3>Defense / DST <small>streaming context, not a ranking</small></h3>
          <p className="caption">
            There is no validated DST model, so there is no projection column. What is
            known: the opponent&rsquo;s implied total predicts points allowed at r&nbsp;0.388
            &mdash; far better than the defense&rsquo;s own last game (r&nbsp;0.060) &mdash;
            so the table sorts by it, lowest first. Forced turnovers are <em>not</em> a
            stable skill (r&nbsp;0.044 year over year): the recent averages are
            observations, not expectations.
          </p>
          <div className="table-wrap">
            <table className="rank-table wk-table">
              <thead>
                <tr>
                  <th className="who">Defense</th>
                  <th>Opp implied</th>
                  <th>Game</th>
                  <th>PA last 6</th>
                  <th>Sacks</th>
                  <th>Takeaways</th>
                </tr>
              </thead>
              <tbody>
                {defenses.map((d) => (
                  <tr key={d.team}>
                    <td className="who">
                      <span className="nm">
                        <TeamMark abbr={d.team} solid /> {d.team}
                        <OwnMark own={ownOf(d.team)} owners={ownersByRoster} />
                      </span>
                    </td>
                    <td className="wk-proj"><strong>{num(d.opponent_implied, 1)}</strong></td>
                    <td>{d.is_home === 0 ? "@" : "vs"} {d.opponent}</td>
                    <td>{num(d.points_allowed_recent, 1)}</td>
                    <td>{num(d.sacks_recent, 1)}</td>
                    <td>{num(d.takeaways_recent, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
