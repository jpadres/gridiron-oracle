// REPRO B: assignSlots reparte por VOR y la alineación se SUMA en puntos.
// Un ala cerrada de banquillo con VOR alto (reemplazo TE bajo) acapara el FLEX
// del modelo, y un receptor que SÍ sería tu mejor FLEX puntúa marginal 0.
import { bestForMe, candidates } from "./app/fantasy/candidates.js";
import { lineupFloor, rosterFit } from "./app/fantasy/rosterFit.js";
import { assignSlots } from "./app/fantasy/leagueValue.js";

const REP = { QB: 233, RB: 131, WR: 132, TE: 113 };
let n = 0;
const p = (position, proj, extra = {}) => ({
  player_id: `${position}${(n += 1)}`, player_name: `${position}${n}`,
  position, projected_points: proj, vor: proj - REP[position], tier: 1,
  wg: 16, rostered: true, ...extra,
});
const LIGA = ["QB","RB","RB","WR","WR","TE","FLEX","BN","BN"];

const QB1 = p("QB",330), RB1 = p("RB",200), RB2 = p("RB",190);
const WR1 = p("WR",195), WR2 = p("WR",185), TE1 = p("TE",180);
const TE2 = p("TE",175);           // banquillo: vor 62
const mios = [QB1,RB1,RB2,WR1,WR2,TE1,TE2];

n = 100;
const WRX = p("WR",190);           // vor 58 — 15 puntos MÁS que TE2 en el FLEX
const RBX = p("RB",140);           // vor 9

const base = lineupFloor({ players: mios, rosterPositions: LIGA, replacement: REP });
const conWRX = lineupFloor({ players: [...mios, WRX], rosterPositions: LIGA, replacement: REP });
console.log("FLEX del modelo (sin candidato):",
  assignSlots(mios, LIGA).slots.find(s=>s.slot==="FLEX").player.player_name);
console.log("FLEX del modelo (con WRX):",
  assignSlots([...mios,WRX], LIGA).slots.find(s=>s.slot==="FLEX").player.player_name);
console.log("lineupFloor base:", base, "con WRX:", conWRX, "=> marginal:", conWRX - base);
console.log("MEJOR alineación real con WRX (a mano):",
  330+200+190+195+185+180+190, "vs sin él:", 330+200+190+195+185+180+175);

const fit = rosterFit({ candidates: [WRX, RBX], roster: mios, rosterPositions: LIGA, replacement: REP });
console.log("rosterFit:", JSON.stringify(fit));

const out = bestForMe([WRX, RBX], { roster: mios, rosterPositions: LIGA, replacement: REP });
console.log("benchOnly:", out.benchOnly, "primary:", out.primary?.row?.player_name ?? null);
console.log("bench:", out.bench.map(b=>`${b.row.player_name} marginal=${b.fit?.marginal}`));

const corta = candidates([WRX, RBX], { roster: mios, rosterPositions: LIGA, replacement: REP, slots: null });
console.log("candidates() dice:", corta.map(e => `${e.row.player_name}: ` +
  e.reasons.map(r=>r.text).join(" | ")));
