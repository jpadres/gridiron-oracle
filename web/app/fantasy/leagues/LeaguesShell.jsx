"use client";

/**
 * El centro de mando: la cuenta de Sleeper, la cola de hechos y el catálogo.
 *
 * ## Lo que es y lo que no
 *
 * Responde «¿dónde está pasando algo?» con HECHOS: estás en el reloj, faltan
 * dos picks, hay huecos titulares abiertos en un draft vivo, una estructura
 * está sin configurar, ya tienes defensa en esta liga y en aquélla no. No
 * responde «¿a quién ficho?» ni «¿qué liga va mal?» — eso serían
 * recomendaciones, y ninguna está validada.
 *
 * ## La cuenta enlazada
 *
 * Con el nombre de usuario de Sleeper se leen TODAS las ligas de la temporada
 * de una vez: configuración real, mi plantilla, quién es cada uno, el estado
 * del draft — y los mocks del usuario, que son la forma de probar el asistente
 * en vivo. Cada liga entra en el catálogo con la misma forma que escribe la
 * antesala del Draft Room, así que «Open draft» funciona igual que siempre.
 *
 * No es iniciar sesión: la API es pública y de sólo lectura. Nada sale del
 * navegador salvo el nombre de usuario, y lo único que se guarda es ese
 * nombre y una instantánea de IDENTIFICADORES con su hora de descarga.
 *
 * ## Frescura
 *
 * La instantánea envejece: dice «synced X ago», pasa a STALE a las seis horas
 * (`ROSTER_STALE_MS`, la ventana de una plantilla) y nunca dice LIVE. Un
 * draft en curso se sigue en el Draft Room, que es el que sondea.
 *
 * ## Composición
 *
 * Una cola compacta arriba (sólo lo operativo), los paneles de la cuenta, y
 * debajo las ligas del catálogo que no vienen de la cuenta (manuales y viejas),
 * en filas y no en tarjetas: con veinte ligas un muro de tarjetas no se
 * escanea. Cuando no hay nada operativo, se dice «nothing needs your eyes».
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { num } from "../../../data/model.js";
import { TeamMark } from "../../sports.jsx";
import { Headshot } from "../../headshot.jsx";
import {
  attentionItems, labelFor, leagueSnapshot, sortAttention, sortLeagues,
} from "../attention.js";
import { ROOM_LEAGUE_KEY, browserStorage, knownLeagues, saveLeagueToCatalog, scopeFor } from "../draftStorage.js";
import { agoLabel } from "../draftSync.js";
import {
  activeBoardFrom, assignSlots, leagueBoardFrom, rosterContext, setComponentOrder,
} from "../leagueValue.js";
import { providerLabel } from "../providers.js";
import { compilePoints, rulesFromSleeper } from "../scoring.js";
import {
  DRAFT_STATUS_LABEL, accountFreshness, buildIndex, clearAccount, leagueConfigFrom,
  leagueSnapshotFrom, loadAccount, mockDrafts, rosterView, saveAccount,
} from "../sleeperAccount.js";
import { readSleeperAccount } from "../useSleeperDraft.js";
import { dedicatedStarters, depthByTeam, matchupView, weeklyIndex } from "../leagueWeek.js";

const FANTASY = ["QB", "RB", "WR", "TE"];

function storageOrNull() {
  return browserStorage();
}

/** Abrir una liga = hacerla la ACTIVA del Draft Room y navegar. */
function openInRoom(config) {
  if (!config) return;
  try {
    browserStorage()?.setItem(ROOM_LEAGUE_KEY, JSON.stringify(config));
  } catch { /* modo privado: se navega igual y la antesala preguntará */ }
  window.location.href = "/fantasy/draft";
}

