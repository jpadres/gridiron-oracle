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
import { numberOrNull } from "../../numbers.js";
import { restOfSeason } from "../leagueAdvice.js";
import { weeklyIndex } from "../leagueWeek.js";
import { lineupFrom, sideBySide, startSit } from "../lineup.js";
import { VALUED, headToHead, powerRankings, tradeOpenings } from "../leagueAnalyzer.js";

/** `{wins, losses, ties}` -> «3-1» o «3-1-1». Sin récord, cadena vacía. */
function recordLabel(record) {
  // `Number(null)` es cero y es finito: preguntando así, «no hay récord» se
  // pintaba «0-0». `numberOrNull` es la única forma de preguntarlo en la web.
  if (!record || numberOrNull(record.wins) === null) return "";
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

export default function AnalyzerShell({
  board, byes, week, season, sleeperIds, weekly = [], weeklyKickers = [],
}) {
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

  /* LA SEMANA: proyecciones de ESTA jornada, no el valor de resto de temporada.
     Son dos preguntas distintas y mezclarlas es el error clásico — a quién
     alineo el domingo no se contesta con lo que vale hasta enero. */
  const semanal = useMemo(() => weeklyIndex(weekly, weeklyKickers), [weekly, weeklyKickers]);
  /* El índice con el que se REPARTEN los huecos: la proyección semanal manda,
     y por debajo el board — que es quien conoce a las defensas, sin proyección
     porque no hay modelo de DST validado. Sin esta mezcla, tu defensa titular
     salía como un hueco vacío y con su id crudo en el start/sit: existe, ocupa
     su sitio y no suma, que son tres cosas distintas de «no está». */
  const paraAlinear = useMemo(() => {
    const m = new Map(index);
    for (const [k, v] of semanal) m.set(k, v);
    return m;
  }, [index, semanal]);
  const huecos = league?.config?.roster ?? null;
  const misTitulares = league?.starters ?? null;
  const rivalRosterId = rivalId || defaultRival;
  const equipoRival = useMemo(
    () => (league?.teams ?? []).find((t) => String(t.rosterId) === String(rivalRosterId)) ?? null,
    [league, rivalRosterId]
  );
  // El rival de la JORNADA trae sus titulares publicados; contra cualquier otro
  // equipo se compara con la alineación que más proyecta de su plantilla, y se
  // dice cuál de las dos se está enseñando.
  const rivalEsDeLaSemana = String(rivalRosterId) === String(defaultRival) && defaultRival !== "";
  const alineaciones = useMemo(() => {
    if (!league || !huecos) return null;
    const mia = lineupFrom({ ids: misTitulares, index: paraAlinear, rosterPositions: huecos });
    const miMejor = lineupFrom({ ids: league.players, index: paraAlinear, rosterPositions: huecos });
    const idsRival = rivalEsDeLaSemana && league.matchup?.opponentStarters?.length
      ? league.matchup.opponentStarters
      : equipoRival?.players;
    const suya = lineupFrom({ ids: idsRival, index: paraAlinear, rosterPositions: huecos });
    return { mia, miMejor, suya, rivalPuesta: rivalEsDeLaSemana };
  }, [league, huecos, misTitulares, paraAlinear, equipoRival, rivalEsDeLaSemana]);

  const [usarMejor, setUsarMejor] = useState(false);
  const miAlineacion = usarMejor ? alineaciones?.miMejor : alineaciones?.mia;
  const cara = useMemo(
    () => (alineaciones ? sideBySide(miAlineacion, alineaciones.suya) : null),
    [alineaciones, miAlineacion]
  );
  const cambios = useMemo(
    () => (alineaciones ? startSit({ currentIds: misTitulares, best: alineaciones.miMejor }) : null),
    [alineaciones, misTitulares]
  );
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

      {/* --- LA JORNADA: LOS DOS EQUIPOS, LADO A LADO ---------------------- */}
      {cara && cara.rows.length > 0 ? (
        <div className="wk-panel" id="lineups">
          <h3>
            This week, side by side{" "}
            <small>week {week} projections · slot by slot</small>
          </h3>
          <div className="mu-head">
            <div className="mu-side mu-side--mine">
              <span className="mu-name">You</span>
              <strong className="mu-pts">{num(cara.minePoints, 1)}</strong>
              {alineaciones?.mia && alineaciones?.miMejor ? (
                <button type="button" className="lg-refresh"
                        onClick={() => setUsarMejor((v) => !v)}>
                  {usarMejor ? "Show my current lineup" : "Generate best lineup"}
                </button>
              ) : null}
            </div>
            <div className="mu-vs"><Gap value={cara.delta} digits={1} /></div>
            <div className="mu-side mu-side--theirs">
              <span className="mu-name">{rival?.owner ?? "Opponent"}</span>
              <strong className="mu-pts">{num(cara.theirsPoints, 1)}</strong>
              <span className="caption">
                {alineaciones?.rivalPuesta ? "their posted lineup" : "their highest-projected lineup"}
              </span>
            </div>
          </div>
          {usarMejor ? (
            <p className="caption mu-note">
              This is the <strong>highest-projected</strong> legal lineup from your roster —
              not &ldquo;the best&rdquo;. The weekly projection beats a six-game average by a
              little, so a gap of a point or two between two options is inside the noise, and
              it knows nothing about a late scratch or about needing variance because you are
              chasing. <strong>Nothing is submitted anywhere</strong>: Sleeper has no write
              API, so you set it there.
            </p>
          ) : null}
          <ol className="mu-rows">
            {cara.rows.map((row, i) => (
              <li key={`${row.slot}-${i}`}>
                <span className="mu-cell mu-cell--mine">
                  {row.mine ? (
                    <>
                      <Headshot sid={row.mine.sid} team={row.mine.team} position={row.mine.position}
                                name={row.mine.player_full_name ?? row.mine.player_name} size={26} />
                      <span className="nm">{row.mine.player_name}</span>
                      <b>{row.minePoints == null ? "—" : num(row.minePoints, 1)}</b>
                    </>
                  ) : <span className="attrib">empty</span>}
                </span>
                <span className={`mu-slot ptag ptag--${String(row.slot).toLowerCase().replace("super_flex", "sflx")}`}>
                  {row.slot === "SUPER_FLEX" ? "SFLX" : row.slot}
                </span>
                <span className="mu-cell mu-cell--theirs">
                  {row.theirs ? (
                    <>
                      <b>{row.theirsPoints == null ? "—" : num(row.theirsPoints, 1)}</b>
                      <span className="nm">{row.theirs.player_name}</span>
                      <Headshot sid={row.theirs.sid} team={row.theirs.team} position={row.theirs.position}
                                name={row.theirs.player_full_name ?? row.theirs.player_name} size={26} />
                    </>
                  ) : <span className="attrib">empty</span>}
                </span>
              </li>
            ))}
          </ol>
          {miAlineacion?.unknown > 0 ? (
            <p className="caption">
              {miAlineacion.unknown} of your starters have no weekly projection — a defense
              has none by design (there is no validated DST model on this site). They hold
              their slot and add nothing: counting them as zero would sink everyone who
              starts a defense.
            </p>
          ) : null}

          {/* --- START / SIT ------------------------------------------------ */}
          {cambios ? (
            <div className="mu-startsit">
              <h4>Start / sit</h4>
              {cambios.sinCambios ? (
                <p className="caption">
                  Your posted lineup already is the highest-projected one. That is the normal
                  case and it is worth saying instead of inventing a change.
                </p>
              ) : (
                <>
                  <ul className="an-trades">
                    {cambios.entran.map((e) => (
                      <li key={e.player.sid}>
                        <b className="mu-start">START</b>{" "}
                        <strong>{e.player.player_name}</strong>{" "}
                        <span className="attrib">{e.player.team} · {e.slot}</span>{" "}
                        <span className="wk-gap-num">{num(e.player.projected_points, 1)}</span>
                      </li>
                    ))}
                    {cambios.salen.map((sid) => {
                      const row = paraAlinear.get(String(sid));
                      return (
                        <li key={sid}>
                          <b className="mu-sit">SIT</b>{" "}
                          <strong>{row?.player_name ?? `id ${sid}`}</strong>{" "}
                          {row ? (
                            <>
                              <span className="attrib">{row.team}</span>{" "}
                              <span className="wk-gap-num">{num(row.projected_points, 1)}</span>
                            </>
                          ) : <span className="attrib">no weekly projection</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="caption">
                    The swap is worth{" "}
                    <strong>
                      {num((alineaciones.miMejor.points ?? 0) - (alineaciones.mia.points ?? 0), 1)}
                    </strong>{" "}
                    projected points. Under about two points it is inside the weekly noise and
                    this page will not pretend otherwise.
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="caption">
              Sleeper has not published your starters for this week yet, so there is nothing to
              compare your lineup against.
            </p>
          )}
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
