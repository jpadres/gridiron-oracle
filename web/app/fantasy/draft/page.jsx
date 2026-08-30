import { model } from "../../../data/model.js";
import { NoDataYet } from "../../ui.jsx";
import RoomShell from "./RoomShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — Draft Room",
  description:
    "Live draft companion. Works on any platform — mark picks as they happen and the board reacts.",
};

export default function DraftRoomPage() {
  const fantasy = model.fantasy;
  if (!fantasy?.board?.length) {
    return (
      <>
        <h1>Draft Room</h1>
        <NoDataYet />
      </>
    );
  }
  return (
    <RoomShell
      board={fantasy.board}
      context={{ season: fantasy.season, scoring: fantasy.scoring, teams: fantasy.teams }}
    />
  );
}
