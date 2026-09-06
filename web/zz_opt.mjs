// ¿Es `assignSlots` (voraz por VOR) óptimo en PUNTOS? Fuerza bruta contra él.
import { assignSlots, SLOT_ELIGIBILITY } from "./app/fantasy/leagueValue.js";
import { lineupFloor } from "./app/fantasy/rosterFit.js";
const REP = { QB: 233, RB: 131, WR: 132, TE: 113 };
const BENCH = new Set(["BN","BE","BENCH","IR","TAXI"]);

function optimo(players, slots, replacement) {
  const s = slots.map(x=>String(x).toUpperCase()).filter(x=>!BENCH.has(x));
  const floors = s.map(slot => {
    const el = SLOT_ELIGIBILITY[slot] ?? [];
    let m = null; for (const pos of el) { const r = replacement[pos];
      if (r !== undefined && (m===null || r>m)) m=r; }
    return m ?? 0;
  });
  const memo = new Map();
  const rec = (i, used) => {
    if (i === s.length) return 0;
    const k = i + "|" + used;
    if (memo.has(k)) return memo.get(k);
    let best = floors[i] + rec(i+1, used);     // dejar el hueco vacío (suelo)
    const el = SLOT_ELIGIBILITY[s[i]] ?? [];
    for (let j = 0; j < players.length; j++) {
      if (used & (1<<j)) continue;
      if (!el.includes(String(players[j].position).toUpperCase())) continue;
      const v = (Number(players[j].projected_points)||0) + rec(i+1, used | (1<<j));
      if (v > best) best = v;
    }
    memo.set(k, best); return best;
  };
  return rec(0, 0);
}

// 1) el caso B2, comprobado por fuerza bruta
let n=0;
const p=(pos,proj)=>({player_id:`${pos}${++n}`,player_name:`${pos}${n}(${proj})`,position:pos,
  projected_points:proj,vor:proj-REP[pos]});
const LIGA=["QB","RB","RB","WR","WR","TE","FLEX","BN","BN"];
const mios=[p("QB",330),p("RB",200),p("RB",190),p("WR",205),p("WR",200),p("TE",180),p("TE",176)];
const WRX=p("WR",194);
console.log("B2  base: voraz", lineupFloor({players:mios,rosterPositions:LIGA,replacement:REP}),
            " óptimo", optimo(mios,LIGA,REP));
console.log("B2  con WRX: voraz", lineupFloor({players:[...mios,WRX],rosterPositions:LIGA,replacement:REP}),
            " óptimo", optimo([...mios,WRX],LIGA,REP));

// 2) ¿con qué frecuencia se equivoca el marginal? Plantillas aleatorias realistas.
const POS=["QB","RB","WR","TE"];
const rnd=(a,b)=>a+Math.random()*(b-a);
const proyecta=(pos)=>({QB:()=>rnd(200,380),RB:()=>rnd(60,260),WR:()=>rnd(60,250),TE:()=>rnd(50,200)}[pos]());
let malos=0, peor=0, total=0, marginalCero=0;
for (let it=0; it<4000; it++) {
  n=0;
  const cuantos = 4 + Math.floor(Math.random()*6);
  const roster = Array.from({length:cuantos},()=>{const pos=POS[Math.floor(Math.random()*4)];
    return p(pos, Math.round(proyecta(pos)));});
  const cand = (()=>{const pos=POS[Math.floor(Math.random()*4)]; return p(pos, Math.round(proyecta(pos)));})();
  const gBase=lineupFloor({players:roster,rosterPositions:LIGA,replacement:REP});
  const gCon =lineupFloor({players:[...roster,cand],rosterPositions:LIGA,replacement:REP});
  const oBase=optimo(roster,LIGA,REP), oCon=optimo([...roster,cand],LIGA,REP);
  const mg=gCon-gBase, mo=oCon-oBase;
  total++;
  if (Math.abs(mg-mo)>0.5){ malos++; peor=Math.max(peor,Math.abs(mg-mo));
    if (mg<=0.5 && mo>0.5) marginalCero++; }
}
console.log(`marginal ERRÓNEO en ${malos}/${total} plantillas aleatorias (máx error ${peor} puntos);`,
            `de ellas ${marginalCero} son «el motor dice 0 y de verdad mejora»`);
