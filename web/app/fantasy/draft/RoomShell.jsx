"use client";

/**
 * La antesala del Draft Room: establecer el contexto antes de entrar.
 *
 * ## Por qué hay una antesala
 *
 * El reloj del draft —de quién es el pick, cuántos faltan para ti— **no se
 * puede derivar sin tamaño de liga, tipo de draft y tu puesto**. Entrar sin eso
 * y suponer «12 equipos, snake, puesto 1» daría un calendario plausible y falso,
 * que es la peor clase de error: nadie lo comprueba porque parece razonable.
 *
 * Así que se pregunta una vez, se guarda por liga, y lo que no se sepa queda en
 * `UNKNOWN` — el Draft Room funciona igual, sólo que sin reloj.
 *
 * ## Independiente de plataforma, a propósito
 *
 * Esta pantalla no menciona Sleeper. Una liga manual se configura aquí y sirve
 * para un draft en ESPN, en Yahoo o alrededor de una mesa. El adaptador de
 * Sleeper, cuando exista, rellenará estos mismos campos solo.
 */

import { useCallback, useEffect, useState } from "react";

import DraftRoom from "../DraftRoom.jsx";
// La misma constante que lee el board para saber en qué draft está: si cada
// pantalla escribiera la suya, volverían a ser dos contextos con un nombre.
import { ROOM_LEAGUE_KEY as KEY } from "../draftStorage.js";

const SCORING = [
  { id: "ppr", label: "PPR" },
  { id: "half", label: "Half PPR" },
  { id: "standard", label: "Standard" },
];
const TYPES = [
  { id: "snake", label: "Snake" },
  { id: "linear", label: "Linear" },
];

const BLANK = {
  name: "", platform: "manual", leagueId: "", draftId: "",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: null,
};

function load() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function RoomShell({ board, context }) {
  const [league, setLeague] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const saved = load();
    if (saved) setLeague(saved);
    setReady(true);
  }, []);

  const enter = useCallback((entry) => {
    // Cada liga y cada draft tienen su propio id: es lo que hace que el estado
    // de una no pueda contaminar a otra, igual que en el board.
    const complete = {
      ...entry,
      leagueId: entry.leagueId || `manual-${Date.now().toString(36)}`,
      draftId: entry.draftId || `d-${Date.now().toString(36)}`,
    };
    setLeague(complete);
    setEditing(false);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(complete));
    } catch { /* modo privado: se puede draftear igual, sin recordar la liga */ }
  }, []);

  if (!ready) return <p className="caption">Loading&hellip;</p>;

  if (!league || editing) {
    const entry = editing && league ? { ...league } : draft;
    const set = (patch) => setDraft({ ...entry, ...patch });
    return (
      <>
        <p className="eyebrow">{context.season} · Draft Room</p>
        <h1>Set up your league</h1>
        <p className="lede">
          Works with any platform. Draft on Sleeper, ESPN, Yahoo or around a kitchen table —
          mark picks here and the board reacts.
        </p>
        <form
          className="room-setup"
          onSubmit={(event) => {
            event.preventDefault();
            enter(entry);
          }}
        >
          <label className="field-label">
            League name
            <input type="text" value={entry.name}
                   onChange={(e) => set({ name: e.target.value })}
                   placeholder="Work league" />
          </label>

          <label className="field-label">
            Teams
            <input type="number" min="4" max="20" value={entry.teams}
                   onChange={(e) => set({ teams: Number(e.target.value) || null })} />
          </label>

          <fieldset className="field-label">
            <legend>Scoring</legend>
            <div className="pos-filter" role="group">
              {SCORING.map((option) => (
                <button key={option.id} type="button" className="pos-option"
                        aria-pressed={entry.scoring === option.id}
                        onClick={() => set({ scoring: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field-label">
            <legend>Draft type</legend>
            <div className="pos-filter" role="group">
              {TYPES.map((option) => (
                <button key={option.id} type="button" className="pos-option"
                        aria-pressed={entry.draftType === option.id}
                        onClick={() => set({ draftType: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field-label">
            Your draft slot
            <input type="number" min="1" max={entry.teams ?? 20}
                   value={entry.mySlot ?? ""}
                   onChange={(e) => set({ mySlot: Number(e.target.value) || null })}
                   placeholder="leave blank if unknown" />
            {/* Sin puesto el Draft Room funciona igual: lo que se pierde es el
                reloj. Es mejor que inventar un puesto y dar un turno falso. */}
            <span className="caption">
              Optional. Without it there is no pick clock — nothing is guessed.
            </span>
          </label>

          <label className="field-label">
            Rounds
            <input type="number" min="1" max="30" value={entry.rounds}
                   onChange={(e) => set({ rounds: Number(e.target.value) || null })} />
          </label>

          <button type="submit" className="act act--mine">Enter draft room</button>
        </form>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">
        {league.name || "Manual league"} · {league.teams}-team ·{" "}
        {SCORING.find((s) => s.id === league.scoring)?.label ?? league.scoring} ·{" "}
        {league.draftType}
        {league.mySlot ? ` · slot ${league.mySlot}` : " · slot UNKNOWN"}
        {" · "}
        <button type="button" className="link" onClick={() => setEditing(true)}>edit</button>
      </p>
      <h1>Draft Room</h1>
      <DraftRoom board={board} context={context} league={league} />
    </>
  );
}
