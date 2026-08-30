/**
 * FASES 3-4 — drafts sintéticos completos contra el motor REAL.
 *
 * No inyecta estado: construye eventos con `takeEvent`/`undoEvent` y lee el
 * estado con `fold`, que es exactamente lo que hace el producto. Si el motor
 * pierde un pick, lo duplica o desincroniza el recuento, sale aquí.
 */
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import {
  ROSTER, SOURCE, fold, isMyTurn, slotForOverall, takeEvent, undoEvent, untilMyTurn,
} from "../../app/fantasy/draftLog.js";
import { POLICIES, POLICY_NAMES, rng } from "./bots.mjs";

export function loadBoard() {
  const raw = readFileSync(new URL("../../data/model.b64.js", import.meta.url), "utf8");
  const b64 = raw.match(/"([A-Za-z0-9+/=]{100,})"/)[1];
  const payload = JSON.parse(zlib.gunzipSync(Buffer.from(b64, "base64")).toString());
  return payload.fantasy.board;
}

/**
 * Un draft completo. Devuelve el registro, el estado plegado y las violaciones
 * de invariante encontradas por el camino.
 */
export function simulate({ board, teams, rounds, type, mySlot, seed, undoRate = 0 }) {
  const rand = rng(seed);
  const policies = Array.from({ length: teams }, (_, i) =>
    POLICY_NAMES[(seed + i) % POLICY_NAMES.length]);
  const needs = { QB: 1, RB: 2, WR: 2, TE: 1 };
  const rosters = Array.from({ length: teams }, () => []);
  const recent = [];
  const events = [];
  const problemas = [];
  const vistos = new Set();
  let reloj = 1_800_000_000_000;

  const total = teams * rounds;
  for (let overall = 1; overall <= total; overall += 1) {
    const state = fold(events);

    // --- INVARIANTES en cada pick, antes de elegir -------------------------
    if (state.count !== overall - 1) {
      problemas.push(`ov${overall}: recuento ${state.count}, esperado ${overall - 1}`);
    }
    const pool = board.filter((row) => !state.byPlayer.has(row.player_id));
    if (pool.length !== board.length - state.count) {
      problemas.push(`ov${overall}: pool ${pool.length}, esperado ${board.length - state.count}`);
    }
    if (pool.length === 0) break;

    const pos = slotForOverall(overall, teams, type);
    if (!pos) { problemas.push(`ov${overall}: sin puesto derivable`); break; }
    if (pos.slot < 1 || pos.slot > teams) problemas.push(`ov${overall}: puesto ${pos.slot}`);

    const equipo = pos.slot - 1;
    const politica = POLICIES[policies[equipo]];
    const elegido = politica(pool, rosters[equipo], rand, { round: pos.round, recent, needs });
    if (!elegido) { problemas.push(`ov${overall}: la política no eligió a nadie`); break; }
    if (state.byPlayer.has(elegido.player_id)) {
      problemas.push(`ov${overall}: eligió a alguien YA TOMADO (${elegido.player_id})`);
    }
    if (vistos.has(elegido.player_id)) {
      problemas.push(`ov${overall}: DUPLICADO ${elegido.player_id}`);
    }
    vistos.add(elegido.player_id);

    const mio = isMyTurn({ overall, teams, type, mySlot });
    reloj += 1 + Math.floor(rand() * 3);
    events.push(takeEvent({
      playerId: elegido.player_id,
      roster: mio === null ? ROSTER.UNKNOWN : mio ? ROSTER.MINE : ROSTER.OPPONENT,
      rosterSource: mio === null ? "UNKNOWN" : "DERIVED",
      source: SOURCE.MANUAL,
      at: reloj,
    }));
    rosters[equipo].push(elegido);
    recent.push(elegido.position);

    // --- corrección: deshacer y rehacer, que es lo que pasa de verdad -------
    if (undoRate > 0 && rand() < undoRate && events.length > 1) {
      reloj += 1;
      events.push(undoEvent({ playerId: elegido.player_id, at: reloj }));
      const tras = fold(events);
      if (tras.byPlayer.has(elegido.player_id)) {
        problemas.push(`ov${overall}: deshacer NO liberó a ${elegido.player_id}`);
      }
      if (tras.count !== overall - 1) {
        problemas.push(`ov${overall}: tras deshacer recuento ${tras.count}, esperado ${overall - 1}`);
      }
      rosters[equipo].pop();
      recent.pop();
      vistos.delete(elegido.player_id);
      reloj += 1;
      events.push(takeEvent({
        playerId: elegido.player_id,
        roster: mio ? ROSTER.MINE : ROSTER.OPPONENT,
        source: SOURCE.MANUAL, at: reloj,
      }));
      rosters[equipo].push(elegido);
      recent.push(elegido.position);
      vistos.add(elegido.player_id);
    }
  }

  const final = fold(events);

  // --- INVARIANTES finales ---------------------------------------------------
  const ids = final.picks.map((p) => p.playerId);
  if (new Set(ids).size !== ids.length) problemas.push("hay jugadores duplicados en el estado final");
  final.picks.forEach((p, i) => {
    if (p.overall !== i + 1) problemas.push(`pick ${i + 1} numerado ${p.overall}`);
  });
  if (final.count !== final.picks.length) problemas.push("count no coincide con picks.length");
  for (const p of final.picks) {
    if (!Number.isFinite(p.at) || !Number.isFinite(p.seq)) problemas.push(`pick ${p.playerId} con at/seq no finito`);
    if (!["MINE", "OPPONENT", "UNKNOWN"].includes(p.roster)) problemas.push(`roster inválido ${p.roster}`);
  }
  // Determinismo: barajar el registro no puede cambiar el estado plegado.
  const barajado = [...events];
  for (let i = barajado.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  const otro = fold(barajado);
  if (otro.count !== final.count) problemas.push(`fold no determinista: ${final.count} vs ${otro.count} tras barajar`);
  if (otro.picks.map((p) => p.playerId).join() !== ids.join()) {
    problemas.push("fold no determinista: distinto orden tras barajar");
  }
  // «Cuántos faltan» nunca puede ser negativo ni imposible.
  const falta = untilMyTurn({ count: final.count, teams, type, mySlot, rounds });
  if (falta && (falta.away < 0 || falta.overall <= final.count)) {
    problemas.push(`picks-until-you imposible: away=${falta.away} overall=${falta.overall} count=${final.count}`);
  }

  return { events, state: final, problemas, policies };
}
