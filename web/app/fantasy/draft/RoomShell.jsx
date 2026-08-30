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
import { rosterFromCounts } from "../leagueValue.js";

const SCORING = [
  { id: "ppr", label: "PPR" },
  { id: "half", label: "Half PPR" },
  { id: "standard", label: "Standard" },
];
const TYPES = [
  { id: "snake", label: "Snake" },
  { id: "linear", label: "Linear" },
];

// Los contadores de plantilla del configurador. `null` = SIN CONFIGURAR, que
// no es lo mismo que cero: cero es una liga que decidió no alinear esa
// posición, null es que nadie ha dicho nada. La plantilla sólo se guarda si el
// usuario la tocó o aplicó el preset — una liga sin configurar queda UNKNOWN y
// la vista de plantilla lo dice, no dibuja una alineación estándar.
const NO_ROSTER = Object.freeze({
  QB: null, RB: null, WR: null, TE: null, FLEX: null, SUPER_FLEX: null,
  DEF: null, K: null, BN: null,
});

// El preset del dueño, confirmado explícitamente. Es una COMODIDAD del
// formulario: rellena los contadores para editarlos, nunca se aplica solo.
const STANDARD_PRESET = Object.freeze({
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 0, DEF: 1, K: 1, BN: 6,
});

const ROSTER_FIELDS = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF", "K", "BN"];

const BLANK = {
  name: "", platform: "manual", leagueId: "", draftId: "",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: null,
  rosterCounts: NO_ROSTER,
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

  // Entrar en edición SIEMBRA el formulario desde la liga guardada, una vez.
  // Los contadores se derivan de la lista canónica: la lista es lo que se
  // guarda y los contadores son su vista de formulario.
  const beginEdit = useCallback(() => {
    setDraft({
      ...league,
      rosterCounts: Array.isArray(league?.roster)
        ? Object.fromEntries(ROSTER_FIELDS.map((f) => [
            f, league.roster.filter((slot) => slot === f).length,
          ]))
        : NO_ROSTER,
    });
    setEditing(true);
  }, [league]);

  useEffect(() => {
    const saved = load();
    if (saved) setLeague(saved);
    setReady(true);
  }, []);

  const enter = useCallback((entry) => {
    // La plantilla se materializa SÓLO si hay algún contador puesto. Todo en
    // null significa que el usuario no la configuró, y eso se guarda como
    // ausencia — no como el preset. La fuente queda anotada: esta ruta es
    // siempre MANUAL; un adaptador que la rellene pondrá la suya.
    const counts = entry.rosterCounts ?? NO_ROSTER;
    const configured = ROSTER_FIELDS.some((f) => counts[f] !== null && counts[f] !== undefined);
    // Cada liga y cada draft tienen su propio id: es lo que hace que el estado
    // de una no pueda contaminar a otra, igual que en el board.
    const complete = {
      ...entry,
      leagueId: entry.leagueId || `manual-${Date.now().toString(36)}`,
      draftId: entry.draftId || `d-${Date.now().toString(36)}`,
      roster: configured
        ? rosterFromCounts(Object.fromEntries(
            ROSTER_FIELDS.map((f) => [f, counts[f] ?? 0])))
        : null,
      rosterSource: configured ? "MANUAL" : null,
    };
    setLeague(complete);
    setEditing(false);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(complete));
    } catch { /* modo privado: se puede draftear igual, sin recordar la liga */ }
  }, []);

  if (!ready) return <p className="caption">Loading&hellip;</p>;

  if (!league || editing) {
    // El formulario SIEMPRE lee el estado `draft`; al entrar en edición se
    // siembra una vez desde la liga guardada (ver `beginEdit`). La versión
    // anterior re-derivaba `entry` de `league` en cada render, así que lo que
    // se tecleaba en la edición se descartaba en el render siguiente: el
    // formulario parecía funcionar y no escribía nada. Interacción muerta que
    // no falla — la clase de bug que sólo se ve tecleando.
    const entry = draft;
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
            <input type="number" min="4" max="32" value={entry.teams}
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

          <fieldset className="field-label room-roster-config">
            <legend>
              Roster
              <button type="button" className="link"
                      onClick={() => set({ rosterCounts: { ...STANDARD_PRESET } })}>
                use standard
              </button>
            </legend>
            {/* Sin configurar, la plantilla queda UNKNOWN y la vista lo dice.
                El preset rellena los contadores PARA EDITARLOS — nunca se
                aplica solo, y cero es una decisión, no una ausencia. */}
            <span className="caption">
              Optional. Unconfigured stays unknown — nothing is assumed. Zero is a
              real value: a league with no TE slot keeps zero.
            </span>
            <div className="roster-counts">
              {ROSTER_FIELDS.map((field) => (
                <label key={field} className="roster-count">
                  <span>{field === "SUPER_FLEX" ? "SFLX" : field}</span>
                  <input
                    type="number" min="0" max="12" inputMode="numeric"
                    value={entry.rosterCounts?.[field] ?? ""}
                    placeholder="–"
                    onChange={(e) => set({
                      rosterCounts: {
                        ...(entry.rosterCounts ?? NO_ROSTER),
                        [field]: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="act act--mine">Enter draft room</button>
        </form>
      </>
    );
  }

  return (
    <>
      {/* Cabecera de UNA línea. El titular de portada y su antetítulo ocupaban
          250px por encima de la banda de estado — un cuarto de la pantalla del
          móvil gastado en decir dónde estás cuando ya lo sabes: has entrado tú.
          Lo que sí hace falta es la identidad de la liga, y cabe en la línea. */}
      <header className="room-head">
        <h1>Draft Room</h1>
        <p>
          <b>{league.name || "Manual league"}</b>
          <span>{league.teams}-team</span>
          <span>{SCORING.find((s) => s.id === league.scoring)?.label ?? league.scoring}</span>
          <span>{league.draftType}</span>
          <span>{league.mySlot ? `slot ${league.mySlot}` : "slot UNKNOWN"}</span>
          <button type="button" className="link" onClick={beginEdit}>edit</button>
        </p>
      </header>
      <DraftRoom board={board} context={context} league={league} />
    </>
  );
}
