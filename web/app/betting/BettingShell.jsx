"use client";

/**
 * El centro de mando de apuestas: banca del mes arriba, decisiones debajo.
 *
 * ## El orden del primer viewport es la tesis de la pantalla
 *
 * 1. MI DINERO: banca del mes, disponible, expuesto, P/L. 2. QUÉ MIRAR HOY:
 * los leans más grandes del modelo. La metodología existe y está — detrás,
 * como divulgación. Un usuario que abre Betting no viene a leer validación:
 * viene a decidir, y la validación decide QUÉ se le puede enseñar, no en qué
 * orden lo lee.
 *
 * ## Las tres verdades que la pantalla no difumina
 *
 * - MODEL LEAN ≠ EDGE. E4 lo midió: el desacuerdo no predice acierto. El lean
 *   se enseña porque es un hecho del modelo; la etiqueta nunca sube de ahí.
 * - Las líneas de partido son las del payload (nflverse, al construir). Las de
 *   props NO EXISTEN aquí: las tecleas de tu casa de apuestas, y sin línea no
 *   hay lean — MARKET UNAVAILABLE es la respuesta, no un número inventado.
 * - «Record as placed» REGISTRA en Gridiron. Aquí no se transmite dinero.
 */

import { useEffect, useMemo, useState } from "react";

import { num } from "../../data/model.js";
import { TeamMark } from "../sports.jsx";
import {
  BET_STATUS, addBet, createMonth, decimalFromAmerican, exposure, limitWarnings,
  loadMonth, loadMonths, placeBets, removeBet, saveMonth, settleBet, summary,
  updateBet,
} from "./bankroll.js";
import { gameLeans, propLean, rankedLeans } from "./leans.js";
import { browserStorage } from "../fantasy/draftStorage.js";

const PROP_CATEGORIES = [
  { key: "proj_pass_yds", label: "Passing yards", positions: ["QB"], decimals: 1 },
  { key: "proj_pass_tds", label: "Passing TDs", positions: ["QB"], decimals: 2 },
  { key: "proj_pass_att", label: "Pass attempts", positions: ["QB"], decimals: 1 },
  { key: "proj_pass_ints", label: "Interceptions", positions: ["QB"], decimals: 2 },
  { key: "proj_rush_yds", label: "Rushing yards", positions: ["QB", "RB"], decimals: 1 },
  { key: "proj_carries", label: "Rush attempts", positions: ["QB", "RB"], decimals: 1 },
  { key: "proj_rec_yds", label: "Receiving yards", positions: ["RB", "WR", "TE"], decimals: 1 },
  { key: "proj_receptions", label: "Receptions", positions: ["RB", "WR", "TE"], decimals: 1 },
  { key: "proj_targets", label: "Targets", positions: ["RB", "WR", "TE"], decimals: 1 },
];

const money = (v) => `$${num(v, Math.abs(v) % 1 < 0.005 ? 0 : 2)}`;
const signed = (v) => `${v >= 0 ? "+" : "−"}$${num(Math.abs(v), 2)}`;

function currentMonthId() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Cuota americana justa para una probabilidad: sin margen, lo que pagaría una casa sin vig. */
function fairAmerican(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  const decimal = 1 / p;
  return decimal >= 2 ? `+${Math.round((decimal - 1) * 100)}` : `${Math.round(-100 / (decimal - 1))}`;
}
const pctOf = (p) => `${num(p * 100, 1)}%`;

