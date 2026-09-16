import { model } from "../../../data/model.js";
import { progressLabel, weekWindow, windowLabel } from "../../weekWindow.js";
import { Callout, Note } from "../../ui.jsx";
import WaiversShell from "./WaiversShell.jsx";

export const metadata = {
  title: "Waivers, DST and kickers — Gridiron Oracle",
  description:
    "Add/drop pairs against your actual roster, the week's defense context and "
    + "a verified kicker-job board.",
};

/**
 * UNA pantalla para las tres decisiones de TRANSACCIÓN de la semana.
 *
 * Waivers, defensa y pateador son la misma pregunta con tres pools: ¿quién está
 * libre en MI liga y me mejora la alineación? Tres rutas separadas habrían sido
 * tres sitios donde mirar lo mismo — y este proyecto ya perdió el resto de
 * temporada por esconderlo dentro de otra pantalla.
 */
export default function WaiversPage() {
  const weekly = model.fantasy_weekly ?? null;
  const research = model.weekly_research ?? null;
  // La MISMA derivación que la portada y /predicciones: una jornada no puede
  // leerse «Sep 9–14» en una pantalla y «2026-09-17 TO 2026-09-21» en otra.
  const ventana = weekWindow(model.predictions);

  return (
    <>
      <p className="eyebrow">
        {weekly ? `Week ${weekly.week} · ${weekly.season}` : "Weekly"}
        {ventana ? ` · ${windowLabel(ventana)} · ${progressLabel(ventana)}` : null}
      </p>
      <h1>Waivers, defense and kickers</h1>
      <p className="lede">
        Every recommendation here is a <strong>pair</strong>: who comes in, who goes
        out, and what your starting lineup is worth before and after. A good free
        agent is not a good move if the required drop costs more than he adds.
      </p>

      <Callout title="What this screen will not do">
        <p>
          It will not rank a defense or a kicker as if that ranking were validated.
          <code>DST_ORDINAL_RANKING</code> and <code>KICKER_ORDINAL_RANKING</code> are{" "}
          <strong>REJECTED</strong> in the capability registry, and the labels below are
          read from that registry rather than written by hand — the day an experiment
          moves them, the wording changes on its own. What you get instead is the
          factual context for each matchup and, for kickers, the one thing that
          <em> is</em> verifiable: whether the player actually has the job.
        </p>
      </Callout>

      <WaiversShell
        weekly={weekly}
        research={research}
        capabilities={model.capabilities ?? null}
        byes={model.fantasy?.byes ?? null}
      />

      {research?.unknowns?.length ? (
        <Note title="What today's sweep does not know">
          <ul>
            {research.unknowns.map((u) => <li key={u}>{u}</li>)}
          </ul>
        </Note>
      ) : null}
    </>
  );
}
