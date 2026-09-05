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
import { Headshot } from "../../headshot.jsx";
import { TeamMark } from "../../sports.jsx";
import LeagueBar from "../LeagueBar.jsx";
import { OwnMark, RowMarks } from "../rowMarks.jsx";
import {
  GAMES_IN_SEASON, LAST_WEEK, freeAgentUpgrades, freeSpecialists, restOfSeason,
} from "../leagueAdvice.js";
import { ownershipLabel, ownershipOf } from "../sleeperAccount.js";

const OFFENSE = ["QB", "RB", "WR", "TE"];
const CHIPS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];

export default function WeeklyExplorer({
  rankings, kickers, defenses, notes = {}, news = {}, availability = {},
  kickerRankStatus = null, kickerProjStatus = null, startSitStatus = {},
  board = [], byes = {}, week = null, season = null,
}) {
  // El conjunto vacío significa ALL. Multi-selección: cada chip conmuta, y
  // elegirlo todo explícitamente equivale a no filtrar.
  const [picked, setPicked] = useState(() => new Set());
  const [detail, setDetail] = useState(false);

  // LA LIGA ACTIVA del ranking. La cuenta enlazada se lee después de montar
  // (en el servidor no hay localStorage) y la liga elegida se recuerda por
  // navegador. Sin cuenta, el ranking es el de siempre y no marca nada.
  // La liga la elige la barra compartida: una clave para todo el producto.
  const [league, setLeague] = useState(null);
  const onLeague = useCallback((next) => setLeague(next), []);

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
  // Aquí sólo se calcula para el resumen y el enlace: la tabla entera, los
  // filtros y la propiedad viven en /fantasy/resto.
  const ros = useMemo(
    () => restOfSeason({ board, byes, week }).filter((r) => r.ros_vor != null),
    [board, byes, week]
  );

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
  /* K Y DST SON PESTAÑAS, NO APÉNDICES. Con «ALL» se apilaban debajo del
     ranking, así que la pantalla medía 10.899 px: ranking de ochenta filas,
     kickers, libres, resto de temporada y defensas, uno detrás de otro. Y no
     son la misma pregunta — el ranking decide una alineación, el pateador y la
     defensa son streaming, y su autoridad es distinta (el pateador lleva
     proyección sin puesto; la defensa, hechos sin proyección).

     El chip que los abre YA existe y está arriba del todo, así que no se
     esconde nada: se deja de enseñar todo a la vez. */
  const showK = picked.has("K");
  const showDst = picked.has("DST");
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
      <LeagueBar season={season} week={week} id="wk-league" onLeague={onLeague} />
      {/* La leyenda es de ESTA tabla, no de la barra: la barra la comparten
          tres pantallas y sólo aquí hay filas que marcar. */}
      {league ? (
        <p className="caption wk-legend">
          <b className="own own--mine">MINE</b> on your roster ·{" "}
          <b className="own own--fa">FA</b> free agent in this league · otherwise the owner.
        </p>
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
      {/* LA AUTORIDAD DE CADA POSICIÓN, leída del registro y no escrita aquí.
          RB, WR y TE tienen su start/sit VALIDADO (E11); el del QB está
          NOT_READY. La pantalla los presentaba EXACTAMENTE igual: filtras a QB y
          la tabla se lee con la misma autoridad que la de RB, que es el bypass
          del registro que este proyecto no puede permitirse.

          Es general y no un caso especial del QB: cualquier posición cuyo
          estado no sea VALIDATED se avisa, y si mañana un experimento sube el
          QB, el aviso desaparece solo. */}
      {(() => {
        const flojas = [...picked].filter(
          (pos) => startSitStatus[pos] && startSitStatus[pos] !== "VALIDATED"
        );
        if (flojas.length === 0) return null;
        return (
          <p className="callout wk-authority">
            <strong>{flojas.join(", ")}</strong>: the weekly start/sit call for{" "}
            {flojas.length > 1 ? "these positions is" : "this position is"} not validated
            ({flojas.map((p2) => `${p2} ${startSitStatus[p2]}`).join(", ")} in the capability
            registry). The projection is shown as information; the ordering does not carry
            the start/sit authority that RB, WR and TE do.
          </p>
        );
      })()}

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

      {/* Dónde están los que ya no se apilan. Sin esto, quitarlos de «ALL» sería
          esconderlos — y esconder algo que existe es lo que costó una iteración
          con el resto de temporada. */}
      {all ? (
        <p className="caption wk-tabs-hint">
          Kickers and defenses are not in this list: their authority is different — a
          kicker has a projection without a rank, a defense has facts without a
          projection. They have their own tabs above:{" "}
          <button type="button" className="wk-detail" onClick={() => toggle("K")}>Kickers</button>
          {" "}
          <button type="button" className="wk-detail" onClick={() => toggle("DST")}>Defense / DST</button>
        </p>
      ) : null}

      {/* --- PATEADORES: proyección validada, orden a propósito ausente ------ */}
      {showK && kickers?.length > 0 ? (
        <div className="wk-panel" id="k">
          <h3>Kickers <small>projection without a rank</small></h3>
          {/* Las dos frases van atadas al REGISTRO. Si algún día un experimento
              mueve `KICKER_ORDINAL_RANKING` fuera de REJECTED, esta pantalla
              deja de afirmar que el orden no vale — en vez de seguir diciéndolo
              porque la frase estaba escrita a mano. Y si el registro no declara
              el estado, no se afirma ninguna de las dos cosas. */}
          <p className="caption">
            {kickerProjStatus === "VALIDATED"
              ? "The projection is validated (it beats both baselines on error). "
              : "The projection's authority is not declared in the capability registry. "}
            {kickerRankStatus === "REJECTED"
              ? <>The ORDER is not: within the top 12, measured separation is 0.26 points per
                game with a confidence interval that crosses zero — so no K1&hellip;K12 column
                exists here, on purpose. A kicker ranking is mostly a ranking of offenses.</>
              : <>No K1&hellip;K12 column is shown: this screen only claims what the capability
                registry backs, and an ordinal kicker ranking is not currently backed.</>}
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
          {/* ACTUAR ES EN SLEEPER, y el enlace lo dice. Sleeper no publica una
              API de escritura: nadie puede fichar por ti desde fuera de su app,
              ni este sitio ni ningún otro. Lo que sí se puede es dejarte a un
              toque de la pantalla donde se hace. */}
          {league?.leagueId ? (
            <p className="caption">
              <a href={`https://sleeper.com/leagues/${league.leagueId}`}
                 target="_blank" rel="noreferrer">
                Open {league.name ?? "this league"} in Sleeper
              </a>{" "}
              to actually add or drop — Sleeper has no public write API, so no app
              outside theirs can make the move for you.
            </p>
          ) : null}
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
      {/* --- RESTO DE TEMPORADA: vive en su propia pantalla ------------------
           Estaba aquí, detrás de seis tablas y recortado a sesenta filas, y no
           se encontraba. Ahora es una página con el pool entero, filtros de
           posición y de propiedad y búsqueda. Se enlaza, no se duplica: dos
           superficies pintando la misma tabla es como divergen. */}
      {ros.length > 0 ? (
        <div className="wk-panel" id="ros">
          <h3>Rest of season <small>week {week} to {LAST_WEEK}</small></h3>
          <p className="caption">
            The board&rsquo;s season projection spread over the game weeks each player has
            left (<strong>× games left ÷ {GAMES_IN_SEASON}</strong>), ordered by value over
            replacement rather than by points. Top of the pool right now:{" "}
            {ros.slice(0, 3).map((row, i) => (
              <span key={row.player_id}>
                {i > 0 ? ", " : ""}<strong>{row.player_name}</strong>{" "}
                <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                  {row.position}{row.ros_position_rank}
                </span>
              </span>
            ))}.
          </p>
          <p className="caption">
            <a className="wk-detail" href="/fantasy/resto">
              Open Rest of Season &mdash; all {ros.length} players, with who owns them
            </a>
          </p>
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
