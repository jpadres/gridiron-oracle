import { bestForMe, headlineReason } from "./app/fantasy/candidates.js";
const REP = { QB: 233, RB: 131, WR: 132, TE: 113, K: 100, DST: 90 };
let n = 0;
const p = (position, proj, extra = {}) => ({
  player_id: `${position}${(n += 1)}`, player_name: `${position} ${n}`,
  position, projected_points: proj, vor: proj - (REP[position] ?? 100),
  tier: 1, wg: 16, rostered: true, ...extra,
});
const LIGA = ["QB","RB","RB","WR","WR","TE","FLEX","DST","K","BN"];
const mios = [p("QB",300),p("RB",200),p("RB",190),p("WR",195),p("WR",185),p("TE",150),p("RB",180)];
n = 100;
const sinEquipo = p("K", 130, { rostered: false, player_name: "Kicker SIN EQUIPO NFL" });
const conEquipo = p("K", 120, { rostered: true, player_name: "Kicker con equipo" });
const dst = p("DST", 95);
const relleno = p("WR", 90);   // mantiene vivo el pool rankeado
const out = bestForMe([sinEquipo, conEquipo, dst, relleno], {
  roster: mios, rosterPositions: LIGA, replacement: REP, picksLeftForMe: 2,
});
console.log("mustFillSpecialist:", out.mustFillSpecialist, "fillingRequiredSlot:", out.fillingRequiredSlot);
console.log("PRIMARY:", out.primary.row.player_name, "| rostered =", out.primary.row.rostered);
console.log("reasons:", JSON.stringify(out.primary.reasons, null, 0));
console.log("headlineReason:", JSON.stringify(headlineReason(out.primary)));
console.log("flags noRosteredLeft:", out.noRosteredLeft, "shortSampleOnly:", out.shortSampleOnly);
console.log("alternates:", out.alternates.map(a => a.row.player_name + "/" + a.row.rostered));
