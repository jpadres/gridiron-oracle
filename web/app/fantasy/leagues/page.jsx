import { model } from "../../../data/model.js";
import LeaguesShell from "./LeaguesShell.jsx";

export const metadata = {
  title: "Leagues — Gridiron Oracle",
  description: "Every league you draft in, and what is factually happening in each.",
};

/**
 * El centro de mando multi-liga. La pregunta que responde es una:
 * ¿DÓNDE ESTÁ PASANDO ALGO, de hecho, entre todas mis ligas?
 *
 * El estado vive en el navegador (catálogo + registros de picks por liga, y
 * desde septiembre la cuenta de Sleeper enlazada), así que la página es una
 * concha estática y el trabajo lo hace el cliente — igual que el Draft Room, y
 * por el mismo motivo.
 *
 * El contexto lleva lo mismo que recibe el Draft Room: el mapa de identidades
 * de Sleeper (para resolver una plantilla POR ID), los especialistas (una
 * defensa fichada es una fila del pool, no un nombre suelto) y lo que hace
 * falta para recompilar el VOR en la puntuación y estructura de CADA liga.
 */
export default function LeaguesPage() {
  const fantasy = model.fantasy ?? {};
  return (
    <LeaguesShell
      board={fantasy.board ?? []}
      context={{
        season: fantasy.season,
        byes: fantasy.byes ?? null,
        sleeperIds: fantasy.sleeper_ids ?? null,
        specialists: fantasy.specialists ?? null,
        rookies: fantasy.rookies ?? null,
        componentOrder: fantasy.components ?? null,
        positionPriors: fantasy.position_priors ?? null,
        shrinkPriorGames: fantasy.shrink_prior_games ?? 10,
        tdPersistence: fantasy.td_persistence ?? 0.55,
        projectedGames: fantasy.projected_games ?? 15.5,
      }}
    />
  );
}
