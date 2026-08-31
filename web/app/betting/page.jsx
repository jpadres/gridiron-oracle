import { model } from "../../data/model.js";
import { NoDataYet } from "../ui.jsx";
import BettingShell from "./BettingShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — Betting",
  description:
    "Monthly bankroll, today's model leans against real lines, and a bet slip that records — never transmits — your bets.",
};

export default function BettingPage() {
  const predictions = model.predictions ?? [];
  if (predictions.length === 0) {
    return (
      <>
        <h1>Betting</h1>
        <NoDataYet />
      </>
    );
  }
  return (
    <BettingShell
      predictions={predictions}
      weekly={model.fantasy_weekly?.rankings ?? []}
      context={{
        season: model.week?.season ?? null,
        week: model.week?.week ?? null,
      }}
    />
  );
}
