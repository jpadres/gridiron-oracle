/** FASE 3 — drafts completos en toda la matriz de configuraciones. */
import { loadBoard, simulate } from "./simulate.mjs";

const board = loadBoard();
const TAMANOS = [8, 10, 12, 14, 16, 20, 24, 32];
let fallos = 0, corridas = 0, picksTotales = 0;

console.log(`pool publicado: ${board.length} jugadores\n`);
console.log(`${"liga".padEnd(22)}${"rondas".padStart(7)}${"picks".padStart(7)}${"pool restante".padStart(15)}  problemas`);
for (const teams of TAMANOS) {
  for (const type of ["snake", "linear"]) {
    for (const mySlot of [1, Math.ceil(teams / 2), teams]) {
      // Rondas hasta agotar defensivamente el pool publicado.
      const rounds = Math.max(1, Math.min(15, Math.floor(board.length / teams)));
      const r = simulate({ board, teams, rounds, type, mySlot, seed: teams * 100 + mySlot, undoRate: 0.04 });
      corridas += 1; picksTotales += r.state.count;
      if (r.problemas.length) fallos += 1;
      const etq = `${teams} eq ${type} slot${mySlot}`;
      console.log(`${etq.padEnd(22)}${String(rounds).padStart(7)}${String(r.state.count).padStart(7)}` +
                  `${String(board.length - r.state.count).padStart(15)}  ${r.problemas.length || "—"}`);
      if (r.problemas.length) console.log("    " + r.problemas.slice(0, 3).join("\n    "));
    }
  }
}
console.log(`\n${corridas} drafts completos, ${picksTotales} picks, ${fallos} con problemas`);
process.exit(fallos === 0 ? 0 : 1);
