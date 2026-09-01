/**
 * CONECTAR CON SLEEPER DESDE CERO, como lo hace una persona.
 *
 * Sin localStorage sembrado: se abre el asistente por primera vez, se rellena
 * el formulario y se comprueba que la sincronización arranca. Es el único test
 * que recorre el camino que el usuario recorre — los demás sembraban la liga
 * ya configurada, y por eso ninguno vio que NO HABÍA CAMPOS para conectar.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { USERNAME, crearLiga, emitir as emitirPick, montar } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4515);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s,g])=>[g,s]));
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error("build")));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

// La liga REAL del proveedor: 10 equipos, media recepción, mi puesto el 4.
const PROV=crearLiga({id:"987654321",draftId:"DR987",teams:10,mySlot:4,rounds:15,
  roster:["QB","RB","RB","WR","WR","WR","TE","FLEX","BN","BN","BN","BN","BN","BN","BN"],
  scoring:{rec:0.5}, name:"Sunday Money"});

const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await montar(ctx,[PROV]);
const page=await ctx.newPage();
await page.clock.install();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});

console.log("=== primera visita: el formulario ===");
await page.waitForSelector(".room-setup");
const etiquetas=(await page.locator(".room-setup .field-label").allInnerTexts()).join(" | ");
check("el formulario ofrece conectar Sleeper",/sleeper league id/i.test(etiquetas),
      etiquetas.split("\n").join(" ").slice(0,150));
check("y pide el usuario para saber qué picks son míos",/sleeper username/i.test(etiquetas));

console.log("\n=== relleno y entro ===");
const campos=page.locator(".room-setup input[type=text]");
await page.locator(".field-label", {hasText:"Sleeper league ID"}).locator("input").fill("987654321");
await page.locator(".field-label", {hasText:"Sleeper username"}).locator("input").fill(USERNAME);
await page.locator(".room-setup button[type=submit]").click();
await page.waitForSelector(".room-list button",{timeout:8000});
await page.clock.runFor(1_000);
await page.waitForSelector(".room-head-src",{timeout:8000}).catch(()=>{});

const cabecera=await page.locator(".room-head p").innerText();
check("la sincronización arranca sola y los ajustes vienen del proveedor",
      /from sleeper/i.test(cabecera),cabecera.split("\n").join(" · "));
check("tamaño, puntuación y puesto son los REALES (10 / half / 4)",
      /10-team/i.test(cabecera)&&/half ppr/i.test(cabecera)&&/slot 4/i.test(cabecera),
      cabecera.split("\n").join(" · "));
const banda=await page.locator(".room-link b").innerText();
check("la banda dice LIVE con evidencia",/live/i.test(banda),banda);
check("y dice qué draft sigue",/DR987/.test(await page.locator(".room-scope-link").innerText()));

console.log("\n=== y sigue el draft ===");
emitirPick(PROV,1,BOARD[0],SLEEPER_OF);
await page.clock.runFor(16_000);
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="1",
                           null,{timeout:8000});
check("un pick de Sleeper entra solo",(await page.locator(".room-count strong").innerText())==="1");
check("y el jugador sale del board",
      !(await page.locator(".room-list .nm").allInnerTexts()).includes(BOARD[0].player_full_name),
      BOARD[0].player_full_name);

console.log("\n=== sin id de Sleeper sigue siendo manual ===");
const c2=await browser.newContext({viewport:{width:1440,height:900}});
await montar(c2,[PROV]);
const p2=await c2.newPage();
await p2.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await p2.waitForSelector(".room-setup");
await p2.locator(".room-setup button[type=submit]").click();
await p2.waitForSelector(".room-list button",{timeout:8000});
check("sin id, el asistente entra en MANUAL y no finge conexión",
      /manual/i.test(await p2.locator(".room-link b").innerText()),
      await p2.locator(".room-link b").innerText());
await c2.close();

await ctx.close(); await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
