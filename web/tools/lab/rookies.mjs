/**
 * NOVATOS: existen, se buscan, se draftean — y NO tienen valor inventado.
 *
 *     EXISTIR != DRAFTEABLE != PROYECTADO != RANKEADO != RECOMENDABLE
 *
 * Lo que se prueba es la frontera: un novato tiene identidad de Sleeper
 * verificada (así que su pick se resuelve y el reloj avanza) y NO tiene VOR
 * (así que no entra en la lista corta y la interfaz escribe UNKNOWN). El fallo
 * que esto vigila es que alguien «arregle» el hueco con un cero.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, emitir as emitirPick, montar } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4514);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const ROOKIES = model.fantasy.rookies ?? [];
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

console.log("=== el universo publicado ===");
check("hay novatos publicados",ROOKIES.length>0,`${ROOKIES.length}`);
check("NINGUNO trae vor, proyección, rank ni tier",
      ROOKIES.every(r=>r.vor===undefined&&r.projected_points===undefined
                     &&r.overall_rank===undefined&&r.tier===undefined),
      "UNKNOWN > INVENTED");
check("todos tienen identidad de Sleeper verificada",
      ROOKIES.every(r=>SLEEPER_OF[r.player_id]),
      `${ROOKIES.filter(r=>SLEEPER_OF[r.player_id]).length}/${ROOKIES.length}`);
check("y ninguno duplica a un jugador del board",
      !ROOKIES.some(r=>BOARD.some(b=>b.player_id===r.player_id)));

const TEAMS=12, ROUNDS=15, MY_SLOT=3;
const ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
let PROV=crearLiga({id:"LGR",draftId:"DRR",teams:TEAMS,roster:ROSTER,mySlot:MY_SLOT,rounds:ROUNDS});
const GUARDADA={name:"Rookie League",platform:"sleeper",leagueId:"LGR",draftId:"DRR",
  userId:USERNAME,teams:TEAMS,scoring:"ppr",draftType:"snake",rounds:ROUNDS,mySlot:MY_SLOT,
  roster:ROSTER,rosterSource:"MANUAL"};

const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await montar(ctx,[PROV]);
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),GUARDADA);
const page=await ctx.newPage();
await page.clock.install();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");
await page.clock.runFor(1_000);

console.log("\n=== visible y buscable ===");
const objetivo=ROOKIES[0];
const nombre=objetivo.player_full_name;
await page.fill(".room-board input", nombre);
await page.waitForTimeout(150);
const fila=page.locator(".room-list li", {hasText: nombre}).first();
check("el novato aparece al buscarlo por nombre",await fila.count()>0,`${nombre} (${objetivo.position} ${objetivo.team})`);
const texto=await fila.innerText();
check("con su posición correcta",texto.includes(objetivo.position),texto.split("\n").join(" · "));
check("marcado ROOKIE",/ROOKIE/.test(texto));
check("y su valor dice UNKNOWN, no un número",/UNKNOWN/.test(texto)&&!/\d+\.\d/.test(texto.replace(/\d+\s*$/,"")),
      texto.split("\n").join(" · "));
check("el contador distingue rankeados de drafteables",
      /of \d+ draftable/i.test(await page.locator(".room-pool").innerText()),
      await page.locator(".room-pool").innerText());
await page.fill(".room-board input","");

console.log("\n=== la lista corta no los traga como cero ===");
await page.waitForSelector(".room-rookie-note",{timeout:5000}).catch(()=>{});
check("se avisa de que hay novatos sin valor validado",
      (await page.locator(".room-rookie-note").count())===1,
      await page.locator(".room-rookie-note").innerText().catch(()=>"sin aviso"));
const cands=await page.locator(".room-cands .nm").allInnerTexts();
const nombresNovatos=new Set(ROOKIES.map(r=>r.player_full_name));
check("y NINGÚN novato entra en la lista corta ordenada por VOR",
      cands.every(n=>!nombresNovatos.has(n)),cands.join(" · "));

console.log("\n=== el rival ficha un novato ===");
const rival=ROOKIES[1];
emitirPick(PROV,1,rival,SLEEPER_OF);
emitirPick(PROV,2,BOARD[0],SLEEPER_OF);
await page.clock.runFor(16_000);
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="2",
                           null,{timeout:8000});
check("el pick del novato SE RESUELVE (no UNMAPPED)",
      (await page.locator(".room-scope-warn").count())===0,
      await page.locator(".room-scope-warn").innerText().catch(()=>"sin UNMAPPED"));
check("y cuenta como pick registrado: el reloj avanza",
      (await page.locator(".room-count strong").innerText())==="2");
await page.fill(".room-board input", rival.player_full_name);
await page.waitForTimeout(150);
// Se comprueba sobre los NOMBRES de las filas, no sobre el texto del `li`: el
// mensaje de «sin resultados» repite la consulta, así que buscar al fichado
// encontraba su propio nombre dentro del aviso de que no está.
check("el novato fichado desaparece de disponibles",
      !(await page.locator(".room-list .nm").allInnerTexts()).includes(rival.player_full_name),
      rival.player_full_name);
await page.fill(".room-board input","");

console.log("\n=== lo ficho yo ===");
const mio=ROOKIES[2];
emitirPick(PROV,3,mio,SLEEPER_OF);   // pick 3 = mi puesto
await page.clock.runFor(16_000);
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="3",
                           null,{timeout:8000});
check("entra en MI plantilla",
      (await page.locator(".room-roster").innerText()).includes(mio.player_full_name),
      `${mio.player_full_name} (${mio.position})`);
check("y el turno siguiente se calcula bien",
      /picks until you/i.test(await page.locator(".room-until").innerText()),
      (await page.locator(".room-until").innerText()).split("\n").join(" · "));

await ctx.close(); await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
