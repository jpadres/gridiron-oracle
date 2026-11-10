"use client";

/**
 * WAIVERS, DEFENSA Y PATEADOR: las tres decisiones de transacción de la semana.
 *
 * Lo que esta pantalla NO hace, y está escrito aquí para que se pueda comprobar
 * leyendo el fichero:
 *
 *   - No ordena defensas ni pateadores como si el orden estuviera validado. Las
 *     etiquetas de autoridad salen de `capabilityStatus`, no de prosa escrita a
 *     mano: `KICKER_ORDINAL_RANKING` está REJECTED y `DST_STREAMING` es
 *     DESIGN_ONLY, y el día que un experimento los mueva el texto cambia solo.
 *   - No recomienda un fichaje sin su corte. La pareja la calcula
 *     `waivers.js::waiverMoves` con el MISMO repartidor de huecos del board, del
 *     Draft Room y del analizador.
 *   - No dice «actualizado hoy». Los relojes son los del barrido, por sección, y
 *     un parte de lesiones sin publicar se dice como tal.
 */

import { useCallback, useMemo, useState } from "react";

import { capabilityStatus, num } from "../../../data/model.js";
import { Callout } from "../../ui.jsx";
import { instantLabel } from "../../instant.js";
import { coverageTitle, coverageWarning, injuryClockLabel } from "../injuryReport.js";
import LeagueBar from "../LeagueBar.jsx";
import { RowMarks } from "../rowMarks.jsx";
import { ownershipLabel, ownershipOf } from "../sleeperAccount.js";
import { MOVE, waiverMoves } from "../waivers.js";

/** Cómo se lee cada categoría. Descripciones de un HECHO, no adjetivos. */
const CATEGORIA = {
  [MOVE.IMMEDIATE_STARTER]: ["Immediate starter", "fills a starting slot you have empty"],
  [MOVE.STARTER_UPGRADE]: ["Starter upgrade", "enters your starting lineup"],
  [MOVE.FLEX_UPGRADE]: ["Flex upgrade", "enters only through a flex slot"],
  [MOVE.INJURY_REPLACEMENT]: ["Injury replacement", "someone at this position is OUT"],
  [MOVE.BYE_COVER]: ["Bye cover", "someone at this position is on bye"],
  [MOVE.BENCH_DEPTH]: ["Bench depth", "does not enter your lineup this week"],
};

/* UN RELOJ: RÓTULO Y VALOR, CADA UNO EN SU SITIO.
   Antes eran un `<small>` y un `<b>` sueltos dentro de una rejilla pensada para
   `<dl>`: los dos fluían en línea y se pintaban pegados —«Rankings2026-10-
   14T13:59:16Z»—, con el instante en ISO crudo partido en dos renglones. Es un
   par término/definición, así que va en `<dt>`/`<dd>`, y el instante se escribe
   para leerse (`instantLabel`). */
function Clock({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{instantLabel(value) ?? "UNKNOWN"}</dd>
    </div>
  );
}


