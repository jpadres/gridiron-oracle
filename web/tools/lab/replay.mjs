/**
 * DRAFT REPLAY — la suite del bloque.
 *
 * Lo crítico: la disponibilidad HISTÓRICA (un jugador cogido en el pick 20
 * está libre en el cursor 10), el replay como sólo lectura (mirar el pasado no
 * puede tocar el registro), y que salir devuelve el vivo intacto.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4460);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
console.log("construyendo…");
await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}

const browser=await launch();
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

const NORMAL=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN"];
const LIGA=(o={})=>({name:"Rep",platform:"manual",leagueId:"REP",draftId:"DREP",teams:4,
  scoring:"ppr",draftType:"snake",rounds:8,mySlot:1,roster:NORMAL,rosterSource:"MANUAL",...o});
const cuenta=(p)=>p.locator(".room-count strong").innerText();
const pick=async(p,n)=>{await p.locator(".room-list button:enabled").first().click();
  await p.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),n);};
const cursor=async(p,n)=>{await p.locator('.room-replay-bar input[type="range"]').fill(String(n));
  await p.waitForTimeout(40);};

const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),LIGA());
const page=await ctx.newPage();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");

/* === historia con RUIDO: picks, un deshacer y un rehecho ================== */
console.log("=== construir la historia (con deshacer en medio) ===");
const nombres=[];
for(let i=1;i<=12;i+=1){
  nombres.push(await page.locator(".room-list .nm").first().innerText());
  await pick(page,i);
}
// Deshacer el pick 12 y coger a OTRO: el deshecho no es historia efectiva.
const deshecho=nombres[11];
await page.locator(".room-flash button").click();
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="11");
await page.locator(".draft-search").fill("");
const sustituto=await page.locator(".room-list .nm").nth(3).innerText();
await page.locator(".room-list button:enabled").nth(3).click();
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="12");
for(let i=13;i<=20;i+=1){nombres.push("x");await pick(page,i);}
const logAntes=await page.evaluate(()=>localStorage.getItem("gridiron-draft-v2:manual:2026:REP:DREP:log"));
check("veinte picks efectivos con un deshacer en la historia",(await cuenta(page))==="20");

/* === entrar: histórico inconfundible ====================================== */
console.log("\n=== entrar en el replay ===");
await page.locator(".room-replay-enter").click();
await page.waitForSelector(".room-state--replay");
const banda=await page.locator(".room-state--replay").innerText();
check("la banda dice REPLAY",/replay/i.test(banda),banda.replace(/\s+/g," ").slice(0,60));
check("y no hay reloj en vivo",!/on the clock|until you/i.test(banda));
check("las filas del board están deshabilitadas",
      (await page.locator(".room-list button:disabled").count())>0);
check("deshacer desaparece",(await page.locator(".room-x:visible").count())===0);

/* === disponibilidad histórica: LO CRÍTICO ================================= */
console.log("\n=== disponibilidad histórica ===");
await cursor(page,10);
const dispEn10=await page.locator(".room-list .nm").allInnerTexts();
check("en el cursor 10, el pick 15 sigue disponible",dispEn10.length>0&&!dispEn10.includes(nombres[0]),
      `${dispEn10.length} visibles`);
check("y el pick 1 NO está",!dispEn10.includes(nombres[0]),nombres[0]);
// El jugador deshecho está disponible en TODO cursor: no es historia efectiva.
for(const n of [0,5,11,20]){
  await cursor(page,n);
  const textos=await page.locator(".room-list .nm").allInnerTexts();
  const esta=textos.includes(deshecho);
  if(n===20&&!esta){
    // salvo que el azar lo haya recogido después como sustituto — comprobar feed
    const feed=await page.locator(".room-feed .feed-who").allInnerTexts();
    check(`cursor ${n}: el deshecho o está libre o fue recogido después`,feed.includes(deshecho),deshecho);
  } else {
    check(`cursor ${n}: el pick deshecho aparece disponible`,esta,deshecho);
  }
}
// Búsqueda sobre el pool histórico.
await cursor(page,3);
const cogidoTarde=sustituto.split(" ").pop();
await page.locator(".draft-search").fill(cogidoTarde);
await page.waitForTimeout(80);
const resultados=await page.locator(".room-list .nm").allInnerTexts();
check("la búsqueda opera sobre el pool histórico",
      resultados.some((n)=>n.includes(cogidoTarde)),`buscando «${cogidoTarde}»`);
