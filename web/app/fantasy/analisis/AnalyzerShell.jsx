"use client";

/**
 * El analizador de la liga: quién es fuerte, dónde, y contra quién juego.
 *
 * Componente de cliente porque la liga enlazada vive en `localStorage` y en el
 * servidor no existe. Los datos —board, ranking semanal, mapa de identidad—
 * llegan horneados desde la página: aquí no hay red.
 *
 * Lo que se enseña son cuentas sobre números ya publicados. Lo que NO se
 * enseña, y es deliberado: «ofrécele a X por Y», «este equipo va a ganar la
 * liga», «necesitas un corredor». Nada de eso está validado, y la línea entre
 * una cuenta y un consejo es la que este proyecto lleva meses sin cruzar.
 */

import { useCallback, useMemo, useState } from "react";

import { num } from "../../../data/model.js";
import { Headshot } from "../../headshot.jsx";
import { TeamMark } from "../../sports.jsx";
import LeagueBar from "../LeagueBar.jsx";
import { restOfSeason } from "../leagueAdvice.js";
import { VALUED, headToHead, powerRankings, tradeOpenings } from "../leagueAnalyzer.js";

/** `{wins, losses, ties}` -> «3-1» o «3-1-1». Sin récord, cadena vacía. */
function recordLabel(record) {
  if (!record || !Number.isFinite(Number(record.wins))) return "";
  const { wins, losses, ties } = record;
  return Number(ties) ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/**
 * El signo con su color. Cero es cero: ni verde ni rojo, y sin signo.
 *
 * Se decide sobre el número YA REDONDEADO. Con el signo puesto antes de
 * redondear salía «-0» en la tabla, que es un menos que no significa nada.
 */
function Gap({ value, digits = 0 }) {
  if (!Number.isFinite(value)) return <span className="attrib">—</span>;
  // El `+ 0` no sobra: `Number((-0.4).toFixed(0))` es CERO NEGATIVO, y
  // `toLocaleString` lo escribe «-0» — un menos que no significa nada. Sumar
  // cero lo normaliza (IEEE 754: −0 + +0 = +0).
  const rounded = Number(value.toFixed(digits)) + 0;
  const cls = rounded > 0 ? "gap gap--up" : rounded < 0 ? "gap gap--down" : "gap";
  return (
    <span className={cls}>{rounded > 0 ? "+" : ""}{num(rounded, digits)}</span>
  );
}

export default function AnalyzerShell({ board, byes, week, season, sleeperIds }) {
  // La liga la elige la barra compartida: una sola clave para todo el producto.
  const [league, setLeague] = useState(null);
  const [rivalId, setRivalId] = useState("");
  const onLeague = useCallback((next) => {
    setLeague(next);
    setRivalId("");                 // el rival elegido era de la liga anterior
  }, []);

  /* El índice de VALOR por `sleeper_id`: el board repartido por lo que queda de
     temporada. Es el mismo cálculo que publica /fantasy/semanal, del mismo
     módulo — no una segunda versión que pueda divergir. */
  const index = useMemo(() => {
    const bySid = new Map();
    if (!sleeperIds) return bySid;
    const gsisToSid = new Map();
    for (const [sid, gsis] of Object.entries(sleeperIds)) gsisToSid.set(String(gsis), String(sid));
    for (const row of restOfSeason({ board, byes, week })) {
      if (row.ros_vor == null) continue;
      const sid = gsisToSid.get(String(row.player_id));
      if (!sid) continue;
      bySid.set(sid, { ...row, sid, value: row.ros_vor });
    }
    return bySid;
  }, [board, byes, week, sleeperIds]);

  const ranks = useMemo(() => {
    if (!league) return [];
    // Los huecos salen de `config`, que es donde `leagueSnapshotFrom` deja la
    // configuración REAL de Sleeper. Sin ellos no hay alineación que valorar y
    // la tabla saldría con doce ceros — que es como lo cazó el laboratorio.
    return powerRankings({
      snapshot: league, index, rosterPositions: league.config?.roster ?? null,
    });
  }, [league, index]);

  const mine = ranks.find((r) => r.mine) ?? null;
  const defaultRival = league?.matchup?.opponentRosterId != null
    ? String(league.matchup.opponentRosterId) : "";
  const rival = useMemo(() => {
    const wanted = rivalId || defaultRival;
    return ranks.find((r) => String(r.rosterId) === String(wanted)) ?? null;
  }, [ranks, rivalId, defaultRival]);
  const h2h = useMemo(() => headToHead(mine, rival), [mine, rival]);
  const openings = useMemo(() => tradeOpenings(ranks), [ranks]);
  const mineOpenings = openings.filter((o) => o.aMine || o.bMine);

  return (
    <section className="an">
      <LeagueBar season={season} week={week} id="an-league" onLeague={onLeague} />

      {ranks.length === 0 ? (
        <p className="caption">
          No rosters for this league yet. Refresh it on <a href="/fantasy/leagues">Leagues</a>.
        </p>
      ) : null}

      {/* --- POWER RANKINGS ---------------------------------------------- */}
      {ranks.length > 0 ? (
        <div className="wk-panel" id="power">
          <h3>Power rankings <small>roster value, not a standings forecast</small></h3>
          <p className="caption">
            Each team&rsquo;s <strong>best legal lineup</strong>, valued with the board&rsquo;s
            value over replacement spread across the game weeks left. Slots are filled by the
            same assigner the draft board uses. It is <strong>not</strong> a prediction of who
            wins: it knows nothing about the schedule, who sets a good lineup, or the waiver
            wire. Kickers and defenses are excluded — the board has no validated value for
            them — and players outside the identity map are counted, not zeroed.
          </p>
          <div className="table-wrap">
            <table className="rank-table an-table">
              <thead>
                <tr>
                  <th className="rk">#</th>
                  <th className="who">Team</th>
                  <th className="wk-proj">Lineup value</th>
                  {VALUED.map((p) => <th key={p}>{p} vs median</th>)}
                  <th>Not mapped</th>
                </tr>
              </thead>
              <tbody>
                {ranks.map((team) => (
                  <tr key={team.rosterId} className={team.mine ? "is-mine" : undefined}>
                    <td className="rk">{team.rank}</td>
                    <td className="who">
                      <span className="nm">
                        {team.owner}
                        {team.mine ? <span className="own own--mine">MINE</span> : null}
                      </span>
                      <span className="meta">
                        {recordLabel(team.record) ? `${recordLabel(team.record)} · ` : ""}
                        {team.size} players
                        {team.strongest ? ` · strongest ${team.strongest}` : ""}
                        {team.weakest ? ` · thinnest ${team.weakest}` : ""}
                      </span>
                    </td>
                    <td className="wk-proj"><strong>{num(team.lineup, 0)}</strong></td>
                    {VALUED.map((p) => (
                      <td key={p}><Gap value={team.gaps[p]} /></td>
                    ))}
                    <td>{team.unknown > 0 ? team.unknown : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* --- CARA A CARA -------------------------------------------------- */}
      {mine && ranks.length > 1 ? (
        <div className="wk-panel" id="h2h">
          <h3>
            Head to head <small>position by position</small>
          </h3>
          <label htmlFor="an-rival" className="an-pick">
            Against
            <select id="an-rival" value={rivalId || defaultRival}
                    onChange={(e) => setRivalId(e.target.value)}>
              {ranks.filter((r) => !r.mine).map((r) => (
                <option key={r.rosterId} value={String(r.rosterId)}>
                  {r.owner}{String(r.rosterId) === defaultRival ? " — this week" : ""}
                </option>
              ))}
            </select>
          </label>
          {h2h ? (
            <>
              <p className="an-total">
                <strong>{num(h2h.mineTotal, 0)}</strong> you
                {" · "}
                <strong>{num(h2h.theirsTotal, 0)}</strong> {h2h.theirsOwner}
                {" · "}
                <Gap value={h2h.delta} />
              </p>
              <div className="table-wrap">
                <table className="rank-table an-table">
                  <thead>
                    <tr>
                      <th className="who">Slot</th>
                      <th className="wk-proj">You</th>
                      <th>{h2h.theirsOwner}</th>
                      <th>Diff</th>
                      <th>Your depth</th>
                      <th>Theirs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2h.rows.map((row) => (
                      <tr key={row.position}>
                        <td className="who">
                          <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                            {row.position}
                          </span>
                        </td>
                        <td className="wk-proj"><strong>{num(row.mine, 0)}</strong></td>
                        <td>{num(row.theirs, 0)}</td>
                        <td><Gap value={row.delta} /></td>
                        <td>{row.mineDepth}</td>
                        <td>{row.theirsDepth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="caption">
                These rows cover the <strong>dedicated</strong> slots only, so they do not add
                up to the lineup difference above: the flex belongs to no single position. A
                third running back in your flex counts toward your total and not toward RB —
                otherwise a team with four backs would look strong everywhere.
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {/* --- HUECOS OPUESTOS ---------------------------------------------- */}
      {openings.length > 0 ? (
        <div className="wk-panel" id="trades">
          <h3>Opposite gaps <small>where a trade could start</small></h3>
          <p className="caption">
            Pairs of teams where one is above the league median at a position and below it at
            another, and the other team is the mirror image. That is a fact about two rosters.{" "}
            <strong>It is not a trade recommendation</strong>: nobody here has measured what a
            player is worth in a trade, whether the other manager would accept, or what it
            does to your bye weeks. The names and the numbers are so you can start the
            conversation, not so the page has it for you.
          </p>
          {mineOpenings.length > 0 ? (
            <>
              <h4>Involving your team</h4>
              <ul className="an-trades">
                {mineOpenings.slice(0, 8).map((o, i) => (
                  <li key={`mine-${i}`}>
                    <strong>{o.a}</strong> is deep at{" "}
                    <span className={`ptag ptag--${o.give.toLowerCase()}`}>{o.give}</span>{" "}
                    <Gap value={o.aSurplus} /> and thin at{" "}
                    <span className={`ptag ptag--${o.get.toLowerCase()}`}>{o.get}</span>{" "}
                    <Gap value={o.aNeed} />
                    {" — "}
                    <strong>{o.b}</strong> is the mirror ({o.get} <Gap value={o.bSurplus} />,{" "}
                    {o.give} <Gap value={o.bNeed} />)
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="caption">
              None of the open gaps involve your roster right now.
            </p>
          )}
          {openings.length > mineOpenings.length ? (
            <details className="an-more">
              <summary>The rest of the league ({openings.length - mineOpenings.length})</summary>
              <ul className="an-trades">
                {openings.filter((o) => !o.aMine && !o.bMine).slice(0, 12).map((o, i) => (
                  <li key={`rest-${i}`}>
                    <strong>{o.a}</strong> {o.give} <Gap value={o.aSurplus} /> / {o.get}{" "}
                    <Gap value={o.aNeed} /> — <strong>{o.b}</strong> {o.get}{" "}
                    <Gap value={o.bSurplus} /> / {o.give} <Gap value={o.bNeed} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* --- MI ALINEACIÓN, PARA VER DE DÓNDE SALE EL NÚMERO --------------- */}
      {mine ? (
        <div className="wk-panel" id="lineup">
          <h3>Your lineup <small>where your number comes from</small></h3>
          <div className="table-wrap">
            <table className="rank-table an-table">
              <thead>
                <tr>
                  <th className="who">Slot</th>
                  <th>Player</th>
                  <th className="wk-proj">ROS value</th>
                </tr>
              </thead>
              <tbody>
                {mine.slots.map((slot) => (
                  <tr key={slot.index}>
                    <td className="who">
                      <span className="nm">{slot.slot}</span>
                    </td>
                    <td className="hs-who">
                      {slot.player ? (
                        <>
                          <Headshot sid={slot.player.sid} team={slot.player.team}
                                    position={slot.player.position}
                                    name={slot.player.player_full_name ?? slot.player.player_name}
                                    size={26} />
                          <span className="nm">
                            {slot.player.player_name}
                            {slot.player.status_label ? (
                              <span className={slot.player.status_severity === "OUT"
                                ? "mark mark--out" : "mark mark--risk"}
                                    title={`${slot.player.status_detail} Verified ${slot.player.status_verified_at}.`}>
                                {slot.player.status_label}
                              </span>
                            ) : null}
                          </span>
                          <span className="meta">
                            <TeamMark abbr={slot.player.team} /> {slot.player.position}
                          </span>
                        </>
                      ) : (
                        <span className="attrib">
                          empty — no valued player fits this slot
                        </span>
                      )}
                    </td>
                    <td className="wk-proj">
                      {slot.player ? <strong>{num(slot.player.value, 0)}</strong>
                        : <span className="attrib">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            K and DEF slots show empty here even when you have one: they carry no value in the
            board, so they add nothing to the number above and pretending otherwise would put
            a made-up figure in a total.
            {mine.unknown > 0 ? ` ${mine.unknown} of your players are not in the identity map and are not counted either way.` : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
