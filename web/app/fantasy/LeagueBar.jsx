"use client";

/**
 * LA BARRA DE LIGA: una cuenta, una liga activa, en todas las pantallas.
 *
 *     ELIGES UNA VEZ Y EL RESTO DEL PRODUCTO TE SIGUE.
 *
 * Antes cada pantalla se las arreglaba sola: el semanal tenía su selector y su
 * clave, el analizador habría tenido los suyos, y enlazar la cuenta sólo se
 * podía hacer en Leagues — así que descubrir el ranking semanal por liga
 * pasaba por irse a otra página, teclear el usuario y volver. Es el mismo fallo
 * que ya costó una iteración con el estado del draft: dos superficies hablando
 * de lo mismo con su propia copia, las dos con razón, y nadie sabe cuál mira el
 * que lee.
 *
 * Aquí hay una sola: `loadActiveLeagueId` / `saveActiveLeagueId`.
 *
 * Enlazar es de sólo lectura y sin contraseña: la API de Sleeper es pública y
 * lo único que sale del navegador es el nombre de usuario, que ya está en la
 * URL de tu perfil. La barra lo repite donde se teclea, porque «linkear la
 * cuenta» suena a iniciar sesión y no lo es.
 */

import { useCallback, useEffect, useState } from "react";

import { browserStorage } from "./draftStorage.js";
import { agoLabel } from "./draftSync.js";
import { linkSleeperAccount } from "./linkAccount.js";
import {
  ROSTER_STALE_MS, loadAccount, loadActiveLeagueId, saveActiveLeagueId,
} from "./sleeperAccount.js";

/**
 * @param onLeague se llama con `(league, account)` cada vez que cambia la liga
 *   activa, incluida la primera carga. `league` es la instantánea guardada.
 * @param id identificador del `<select>`, para que cada pantalla conserve el
 *   suyo y los laboratorios sigan apuntando donde apuntaban.
 */
export default function LeagueBar({ season, week = null, id = "lg-league", onLeague }) {
  const [account, setAccount] = useState(null);
  const [leagueId, setLeagueId] = useState("");
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // La cuenta se lee después de montar: en el servidor no hay `localStorage`, y
  // leerlo a pelo en un efecto ya tumbó cinco pantallas una vez (el getter
  // LANZA cuando el navegador bloquea el almacenamiento). Por eso va por
  // `browserStorage()`, que devuelve `null` en vez de reventar.
  useEffect(() => {
    const storage = browserStorage();
    const saved = loadAccount(storage);
    setAccount(saved);
    const wanted = loadActiveLeagueId(storage);
    const leagues = saved?.leagues ?? [];
    const chosen = leagues.find((l) => l.leagueId === wanted) ?? leagues[0] ?? null;
    setLeagueId(chosen?.leagueId ?? "");
    setUsername(saved?.username ?? "");
    setReady(true);
    onLeague?.(chosen, saved);
    // Sólo al montar: después manda lo que elija la persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = useCallback((next) => {
    setLeagueId(next);
    saveActiveLeagueId(browserStorage(), next);
    const league = (account?.leagues ?? []).find((l) => l.leagueId === next) ?? null;
    onLeague?.(league, account);
  }, [account, onLeague]);

  const link = useCallback(async (event) => {
    event?.preventDefault?.();
    setBusy(true);
    setError("");
    try {
      const storage = browserStorage();
      const next = await linkSleeperAccount({ username, season, week, storage });
      setAccount(next);
      setUsername(next.username);
      const first = next.leagues?.[0] ?? null;
      const keep = loadActiveLeagueId(storage);
      const chosen = next.leagues?.find((l) => l.leagueId === keep) ?? first;
      setLeagueId(chosen?.leagueId ?? "");
      if (chosen?.leagueId) saveActiveLeagueId(storage, chosen.leagueId);
      onLeague?.(chosen, next);
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [username, season, week, onLeague]);

  if (!ready) return <p className="caption">Loading…</p>;

  if (!account?.leagues?.length) {
    return (
      <form className="lg-bar lg-bar--link" onSubmit={link}>
        <label htmlFor={`${id}-user`}>
          Sleeper username
          <input id={`${id}-user`} type="text" autoComplete="off" value={username}
                 placeholder="your Sleeper username"
                 onChange={(e) => setUsername(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !username.trim()}>
          {busy ? "Reading…" : "Link account"}
        </button>
        <span className="caption">
          Read-only and public: no password, no login. Only the username leaves this
          browser, and it is already in your Sleeper profile URL.
        </span>
        {error ? <p className="caption sleeper-error">{error}</p> : null}
      </form>
    );
  }

  const stale = Date.now() - Number(account.retrievedAt ?? 0) > ROSTER_STALE_MS;
  return (
    <div className="lg-bar">
      <label htmlFor={id}>
        League
        <select id={id} value={leagueId} onChange={(e) => pick(e.target.value)}>
          {account.leagues.map((l) => (
            <option key={l.leagueId} value={l.leagueId}>{l.name ?? l.leagueId}</option>
          ))}
        </select>
      </label>
      <span className="caption">
        {account.username} · {account.leagues.length} league
        {account.leagues.length === 1 ? "" : "s"} ·{" "}
        {/* La frescura es de PLANTILLA, no de draft: se dice cuánto hace y, si
            pasó la ventana, que está vieja. Esta barra nunca escribe LIVE —
            nada de ella se está sincronizando. */}
        <span className={stale ? "lg-stale" : undefined}>
          {stale ? "STALE · " : ""}synced {agoLabel(account.retrievedAt)}
        </span>
        {" · "}
        <button type="button" className="lg-refresh" onClick={link} disabled={busy}>
          {busy ? "Reading…" : "Refresh"}
        </button>
        {" · "}
        <a href="/fantasy/leagues">All leagues</a>
      </span>
      {error ? <p className="caption sleeper-error">{error}</p> : null}
    </div>
  );
}
