// REPRO B3 (SUPERFLEX): el segundo QB añade 96 puntos reales y puntúa 0.
import { bestForMe } from "./app/fantasy/candidates.js";
import { lineupFloor } from "./app/fantasy/rosterFit.js";
import { assignSlots } from "./app/fantasy/leagueValue.js";
const REP = { QB: 233, RB: 131, WR: 132, TE: 113 };
let n = 0;
const p = (position, proj, extra = {}) => ({
  player_id: `${position}${(n += 1)}`, player_name: `${position}${n}(${proj})`,
  position, projected_points: proj, vor: proj - REP[position], tier: 1,
  wg: 16, rostered: true, ...extra,
});
const SF = ["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","BN"];
const mios = [p("QB",340), p("RB",200), p("RB",190), p("WR",195), p("WR",185),
              p("TE",150), p("RB",196), p("WR",194)];  // dos de banquillo flex-elegibles
n = 100;
const QB2 = p("QB",290);       // vor 57 -> por debajo del vor de RB(65) y WR(62)
const WR9 = p("WR",140);
const alin = (rs) => assignSlots(rs, SF).slots.map(s=>`${s.slot}=${s.player?.player_name ?? "—"}`).join(" ");
console.log("SIN QB2:", alin(mios));
console.log("CON QB2:", alin([...mios, QB2]));
const base = lineupFloor({ players: mios, rosterPositions: SF, replacement: REP });
const con  = lineupFloor({ players: [...mios, QB2], rosterPositions: SF, replacement: REP });
console.log(`lineupFloor base=${base} con QB2=${con} marginal=${con-base}`);
console.log("óptimo con QB2 (SUPER_FLEX=QB2 290, FLEX=RB196):",
  340+200+190+195+185+150+196+290, "vs base óptima", 340+200+190+195+185+150+196+194,
  "=> mejora REAL", (340+200+190+195+185+150+196+290)-(340+200+190+195+185+150+196+194));
const out = bestForMe([QB2, WR9], { roster: mios, rosterPositions: SF, replacement: REP });
console.log("benchOnly:", out.benchOnly, "| primary:", out.primary?.row?.player_name ?? null,
            "| startersComplete:", out.startersComplete);
console.log("bench:", out.bench.map(b=>`${b.row.player_name} marginal=${b.fit?.marginal} canStart=${b.canStart}`));
console.log("estado QB:", out.state.byPosition.QB);
