/** FASE 4 — 1.000+ drafts sembrados. Prueba de ESTADO, no de fantasy. */
import { loadBoard, simulate } from "./simulate.mjs";

const board = loadBoard();
const TAMANOS = [8, 10, 12, 14, 16, 20, 24, 32];
const TIPOS = ["snake", "linear"];
const N = Number(process.env.N ?? 1000);

let corridas = 0, picks = 0, conFallos = 0;
const fallosPorTipo = new Map();
const minimizados = [];
const t0 = Date.now();

for (let seed = 1; seed <= N; seed += 1) {
  const teams = TAMANOS[seed % TAMANOS.length];
  const type = TIPOS[seed % 2];
  const mySlot = 1 + (seed % teams);
  const rounds = Math.max(1, Math.min(15, Math.floor(board.length / teams)));
  const undoRate = (seed % 5) * 0.03;   // 0 a 0,12
  let r;
  try {
    r = simulate({ board, teams, rounds, type, mySlot, seed, undoRate });
  } catch (error) {
    conFallos += 1;
    const clave = `EXCEPCIÓN ${error.message}`;
    fallosPorTipo.set(clave, (fallosPorTipo.get(clave) ?? 0) + 1);
    minimizados.push({ seed, teams, type, mySlot, rounds, undoRate, error: error.message });
    continue;
  }
  corridas += 1; picks += r.state.count;
  if (r.problemas.length) {
    conFallos += 1;
    for (const p of r.problemas) {
      const clave = p.replace(/\b\d+\b/g, "N").replace(/00-\d+/g, "ID");
      fallosPorTipo.set(clave, (fallosPorTipo.get(clave) ?? 0) + 1);
    }
    if (minimizados.length < 10) minimizados.push({ seed, teams, type, mySlot, rounds, undoRate, problemas: r.problemas.slice(0, 3) });
  }
}

const ms = Date.now() - t0;
console.log(`${corridas} drafts · ${picks} picks · ${ms} ms · ${(picks / (ms / 1000)).toFixed(0)} picks/s`);
console.log(`drafts con problemas: ${conFallos}`);
if (fallosPorTipo.size) {
  console.log("\nclases de fallo:");
  for (const [k, v] of [...fallosPorTipo].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x  ${k}`);
  console.log("\nfixtures mínimos:");
  for (const m of minimizados) console.log("  " + JSON.stringify(m));
}
process.exit(conFallos === 0 ? 0 : 1);