export default function BettingShell({ predictions, weekly, context, markets = [], bets = [] }) {
  const [months, setMonths] = useState(null);
  const [active, setActive] = useState(null);
  const [record, setRecord] = useState(null);
  const [propLines, setPropLines] = useState({});
  const [category, setCategory] = useState("proj_pass_yds");
  const [newMonth, setNewMonth] = useState({ month: currentMonthId(), starting: "" });

  const storage = browserStorage();
  const linesKey = `gridiron-prop-lines-v1:${context.season}-w${context.week}`;

  useEffect(() => {
    const known = loadMonths(storage);
    setMonths(known);
    const last = known[known.length - 1] ?? null;
    setActive(last);
    setRecord(last ? loadMonth(last, storage) : null);
    try {
      const raw = storage?.getItem(linesKey);
      setPropLines(raw ? JSON.parse(raw) : {});
    } catch { setPropLines({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next) => {
    setRecord(next);
    saveMonth(next, storage);
  };
  const switchMonth = (month) => {
    setActive(month);
    setRecord(loadMonth(month, storage));
  };
  const setLine = (id, value) => {
    setPropLines((prev) => {
      const next = { ...prev, [id]: value };
      try { storage?.setItem(linesKey, JSON.stringify(next)); } catch { /* privado */ }
      return next;
    });
  };

  const board = useMemo(() => rankedLeans(gameLeans(predictions)), [predictions]);
  const s = record ? summary(record) : null;
  const slip = record ? record.bets.filter((b) => b.status === BET_STATUS.CONSIDERING) : [];
  const open = record ? record.bets.filter((b) => b.status === BET_STATUS.PLACED) : [];
  const settled = record
    ? record.bets.filter((b) => ![BET_STATUS.CONSIDERING, BET_STATUS.PLACED].includes(b.status))
    : [];
  const slipTotal = slip.reduce((sum, b) => sum + (Number(b.stake) || 0), 0);
  const grouped = record ? exposure(record) : null;

  const toSlip = (bet) => {
    if (!record) return;
    persist(addBet(record, bet));
  };
  const gameBet = (row) => toSlip({
    market: row.family, label: row.lean, selection: row.lean, line: row.line,
    odds: -110, stake: 0, gameId: row.gameId, team: row.team,
    snapshot: { model: row.model, market: row.line, family: row.family },
  });

  const propRows = useMemo(() => {
    const spec = PROP_CATEGORIES.find((c) => c.key === category);
    if (!spec) return [];
    return (weekly ?? [])
      .filter((r) => spec.positions.includes(r.position) && Number.isFinite(Number(r[category])))
      .sort((a, b) => Number(b[category]) - Number(a[category]))
      .slice(0, 24)
      .map((r) => ({ ...r, projection: Number(r[category]) }));
  }, [weekly, category]);
  const spec = PROP_CATEGORIES.find((c) => c.key === category);

  if (months === null) return <p className="caption">Reading your bankroll&hellip;</p>;

  /* --- sin mes: crear la banca es lo primero y lo único ------------------- */
  if (!record) {
    return (
      <div className="bk">
        <h1>Betting</h1>
        <div className="bk-start">
          <p className="lede">Start a monthly bankroll to work from.</p>
          <p className="caption">
            The month&rsquo;s starting amount is yours to choose — it is a bookkeeping
            container, not advice about what to risk. History stays per month, forever.
          </p>
          <div className="bk-start-form">
            <label>Month
              <input type="month" value={newMonth.month}
                     onChange={(e) => setNewMonth({ ...newMonth, month: e.target.value })} />
            </label>
            <label>Starting bankroll ($)
              <input type="number" min="1" placeholder="10000" value={newMonth.starting}
                     onChange={(e) => setNewMonth({ ...newMonth, starting: e.target.value })} />
            </label>
            <button type="button" className="bk-primary" onClick={() => {
              const created = createMonth(newMonth.month, Number(newMonth.starting), storage);
              if (created) { setMonths(loadMonths(storage)); setActive(created.month); setRecord(created); }
            }}>Start month</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bk">
      {/* ============ 1. MI DINERO — el primer viewport empieza aquí ======= */}
      <header className="bk-head">
        <div className="bk-month">
          <h1>{record.month}</h1>
          <span className="bk-starting">{money(record.starting)} starting</span>
          {months.length > 1 ? (
            <select aria-label="Month" value={active ?? ""} onChange={(e) => switchMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : null}
        </div>
        <dl className="bk-stats">
          <div><dt>Available</dt><dd>{money(s.available)}</dd></div>
          <div><dt>Open</dt><dd>{money(s.openExposure)}<small>{s.openCount} bets</small></dd></div>
          <div className={s.settledPL >= 0 ? "is-up" : "is-down"}>
            <dt>Settled P/L</dt><dd>{signed(s.settledPL)}<small>{num(s.roi * 100, 1)}% ROI</small></dd>
          </div>
          <div><dt>Record</dt><dd>{s.wins}-{s.losses}{s.pushes ? `-${s.pushes}` : ""}<small>{money(s.unitDollars)}/u</small></dd></div>
        </dl>
      </header>

      {/* ============ 2. QUÉ MIRAR HOY ==================================== */}
      <section aria-label="Top model leans">
        <h2 className="bk-h">Top model leans <small>week {context.week} · not edge — E4 measured that</small></h2>
        <ol className="bk-leans">
          {board.slice(0, 5).map((row) => (
            <li key={`${row.gameId}:${row.family}`}>
              <span className="bk-lean-what">
                <b>{row.lean}</b>
                <small>{row.family === "SPREAD" ? "Spread" : "Total"} · {row.label}</small>
              </span>
              <span className="bk-lean-nums">
                <span><small>Model</small>{num(row.model, 1)}</span>
                <span><small>Market</small>{row.family === "SPREAD" ? num(row.line, 1) : num(row.line, 1)}</span>
                <span><small>Gap</small>{num(row.gap, 1)} <em>{num(row.sigmas, 1)}× typical</em></span>
              </span>
              <button type="button" onClick={() => gameBet(row)}>Add to slip</button>
            </li>
          ))}
        </ol>
        <p className="caption">
          Ranked by gap in units of the family&rsquo;s own weekly spread of disagreements,
          so leans of different sizes are comparable; raw points are not.
          Out of sample, accuracy does <strong>not</strong> rise with disagreement
          (49.3&nbsp;/&nbsp;50.9&nbsp;/&nbsp;48.8% by bucket): a lean is where the model
          stands, never a promise.
        </p>
      </section>

      {/* ============ PROPS ================================================ */}
      <section aria-label="Player props">
        <h2 className="bk-h">Player props <small>model means · lines are yours</small></h2>
        <div className="pos-filter" role="group" aria-label="Prop category">
          {PROP_CATEGORIES.map((c) => (
            <button key={c.key} type="button" className="pos-option"
                    aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <p className="caption">
          The projection is the weekly model&rsquo;s <strong>mean</strong> stat line
          (volume &times; efficiency, before matchup adjustment — those layers operate on
          points). Prop markets don&rsquo;t travel in this site&rsquo;s data:{" "}
          <strong>type your book&rsquo;s line</strong> and the lean appears. No line, no
          lean.
        </p>
        <div className="table-wrap">
          <table className="rank-table bk-props">
            <thead>
              <tr><th>Player</th><th>Model</th><th>Your book&rsquo;s line</th><th>Model lean</th><th></th></tr>
            </thead>
            <tbody>
              {propRows.map((row) => {
                const lineId = `${row.player_id}:${category}`;
                const line = propLines[lineId] ?? "";
                const lean = propLean(row.projection, line);
                return (
                  <tr key={row.player_id}>
                    <td className="who">
                      <span className="nm">{row.player_name}</span>
                      <span className="meta">
                        <span className={`ptag ptag--${row.position.toLowerCase()}`}>
                          {row.position}{row.position_rank}
                        </span>
                        <TeamMark abbr={row.team} />
                        <span>{row.is_home === 0 ? "@" : "vs"} {row.opponent}</span>
                      </span>
                    </td>
                    <td className="bk-proj"><strong>{num(row.projection, spec.decimals)}</strong></td>
                    <td>
                      <input className="bk-line" type="number" step="0.5" inputMode="decimal"
                             aria-label={`${row.player_name} line`} placeholder="—"
                             value={line} onChange={(e) => setLine(lineId, e.target.value)} />
                    </td>
                    <td>
                      {lean === null ? (
                        <span className="bk-nomarket">market unavailable</span>
                      ) : lean.side === "PUSH" ? (
                        <span>even</span>
                      ) : (
                        <b className="bk-side">{lean.side} {num(Number(line), 1)}
                          <small> by {num(lean.gap, spec.decimals)}</small></b>
                      )}
                    </td>
                    <td>
                      {lean !== null && lean.side !== "PUSH" ? (
                        <button type="button" onClick={() => toSlip({
                          market: `PROP_${category.replace("proj_", "").toUpperCase()}`,
                          label: `${row.player_name} ${lean.side[0]}${num(Number(line), 1)} ${spec.label.toLowerCase()}`,
                          selection: lean.side, line: Number(line), odds: -110, stake: 0,
                          gameId: `${context.season}-w${context.week}-${row.team}`,
                          playerId: row.player_id, team: row.team,
                          snapshot: { model: row.projection, market: Number(line), stat: category },
                        })}>Add</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ MERCADOS: el motor de valor, partido a partido ======= */}
      {markets.length > 0 ? (
        <section aria-label="Markets">
          <h2 className="bk-h">
            Markets <small>model probability vs the house without vig · every spread, both sides</small>
          </h2>
          {/* Las apuestas que PASAN el umbral, con su stake a ESTE bankroll. Son
              pocas o ninguna a propósito: el modelo iguala al mercado, y la
              ficha histórica de su clase suele decir «below breakeven». */}
          {bets.length > 0 ? (
            <ol className="bk-bets">
              {bets.map((bet) => (
                <li key={`${bet.game_id}:${bet.market}:${bet.selection}`}>
                  <span className="bk-lean-what">
                    <b>{bet.selection} {bet.market}</b>
                    <small>{bet.matchup} · model {pctOf(bet.model_prob)} vs house {pctOf(bet.market_prob)} · EV {num(bet.ev * 100, 1)}%</small>
                  </span>
                  <span className="bk-lean-nums">
                    <span><small>Stake</small>{money(bet.stake_fraction * record.starting)}<em>{num(bet.stake_fraction * 100, 2)}% bank</em></span>
                    <span><small>History</small>{bet.evidence_label}<em>{bet.evidence_bets ? `${bet.evidence_bets} bets · ${num(bet.evidence_win_rate * 100, 1)}% · ${bet.evidence_verdict}` : "no sample"}</em></span>
                  </span>
                  <button type="button" onClick={() => toSlip({
                    market: bet.market.startsWith("spread") ? "SPREAD" : "MONEYLINE",
                    label: `${bet.selection} ${bet.market}`, selection: bet.selection,
                    line: Number(String(bet.market).replace(/[^-+\d.]/g, "")) || null,
                    odds: -110, stake: Math.round(bet.stake_fraction * record.starting),
                    gameId: bet.game_id, team: bet.selection,
                    snapshot: { model: bet.model_prob, market: bet.market_prob, family: bet.market },
                  })}>Add to slip</button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="caption">
              No market clears the staking threshold this week (minimum edge 1.5 points of
              probability after shrinkage). That is the normal state for a model that
              matches the closing line; the table below still shows where it stands.
            </p>
          )}
          <div className="table-wrap">
            <table className="rank-table bk-markets">
              <thead>
                <tr>
                  <th>Game</th><th>Model score</th><th>Fair ML</th>
                  <th>Side</th><th>Cover</th><th>House</th><th>Edge</th><th>EV at −110</th><th>Stake</th><th>History</th>
                </tr>
              </thead>
              <tbody>
                {predictions.map((game) => {
                  const sides = markets.filter((m) => m.game_id === game.game_id && String(m.market).startsWith("spread"));
                  const fairHome = fairAmerican(Number(game.home_win_prob));
                  const fairAway = fairAmerican(1 - Number(game.home_win_prob));
                  if (sides.length === 0) {
                    return (
                      <tr key={game.game_id}>
                        <td className="who"><span className="nm">{game.away_team} @ {game.home_team}</span></td>
                        <td>{num(game.pred_away_points, 1)}&ndash;{num(game.pred_home_points, 1)}</td>
                        <td>{fairHome ? `${game.home_team} ${fairHome} · ${game.away_team} ${fairAway}` : "—"}</td>
                        <td colSpan={7}><span className="bk-nomarket">market unavailable</span></td>
                      </tr>
                    );
                  }
                  return sides.map((side, i) => (
                    <tr key={`${game.game_id}:${side.selection}`} className={i === 0 ? "bk-game-first" : undefined}>
                      {i === 0 ? (
                        <>
                          <td className="who" rowSpan={sides.length}><span className="nm">{game.away_team} @ {game.home_team}</span></td>
                          <td rowSpan={sides.length}>{num(game.pred_away_points, 1)}&ndash;{num(game.pred_home_points, 1)}</td>
                          <td rowSpan={sides.length}>{fairHome ? <>{game.home_team} {fairHome}<br />{game.away_team} {fairAway}</> : "—"}</td>
                        </>
                      ) : null}
                      <td><b className="bk-side">{side.selection} {String(side.market).replace("spread ", "")}</b></td>
                      <td>{pctOf(side.model_prob)}{side.push_prob > 0 ? <small> · push {pctOf(side.push_prob)}</small> : null}</td>
                      <td>{pctOf(side.market_prob)}</td>
                      <td className={side.edge >= 0 ? "wk-up" : "wk-down"}>{side.edge > 0 ? "+" : ""}{num(side.edge * 100, 1)}</td>
                      <td className={side.ev >= 0 ? "wk-up" : "wk-down"}>{side.ev > 0 ? "+" : ""}{num(side.ev * 100, 1)}%</td>
                      <td>{side.stake_fraction > 0 ? money(side.stake_fraction * record.starting) : "0"}</td>
                      <td><small>{side.evidence_label}{side.evidence_bets ? ` · ${num(side.evidence_win_rate * 100, 1)}%` : ""}</small></td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          <p className="caption">
            Cover probabilities come from the model&rsquo;s margin distribution with key
            numbers (3 and 7) and the push split out; the house is −110 both ways de-vigged
            (Shin), so 50/50. Fair ML is the model&rsquo;s win probability turned into a
            no-vig price — compare it with your book&rsquo;s. Stake is fractional Kelly with
            the project&rsquo;s brakes (quarter Kelly, edge halved, 2% cap, 1.5-point
            minimum) at this month&rsquo;s starting bankroll. &ldquo;History&rdquo; is the
            out-of-sample record of bets with this size of model–market disagreement: read
            it before the edge. Totals have no distribution here, so they stay leans.
          </p>
        </section>
      ) : null}

      {/* ============ GAME LINES =========================================== */}
      <section aria-label="Game lines">
        <h2 className="bk-h">Game lines <small>model vs market, every game</small></h2>
        <div className="table-wrap">
          <table className="rank-table bk-games">
            <thead>
              {/* Sin columna de lean de totales: el modelo de totales se
                  retiró con su medición (ver `leans.js`), así que el total que
                  se publica ES la línea y no puede haber discrepancia. Una
                  columna que siempre dijera «even» sería peor que no estar. */}
              <tr><th>Game</th><th>Model score</th><th>Spread</th><th>Lean</th><th>Total</th><th></th></tr>
            </thead>
            <tbody>
              {predictions.map((game) => {
                const rows = board.filter((r) => r.gameId === game.game_id);
                const spreadLean = rows.find((r) => r.family === "SPREAD") ?? null;
                const noMarket = !Number.isFinite(Number(game.spread_line));
                return (
                  <tr key={game.game_id}>
                    <td className="who">
                      <span className="nm">{game.away_team} @ {game.home_team}</span>
                    </td>
                    <td>{num(game.pred_away_points, 1)}&ndash;{num(game.pred_home_points, 1)}</td>
                    {noMarket ? (
                      <td colSpan={3}><span className="bk-nomarket">market unavailable</span></td>
                    ) : (
                      <>
                        <td>{num(game.spread_line, 1)}</td>
                        <td>{spreadLean ? <b className="bk-side">{spreadLean.lean}</b> : "even"}</td>
                        <td>{num(game.total_line, 1)}</td>
                      </>
                    )}
                    <td>
                      {spreadLean ? (
                        <button type="button" onClick={() => gameBet(spreadLean)}>Add</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Lines are nflverse&rsquo;s as of this build — verify at your book before
          recording. Team and game props carry no market here yet:{" "}
          <strong>market unavailable</strong> is the honest state, not a missing feature.
        </p>
      </section>

      {/* ============ SLIP ================================================= */}
      <section aria-label="Bet slip">
        <h2 className="bk-h">Bet slip <small>{slip.length ? `${slip.length} considering` : "empty"}</small></h2>
        {slip.length === 0 ? (
          <p className="caption">Add a lean or a prop above to build the slip.</p>
        ) : (
          <>
            <ul className="bk-slip">
              {slip.map((bet) => {
                const decimal = decimalFromAmerican(bet.odds);
                const stake = Number(bet.stake) || 0;
                const pct = record.starting > 0 ? (stake / record.starting) * 100 : 0;
                const units = s.unitDollars > 0 ? stake / s.unitDollars : 0;
                const warnings = limitWarnings(record, { stake, gameId: bet.gameId });
                return (
                  <li key={bet.id}>
                    <span className="bk-slip-what">
                      <b>{bet.label}</b>
                      <small>snapshot: model {num(bet.snapshot?.model, 1)} vs {num(bet.snapshot?.market, 1)}</small>
                    </span>
                    <label>Odds
                      <input type="number" step="5" value={bet.odds ?? ""}
                             aria-label={`${bet.label} odds`}
                             onChange={(e) => persist(updateBet(record, bet.id, { odds: e.target.value === "" ? null : Number(e.target.value) }))} />
                    </label>
                    <label>Stake $
                      <input type="number" min="0" value={bet.stake || ""}
                             aria-label={`${bet.label} stake`}
                             onChange={(e) => persist(updateBet(record, bet.id, { stake: Number(e.target.value) || 0 }))} />
                    </label>
                    <span className="bk-slip-math">
                      {num(pct, 1)}% bank · {num(units, 1)}u
                      {decimal && stake > 0 ? <small>returns {money(stake * decimal)}</small> : null}
                    </span>
                    {warnings.length > 0 ? (
                      <span className="bk-warn">{warnings.join(" · ")}</span>
                    ) : null}
                    <button type="button" className="bk-x" aria-label={`Remove ${bet.label}`}
                            onClick={() => persist(removeBet(record, bet.id))}>&times;</button>
                  </li>
                );
              })}
            </ul>
            <div className="bk-slip-foot">
              <span>
                New open exposure: <b>{money(s.openExposure + slipTotal)}</b>
                {" "}({num(((s.openExposure + slipTotal) / record.starting) * 100, 1)}% bank)
              </span>
              <button type="button" className="bk-primary"
                      onClick={() => persist(placeBets(record, slip.map((b) => b.id)))}>
                Record as placed
              </button>
            </div>
            <p className="caption">
              Recording marks the bet as placed <strong>in Gridiron</strong> and freezes
              its snapshot. Nothing is transmitted to any sportsbook. Bets without a
              stake or interpretable odds stay in the slip.
            </p>
          </>
        )}
      </section>

      {/* ============ ABIERTAS ============================================ */}
      {open.length > 0 ? (
        <section aria-label="Open bets">
          <h2 className="bk-h">Open bets <small>{money(s.openExposure)} exposed</small></h2>
          <ul className="bk-open">
            {open.map((bet) => (
              <li key={bet.id}>
                <span className="bk-slip-what">
                  <b>{bet.label}</b>
                  <small>{money(bet.stake)} at {bet.odds} · model {num(bet.snapshot?.model, 1)} vs {num(bet.snapshot?.market, 1)}</small>
                </span>
                <span className="bk-settle" role="group" aria-label={`Settle ${bet.label}`}>
                  {["WON", "LOST", "PUSH", "VOID"].map((result) => (
                    <button key={result} type="button"
                            onClick={() => persist(settleBet(record, bet.id, BET_STATUS[result]))}>
                      {result.toLowerCase()}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {grouped ? (
            <p className="caption bk-exposure">
              Exposure — by game: {grouped.byGame.map((g) => `${g.key} ${money(g.amount)}`).join(", ") || "—"}
              {grouped.byTeam.length ? ` · by team: ${grouped.byTeam.map((g) => `${g.key} ${money(g.amount)}`).join(", ")}` : ""}
              {grouped.byMarket.length ? ` · by market: ${grouped.byMarket.map((g) => `${g.key} ${money(g.amount)}`).join(", ")}` : ""}.
              Grouping is descriptive: five bets on one game are not five independent ideas.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ============ HISTORIAL =========================================== */}
      <section aria-label="History">
        <h2 className="bk-h">History <small>{settled.length} settled this month</small></h2>
        {settled.length === 0 ? (
          <p className="caption">Settled bets land here, immutably.</p>
        ) : (
          <ul className="bk-history">
            {settled.map((bet) => (
              <li key={bet.id} className={`bk-hist--${bet.status.toLowerCase()}`}>
                <b>{bet.status}</b>
                <span>{bet.label}</span>
                <span>{money(bet.stake)} at {bet.odds}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="bk-newmonth">
          <label>New month
            <input type="month" value={newMonth.month}
                   onChange={(e) => setNewMonth({ ...newMonth, month: e.target.value })} />
          </label>
          <label>Starting ($)
            <input type="number" min="1" value={newMonth.starting}
                   placeholder={String(Math.round(s.current))}
                   onChange={(e) => setNewMonth({ ...newMonth, starting: e.target.value })} />
          </label>
          <button type="button" onClick={() => {
            const created = createMonth(newMonth.month, Number(newMonth.starting), storage);
            if (created) { setMonths(loadMonths(storage)); switchMonth(created.month); }
          }}>Start it</button>
          <p className="caption">
            A new month never rolls over automatically — the placeholder shows this
            month&rsquo;s ending bank, but the number is yours to type.
          </p>
        </div>
      </section>

      <details className="room-method">
        <summary>What these numbers are — and are not</summary>
        <p>
          Margin and total are the validated game model (E20: within a fifth of a point of
          the closing line&rsquo;s error, never beating it). A <strong>model lean</strong> is
          arithmetic between that number and a real line — E4 measured that the size of the
          disagreement does <strong>not</strong> predict winning against the spread, which is
          why nothing here is called an edge, a lock, or a confidence. Prop projections are
          unadjusted model means; the aggregate is validated at the points level (E7), the
          stat level is not separately validated. Stakes are your choice: no Kelly, no
          &ldquo;optimal size&rdquo; — that machinery stays off until edge is proven.
        </p>
      </details>
    </div>
  );
}
