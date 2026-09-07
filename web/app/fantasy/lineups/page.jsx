import { capabilityStatus, dataDate, model } from "../../../data/model.js";
import { Note, NoDataYet } from "../../ui.jsx";
import LineupsShell from "./LineupsShell.jsx";

export const metadata = {
  title: "Lineups — Gridiron Oracle",
  description:
    "Every league you linked: the lineup you have set in Sleeper, the highest-projected one, and the swap slot by slot.",
};

/**
 * START / SIT PARA TODAS MIS LIGAS, EN UNA PANTALLA.
 *
 * La pregunta del dueño después del draft es una: «¿a quién alineo esta
 * semana, en cada liga?». Antes la única respuesta vivía en el analizador,
 * atada a UNA liga por la barra, y encima sumaba escalas distintas (el board
 * de temporada como respaldo del índice semanal). Aquí cada liga enlazada se
 * lee de la instantánea guardada en el navegador y el motor puro
 * (`startSit.js`) hace la resta con la proyección de ESTA semana y nada más.
 *
 * La autoridad de cada cambio sale del registro de capacidades y no de la
 * prosa: si un experimento sube el QB, esta pantalla deja de avisar sola.
 */
export default function LineupsPage() {
  const weekly = model.fantasy_weekly;
  if (!weekly?.rankings?.length) {
    return (
      <>
        <h1>Lineups</h1>
        <NoDataYet />
      </>
    );
  }
  return (
    <>
      <p className="eyebrow">{weekly.season} · week {weekly.week}</p>
      <h1>Lineups</h1>
      <p className="lede">
        For every league you linked: the lineup you have set in Sleeper, the highest-projected
        legal lineup from your roster this week, and the change slot by slot with the points it
        is worth. Nothing is submitted anywhere — Sleeper has no write API — so you make the
        move there.
      </p>
      <Note title="What the numbers are">
        <p>
          The projection is this site&rsquo;s weekly projection, built from player stats as of{" "}
          <strong>{dataDate("fantasy") ?? "an unknown date"}</strong>, with roster and status
          facts as of <strong>{dataDate("rosters") ?? "an unknown date"}</strong>. A player who is
          OUT, on bye, or on your IR or taxi squad is never proposed as a starter. A defense has
          no projection here by design: it holds its slot and adds nothing.
        </p>
      </Note>
      <LineupsShell
        rankings={weekly.rankings ?? []}
        kickers={weekly.kickers ?? []}
        defenses={weekly.defenses ?? []}
        byes={model.fantasy?.byes ?? {}}
        week={weekly.week}
        season={weekly.season}
        statuses={{
          START_SIT_QB: capabilityStatus("START_SIT_QB"),
          START_SIT_RB: capabilityStatus("START_SIT_RB"),
          START_SIT_WR: capabilityStatus("START_SIT_WR"),
          START_SIT_TE: capabilityStatus("START_SIT_TE"),
          KICKER_ORDINAL_RANKING: capabilityStatus("KICKER_ORDINAL_RANKING"),
          KICKER_PROJECTION: capabilityStatus("KICKER_PROJECTION"),
          DST_STREAMING: capabilityStatus("DST_STREAMING"),
        }}
      />
    </>
  );
}
