import { model } from "../../../data/model.js";
import { Callout, NoDataYet } from "../../ui.jsx";
import AnalyzerShell from "./AnalyzerShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — League Analyzer",
  description:
    "Power rankings, head-to-head by position and opposite roster gaps for the Sleeper league you linked.",
};

export default function Analisis() {
  const fantasy = model.fantasy;
  const week = model.fantasy_weekly?.week ?? null;
  if (!fantasy?.board?.length) {
    return (
      <>
        <h1>League Analyzer</h1>
        <NoDataYet />
      </>
    );
  }
  return (
    <>
      <h1>League Analyzer</h1>
      <p className="lede">
        Your league read as arithmetic: how much value each roster can field, how you compare
        position by position with anyone in it, and which pairs of teams have opposite gaps.
        Everything here is a sum over numbers this site already publishes.
      </p>

      <Callout title="What this page will not tell you">
        <p>
          It will not say who wins the league, what a player is worth in a trade, or which
          offer to send. None of that is measured here, and this project publishes the numbers
          it can defend and stops there. The counting stops where the judgement starts —{" "}
          <strong>that part is yours</strong>.
        </p>
      </Callout>

      <AnalyzerShell
        board={fantasy.board}
        byes={fantasy.byes ?? {}}
        week={week}
        sleeperIds={fantasy.sleeper_ids ?? null}
      />
    </>
  );
}
