"use client";

/**
 * TODAS MIS LIGAS, UNA DEBAJO DE OTRA: lo puesto, lo que más proyecta y el
 * cambio hueco a hueco. La liga activa va primero; las demás debajo, sin
 * tener que cambiar de liga en la barra para verlas.
 *
 * Sin red propia: la cuenta y cada instantánea (plantilla, titulares,
 * enfrentamiento) vienen del almacenamiento del navegador, que llena
 * `LeagueBar` al enlazar o refrescar. El motor es `startSit.js`, puro.
 *
 * Lo que esta pantalla NO hace, y lo dice: no envía nada a Sleeper, no
 * promete que ganes, y no afirma autoridad sobre un cambio de quarterback
 * mientras el registro diga NOT_READY.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { num } from "../../../data/model.js";
import { Headshot } from "../../headshot.jsx";
import { TeamMark } from "../../sports.jsx";
import LeagueBar from "../LeagueBar.jsx";
import { EXCLUDED, fullWeeklyIndex, leagueStartSit, swapAuthority } from "../startSit.js";
import { stateLabel } from "../../gameClock.js";
import { lateStatusRisks } from "../lateRisk.js";

/* «Un par de puntos está dentro del ruido semanal»: la convención declarada en
   docs/evidence/ui_numbers.json («2 points», acierto por desacuerdo). Vive
   aquí y no en el JSX para que el libro de cifras lo encuentre una sola vez. */
const NOISE_POINTS = 2;
const insideNoise = (gap) => Number.isFinite(gap) && gap < NOISE_POINTS;

const SLOT_LABEL = (slot) => (slot === "SUPER_FLEX" ? "SFLX" : slot);
const slotClass = (slot) => `ptag ptag--${String(slot).toLowerCase().replace("super_flex", "sflx")}`;

function Gap({ value, digits = 1 }) {
  if (!Number.isFinite(value)) return <span className="attrib">—</span>;
  const rounded = Number(value.toFixed(digits)) + 0;
  const cls = rounded > 0 ? "gap gap--up" : rounded < 0 ? "gap gap--down" : "gap";
  return <span className={cls}>{rounded > 0 ? "+" : ""}{num(rounded, digits)}</span>;
}

/** Las marcas de una fila que pesan en la decisión: estado y bye. */
function Flags({ row, flags }) {
  if (!row) return null;
  return (
    <>
      {row.status_label ? (
        <span className={row.status_disputed ? "mark mark--risk"
          : row.status_severity === "OUT" ? "mark mark--out" : "mark mark--risk"}
              title={`${row.status_detail ?? ""} ${row.status_freshness === "CURRENT"
                ? `Verified ${row.status_verified_at}.` : `LAST VERIFIED ${row.status_verified_at}.`}`}>
          {row.status_label}
        </span>
      ) : null}
      {flags?.includes("BYE") ? <span className="mark mark--out" title="His team does not play this week">BYE</span> : null}
    </>
  );
}

function Who({ row, sid, size = 26 }) {
  if (!row) return <span className="attrib">{sid ? `id ${sid} — not in this week's projections` : "empty"}</span>;
  return (
    <>
      <Headshot sid={row.position === "DEF" ? null : sid} team={row.team} position={row.position}
                name={row.player_full_name ?? row.player_name} size={size} />
      <span className="nm">{row.player_full_name ?? row.player_name}</span>
      <TeamMark abbr={row.team} />
    </>
  );
}

/** El estado de autoridad de un cambio, en una palabra que sale del registro. */
function Authority({ position, statuses }) {
  const a = swapAuthority(position, (id) => statuses?.[id] ?? null);
  if (!a || !a.status) return null;
  if (a.status === "VALIDATED") return null;
  const text = a.status === "NOT_READY" ? "order not validated"
    : a.status === "REJECTED" ? "order rejected"
      : a.status === "DESIGN_ONLY" ? "no validated model"
        : a.status.toLowerCase();
  return <span className="mark mark--risk" title={`${a.id}: ${a.status} in the capability registry`}>{text}</span>;
}

/* LA HORA DEL PARTIDO, EN HORA DEL ESTE — que es como se publica el calendario
   y como se habla de la jornada («el de la una», «el nocturno»). Se rotula ET
   siempre: una hora sin zona en una pantalla que se mira desde otro huso es la
   misma trampa que un saque sin `kickoff_at`. */
