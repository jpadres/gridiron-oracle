import { briefsByPlayer, model } from "../../../data/model.js";
import { NoDataYet } from "../../ui.jsx";
import RoomShell from "./RoomShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — Draft Assistant",
  description:
    "Live draft companion. Works on any platform — mark picks as they happen and the board reacts.",
};

export default function DraftRoomPage() {
  const fantasy = model.fantasy;
  if (!fantasy?.board?.length) {
    return (
      <>
        <h1>Draft Assistant</h1>
        <NoDataYet />
      </>
    );
  }
  return (
    <RoomShell
      board={fantasy.board}
      context={{
        season: fantasy.season,
        scoring: fantasy.scoring,
        teams: fantasy.teams,
        // Semanas de descanso: HECHO derivado del calendario publicado. El
        // Draft Room tiene su propia ruta, así que el contexto se pasa aquí y
        // no en el `page.jsx` del board — dos páginas, dos sitios.
        byes: fantasy.byes ?? null,
        // Lo que hace falta para RECOMPILAR el board en la liga del usuario.
        // Faltaban aquí, así que el asistente enseñaba el board publicado
        // mientras el encabezado decía «by your league's value»: no era que el
        // compilador fallara, es que nunca le llegaban los priors. Los mismos
        // campos que pasa el board de `/fantasy`, por el mismo compilador.
        componentOrder: fantasy.components ?? null,
        positionPriors: fantasy.position_priors ?? null,
        shrinkPriorGames: fantasy.shrink_prior_games ?? 10,
        tdPersistence: fantasy.td_persistence ?? 0.55,
        projectedGames: fantasy.projected_games ?? 15.5,
        // `sleeper_id` -> jugador, horneado en el build desde los rosters de
        // nflverse. Es lo que permite resolver un pick en vivo POR
        // IDENTIFICADOR en vez de por nombre. Sin él, el adaptador marca
        // UNMAPPED en lugar de adivinar.
        sleeperIds: fantasy.sleeper_ids ?? null,
        // CONTEXTO ACTUAL, al lado del valor y nunca dentro. El board de
        // `/fantasy` ya lo enseñaba y el asistente NO lo recibía: la pantalla
        // que se mira en mitad del draft era la única sin las noticias.
        // Se pinta como marca; no toca ni un número (regla 8).
        briefs: briefsByPlayer(model.dossier, model.research),
        // K y DST fichables: hechos de la temporada anterior, sin valor. El
        // board de VOR no los ordena y la sala tampoco lo finge.
        specialists: fantasy.specialists ?? null,
      }}
    />
  );
}
