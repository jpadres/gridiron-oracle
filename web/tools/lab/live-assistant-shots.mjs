/**
 * Las capturas del Live Draft Assistant, en los estados que importan y en los
 * tres anchos. No es un test: es la vista, que es lo único que contesta si la
 * pantalla se lee. Los estados se alcanzan por el MISMO camino que el usuario
 * —picks entrando por el adaptador—, no forzando clases a mano.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4512);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});

const TEAMS=12, ROUNDS=15;
const provider={picks:[],estado:"drafting",caido:false};
const slotOf=(no)=>{const r=Math.floor((no-1)/TEAMS)+1,i=((no-1)%TEAMS)+1;return r%2===0?TEAMS-i+1:i;};
function emitir(no,row,mySlot){
  const [first,...rest]=(row.player_full_name ?? row.player_name).split(" ");
  // MIS picks van a mi nombre. Con todo a nombre de otros, la captura del draft
  // terminado enseñaba una plantilla vacía después de 180 picks: una imagen
  // falsa de un estado correcto.
  provider.picks.push({pick_no:no,player_id:`sl-${row.player_id}`,
    picked_by: slotOf(no)===mySlot ? "me" : `otro-${slotOf(no)}`,
    metadata:{first_name:first,last_name:rest.join(" "),position:row.position,team:row.team}});
}
const libres=()=>BOARD.filter(r=>!provider.picks.some(p=>p.player_id===`sl-${r.player_id}`));
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
    provider.picks=[]; provider.estado="drafting"; provider.caido=false;
    // La corrida: cinco receptores seguidos justo antes de mi turno.
    for(let no=1;no<=est.hasta;no+=1){
      const pool=libres();
      const fila=(est.corrida && no>est.hasta-5)
        ? pool.find(r=>r.position==="WR") : pool[0];
      emitir(no,fila,est.liga.mySlot);
    }
    const ctx=await browser.newContext({viewport:{width:w,height:h},reducedMotion:"reduce"});
    await ctx.route("**/api.sleeper.app/**",async(route)=>{
      if(provider.caido) return route.fulfill({status:503,contentType:"application/json",body:'{"e":1}'});
      const u=route.request().url();
      if(u.includes("/drafts")) return route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify([{draft_id:"DRS",status:provider.estado,season:"2026",
          settings:{teams:TEAMS,rounds:ROUNDS},type:"snake"}])});
      if(u.includes("/picks")) return route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify(provider.picks)});
      return route.fulfill({status:404,body:"[]"});
    });
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
    if(est.caida){ provider.caido=true; await page.clock.runFor(40_000); }
    await page.screenshot({path:`${OUT}/lda-${w}-${est.id}.png`});
    await ctx.close();
  }
  console.log(`  ${est.id}`);
}
await browser.close(); stop();
console.log("capturas listas");