function clockET(ms) {
  if (!Number.isFinite(ms)) return "an unknown time";
  return `${new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  })} ET`;
}

function LeagueLineup({ league, index, byes, week, statuses, active, now }) {
  const out = useMemo(
    () => leagueStartSit({ league, index, byes, week, now }),
    [league, index, byes, week, now]
  );
  /* NEEDS ACTION: lo que hay que decidir ANTES de que se cierre una puerta.
     Va lo primero del panel porque es lo único con reloj — el resto se puede
     mirar después y esto no. */
  const riesgos = useMemo(
    () => lateStatusRisks({ league, index, now }), [league, index, now]
  );
  const config = league?.config ?? null;
  const name = league?.name || `League ${league?.leagueId ?? ""}`;
  const sleeperHref = league?.leagueId && !String(league.leagueId).startsWith("draft-")
    ? `https://sleeper.com/leagues/${league.leagueId}` : null;

  return (
    <article className={active ? "cc-panel lu-panel lu-panel--active" : "cc-panel lu-panel"}
             aria-label={`Lineup — ${name}`}>
      <header className="cc-panel-head">
        <div>
          <h3>{name}{active ? <small className="lu-active"> active league</small> : null}</h3>
          <p className="meta">
            <span>{config?.teams ?? "UNKNOWN"}-team</span>
            <span>{config?.scoringLabel ?? "UNKNOWN scoring"}</span>
            {league?.record ? (
              <span>{league.record.wins}-{league.record.losses}{league.record.ties ? `-${league.record.ties}` : ""}</span>
            ) : null}
            <span>week {week ?? "UNKNOWN"}</span>
          </p>
        </div>
        <div className="cc-league-act">
          {sleeperHref ? (
            <a href={sleeperHref} target="_blank" rel="noreferrer noopener">Set lineup in Sleeper</a>
          ) : null}
        </div>
      </header>

      {!out ? (
        <p className="caption">
          Roster slots UNKNOWN for this league — Sleeper did not return them, so there is no
          lineup to compare. Nothing is assumed.
        </p>
      ) : (
        <>
          {/* --- EL VEREDICTO ------------------------------------------------ */}
          {out.emptyRoster ? (
            <p className="caption lu-verdict">
              No players on this roster yet — nothing to line up. Once the draft is done and
              you Refresh in the bar, the lineup appears here.
            </p>
          ) : !out.current ? (
            <p className="caption lu-verdict">
              Sleeper has not published your starters for week {week}. Below is the
              highest-projected lineup from your roster; there is nothing to diff it against yet.
            </p>
          ) : out.unchanged ? (
            <p className="lu-verdict lu-verdict--ok">
              <b>No change.</b> Your posted lineup already is the highest-projected one
              ({num(out.current.points, 1)} projected{out.current.unknown
                ? `, ${out.current.unknown} starter${out.current.unknown === 1 ? "" : "s"} without a projection` : ""}).
            </p>
          ) : (
            <p className="lu-verdict">
              <b>{out.swaps.length} slot{out.swaps.length === 1 ? "" : "s"} to change</b> —
              from {num(out.current.points, 1)} to {num(out.best.points, 1)} projected,{" "}
              <Gap value={out.gain} /> this week.
            </p>
          )}

          {/* --- AVISOS: lo que está mal PUESTO ahora mismo ------------------- */}
          {out.warnings.length > 0 ? (
            <ul className="lu-warnings" aria-label="Lineup warnings">
              {out.warnings.map((wn, i) => (
                <li key={`${wn.kind}-${wn.slot}-${i}`} className={`lu-warn lu-warn--${wn.kind.toLowerCase()}`}>
                  <span className={slotClass(wn.slot)}>{SLOT_LABEL(wn.slot)}</span>{" "}
                  {wn.kind === "EMPTY" ? <>slot is <b>empty</b> in Sleeper — the lineup on the right fills it</>
                    : wn.kind === "EMPTY_NO_ONE_FITS" ? <>slot is <b>empty</b> in Sleeper and nobody on your roster can fill it this week</>
                    : wn.kind === "OUT" ? <><b>{wn.row.player_full_name ?? wn.row.player_name}</b> is <b>{wn.row.status_label ?? "OUT"}</b> and is your starter</>
                      : wn.kind === "BYE" ? <><b>{wn.row.player_full_name ?? wn.row.player_name}</b> is on <b>bye</b> and is your starter</>
                        : wn.kind === "NO_ONE_FITS" ? <>nobody on your roster can fill this slot this week</>
                          : <>starter <b>{wn.row?.player_full_name ?? wn.row?.player_name ?? `id ${wn.sid}`}</b> has no weekly projection — not compared</>}
                </li>
              ))}
            </ul>
          ) : null}

          {/* --- LOS CAMBIOS, HUECO A HUECO ---------------------------------- */}
          {out.swaps.length > 0 ? (
            <ol className="lu-swaps" aria-label="Start / sit">
              {out.swaps.map((s, i) => (
                <li key={`${s.slot}-${i}`}>
                  <span className={slotClass(s.slot)}>{SLOT_LABEL(s.slot)}</span>
                  <span className="lu-swap-out">
                    <b className="mu-sit">{s.out?.row || s.out?.sid ? "SIT" : "FILL"}</b>{" "}
                    {s.out?.row ? (
                      <>
                        <span className="nm">{s.out.row.player_full_name ?? s.out.row.player_name}</span>{" "}
                        <Flags row={s.out.row} flags={s.out.flags} />{" "}
                        <span className="wk-gap-num">{s.out.points === null ? "—" : num(s.out.points, 1)}</span>
                      </>
                    ) : s.out?.sid ? <span className="attrib">id {s.out.sid} — no weekly projection</span>
                      : <span className="attrib">empty slot in Sleeper</span>}
                  </span>
                  <span className="lu-swap-in">
                    <b className="mu-start">START</b>{" "}
                    {s.in?.row ? (
                      <>
                        <span className="nm">{s.in.row.player_full_name ?? s.in.row.player_name}</span>{" "}
                        <span className="attrib">{s.in.row.team}{s.in.row.opponent ? ` ${s.in.row.is_home ? "vs" : "@"} ${s.in.row.opponent}` : ""}</span>{" "}
                        <Flags row={s.in.row} flags={s.in.flags} />{" "}
                        <span className="wk-gap-num">{s.in.points === null ? "—" : num(s.in.points, 1)}</span>{" "}
                        <Authority position={s.in.row.position} statuses={statuses} />
                      </>
                    ) : <span className="attrib">nobody fits</span>}
                  </span>
                  <span className="lu-swap-delta"><Gap value={s.delta} /></span>
                </li>
              ))}
            </ol>
          ) : null}

          {/* --- LAS DOS ALINEACIONES, EN PARALELO ---------------------------- */}
          <div className="mu-head lu-head">
            <div className="mu-side mu-side--mine">
              <span className="mu-name">Set in Sleeper</span>
              <strong className="mu-pts">{out.current ? num(out.current.points, 1) : "—"}</strong>
            </div>
            <div className="mu-vs"><Gap value={out.gain} /></div>
            <div className="mu-side mu-side--theirs">
              <span className="mu-name">Highest projected</span>
              <strong className="mu-pts">{num(out.best.points, 1)}</strong>
            </div>
          </div>
          <ol className="mu-rows lu-rows">
            {out.best.rows.map((b, i) => {
              const a = out.current?.rows?.[i] ?? null;
              const same = (a?.sid ?? null) === (b.sid ?? null);
              return (
                <li key={`${b.slot}-${i}`} className={same ? undefined : "lu-row--changed"}>
                  <span className="mu-cell mu-cell--mine">
                    {a ? (
                      <>
                        <Who row={a.row} sid={a.sid} />
                        <Flags row={a.row} flags={a.flags} />
                        <b>{a.points === null ? "—" : num(a.points, 1)}</b>
                      </>
                    ) : <span className="attrib">not published</span>}
                  </span>
                  <span className={`mu-slot ${slotClass(b.slot)}`}>{SLOT_LABEL(b.slot)}
                    {/* UN HUECO CONGELADO NO ES UN HUECO QUE COINCIDE.
                        Sin decirlo, la fila se lee como «aquí no hay nada que
                        cambiar» cuando lo cierto es «aquí ya no se puede». */}
                    {b.locked ? (
                      <small className="lu-locked"
                             title="This game has started: Sleeper no longer accepts a change in this slot">
                        {stateLabel(b.row, now) ?? "LOCKED"}
                      </small>
                    ) : null}
                  </span>
                  <span className="mu-cell mu-cell--theirs">
                    {b.row ? (
                      <>
                        <b>{b.points === null ? "—" : num(b.points, 1)}</b>
                        <Flags row={b.row} flags={b.flags} />
                        <Who row={b.row} sid={b.sid} />
                      </>
                    ) : <span className="attrib">nobody fits</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {out.best.unknown > 0 ? (
            <p className="caption">
              {out.best.unknown} starter{out.best.unknown === 1 ? "" : "s"} without a weekly
              projection — a defense has none by design. They hold their slot and add nothing.
            </p>
          ) : null}

          {/* --- LAS DECISIONES APRETADAS ------------------------------------ */}
          {out.closest.length > 0 ? (
            <details className="an-more">
              <summary>Closest calls — the bench option nearest to each starter</summary>
              <ul className="an-trades">
                {out.closest.slice(0, 5).map((c, i) => (
                  <li key={`${c.slot}-${i}`}>
                    <span className={slotClass(c.slot)}>{SLOT_LABEL(c.slot)}</span>{" "}
                    <strong>{c.starter.player_full_name ?? c.starter.player_name}</strong>{" "}
                    <span className="wk-gap-num">{num(c.starter.projected_points, 1)}</span>
                    {" over "}
                    <strong>{c.bench.player_full_name ?? c.bench.player_name}</strong>{" "}
                    <span className="wk-gap-num">{num(c.bench.projected_points, 1)}</span>
                    {" · gap "}<Gap value={c.gap} />
                    {insideNoise(c.gap) ? <span className="attrib"> — inside weekly noise</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* --- QUIÉN QUEDÓ FUERA Y POR QUÉ --------------------------------- */}
          {riesgos.length > 0 ? (
            <section className="lu-act" aria-label="Needs action now">
              <h4 className="lu-act-h">
                <span className="mark mark--out">NEEDS ACTION</span>{" "}
                {riesgos.length === 1 ? "1 decision" : `${riesgos.length} decisions`} close
                before the player they depend on
              </h4>
              <ul className="lu-act-list">
                {riesgos.map((r) => (
                  <li key={`${r.slot}-${r.starter.sid}`}>
                    <p className="lu-act-why">
                      <span className={slotClass(r.slot)}>{SLOT_LABEL(r.slot)}</span>{" "}
                      <strong>{r.starter.row.player_full_name ?? r.starter.row.player_name}</strong>{" "}
                      <span className="attrib">
                        {r.starter.row.injury_designation ?? "in doubt"}
                        {r.starter.row.injury_detail ? ` — ${r.starter.row.injury_detail}` : ""}
                        {" · kicks off "}{clockET(r.starterKickoff)}
                      </span>
                    </p>
                    <p className="lu-act-when">
                      Decide by <strong>{clockET(r.decideBy)}</strong>{" "}
                      <span className="attrib">
                        — that is when {r.options.length === 1 ? "your cover" : "your earliest cover"}{" "}
                        locks, not when his game starts.
                      </span>
                    </p>
                    <p className="lu-act-alt">
                      Cover:{" "}
                      {r.options.map((o, i) => (
                        <span key={o.sid}>
                          {i > 0 ? " · " : ""}
                          <strong>{o.row.player_full_name ?? o.row.player_name}</strong>{" "}
                          <span className="wk-gap-num">{num(o.row.projected_points, 1)}</span>{" "}
                          <span className="attrib">{clockET(o.kickoff)}</span>
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="caption">
                A questionable player stays questionable until the official inactive list, which
                posts 90 minutes before his kickoff. Nothing here estimates whether he plays — it
                says when your choice expires.
              </p>
            </section>
          ) : null}

          {out.best.locked > 0 ? (
            <p className="caption">
              {out.best.locked} slot{out.best.locked === 1 ? "" : "s"} locked: those games have
              kicked off, so Sleeper no longer accepts a change there. The swap below is only
              over what is still playable.
            </p>
          ) : null}

          {out.excluded.length > 0 ? (
            <details className="an-more">
              <summary>Not considered for a starting slot ({out.excluded.length})</summary>
              <ul className="an-trades">
                {out.excluded.map((e) => (
                  <li key={e.sid}>
                    <strong>{e.row?.player_full_name ?? e.row?.player_name ?? `id ${e.sid}`}</strong>{" "}
                    <span className="attrib">
                      {e.reason === EXCLUDED.GAME_FINAL ? "his game has started — he can no longer be started"
                        : e.reason === EXCLUDED.OUT ? `${e.row?.status_label ?? "OUT"} — cannot play`
                          : e.reason === EXCLUDED.BYE ? "on bye this week"
                            : e.reason === EXCLUDED.RESERVE ? "on your IR / taxi squad in Sleeper"
                              : "no weekly projection (not in this week's ranking)"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </article>
  );
}

export default function LineupsShell({ rankings, kickers, defenses, byes, week, season, statuses }) {
  /* EL RELOJ, y sólo después de montar. Un titular cuyo partido ya empezó no se
     puede sacar en Sleeper, pero «ahora» no existe en el build: leerlo en el
     render del servidor pintaría la hora de la COMPILACIÓN. Con `null` sólo se
     congela lo que ya tiene marcador; en cuanto monta, también lo empezado. */
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [account, setAccount] = useState(null);
  const [activeId, setActiveId] = useState("");
  const index = useMemo(
    () => fullWeeklyIndex({ rankings, kickers, defenses }),
    [rankings, kickers, defenses]
  );
  const onLeague = useCallback((league, acct) => {
    setAccount(acct ?? null);
    setActiveId(league?.leagueId ?? "");
  }, []);
  const leagues = useMemo(() => {
    const all = account?.leagues ?? [];
    const active = all.filter((l) => l.leagueId === activeId);
    const rest = all.filter((l) => l.leagueId !== activeId);
    return [...active, ...rest];
  }, [account, activeId]);

  const qbNotReady = statuses?.START_SIT_QB && statuses.START_SIT_QB !== "VALIDATED";
  const kOrderRejected = statuses?.KICKER_ORDINAL_RANKING === "REJECTED";
  const dstNoModel = statuses?.DST_STREAMING && statuses.DST_STREAMING !== "VALIDATED";

  return (
    <>
      <LeagueBar season={season} week={week} id="lu-league" onLeague={onLeague} />
      {!account ? (
        <p className="caption">
          Link your Sleeper account above and every league you are in appears here with its
          lineup for week {week}.
        </p>
      ) : leagues.length === 0 ? (
        <p className="caption">No leagues on this account for {season}.</p>
      ) : (
        <>
          <p className="caption">
            {leagues.length} league{leagues.length === 1 ? "" : "s"} · the active one first.
            Starters are as Sleeper last reported them; use Refresh in the bar after you change
            anything there.
          </p>
          {leagues.map((league) => (
            <LeagueLineup key={league.leagueId} league={league} index={index} byes={byes}
                          week={week} statuses={statuses} active={league.leagueId === activeId}
                          now={now} />
          ))}
        </>
      )}
      {/* LA AUTORIDAD, LEÍDA DEL REGISTRO. Sin estado declarado no se afirma
          ninguna de las dos cosas: ni que valga ni que no. */}
      {(qbNotReady || kOrderRejected || dstNoModel) ? (
        <aside className="aside">
          <p>
            <b>Where the order is not validated.</b>{" "}
            {qbNotReady ? (
              <>
                The weekly start/sit call between <b>quarterbacks</b> is {String(statuses.START_SIT_QB).replace("_", " ").toLowerCase()}:
                the projection loses to a player&rsquo;s recent form there, so a QB swap on this
                page is arithmetic on a number that has not earned the call.{" "}
              </>
            ) : null}
            {kOrderRejected ? (
              <>
                The order among <b>kickers</b> is rejected: the projection is validated, the
                ranking between them is not.{" "}
              </>
            ) : null}
            {dstNoModel ? (
              <>
                A <b>defense</b> has no validated projection here, so it never decides a swap.
              </>
            ) : null}
          </p>
        </aside>
      ) : null}
    </>
  );
}