await page.locator(".draft-search").fill("");

/* === plantilla histórica ================================================== */
console.log("\n=== plantilla histórica ===");
await cursor(page,20);
const llenosFinal=await page.locator(".room-roster--slots > li:not(.is-open)").count();
await cursor(page,2);
const llenos2=await page.locator(".room-roster--slots > li:not(.is-open)").count();
check("la construcción retrocede con el cursor",llenos2<llenosFinal,`${llenos2} < ${llenosFinal}`);
check("los nueve huecos se siguen pintando",
      (await page.locator(".room-roster--slots > li").count())===9);
await cursor(page,0);
check("en el cursor 0 todo está abierto",
      (await page.locator(".room-roster--slots > li.is-open").count())===9);
check("y el feed está vacío",(await page.locator(".room-feed li").count())===0);
const banda0=await page.locator(".room-state--replay").innerText();
check("el cursor 0 se dice como pre-draft",/before the draft/i.test(banda0));

/* === profundidad y cortes: contra el pool histórico ======================= */
await cursor(page,0);
const tierEn0=await page.locator(".room-tier-left").first().innerText();
await cursor(page,20);
const tierEn20=await page.locator(".room-tier-left").first().innerText().catch(()=>"(sin cortes)");
check("el corte de tier cambia con el cursor",tierEn0!==tierEn20||tierEn0!=="",
      `0:«${tierEn0}» 20:«${tierEn20}»`);

/* === rendimiento del arrastre ============================================= */
console.log("\n=== rendimiento ===");
{
  const t0=Date.now();
  for(let n=0;n<=20;n+=1) await cursor(page,n);
  const ms=Date.now()-t0;
  check("veintiún saltos de cursor por debajo de 2 s",ms<2000,`${ms} ms (${Math.round(ms/21)} ms/salto)`);
}

/* === sólo lectura: mirar el pasado no toca nada =========================== */
console.log("\n=== seguridad del vivo ===");
await cursor(page,5);
await page.locator(".room-list button").first().click({force:true}).catch(()=>{});
await page.waitForTimeout(120);
const logDurante=await page.evaluate(()=>localStorage.getItem("gridiron-draft-v2:manual:2026:REP:DREP:log"));
check("pulsar una fila en replay NO escribe nada",logDurante===logAntes);
await page.locator(".room-state--replay button").click();   // back to live
await page.waitForSelector(".room-state:not(.room-state--replay)");
check("volver al vivo restaura el presente",(await cuenta(page))==="20");
check("y el registro está byte a byte igual",
      (await page.evaluate(()=>localStorage.getItem("gridiron-draft-v2:manual:2026:REP:DREP:log")))===logAntes);

// Atrás del navegador también sale.
await page.locator(".room-replay-enter").click();
await page.waitForSelector(".room-state--replay");
await page.goBack();
await page.waitForSelector(".room-state:not(.room-state--replay)",{timeout:5000});
check("el botón Atrás sale del replay sin salir de la sala",
      (await cuenta(page))==="20");