export default function LeaguesShell({ board, context }) {
  const [entries, setEntries] = useState(null);
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const storage = storageOrNull();
    setEntries(knownLeagues(storage));
    const saved = loadAccount(storage);
    if (saved) {
      setAccount(saved);
      setUsername(saved.username ?? "");
    }
  }, []);

  // La etiqueta «synced X ago» envejece sola; sin esto se congela en el
  // valor del primer render y a las tres horas sigue diciendo «2 min ago».
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  /* EL POOL COMPLETO: board, especialistas y novatos sin previa. Una defensa
     fichada es una fila del pool con su equipo, no un nombre suelto. */
  const pool = useMemo(() => {
    const s = context.specialists;
    return [...board, ...(s?.kickers ?? []), ...(s?.defenses ?? []), ...(context.rookies ?? [])];
  }, [board, context.specialists, context.rookies]);
  const index = useMemo(() => buildIndex(pool, context.sleeperIds), [pool, context.sleeperIds]);
  // El ranking SEMANAL publicado, por sleeper_id: es lo que pone puntos a una
  // alineación y a la profundidad de cada equipo. Sin semanal, no hay números.
  const weekly = useMemo(() => weeklyIndex(context.weekly, context.weeklyKickers), [context.weekly, context.weeklyKickers]);

  /**
   * Enlazar (o refrescar): UNA lectura de la cuenta entera. Cada liga entra en
   * el catálogo con su configuración real, y la instantánea guarda
   * identificadores y hechos con su hora de descarga.
   */
  const link = useCallback(async (name) => {
    const wanted = String(name ?? "").trim();
    if (!wanted) return;
    setLinking(true);
    setLinkError("");
    try {
      const read = await readSleeperAccount({
        username: wanted, season: context.season, week: context.week ?? null,
      });
      const storage = storageOrNull();
      const leagues = read.leagues.map(({ league, draft, rosters, users, matchups }) => {
        const snap = leagueSnapshotFrom({
          league, draft, rosters, users, userId: read.user.userId, season: context.season,
          matchups, week: context.week ?? null,
        });
        if (snap.config?.leagueId && snap.config?.draftId) saveLeagueToCatalog(snap.config, storage);
        return snap;
      });
      // Un mock es un draft SIN liga. Y por si un proveedor publicara el draft
      // de una liga sin su `league_id`, lo que ya es el draft de una liga de la
      // cuenta no puede ser además un mock: dos entradas para el mismo draft
      // serían dos contextos con un nombre.
      const leagueDraftIds = new Set(leagues.map((l) => l.draftId).filter(Boolean));
      const mocks = mockDrafts(read.drafts, context.season)
        .filter((draft) => !leagueDraftIds.has(String(draft.draft_id)))
        .map((draft) => ({
        draftId: String(draft.draft_id),
        status: draft.status ?? null,
        created: Number(draft.created) || null,
        config: leagueConfigFrom({ draft, userId: read.user.userId, season: context.season }),
      }));
      const next = {
        username: read.user.username,
        displayName: read.user.displayName,
        userId: read.user.userId,
        season: context.season,
        retrievedAt: read.retrievedAt,
        leagues,
        mocks,
      };
      saveAccount(next, storage);
      setAccount(next);
      setUsername(next.username);
      setEntries(knownLeagues(storage));
    } catch (error) {
      setLinkError(String(error?.message ?? error));
    } finally {
      setLinking(false);
    }
  }, [context.season]);

  const unlink = useCallback(() => {
    clearAccount(storageOrNull());
    setAccount(null);
    setLinkError("");
  }, []);

  const snapshots = useMemo(() => {
    if (!entries) return [];
    const storage = storageOrNull();
    return sortLeagues(entries.map((entry) =>
      leagueSnapshot(entry, { storage, board, byes: context.byes })));
  }, [entries, board, context.byes]);

  const queue = useMemo(
    () => sortAttention(snapshots.flatMap((snapshot) => attentionItems(snapshot))),
    [snapshots]
  );
  const byScope = useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.scope, snapshot])),
    [snapshots]
  );

  /**
   * Los paneles de la cuenta, resueltos AHORA contra el payload vigente: la
   * plantilla por id y el VOR recompilado en la puntuación y estructura de cada
   * liga por el mismo compilador que usa el Draft Room. Si no se puede
   * compilar, se enseña el VOR publicado y se DICE.
   */
  const panels = useMemo(() => {
    if (!account?.leagues) return [];
    if (context.componentOrder) setComponentOrder(context.componentOrder);
    return account.leagues.map((snap) => {
      const config = snap.config ?? null;
      const view = rosterView({ roster: snap.players ? { players: snap.players, starters: snap.starters } : null, index });
      let leagueRows = null;
      let valueLabel = "published board · 12-team PPR";
      if (config?.scoringSettings && config?.roster && config?.teams) {
        const parsed = rulesFromSleeper(config.scoringSettings);
        const roster = rosterContext(config.roster, config.teams);
        const built = parsed.supported
          ? leagueBoardFrom({ board, context, rules: parsed.rules, roster, compilePoints })
          : null;
        if (built) {
          leagueRows = new Map(activeBoardFrom(built, []).map((row) => [String(row.player_id), row]));
          valueLabel = `${config.teams}-team · ${config.scoringLabel ?? "custom scoring"}`;
        }
      }
      const players = view.players.map((row) => {
        const mine = leagueRows?.get(String(row.player_id));
        return { ...row, league_vor: mine?.vor ?? null, value_known: mine ? mine.value_known : null };
      });
      let openStarters = null;
      if (Array.isArray(config?.roster) && config.roster.length > 0 && snap.players) {
        const { slots } = assignSlots(players, config.roster);
        openStarters = slots.filter((slot) => !slot.player).length;
      }
      const scope = config ? scopeFor({
        platform: "sleeper", season: config.season, leagueId: config.leagueId, draftId: config.draftId,
      }) : null;
      const matchup = weekly.size ? matchupView({ snapshot: snap, index: weekly }) : null;
      const depth = weekly.size && snap.teams?.length
        ? depthByTeam({ snapshot: snap, index: weekly, starters: dedicatedStarters(config?.roster) })
        : null;
      return { snap, config, view, players, openStarters, valueLabel, scope, matchup, depth };
    });
  }, [account, board, context, index, weekly]);

  const covered = useMemo(() => new Set(panels.map((p) => p.scope).filter(Boolean)), [panels]);
  const rest = useMemo(() => snapshots.filter((s) => !covered.has(s.scope)), [snapshots, covered]);

  // `tick` entra en la dependencia para que la etiqueta envejezca aunque no
  // haya llegado ningún dato nuevo: es el reloj de pantalla, no un dato. Y va
  // ANTES del retorno temprano: un hook después de un `return` condicional
  // cambia el número de hooks entre renders y React tumba la página entera.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const freshness = useMemo(() => accountFreshness(account?.retrievedAt), [account, tick]);
  const stale = freshness === "STALE";

  if (entries === null) return <p className="caption">Reading your leagues&hellip;</p>;

  return (
    <div className="cc">
      <p className="eyebrow">{context.season} season</p>
      <h1>Leagues</h1>

      {/* --- LA CUENTA ------------------------------------------------------ */}
      <section className="cc-account" aria-label="Sleeper account">
        {account ? (
          <div className="cc-account-line">
            <span>
              <b>{account.displayName || account.username}</b>
              <small> · Sleeper · {account.leagues.length} {account.leagues.length === 1 ? "league" : "leagues"}
                {account.mocks?.length ? ` · ${account.mocks.length} mock ${account.mocks.length === 1 ? "draft" : "drafts"}` : ""}
              </small>
            </span>
            <span className={`cc-sync cc-sync--${freshness.toLowerCase()}`}>
              {freshness === "STALE" ? "STALE · " : ""}synced {agoLabel(account.retrievedAt)}
            </span>
            <button type="button" className="cc-item-go" disabled={linking}
                    onClick={() => link(account.username)}>
              {linking ? "Reading…" : "Refresh"}
            </button>
            <button type="button" className="link" onClick={unlink}>unlink</button>
          </div>
        ) : (
          <form
            className="cc-link"
            onSubmit={(event) => { event.preventDefault(); link(username); }}
          >
            <label className="field-label" htmlFor="cc-user">
              Link your Sleeper account — every league you are in, in one place
              <span className="field-row">
                <input id="cc-user" type="text" autoComplete="off" placeholder="your Sleeper username"
                       value={username} onChange={(event) => setUsername(event.target.value)} />
                <button type="submit" className="pick pick--mine" disabled={linking || !username.trim()}>
                  {linking ? "Reading…" : "Link"}
                </button>
              </span>
            </label>
            <p className="caption">
              Not a login. The Sleeper API is public and read-only: no password, no key,
              nothing leaves this browser except the username. Rosters, scoring and draft
              state are read once and kept here with the time they were read.
            </p>
          </form>
        )}
        {linkError ? (
          <p className="caption sleeper-error">Could not read that account: {linkError}</p>
        ) : null}
        {account && stale ? (
          <p className="caption">
            This snapshot is more than six hours old. Rosters change with waivers — refresh
            before acting on it.
          </p>
        ) : null}
      </section>

      {entries.length === 0 && !account ? (
        /* Sin ligas no hay página rota: están los tres caminos que existen. */
        <div className="cc-empty">
          <p className="lede">No leagues yet.</p>
          <p>
            Link your Sleeper account above, set up a manual league in the{" "}
            <a href="/fantasy/draft">Draft Assistant</a> — it works for drafts on any
            platform — or connect a Sleeper league from the <a href="/fantasy">Draft Board</a>.
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
                            onClick={() => openInRoom(byScope.get(item.scope).config)}>
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

          {/* --- LOS MOCKS: la prueba del asistente en vivo ---------------- */}
          {account?.mocks?.length ? (
            <section className="cc-mocks" aria-label="Mock drafts">
              <h2>Mock drafts</h2>
              <p className="caption">
                Your Sleeper mock drafts this season. Follow one in the Draft Assistant to see
                picks land as they happen — the same sync a real draft uses.
              </p>
              <ol className="cc-list">
                {account.mocks.map((mock) => (
                  <li key={mock.draftId} className="cc-league">
                    <span className="cc-league-who">
                      <span className="nm">{mock.config?.name || `Mock draft ${mock.draftId}`}</span>
                      <span className="meta">
                        <span>{mock.config?.teams ?? "UNKNOWN"}-team</span>
                        <span>{mock.config?.scoringLabel ?? "UNKNOWN scoring"}</span>
                        <span>{mock.config?.rounds ?? "UNKNOWN"} rounds</span>
                        <span>{mock.config?.mySlot ? `slot ${mock.config.mySlot}` : "slot UNKNOWN"}</span>
                      </span>
                    </span>
                    <span className="cc-league-state">
                      <b>{DRAFT_STATUS_LABEL[mock.status] ?? (mock.status ?? "UNKNOWN")}</b>
                      <small>draft {mock.draftId}</small>
                    </span>
                    <span className="cc-league-act">
                      {mock.config ? (
                        <button type="button" onClick={() => {
                          saveLeagueToCatalog(mock.config, storageOrNull());
                          openInRoom(mock.config);
                        }}>
                          Follow in the assistant
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* --- LOS PANELES DE LA CUENTA ---------------------------------- */}
          {panels.length > 0 ? (
            <section className="cc-panels" aria-label="Your Sleeper leagues">
              <h2>Your leagues</h2>
              {panels.map((panel) => (
                <LeaguePanel key={panel.scope ?? panel.snap.leagueId} panel={panel}
                             live={byScope.get(panel.scope) ?? null} byes={context.byes}
                             week={context.week ?? null} />
              ))}
            </section>
          ) : null}

          {/* --- EL CATÁLOGO: lo que no viene de la cuenta ----------------- */}
          {rest.length > 0 ? (
            <>
              {panels.length > 0 ? <h2>Other leagues</h2> : null}
              <ol className="cc-list" aria-label="All leagues">
                {rest.map((snapshot) => (
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
                      <DraftState snapshot={snapshot} />
                    </span>

                    <span className="cc-league-act">
                      {!snapshot.config ? null : snapshot.complete === true && snapshot.count > 0 ? (
                        <button type="button" onClick={() => openInRoom(snapshot.config)}>Review draft</button>
                      ) : (
                        <button type="button" onClick={() => openInRoom(snapshot.config)}>Open draft</button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          <p className="caption cc-note">
            Everything here is recorded state: your picks, your configuration, the published
            schedule, and what Sleeper said when it was last read. Nothing is recommended — an
            open slot is a fact, not advice. Opening a league makes it the active one in the
            Draft Assistant.
          </p>
        </>
      )}
    </div>
  );
}

/** El estado del draft de una liga del catálogo, en lenguaje de hechos. */
function DraftState({ snapshot }) {
  return (
    <>
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
    </>
  );
}

/**
 * Un panel por liga de la cuenta: la configuración REAL, mi plantilla resuelta
 * por id con el VOR de ESTA liga, y los hechos que se preguntan en un draft:
 * ¿ya tengo defensa? ¿pateador? ¿cuántos huecos titulares quedan?
 */
function LeaguePanel({ panel, live, byes, week }) {
  const { snap, config, view, players, openStarters, valueLabel, matchup, depth } = panel;
  const status = config?.status ?? null;
  const byPosition = FANTASY.map((position) => ({
    position, rows: players.filter((row) => row.position === position),
  }));
  const specialists = players.filter((row) => !FANTASY.includes(row.position));
  const rosterKnown = Array.isArray(snap.players);

  return (
    <article className="cc-panel">
      <header className="cc-panel-head">
        <div>
          <h3>{snap.name || `League ${snap.leagueId}`}</h3>
          <p className="meta">
            <span>{config?.teams ?? "UNKNOWN"}-team</span>
            <span>{config?.scoringLabel ?? "UNKNOWN scoring"}</span>
            {config?.roster ? (
              <span>{config.roster.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI").length} starters</span>
            ) : <span>roster UNKNOWN</span>}
            <span>{config?.mySlot ? `slot ${config.mySlot}` : "slot UNKNOWN"}</span>
            {snap.record ? (
              <span>{snap.record.wins}-{snap.record.losses}{snap.record.ties ? `-${snap.record.ties}` : ""}</span>
            ) : null}
          </p>
        </div>
        <div className="cc-panel-state">
          {/* El estado del draft tiene DOS fuentes y sólo se enseña una: el
              registro local si tiene picks (el draft que se está siguiendo o se
              siguió aquí), y si no, lo que dijo Sleeper. Pintar las dos daba
              «No picks yet» al lado de «5 rostered» para la misma liga. */}
          {live && live.count > 0 ? <DraftState snapshot={live} /> : (
            <b>{DRAFT_STATUS_LABEL[status] ?? (status ? `Draft: ${status}` : "Draft status UNKNOWN")}</b>
          )}
        </div>
        <div className="cc-league-act">
          {config?.leagueId && config?.draftId ? (
            <button type="button" onClick={() => openInRoom(config)}>
              {status === "complete" ? "Review draft" : "Open draft"}
            </button>
          ) : null}
        </div>
      </header>

      {/* HECHOS de plantilla. «Ya cogiste defensa» se contesta con lo que hay. */}
      <ul className="cc-facts" aria-label="Roster facts">
        {rosterKnown ? (
          <>
            <li><b>{view.total}</b> rostered</li>
            {FANTASY.map((position) => (
              <li key={position}><b>{view.counts[position] ?? 0}</b> {position}</li>
            ))}
            <li className={view.hasKicker ? "cc-fact--yes" : "cc-fact--no"}>
              K {view.hasKicker ? "taken" : "not yet"}
            </li>
            <li className={view.hasDefense ? "cc-fact--yes" : "cc-fact--no"}>
              DEF {view.hasDefense ? "taken" : "not yet"}
            </li>
            {openStarters !== null ? (
              <li>{openStarters === 0 ? "starters complete" : `${openStarters} starter ${openStarters === 1 ? "slot" : "slots"} open`}</li>
            ) : null}
            {view.unmapped.length ? (
              <li className="cc-fact--warn" title={view.unmapped.join(", ")}>
                {view.unmapped.length} not in the identity map
              </li>
            ) : null}
          </>
        ) : (
          <li>roster UNKNOWN — Sleeper did not return it</li>
        )}
      </ul>

      {rosterKnown && players.length > 0 ? (
        <div className="cc-roster">
          <p className="caption">Value: {valueLabel}. Starters as set in Sleeper.</p>
          {byPosition.filter((group) => group.rows.length > 0).map((group) => (
            <ol key={group.position} className="cc-roster-group" aria-label={group.position}>
              {group.rows.map((row) => (
                <li key={row.player_id} className={`cc-player${row.starter ? " cc-player--starter" : ""}`}>
                  <span className={`ptag ptag--${row.position.toLowerCase()}`}>{row.position}</span>
                  <span className="cc-player-who hs-who">
                    <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={32} />
                    <span className="nm">{row.player_full_name ?? row.player_name}</span>
                    <span className="meta">
                      <TeamMark abbr={row.team} />
                      {byes?.[row.team] ? <span>bye {byes[row.team]}</span> : null}
                      {row.starter ? <span>starter</span> : <span>bench</span>}
                      {row.status_severity === "OUT" ? (
                        <span className="mark--out" title={row.status_detail}>{row.status_label}</span>
                      ) : row.status_severity === "RISK" ? (
                        <span className="mark--risk" title={row.status_detail}>{row.status_label}</span>
                      ) : null}
                      {row.rostered === false && row.status_severity !== "OUT" ? (
                        <span className="mark--risk">FREE AGENT</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="cc-player-vor">
                    {row.league_vor != null ? num(row.league_vor, 1)
                      : row.vor != null ? num(row.vor, 1) : "—"}
                    <small>VOR</small>
                  </span>
                </li>
              ))}
            </ol>
          ))}
          {specialists.length > 0 ? (
            <ol className="cc-roster-group" aria-label="K and DEF">
              {specialists.map((row) => (
                <li key={row.player_id} className={`cc-player${row.starter ? " cc-player--starter" : ""}`}>
                  <span className={`ptag ptag--${String(row.position).toLowerCase()}`}>{row.position}</span>
                  <span className="cc-player-who hs-who">
                    <Headshot sid={row.sid} team={row.team} position={row.position} name={row.player_full_name ?? row.player_name} size={32} />
                    <span className="nm">{row.player_full_name ?? row.player_name}</span>
                    <span className="meta">
                      <TeamMark abbr={row.team} />
                      {byes?.[row.team] ? <span>bye {byes[row.team]}</span> : null}
                    </span>
                  </span>
                  <span className="cc-player-vor">—<small>no value</small></span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : rosterKnown ? (
        <p className="caption">No players on this roster yet.</p>
      ) : null}

      {/* EL ENFRENTAMIENTO DE LA SEMANA. Titulares tal y como están alineados
          en Sleeper, con la proyección semanal publicada de cada uno. Lo que
          no tiene proyección (defensa, hueco vacío, id desconocido) se dice
          y no cuenta como cero. Es una comparación de proyecciones, no un
          pronóstico del partido: nadie ha validado la suma de titulares. */}
      {matchup ? (
        <div className="cc-matchup">
          <h4>
            Week {matchup.week ?? week ?? "?"} · vs {matchup.rivalName}
            {matchup.rivalRecord ? ` (${matchup.rivalRecord.wins}-${matchup.rivalRecord.losses}${matchup.rivalRecord.ties ? `-${matchup.rivalRecord.ties}` : ""})` : ""}
          </h4>
          <div className="cc-matchup-grid">
            <Lineup title="Your starters" lineup={matchup.mine} />
            <Lineup title={`${matchup.rivalName}'s starters`} lineup={matchup.rival} />
          </div>
          <p className="caption">
            Projected points are the published weekly projection per starter, summed.
            Starters without a projection (defenses, empty slots, unmapped ids) are
            counted, not scored. A sum of projections is not a validated game forecast.
          </p>
        </div>
      ) : snap.matchup === null && week ? (
        <p className="caption">No matchup for week {week} in this league (bye, or Sleeper has not published it).</p>
      ) : null}

      {/* PROFUNDIDAD POR EQUIPO. Hechos para pensar un trade: cuántos tiene
          cada uno en cada posición y cuánto proyectan sus mejores N esta
          semana. Dónde sobra y dónde falta se lee; «ofrécele X» no se dice. */}
      {depth ? (
        <details className="cc-depth-wrap">
          <summary>League depth by position · who is deep, who is thin</summary>
          <div className="table-wrap">
            <table className="cc-depth">
              <thead>
                <tr>
                  <th>Team</th>
                  {FANTASY.map((p) => <th key={p}>{p} <small>top {depth[0]?.positions[p]?.starters ?? 1}</small></th>)}
                  <th>Rostered</th>
                </tr>
              </thead>
              <tbody>
                {depth.map((team) => (
                  <tr key={team.rosterId} className={team.mine ? "is-mine" : undefined}>
                    <td>{team.owner ?? `roster ${team.rosterId}`}{team.mine ? " (you)" : ""}
                      {team.record ? <small> {team.record.wins}-{team.record.losses}</small> : null}</td>
                    {FANTASY.map((p) => (
                      <td key={p}>{num(team.positions[p].top, 1)} <small>×{team.positions[p].count}</small></td>
                    ))}
                    <td>{team.size}{team.unknown ? <small> · {team.unknown} no proj</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            Points are this week&rsquo;s projected total of each team&rsquo;s best N at the
            position (N = the league&rsquo;s dedicated starters); ×n is how many they roster.
            Defenses and players without a weekly projection are in &ldquo;no proj&rdquo;.
          </p>
        </details>
      ) : null}
    </article>
  );
}

/** Una alineación con su suma y lo que no se pudo proyectar. */
function Lineup({ title, lineup }) {
  return (
    <div>
      <p className="cc-lineup-total">
        {num(lineup.projected, 1)}
        <small>{title} · {lineup.count} starters{lineup.unknown ? ` · ${lineup.unknown} no proj` : ""}</small>
      </p>
      <ol className="cc-lineup">
        {lineup.rows.map((entry, i) => (
          <li key={`${entry.sid ?? "empty"}-${i}`} className={entry.points == null ? "is-unknown" : undefined}>
            <span className={`ptag ptag--${String(entry.row?.position ?? (entry.empty ? "bn" : "def")).toLowerCase()}`}>
              {entry.row?.position ?? (entry.empty ? "—" : "?")}
            </span>
            <span>{entry.row?.player_full_name ?? entry.row?.player_name ?? (entry.empty ? "empty slot" : `id ${entry.sid}`)}</span>
            <span>{entry.points != null ? num(entry.points, 1) : "no proj"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
