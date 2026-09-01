/**
 * EL PUESTO APARECE TARDE, Y HASTA HOY ESO TE DEJABA SIN COLUMNA TODA LA NOCHE.
 *
 * Sleeper no publica `draft_order` hasta que se sortea el orden, minutos antes
 * de empezar. El adaptador derivaba el puesto UNA vez, en la primera resolución,
 * así que quien abría el asistente antes del sorteo se quedaba con `slot
 * UNKNOWN` para el resto de la sesión: sin columna marcada en la parrilla y sin
 * calendario de picks. No fallaba nada — y ése es el problema, porque nada en
 * pantalla invitaba a recargar.
 *
 * Este laboratorio abre ANTES del sorteo y comprueba las dos mitades:
 *
 *   1. sin `draft_order` el puesto es UNKNOWN — no un 1 inventado;
 *   2. cuando el sorteo llega, el siguiente sondeo lo recoge SOLO.
 *
 * Se probó inyectando el fallo: con la derivación antigua (una sola vez) el
 * paso 2 se pone rojo. Un guardián que no se pone rojo con el fallo puesto no
 * es un guardián.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, montar } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4517);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

const TEAMS=12, ROUNDS=15, MY_SLOT=7;
const ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
const L=crearLiga({id:"LGP",draftId:"DRP",teams:TEAMS,roster:ROSTER,mySlot:MY_SLOT,rounds:ROUNDS});

// ANTES DEL SORTEO: el draft existe, la liga existe, y el orden NO. Es
// exactamente lo que sirve Sleeper en las horas previas.
const ORDEN = L.draft.draft_order;
const PUESTOS = L.draft.slot_to_roster_id;
delete L.draft.draft_order;
delete L.draft.slot_to_roster_id;
L.draft.status = "pre_draft";

// El formulario NO trae el puesto: si lo trajera, la parrilla se dibujaría con
// el tecleado y este laboratorio no probaría nada.
const GUARDADA={name:"Pre-sorteo",platform:"sleeper",leagueId:"LGP",draftId:"DRP",
  userId:USERNAME,teams:TEAMS,scoring:"ppr",draftType:"snake",rounds:ROUNDS,
  roster:ROSTER,rosterSource:"MANUAL"};

const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await montar(ctx,[L]);
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),GUARDADA);
const page=await ctx.newPage();
await page.clock.install();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");
await page.clock.runFor(1_000);

const scope=()=>page.locator(".room-head p").innerText();
const columnas=()=>page.locator(".room-grid .is-mine").count();

console.log("=== abro antes del sorteo ===");
check("el puesto se declara UNKNOWN y no se inventa un 1",
      /slot UNKNOWN/i.test(await scope()), (await scope()).split("\n").join(" · "));
check("y la parrilla no marca ninguna columna como mía",
      (await columnas())===0, `${await columnas()} celdas`);

console.log("\n=== se sortea el orden mientras la pestaña sigue abierta ===");
L.draft.draft_order = ORDEN;
L.draft.slot_to_roster_id = PUESTOS;
L.draft.status = "drafting";
// Un sondeo. Sin recargar, sin tocar el formulario, sin reconectar.
await page.clock.runFor(16_000);
await page.waitForFunction(
  () => /slot \d+/i.test(document.querySelector(".room-head p")?.textContent ?? ""),
  null, {timeout: 8000}).catch(()=>{});

check(`el siguiente sondeo recoge mi puesto solo — slot ${MY_SLOT}`,
      new RegExp(`slot ${MY_SLOT}\\b`, "i").test(await scope()),
      (await scope()).split("\n").join(" · "));
check("la parrilla marca mi columna en las 15 rondas",
      (await columnas())===ROUNDS, `${await columnas()} de ${ROUNDS}`);
check("y ya no queda ningún UNKNOWN de puesto en pantalla",
      !/slot UNKNOWN/i.test(await page.locator("main").innerText()));

await ctx.close();
await browser.close();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
