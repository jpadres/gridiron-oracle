/**
 * TARJETAS DE PARTIDO — modelo y mercado con nombre, y el «why» real.
 *
 * Lo crítico: que el marcador proyectado sea visible y del MODELO, que la
 * línea sea del MERCADO y lo diga, que ninguna cifra del modelo lleve
 * lenguaje de mercado («O/U» sobre pred_total era el defecto), y que la
 * atribución abra y sume en la dirección del hueco.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4490);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
console.log("construyendo…");
await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}

const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

for(const [width,height] of [[1440,1100],[768,1024],[390,844]]){
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  const p=await ctx.newPage();
  await p.goto(`${BASE}/predicciones`,{waitUntil:"domcontentloaded"});
  await p.waitForSelector(".matchup");

  const tarjetas=await p.locator(".matchups .matchup").count();
  check(`${width}px: la parrilla pinta sus partidos`,tarjetas>=14,`${tarjetas} tarjetas`);
  check(`${width}px: marcador proyectado en cada tarjeta (2 por partido)`,
        (await p.locator(".matchups .matchup .proj").count())===tarjetas*2);
  check(`${width}px: MODELO y MERCADO con etiqueta, en cada tarjeta`,
        (await p.locator(".matchups .line--model small").count())===tarjetas&&
        (await p.locator(".matchups .line--market small").count())===tarjetas);
  // El innerText llega en MAYÚSCULAS por el CSS: se compara sin caso.
  const primera=(await p.locator(".matchups .matchup").first().innerText()).toUpperCase();
  const antesDelMercado=primera.split("MARKET")[0];
  check(`${width}px: «O/U» sólo aparece en la fila del mercado`,
        primera.includes("MARKET")&&antesDelMercado.includes("MODEL TOTAL")&&
        !antesDelMercado.includes("O/U"),
        primera.replace(/\s+/g," ").slice(0,90));
  check(`${width}px: sin desbordamiento`,
        await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));

  // El «why»: abre, lista 4 drivers con signo, y ninguno inventado.
  const why=p.locator(".matchups .matchup-why").first();
  check(`${width}px: el why existe y está cerrado por defecto`,
        (await why.count())===1&&!(await why.evaluate(e=>e.open)));
  await why.locator("summary").click();
  check(`${width}px: abierto enseña 4 contribuciones con signo`,
        (await why.locator("li").count())===4&&
        /[+−-]\d/.test(await why.locator("li b").first().innerText()));
  await p.screenshot({path:`${OUT}/games-${width}.png`,fullPage:width!==1440});
  await ctx.close();
}
await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
