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
 * El estado vive en el navegador (catálogo + registros de picks por liga), así
 * que la página es una concha estática y el trabajo lo hace el cliente — igual
 * que el Draft Room, y por el mismo motivo.
 */
export default function LeaguesPage() {
  const fantasy = model.fantasy ?? {};
  return (
    <LeaguesShell
      board={fantasy.board ?? []}
      context={{ season: fantasy.season, byes: fantasy.byes ?? null }}
    />
  );
}
