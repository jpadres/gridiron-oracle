/** El descanso llega a la pantalla como HECHO, no como aviso. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4410);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0; const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
await ctx.addInitScript(()=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
  name:"Bye",platform:"manual",leagueId:"LB",draftId:"DB",teams:12,scoring:"ppr",draftType:"snake",rounds:15,mySlot:1})));
const page=await ctx.newPage();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");
// Slot 1: el primer pick es mío, así que entra en la plantilla.
await page.locator(".room-list button").first().click();
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="1");
const bye=await page.locator(".room-roster .room-bye").first().innerText().catch(()=>"");
check("el descanso aparece en la plantilla",/^Bye \d+$/.test(bye),bye||"(vacío)");
const semana=Number(bye.replace(/\D/g,""));
check("y es una semana de temporada regular plausible",semana>=2&&semana<=15,String(semana));
const color=await page.locator(".room-roster .room-bye").first().evaluate(el=>getComputedStyle(el).color);
const alarma=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--live").trim());
check("NO usa el color de alarma: es dato, no aviso",!color.includes(alarma),`${color} vs live ${alarma}`);
const texto=await page.locator(".room-roster").innerText();
check("sin vocabulario de consejo alrededor del descanso",
      !/replace|drop|avoid|warning|problem|need/i.test(texto),texto.replace(/\s+/g," ").slice(0,70));
await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
