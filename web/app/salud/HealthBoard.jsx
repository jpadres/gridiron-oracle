"use client";

/**
 * LO QUE EN ESTA PÁGINA DEPENDE DE LA HORA A LA QUE SE MIRA.
 *
 * El texto fijo sigue en `page.jsx`, de servidor. Esto es de cliente por una
 * sola razón: necesita el reloj. Las etiquetas llegan decididas por Python y
 * aquí sólo pueden BAJAR (`healthClock.js`) — ver ahí el porqué.
 *
 * `now` empieza en `null` para que el primer pintado sea idéntico al del
 * servidor (que no tiene «ahora»: tendría la hora de la COMPILACIÓN, la falsa
 * actualidad de siempre aplicada al reloj). Al montar se lee el reloj de
 * verdad y se refresca cada minuto.
 */
import { useEffect, useState } from "react";

import { instantLabel } from "../instant.js";
import { Callout, Note, Stat } from "../ui.jsx";
import HealthTable from "./HealthTable.jsx";
import { ageLabel, effective, tally } from "./healthClock.js";

export default function HealthBoard({ health }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const sources = (health.sources ?? []).map((s) => ({ ...s, now: effective(s, now) }));
  const c = tally(health.sources, now);
  const w = health.week_agreement ?? {};
  const roto = sources.filter((s) => s.now.label === "BROKEN");
  const viejo = sources.filter((s) => s.now.label === "STALE");
  const total = sources.length;

  const builtMs = health.generated_at ? Date.parse(health.generated_at) : NaN;
  const edadDelBuild = now !== null && Number.isFinite(builtMs) ? ageLabel(now - builtMs) : null;
  const envejecidas = sources.filter((s) => s.now.aged).length;

  return (
    <>
      <section aria-label="Week agreement">
        <h2 className="bk-h">
          Which week is it <small>two witnesses, and the disagreement if any</small>
        </h2>
        <div className="grid">
          <Stat label="From the schedule" value={w.derived_week ?? "UNKNOWN"}
                hint="First unplayed game — what the site publishes" />
          <Stat label="From Sleeper" value={w.sleeper_week ?? "—"}
                hint={w.status === "UNREACHABLE"
                  ? "Could not be read"
                  : `Read ${instantLabel(w.retrieved_at) ?? "at an unknown time"}`} />
          <Stat label="Agreement" value={w.status ?? "UNKNOWN"}
                hint={w.status === "AGREE" ? "Both witnesses say the same week"
                  : w.status === "UNREACHABLE" ? "Not checked is not the same as agreeing"
                  : "See the note below"} />
          <Stat label="Sources fresh" value={`${c.FRESH} of ${total}`}
                hint={`${c.STALE} stale · ${c.BROKEN} broken`} />
        </div>
        {w.note ? <p className="caption">{w.note}</p> : null}
        {/* CUÁNDO SE CALCULÓ, Y HACE CUÁNTO. Los dos testigos de arriba son de
            ese instante, no de ahora: si la exportación se paró hace un mes,
            «AGREE» es un acuerdo de hace un mes y hay que poder verlo. */}
        <p className="caption">
          Computed {instantLabel(health.generated_at) ?? "at an unknown time"}
          {edadDelBuild ? <> — <strong>{edadDelBuild} ago</strong></> : null}.{" "}
          {envejecidas > 0
            ? <>Since then {envejecidas} source{envejecidas === 1 ? " has" : "s have"} aged
                past the window in which {envejecidas === 1 ? "it" : "they"} can be stated
                as current, and {envejecidas === 1 ? "is" : "are"} shown as STALE below.
                A label only ever moves down with time, never back up.</>
            : "Each label below is re-checked against your clock, and can only move down."}
        </p>
      </section>

      {roto.length || viejo.length ? (
        <Callout title={`${roto.length} broken, ${viejo.length} stale right now`}>
          <ul>
            {[...roto, ...viejo].map((s) => (
              <li key={s.name}>
                <strong>{s.name}</strong> — {s.now.label}:{" "}
                {s.now.aged
                  ? `last published ${ageLabel(s.now.ageMs)} ago; it can be stated as current for ${s.fresh_for_hours} h`
                  : s.reason}
              </li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Note title="Every source is inside its window">
          <p>Nothing here is being presented as more current than it is.</p>
        </Note>
      )}

      <HealthTable sources={sources} />
    </>
  );
}
