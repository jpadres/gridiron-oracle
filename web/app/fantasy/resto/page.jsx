import { availabilityByPlayer, model } from "../../../data/model.js";
import { NoDataYet } from "../../ui.jsx";
import RestShell from "./RestShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — Rest of Season",
  description:
    "Every player ranked for what is left of the season, by value over replacement, with who owns them in your league.",
};

/** Jugadores con prensa reciente, para marcar su fila. Mismo criterio que el semanal. */
function playersWithNews(research) {
  const flagged = {};
  for (const item of research?.items ?? []) {
    for (const id of item.player_ids ?? []) flagged[id] = true;
  }
  return flagged;
}

export default function RestOfSeason() {
  const board = model.fantasy?.board ?? [];
  const week = model.fantasy_weekly?.week ?? model.week?.week ?? null;
  const season = model.fantasy_weekly?.season ?? model.week?.season ?? null;

  if (board.length === 0) {
    return (
      <>
        <h1>Rest of Season</h1>
        <NoDataYet />
      </>
    );
  }

  return (
    <>
      <h1>Rest of Season{week ? ` — week ${week} onward` : ""}</h1>
      <p className="lede">
        Every player the board covers, ranked for what is <em>left</em> of the season rather
        than for the whole of it: the season projection spread over the game weeks each one
        actually has, byes taken out. Link your Sleeper account and each row says whether he
        is yours, free, or on somebody else&rsquo;s roster.
      </p>
      <RestShell
        board={board}
        byes={model.fantasy?.byes ?? {}}
        week={week}
        season={season}
        notes={model.narrative?.player_notes ?? {}}
        news={playersWithNews(model.research)}
        availability={availabilityByPlayer(model.dossier)}
      />
    </>
  );
}
