/**
 * Las capturas del Live Draft Assistant, en los estados que importan y en los
 * tres anchos. No es un test: es la vista, que es lo único que contesta si la
 * pantalla se lee. Los estados se alcanzan por el MISMO camino que el usuario
 * —picks entrando por el adaptador—, no forzando clases a mano.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

import { USERNAME, crearLiga, emitir as emitirPick, libres as libresDe, montar }
  from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4512);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}
const browser=await launch();

const TEAMS=12, ROUNDS=15;
/* El doble compartido: los cuatro laboratorios sirven el MISMO Sleeper. */
const TEAMS_=TEAMS;
const provider={actual:null};
const ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
function prov(l){
  provider.actual=crearLiga({id:l.leagueId,draftId:l.draftId,teams:l.teams,
    roster:l.roster??ROSTER,mySlot:l.mySlot,rounds:l.rounds??ROUNDS});
  return provider.actual;
}
function emitir(no,row){ emitirPick(provider.actual,no,row,SLEEPER_OF); }
const libres=()=>libresDe(provider.actual,BOARD,SLEEPER_OF);

const LIGA={name:"Sunday Twelve",platform:"sleeper",leagueId:"LGS",draftId:"DRS",userId:"me",
  teams:TEAMS,scoring:"ppr",draftType:"snake",rounds:ROUNDS,mySlot:11,
  roster:["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"],
  rosterSource:"MANUAL"};

const ANCHOS=[[390,844],[768,1024],[1440,1000]];
/** Un estado = hasta qué pick han entrado. Con el puesto 11, mi turno es el 11. */
const ESTADOS=[
  {id:"wait10", hasta:1,  liga:LIGA},
  {id:"wait3",  hasta:8,  liga:LIGA},
  {id:"clock",  hasta:10, liga:LIGA},
  {id:"run",    hasta:10, liga:LIGA, corrida:true},
  {id:"manual", hasta:4,  liga:{...LIGA,platform:"manual",leagueId:"LGM",draftId:"DRM"}},
  {id:"deep",   hasta:10, liga:{...LIGA,name:"Deep32",leagueId:"LGD",draftId:"DRD",teams:32,mySlot:11}},
  {id:"error",  hasta:6,  liga:LIGA, caida:true},
  {id:"done",   hasta:TEAMS*ROUNDS, liga:LIGA},
];
for(const est of ESTADOS){
  for(const [w,h] of ANCHOS){
    prov(est.liga);
    // La corrida: cinco receptores seguidos justo antes de mi turno.
    for(let no=1;no<=est.hasta;no+=1){
      const pool=libres();
      const fila=(est.corrida && no>est.hasta-5)
        ? pool.find(r=>r.position==="WR") : pool[0];
      emitir(no,fila);
    }
    const ctx=await browser.newContext({viewport:{width:w,height:h},reducedMotion:"reduce"});
    await montar(ctx,[provider.actual]);
    await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),est.liga);
    const page=await ctx.newPage();
    await page.clock.install();
    await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector(".room-list button");
    await page.clock.runFor(1_000);
    if(est.hasta>0){
      await page.waitForFunction((n)=>document.querySelector(".room-count strong")?.textContent===String(n),
                                 est.hasta,{timeout:8000}).catch(()=>{});
    }
    if(est.caida){ provider.actual.caido=true; await page.clock.runFor(40_000); }
    await page.screenshot({path:`${OUT}/lda-${w}-${est.id}.png`});
    await ctx.close();
  }
  console.log(`  ${est.id}`);
}
await browser.close(); stop();
console.log("capturas listas");
