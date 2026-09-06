// ¿El orden que el motor ENSEÑA se invierte respecto al aporte REAL?
import { SLOT_ELIGIBILITY } from "./app/fantasy/leagueValue.js";
import { lineupFloor } from "./app/fantasy/rosterFit.js";
import { bestForMe } from "./app/fantasy/candidates.js";
const REP={QB:233,RB:131,WR:132,TE:113},BENCH=new Set(["BN"]);
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
let seed=777;const rand=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const POS=["QB","RB","WR","TE"],rango={QB:[200,380],RB:[60,260],WR:[60,250],TE:[50,200]};
let n=0;const p=(pos,proj)=>({player_id:`${pos}${++n}`,player_name:`${pos}(${proj})`,position:pos,
 projected_points:proj,vor:proj-REP[pos],tier:1,wg:16,rostered:true});
const LIGA=["QB","RB","RB","WR","WR","TE","FLEX","BN"];
let inversiones=0,total=0,ejemplo=null;
for(let it=0;it<8000;it++){n=0;
 const roster=Array.from({length:5+Math.floor(rand()*4)},()=>{const pos=POS[Math.floor(rand()*4)];
  const[a,b]=rango[pos];return p(pos,Math.round(a+rand()*(b-a)));});
 const cands=Array.from({length:2},()=>{const pos=POS[Math.floor(rand()*4)];
  const[a,b]=rango[pos];return p(pos,Math.round(a+rand()*(b-a)));});
 const out=bestForMe(cands,{roster,rosterPositions:LIGA,replacement:REP});
 if(!out?.primary)continue;
 const oBase=optimo(roster,LIGA,REP);
 const real=new Map(cands.map(c=>[c.player_id,optimo([...roster,c],LIGA,REP)-oBase]));
 const orden=[out.primary,...out.alternates].map(e=>e.row);
 if(orden.length<2)continue;
 total++;
 if(real.get(orden[0].player_id) < real.get(orden[1].player_id)-0.5){
   inversiones++;
   if(!ejemplo)ejemplo={roster:roster.map(r=>r.player_name),
     primero:orden[0].player_name,real1:real.get(orden[0].player_id),
     segundo:orden[1].player_name,real2:real.get(orden[1].player_id),
     motor1:out.primary.fit.marginal,motor2:out.alternates[0].fit.marginal};
 }
}
console.log(`el motor recomienda al PEOR de los dos en ${inversiones}/${total} casos`);
console.log(JSON.stringify(ejemplo,null,1));
