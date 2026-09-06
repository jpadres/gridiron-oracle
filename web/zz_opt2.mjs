import { assignSlots, SLOT_ELIGIBILITY } from "./app/fantasy/leagueValue.js";
import { lineupFloor } from "./app/fantasy/rosterFit.js";
const REP={QB:233,RB:131,WR:132,TE:113}, BENCH=new Set(["BN"]);
function optimo(players,slots,replacement){const s=slots.filter(x=>!BENCH.has(x));
 const floors=s.map(slot=>{const el=SLOT_ELIGIBILITY[slot]??[];let m=null;
  for(const pos of el){const r=replacement[pos];if(r!==undefined&&(m===null||r>m))m=r;}return m??0;});
 const memo=new Map();const rec=(i,used)=>{if(i===s.length)return 0;const k=i+"|"+used;
  if(memo.has(k))return memo.get(k);let best=floors[i]+rec(i+1,used);
  const el=SLOT_ELIGIBILITY[s[i]]??[];
  for(let j=0;j<players.length;j++){if(used&(1<<j))continue;
   if(!el.includes(players[j].position))continue;
   const v=(players[j].projected_points||0)+rec(i+1,used|(1<<j));if(v>best)best=v;}
  memo.set(k,best);return best;};return rec(0,0);}
// PRNG determinista
let seed=12345; const rand=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const POS=["QB","RB","WR","TE"];const rango={QB:[200,380],RB:[60,260],WR:[60,250],TE:[50,200]};
let n=0;const p=(pos,proj)=>({player_id:`${pos}${++n}`,player_name:`${pos}(${proj})`,position:pos,
 projected_points:proj,vor:proj-REP[pos]});
const LIGA=["QB","RB","RB","WR","WR","TE","FLEX","BN"];
let peor=null, ceros=[];
for(let it=0;it<20000;it++){n=0;
 const roster=Array.from({length:4+Math.floor(rand()*6)},()=>{const pos=POS[Math.floor(rand()*4)];
  const [a,b]=rango[pos];return p(pos,Math.round(a+rand()*(b-a)));});
 const cpos=POS[Math.floor(rand()*4)];const [a,b]=rango[cpos];
 const cand=p(cpos,Math.round(a+rand()*(b-a)));
 const mg=lineupFloor({players:[...roster,cand],rosterPositions:LIGA,replacement:REP})
        -lineupFloor({players:roster,rosterPositions:LIGA,replacement:REP});
 const mo=optimo([...roster,cand],LIGA,REP)-optimo(roster,LIGA,REP);
 const err=Math.abs(mg-mo);
 if(!peor||err>peor.err)peor={err,roster,cand,mg,mo};
 if(mg<=0.5&&mo>0.5&&ceros.length<3)ceros.push({roster,cand,mg,mo});
}
const pinta=(o)=>({roster:o.roster.map(r=>r.player_name),cand:o.cand.player_name,
 motor:o.mg,real:o.mo});
console.log("PEOR error de marginal:", JSON.stringify(pinta(peor),null,1));
console.log("\nCASOS «el motor dice 0 y sí mejora»:");
for(const c of ceros) console.log(JSON.stringify(pinta(c)));
