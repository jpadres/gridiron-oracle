// REPRO B2: un receptor que sube tu alineación 18 puntos puntúa marginal = 0
// y la fila escribe «he adds nothing to this lineup».
import { bestForMe, candidates } from "./app/fantasy/candidates.js";
import { lineupFloor } from "./app/fantasy/rosterFit.js";
import { assignSlots } from "./app/fantasy/leagueValue.js";

const REP = { QB: 233, RB: 131, WR: 132, TE: 113 };
let n = 0;
const p = (position, proj, extra = {}) => ({
  player_id: `${position}${(n += 1)}`, player_name: `${position}${n}(${proj})`,
  position, projected_points: proj, vor: proj - REP[position], tier: 1,
  wg: 16, rostered: true, ...extra,
});
const LIGA = ["QB","RB","RB","WR","WR","TE","FLEX","BN","BN"];
const mios = [p("QB",330), p("RB",200), p("RB",190), p("WR",205), p("WR",200),
              p("TE",180), p("TE",176)];   // TE2 176 -> vor 63
n = 100;
const WRX = p("WR",194);                    // vor 62  (< 63) pero 18 puntos MÁS que el TE2
const otro = p("RB",120);

const alin = (rs) => assignSlots(rs, LIGA).slots
  .map(s => `${s.slot}=${s.player?.player_name ?? "—"}`).join(" ");
console.log("alineación del modelo SIN WRX:", alin(mios));
console.log("alineación del modelo CON WRX:", alin([...mios, WRX]));
const base = lineupFloor({ players: mios, rosterPositions: LIGA, replacement: REP });
const con  = lineupFloor({ players: [...mios, WRX], rosterPositions: LIGA, replacement: REP });
console.log(`lineupFloor  base=${base}  con WRX=${con}  marginal=${con - base}`);
console.log("alineación ÓPTIMA con WRX = 330+200+190+205+200+180+194 =", 330+200+190+205+200+180+194,
            " (base óptima:", 330+200+190+205+200+180+176, ") => mejora REAL de",
            (330+200+190+205+200+180+194)-(330+200+190+205+200+180+176), "puntos");

const out = bestForMe([WRX, otro], { roster: mios, rosterPositions: LIGA, replacement: REP });
console.log("benchOnly:", out.benchOnly, "| primary:", out.primary?.row?.player_name ?? null);
console.log("bench:", out.bench.map(b => `${b.row.player_name} marginal=${b.fit?.marginal}`));
const corta = candidates([WRX, otro], { roster: mios, rosterPositions: LIGA, replacement: REP });
for (const e of corta) console.log("candidates():", e.row.player_name, "->", e.reasons.map(r=>r.text).join(" | "));