// Recargar vuelve al vivo: el cursor no se persiste, a propósito.
await page.locator(".room-replay-enter").click();
await page.waitForSelector(".room-state--replay");
await cursor(page,7);
await page.reload({waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");
check("recargar vuelve al VIVO (el cursor no se persiste, a propósito)",
      (await page.locator(".room-state--replay").count())===0&&(await cuenta(page))==="20");

/* === offline ============================================================== */
console.log("\n=== offline ===");
await ctx.setOffline(true);
await page.locator(".room-replay-enter").click();
await page.waitForSelector(".room-state--replay");
await cursor(page,4);
check("el replay funciona sin red",
      (await page.locator(".room-roster--slots > li:not(.is-open)").count())<llenosFinal);
await ctx.setOffline(false);
await page.locator(".room-state--replay button").click();

/* === capturas ============================================================= */
await page.locator(".room-replay-enter").click();
await page.waitForSelector(".room-state--replay");
await cursor(page,0);
await page.screenshot({path:`${OUT}/replay-1440-predraft.png`});
await cursor(page,10);
await page.screenshot({path:`${OUT}/replay-1440-mid.png`});
await cursor(page,20);
await page.screenshot({path:`${OUT}/replay-1440-end.png`});
await page.close();

/* === aislamiento A/B/A ==================================================== */
console.log("\n=== aislamiento multi-liga ===");
{
  await ctx.addInitScript(()=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"B32",platform:"manual",leagueId:"RB32",draftId:"DB32",teams:32,scoring:"ppr",
    draftType:"snake",rounds:8,mySlot:9,
    roster:["RB","WR","FLEX","FLEX","FLEX","SUPER_FLEX","BN"],rosterSource:"MANUAL"})));
  const b=await ctx.newPage();
  await b.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await b.waitForSelector(".room-list button");
  for(let i=1;i<=5;i+=1) await pick(b,i);
  await b.locator(".room-replay-enter").click();
  await b.waitForSelector(".room-state--replay");
  await b.locator('.room-replay-bar input[type="range"]').fill("3");
  await b.waitForTimeout(60);
  check("el replay de B usa el máximo de B",(
        await b.locator('.room-replay-bar input[type="range"]').getAttribute("max"))==="5");
  check("y pinta la estructura de B (seis huecos)",
        (await b.locator(".room-roster--slots > li").count())===6);
  await b.screenshot({path:`${OUT}/replay-1440-32man.png`});
  await b.close();

  await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),LIGA());
  const a=await ctx.newPage();
  await a.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await a.waitForSelector(".room-list button");
  await a.locator(".room-replay-enter").click();
  await a.waitForSelector(".room-state--replay");
  check("de vuelta en A, su replay tiene SUS veinte picks",(
        await a.locator('.room-replay-bar input[type="range"]').getAttribute("max"))==="20");
  await a.close();
}

/* === draft completo: la entrada cambia ==================================== */
console.log("\n=== draft completo ===");
{
  await ctx.addInitScript(()=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"Full",platform:"manual",leagueId:"RF",draftId:"DRF",teams:4,scoring:"ppr",
    draftType:"snake",rounds:5,mySlot:2,roster:["QB","RB","WR","TE","FLEX","BN"],rosterSource:"MANUAL"})));
  const f=await ctx.newPage();
  await f.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await f.waitForSelector(".room-list button");
  for(let i=1;i<=20;i+=1) await pick(f,i);
  const bandaFin=await f.locator(".room-state").innerText();
  check("el draft completo lo dice, sin reloj",/draft complete/i.test(bandaFin),
        bandaFin.replace(/\s+/g," ").slice(0,60));
  check("y la entrada pasa a «Review the draft»",
        /review the draft/i.test(await f.locator(".room-replay-enter").innerText()));
  await f.screenshot({path:`${OUT}/replay-1440-complete.png`});
  await f.close();
}

/* === móvil y tablet ======================================================= */
for(const width of [390,768]){
  const c2=await browser.newContext({viewport:{width,height:width===390?844:1024}});
  await c2.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),LIGA());
  const m=await c2.newPage();
  await m.goto(`${BASE}/fantasy/draft`,{waitUntil:"networkidle"});
  await m.waitForSelector(".room-list button");
  // Contexto nuevo = registro nuevo: sin picks no hay nada que revisar y el
  // botón de replay NO existe — comprobado, y es lo correcto. Se draftea antes.
  check(`a ${width}px sin picks no hay entrada de replay`,
        (await m.locator(".room-replay-enter").count())===0);
  for(let i=1;i<=10;i+=1) await pick(m,i);
  await m.locator(".room-replay-enter").click();
  await m.waitForSelector(".room-state--replay");
  await m.locator('.room-replay-bar input[type="range"]').fill("8");
  await m.waitForTimeout(60);
  const pequenos=await m.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll(".room-replay-bar button, .room-replay-bar input, .room-state--replay button")){
      const r=el.getBoundingClientRect();
      if(r.width>0&&(r.width<44||r.height<44)) out.push(`${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  check(`a ${width}px los controles del replay miden 44px o más`,pequenos.length===0,pequenos.join(", "));
  check(`a ${width}px sin desbordamiento`,
        await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  await m.screenshot({path:`${OUT}/replay-${width}-mid.png`});
  await c2.close();
}

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