export default function WaiversShell({ weekly, research, byes }) {
  const [league, setLeague] = useState(null);

  const rankings = weekly?.rankings ?? [];
  const kickers = weekly?.kickers ?? [];
  const defenses = weekly?.defenses ?? [];
  const week = weekly?.week ?? null;

  const ownership = useMemo(() => (league ? ownershipOf(league) : null), [league]);
  const ownOf = useCallback(
    (sid) => (league ? ownershipLabel({ ownership, sid, myRosterId: league.rosterId }) : null),
    [league, ownership]
  );
  /* El `sid` de una defensa es su código de equipo: así lo publica Sleeper y así
     lo cruza el resto del sitio. Derivarlo distinto aquí sería una segunda
     definición de «de quién es esta defensa». */
  const ownRow = useCallback(
    (row) => ownOf(row?.sid ?? (row?.opponent_implied != null ? row?.team : null)),
    [ownOf]
  );

  const mias = useMemo(
    () => rankings.filter((r) => ownRow(r)?.status === "MINE"),
    [rankings, ownRow]
  );
  const libres = useMemo(
    () => rankings.filter((r) => ownRow(r)?.status === "FREE_AGENT"),
    [rankings, ownRow]
  );

  const movimientos = useMemo(() => {
    if (!league?.config?.roster) return null;
    return waiverMoves({
      available: libres,
      roster: mias,
      rosterPositions: league.config.roster,
      week,
      byes,
      // `roster_positions` es el tamaño de plantilla en Sleeper: no hay un
      // campo aparte, y contar los huecos es leer el dato, no suponerlo.
      rosterLimit: league.config.roster.length,
      // El adaptador no lee el presupuesto de FAAB de Sleeper, así que no
      // hay ninguno declarado y la columna lo dirá. Poner un número aquí
      // sería exactamente la puja inventada que el motor se niega a dar.
      faabRemaining: null,
    });
  }, [league, libres, mias, week, byes]);

  // Los huecos vacíos que este pool no puede servir. Se derivan de lo que el
  // motor DICE que trae, no de una lista escrita a mano.
  /* ¿Hay ALGÚN movimiento con corte, o con puja? Si ninguno lo tiene, la
     columna entera diría lo mismo en cada fila y se retira: se dice una vez en
     el pie. Se deriva de los movimientos y no de la configuración de la liga,
     para que la tabla y la frase no puedan contradecirse. */
  const algunCorte = Boolean(movimientos?.moves?.some((m) => m.drop));
  const algunFaab = Boolean(
    movimientos?.moves?.some((m) => m.faab?.status !== "NO_BUDGET_DECLARED"));
  const fueraDelPool = useMemo(() => {
    const trae = new Set(movimientos?.poolPositions ?? []);
    return (movimientos?.emptyStarterSlots ?? []).filter((pos) => !trae.has(pos));
  }, [movimientos]);

  const kOrdinal = capabilityStatus("KICKER_ORDINAL_RANKING");
  const kProj = capabilityStatus("KICKER_PROJECTION");
  const dstStream = capabilityStatus("DST_STREAMING");

  const jobInstante = research?.jobs?.effective_at ?? null;
  const avisoParte = coverageWarning(research?.injury_report);

  return (
    <>
      <LeagueBar season={weekly?.season ?? null} week={week} onLeague={setLeague} />

      {/* ============ RELOJES ============================================
          Cada uno fecha LO SUYO. «Updated today» sobre cuatro cosas que se
          refrescan a ritmos distintos aplana justo el desacuerdo que importa. */}
      <section aria-label="Freshness" className="bk-plan">
        <h2 className="bk-h">As of <small>each row dates its own source</small></h2>
        <dl className="kv">
          <Clock label="Rankings" value={research?.clocks?.research_as_of ?? null} />
          <Clock label="Injury report" value={injuryClockLabel(research?.injury_report)} />
          <Clock label="Rosters" value={research?.clocks?.roster_as_of ?? null} />
          <Clock label="Kicker jobs" value={jobInstante} />
        </dl>
        {/* Un parte a medias no se puede leer como un parte. Sale SÓLO cuando
            falta algún club: un aviso que aparece siempre es decoración.
            Va en ámbar porque CONTRADICE lo que el lector asume al no ver
            ninguna designación, que es para lo único que sirve el ámbar. */}
        {avisoParte ? (
          <Callout title={coverageTitle(research?.injury_report)}>
            <p>{avisoParte}</p>
          </Callout>
        ) : null}
        {research?.snapshots?.length ? (
          <p className="caption">
            {research.snapshots.length} daily snapshot(s) kept for this week:{" "}
            {research.snapshots.join(", ")}. Nothing is overwritten, so what changed
            and when stays auditable.
          </p>
        ) : null}
      </section>

      {/* ============ 1. WAIVERS DE MI LIGA ============================== */}
      <section aria-label="Waivers in my league">
        <h2 className="bk-h">
          Best available in my league{" "}
          <small>add + drop, with your lineup before and after</small>
        </h2>

        {!league ? (
          <p className="note">
            Link a Sleeper league above to see who is <strong>actually</strong> available
            in it. Until then this section stays empty on purpose: a waiver list that
            ignores your league is a list of players you may not be able to add.
          </p>
        ) : !league.config?.roster ? (
          <p className="note">
            This league did not publish its roster slots, so there is no lineup to
            value and nothing is computed. Assuming &ldquo;12-team PPR&rdquo; is exactly
            what was withdrawn from this project.
          </p>
        ) : movimientos === null ? (
          <p className="note">No roster structure to evaluate against.</p>
        ) : (
          <>
            <p className="caption">
              {movimientos.evaluated} of {movimientos.poolSize} free agents evaluated
              {movimientos.emptyStarterSlots.length
                ? ` · empty starting slots: ${movimientos.emptyStarterSlots.join(", ")}`
                : " · every starting slot is filled"}
              {/* Y los que esta tabla NO puede llenar se dicen, con su sitio.
                  El pool del semanal es QB/RB/WR/TE; pateador y defensa van en
                  sus propias secciones, así que enumerarlos aquí y ofrecer doce
                  alas cerradas era prometer lo que esta tabla no da. */}
              {fueraDelPool.length
                ? ` · ${fueraDelPool.join(" and ")} cannot be filled from this pool —`
                  + " see the sections below"
                : ""}
              {movimientos.rosterFull === true ? " · roster is full, so every move cuts someone" : ""}
            </p>
            {!movimientos.anyImproves ? (
              <p className="callout">
                <strong>Nothing available improves your starting lineup this week.</strong>{" "}
                The rows below are still shown with what they actually add (zero), because
                hiding them would leave you wondering. Taking depth is your call.
              </p>
            ) : null}
            <div className="table-wrap">
              {/* TEXTO A LA IZQUIERDA, Y EN EL TELÉFONO, APILADA.
                  Cada fila es una frase —quién entra, por qué, a quién cortas,
                  cuánto añade— y con la alineación de las tablas de números se
                  leía en dos trozos: el nombre a la izquierda, su posición a
                  150 px, y el motivo pegado al borde derecho. La posición y el
                  equipo van DEBAJO del nombre, como en el resto de tablas, que
                  ahorra una columna; las de prosa se declaran `cell-text`; y
                  `rank-table--stack` las apila en pantallas estrechas con el
                  rótulo de cada dato delante (`data-label`). */}
              <table className="rank-table rank-table--stack">
                <thead>
                  <tr>
                    <th>Add</th>
                    <th className="cell-text">Why now</th>
                    {algunCorte ? <th className="cell-text">Drop</th> : null}
                    <th>Lineup</th><th>Adds</th>
                    {algunFaab ? <th className="cell-text">FAAB</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {movimientos.moves.map((m) => {
                    const [titulo, explica] = CATEGORIA[m.category] ?? [m.category, ""];
                    return (
                      <tr key={`${m.add.player_id}:${m.drop?.player_id ?? "none"}`}>
                        <td className="who">
                          <span className="nm">{m.add.player_name}</span>
                          <span className="meta">{m.add.position} · {m.add.team}</span>
                          <RowMarks row={m.add} />
                        </td>
                        <td className="cell-text cell-lead">
                          <b>{titulo}</b>
                          <small> — {explica}</small>
                          {m.reasons.length ? (
                            <ul className="caption">
                              {m.reasons.map((r) => <li key={r.code}>{r.text}</li>)}
                            </ul>
                          ) : null}
                        </td>
                        {algunCorte ? (
                          <td className="cell-text cell-text--narrow" data-label="Drop">
                            {m.drop
                              ? <>{m.drop.player_name}<small> {m.drop.position}</small></>
                              : <small>no cut needed</small>}
                          </td>
                        ) : null}
                        <td data-label="Lineup">{num(m.lineupBefore, 1)} &rarr; {num(m.lineupAfter, 1)}</td>
                        <td data-label="Adds"
                            className={`cell-key ${m.improves ? "wk-up" : "wk-down"}`}>
                          {m.net > 0 ? "+" : ""}{num(m.net, 1)}
                        </td>
                        {algunFaab ? (
                          <td className="cell-text cell-text--narrow" data-label="FAAB">
                            {m.faab.status === "NO_BUDGET_DECLARED"
                              ? <small>no budget declared</small>
                              : <>{m.faab.pct[0]}&ndash;{m.faab.pct[1]}%
                                  <small> of {m.faab.of} left ({m.faab.label})</small></>}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="caption">
              &ldquo;Adds&rdquo; is the difference between two lineups assigned by the same
              slot-filler the board and the Draft Assistant use — not a score.
              {/* Lo que era igual en TODAS las filas se dice una vez aquí. Una
                  columna con «no cut needed» cincuenta y ocho veces no informa:
                  es el aviso que sale en los 250 jugadores, en forma de columna. */}
              {!algunCorte ? " No move here requires a cut: your roster has room." : ""}
              {algunFaab
                ? <> FAAB is a declared <strong>convention</strong> over your remaining
                    budget, not a measured bid: this project has no validated FAAB
                    model.</>
                : " This league declares no FAAB budget, so no bid is suggested."}
            </p>
          </>
        )}
      </section>

      {/* ============ 2. DEFENSAS ======================================== */}
      <section aria-label="Defense">
        <h2 className="bk-h">
          Defense / DST <small>this week&rsquo;s context · {dstStream ?? "status unknown"}</small>
        </h2>
        <p className="callout">
          <strong>This is context, not a ranking.</strong>{" "}
          {dstStream === "DESIGN_ONLY"
            ? <>Streaming defenses is <code>DESIGN_ONLY</code> in the registry (E24): the
                opponent&rsquo;s implied total predicts points allowed at r&nbsp;0.388,
                which is enough to order this table and <em>not</em> enough to call a
                DST1&ndash;DST12 ranking validated.</>
            : <>The registry reports <code>{dstStream ?? "no declared status"}</code> for
                DST streaming, so no ordinal claim is made here.</>}
        </p>
        <div className="table-wrap">
          <table className="rank-table rank-table--stack">
            <thead>
              <tr>
                <th>Defense</th>
                <th className="cell-text">Opposing QB</th>
                <th>Opp. implied</th><th>Pts allowed</th><th>Sacks</th><th>TO</th>
                {league ? <th className="cell-text">In my league</th> : null}
              </tr>
            </thead>
            <tbody>
              {defenses.map((d) => {
                const own = league ? ownRow(d) : null;
                return (
                  <tr key={d.team}>
                    <td className="who">
                      <span className="nm">{d.team}</span>
                      <span className="meta">{d.is_home ? "vs " : "@ "}{d.opponent}</span>
                    </td>
                    <td className="cell-text cell-text--narrow" data-label="Opp. QB">
                      {d.opposing_qb ?? "UNKNOWN"}
                      {d.opposing_qb_designation
                        ? <small> · {d.opposing_qb_designation}</small>
                        : null}
                      {/* LA DISPUTA SE ENSEÑA. El club declara a uno y los snaps
                          de la última jornada los tomó otro: el payload publica
                          las dos cosas desde octubre y esta celda sólo pintaba
                          el nombre, o sea que el desacuerdo se calculaba y no
                          llegaba a la pantalla. */}
                      {d.opposing_qb_basis === "DISPUTED" ? (
                        <>
                          {" "}<span className="mark mark--risk">DISPUTED</span>
                          {d.opposing_qb_note ? <small> {d.opposing_qb_note}</small> : null}
                        </>
                      ) : null}
                      {d.opposing_qb_basis === "MODEL_PROJECTED_STARTER"
                        ? <small> (model&rsquo;s projected starter, not a club statement)</small>
                        : null}
                    </td>
                    <td data-label="Opp. implied" className="cell-key">{num(d.opponent_implied) ?? "—"}</td>
                    <td data-label="Pts allowed">{num(d.points_allowed_recent) ?? "—"}</td>
                    <td data-label="Sacks">{num(d.sacks_recent) ?? "—"}</td>
                    <td data-label="Takeaways">{num(d.takeaways_recent) ?? "—"}</td>
                    {league ? (
                      <td className="cell-text" data-label="My league">{own?.status === "MINE" ? "MINE"
                        : own?.status === "FREE_AGENT" ? "FREE"
                        : own?.label ?? "—"}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Ordered by the opponent&rsquo;s implied total, ascending — the only measured
          signal in this block. Recent numbers cover{" "}
          {num(defenses[0]?.recent_games) ?? "the listed"} game(s), which is a small
          sample this early and is shown so you can judge it.
        </p>
      </section>

      {/* ============ 3. PATEADORES ===================================== */}
      <section aria-label="Kickers">
        <h2 className="bk-h">
          Kickers <small>job first, then the number</small>
        </h2>
        <p className="callout">
          <strong>Does he actually have the job?</strong> That question comes before any
          ranking, and it is the one this project got wrong three times. Verified against
          the clubs&rsquo; own depth chart, snapshot{" "}
          <code>{jobInstante ?? "UNKNOWN"}</code>.{" "}
          {kProj === "VALIDATED"
            ? <>Per-kicker expected points is <code>VALIDATED</code> (E8).</>
            : <>Kicker projection status: <code>{kProj ?? "unknown"}</code>.</>}{" "}
          {kOrdinal === "REJECTED"
            ? <>The <em>order</em> is not: <code>KICKER_ORDINAL_RANKING</code> is{" "}
                <code>REJECTED</code> (E8b) — K1 through K6 beat K7 through K12 by 0.26
                points per game with the interval crossing zero. Read this as a list of
                jobs and matchups, not as K1 &gt; K2.</>
            : <>Ordinal ranking status: <code>{kOrdinal ?? "unknown"}</code>.</>}
        </p>
        <div className="table-wrap">
          <table className="rank-table rank-table--stack">
            <thead>
              <tr>
                <th>Kicker</th>
                <th className="cell-text">Job</th>
                <th>Exp. pts</th>
                {league ? <th className="cell-text">In my league</th> : null}
              </tr>
            </thead>
            <tbody>
              {kickers.map((k) => {
                const own = league ? ownRow(k) : null;
                const tieneElPuesto = k.job_status === "HAS_JOB";
                return (
                  <tr key={k.player_id}>
                    <td className="who">
                      <span className="nm">{k.player_full_name ?? k.player_name}</span>
                      <span className="meta">{k.team} · {k.is_home ? "vs " : "@ "}{k.opponent}</span>
                      <RowMarks row={k} />
                    </td>
                    <td className="cell-text" data-label="Job">
                      {/* Sólo se marca lo ANORMAL. Tener el puesto es el caso de
                          27 de los 32, y una marca que sale siempre no informa. */}
                      {tieneElPuesto ? (
                        k.job_contested ? (
                          <>
                            <span className="mark mark--risk">CONTESTED</span>
                            <small> · {k.team} also lists {k.job_competition?.join(", ")}</small>
                          </>
                        ) : <small>listed first</small>
                      ) : k.job_status === "NOT_THE_JOB" ? (
                        <>
                          <span className="mark mark--out">NOT THE KICKER</span>
                          <small> · {k.team} lists {k.job_holder}</small>
                        </>
                      ) : (
                        <small>UNKNOWN — no depth chart for this team</small>
                      )}
                    </td>
                    <td data-label="Exp. pts" className="cell-key">{num(k.projected_points) ?? "—"}</td>
                    {league ? (
                      <td className="cell-text" data-label="My league">{own?.status === "MINE" ? "MINE"
                        : own?.status === "FREE_AGENT" ? "FREE"
                        : own?.label ?? "—"}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          A row marked <strong>NOT THE KICKER</strong> is not a weak recommendation — it
          is not a recommendation. The name beside it is who the club actually lists.
        </p>
      </section>
    </>
  );
}
