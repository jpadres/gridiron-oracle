/**
 * LABORATORIO DEL BLOQUE: ranking semanal interactivo + draft completo de 12.
 *
 * Parte A — el explorador semanal: multi-selección real (RB+WR, QB+TE, K+DST),
 * la frontera de autoridad pintada (K sin rank, DST sin proyección), y las
 * capturas 390/768/1440 de los seis estados que manda el bloque.
 *
 * Parte B — un draft de 12 equipos, snake, plantilla estándar, de principio a
 * fin por el navegador: 180 picks reales verificando en cada etapa el pool, el
 * turno, la construcción, los tiers, el deshacer, la persistencia del filtro a
 * través de los picks y el coste de interacción del modo manual.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4480);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";

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

/* ==========================================================================
   PARTE A — EXPLORADOR SEMANAL
   ========================================================================== */
console.log("=== A. explorador semanal ===");
const pulsar=async(p,chip)=>{await p.locator(`.wk .pos-option:text-is("${chip}")`).click();await p.waitForTimeout(60);};
const filas=(p)=>p.locator(".wk-table tbody tr").count();

for(const [width,height] of [[1440,1100],[768,1024],[390,844]]){
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  const p=await ctx.newPage();
  await p.goto(`${BASE}/fantasy/semanal`,{waitUntil:"domcontentloaded"});
  await p.waitForSelector(".wk .pos-filter");

  // ALL: tabla ofensiva + los dos paneles presentes.
  check(`${width}px ALL: tabla y paneles K/DST presentes`,
        (await filas(p))>0&&(await p.locator("#k").count())===1&&(await p.locator("#dst").count())===1);
  await p.screenshot({path:`${OUT}/wk-${width}-all.png`,fullPage:width!==1440});

  // RB+WR: sólo esas posiciones, sin paneles.
  await pulsar(p,"RB");await pulsar(p,"WR");
  const tags=await p.locator(".wk-table tbody .ptag").allInnerTexts();
  check(`${width}px RB+WR: sólo RB y WR en la tabla`,
        tags.length>0&&tags.every(t=>/^RB|^WR/.test(t)),`${tags.length} filas`);
  check(`${width}px RB+WR: sin panel de K ni DST`,
        (await p.locator("#k").count())===0&&(await p.locator("#dst").count())===0);
  await p.screenshot({path:`${OUT}/wk-${width}-rbwr.png`});

  // QB+TE.
  await pulsar(p,"RB");await pulsar(p,"WR");await pulsar(p,"QB");await pulsar(p,"TE");
  const qbte=await p.locator(".wk-table tbody .ptag").allInnerTexts();
  check(`${width}px QB+TE funciona`,qbte.length>0&&qbte.every(t=>/^QB|^TE/.test(t)));
  if(width===1440) await p.screenshot({path:`${OUT}/wk-1440-qbte.png`});

  // K solo: panel sin columna de rank y sin tabla ofensiva.
  await pulsar(p,"QB");await pulsar(p,"TE");await pulsar(p,"K");
  check(`${width}px K: panel presente, tabla ofensiva ausente`,
        (await p.locator("#k").count())===1&&(await p.locator(".wk > .table-wrap").count())===0);
  const cabecerasK=await p.locator("#k thead th").allInnerTexts();
  check(`${width}px K: sin columna de rank`,!cabecerasK.some(h=>/^#|rank/i.test(h)),cabecerasK.join("|"));
  if(width===1440) await p.screenshot({path:`${OUT}/wk-1440-k.png`});

  // DST solo: hechos, sin proyección.
  await pulsar(p,"K");await pulsar(p,"DST");
  const cabecerasD=await p.locator("#dst thead th").allInnerTexts();
  check(`${width}px DST: sin proyección ni rank`,
        !cabecerasD.some(h=>/proj|rank|^#/i.test(h)),cabecerasD.join("|"));
  check(`${width}px DST: 32 defensas`,(await p.locator("#dst tbody tr").count())===32);
  if(width===1440) await p.screenshot({path:`${OUT}/wk-1440-dst.png`});

  // K+DST juntos.
  await pulsar(p,"K");
  check(`${width}px K+DST: los dos paneles, cero tabla ofensiva`,
        (await p.locator("#k").count())===1&&(await p.locator("#dst").count())===1&&
        (await p.locator(".wk > .table-wrap").count())===0);
  await p.screenshot({path:`${OUT}/wk-${width}-kdst.png`});

  check(`${width}px sin desbordamiento horizontal`,
        await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  const pequenos=await p.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll(".wk button")){
      const r=el.getBoundingClientRect();
      if(r.width>0&&r.height>0&&(r.height<44)) out.push(`${el.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  check(`${width}px chips de 44px o más`,pequenos.length===0,pequenos.join(", "));
  await ctx.close();
}

/* ==========================================================================
   PARTE B — DRAFT COMPLETO DE 12 EQUIPOS
   ========================================================================== */
console.log("\n=== B. draft de 12 equipos, de la primera a la última ===");
const LIGA={name:"Sunday Twelve",platform:"manual",leagueId:"S12",draftId:"DS12",teams:12,
  scoring:"ppr",draftType:"snake",rounds:15,mySlot:7,
  roster:["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"],
  rosterSource:"MANUAL"};
const ctx=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:"reduce"});
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),LIGA);
const page=await ctx.newPage();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");

const cuenta=()=>page.locator(".room-count strong").innerText();
const pick=async(n)=>{
  await page.locator(".room-list button:enabled").first().click();
  await page.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),n);
};
// Mis turnos en serpiente de 12 con el puesto 7 (ronda impar 7º, par 6º).
const mios=new Set();
for(let r=0;r<15;r+=1) mios.add(r*12+(r%2===0?7:6));

// --- pick 1: el jugador desaparece del pool -------------------------------
const primero=await page.locator(".room-list .nm").first().innerText();
await pick(1);
check("el pick 1 desaparece del board al registrarlo",
      !(await page.locator(".room-list .nm").allInnerTexts()).includes(primero),primero);
check("y aparece en el feed",
      (await page.locator(".room-feed .feed-who").first().innerText())===primero);

// --- deshacer en caliente --------------------------------------------------
await page.locator(".room-flash button").click();
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="0");
check("deshacer lo devuelve al pool",
      (await page.locator(".room-list .nm").first().innerText())===primero);
await pick(1);

// --- coste de interacción del modo manual (fase 21) ------------------------
{
  const t0=Date.now();
  for(let n=2;n<=21;n+=1) await pick(n);
  const ms=Math.round((Date.now()-t0)/20);
  check("un pick manual = UN toque, por debajo de 400 ms de media",ms<400,`${ms} ms/pick`);
}
await page.screenshot({path:`${OUT}/draft12-1440-early.png`});

// --- persistencia del filtro a través de los picks (fase 29) ----------------
await page.locator('.pos-option:text-is("RB")').click();
await page.locator('.pos-option:text-is("WR")').click();
await pick(22);
check("el filtro RB+WR sobrevive al pick",
      (await page.locator('.pos-option:text-is("RB")').getAttribute("aria-pressed"))==="true"&&
      (await page.locator('.pos-option:text-is("WR")').getAttribute("aria-pressed"))==="true");
const soloRbWr=await page.locator(".room-list .ptag").allInnerTexts();
check("y la lista sólo trae RB y WR",soloRbWr.every(t=>/^RB|^WR/.test(t)));

// --- racha de posición: seis corredores seguidos, el tier reacciona ---------
const tierAntes=await page.locator(".room-tier-left").first().innerText();
for(let n=23;n<=28;n+=1) await pick(n);
const tierDespues=await page.locator(".room-tier-left").first().innerText();
check("seis RB/WR seguidos mueven el conteo del tier",tierAntes!==tierDespues,
      `«${tierAntes}» -> «${tierDespues}»`);
await page.screenshot({path:`${OUT}/draft12-1440-run.png`});
await page.locator('.pos-option:text-is("ALL")').click();

// --- hasta mi turno de la ronda 3: el overall 31 (ronda 3, puesto 7) --------
for(let n=29;n<=30;n+=1) await pick(n);
const banda=await page.locator(".room-state").innerText();
check("EN el reloj la banda es inconfundible",/on the clock|your pick/i.test(banda),
      banda.replace(/\s+/g," ").slice(0,60));
await page.screenshot({path:`${OUT}/draft12-1440-onclock.png`});
await pick(31);
check("mi pick entra en MI plantilla",
      (await page.locator(".room-roster--slots > li:not(.is-open)").count())>0);

// --- el medio del draft, con K y DST fichados ------------------------------
for(let n=32;n<=90;n+=1) await pick(n);
await page.screenshot({path:`${OUT}/draft12-1440-mid.png`});
// Fichar un K y una DST con el filtro (mío no: turno de quien toque).
await page.locator('.pos-option:text-is("K")').click();
const kNombre=await page.locator(".room-list .nm").first().innerText();
await pick(91);
check("un pateador se registra como pick",kNombre.length>0&&(await cuenta())==="91");
await page.locator('.pos-option:text-is("K")').click();
await page.locator('.pos-option:text-is("DST")').click();
await pick(92);
check("una defensa se registra como pick",(await cuenta())==="92");
check("el feed resuelve el nombre de la defensa",
      /D\/ST/.test(await page.locator(".room-feed .feed-who").first().innerText()));
await page.locator('.pos-option:text-is("ALL")').click();

// --- mis K y DEF llenan sus huecos -----------------------------------------
// Avanza hasta mi siguiente turno y ficha K; luego DST en el siguiente.
let n=Number(await cuenta());
const proximoMio=()=>{let x=n+1;while(!mios.has(x))x+=1;return x;};
let objetivo=proximoMio();
while(n<objetivo-1){n+=1;await pick(n);}
await page.locator('.pos-option:text-is("K")').click();
await page.locator(".room-list button:enabled").first().click();
await page.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),objetivo);
n=objetivo;
await page.locator('.pos-option:text-is("K")').click();
objetivo=proximoMio();
while(n<objetivo-1){n+=1;await pick(n);}
await page.locator('.pos-option:text-is("DST")').click();
await page.locator(".room-list button:enabled").first().click();
await page.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),objetivo);
n=objetivo;
await page.locator('.pos-option:text-is("ALL")').click();
const huecos=await page.locator(".room-roster--slots > li").allInnerTexts();
check("mi K llena el hueco K",huecos.some(h=>/^K/.test(h)&&!/open/i.test(h)),
      huecos.find(h=>/^K/.test(h)));
check("mi DST llena el hueco DEF",huecos.some(h=>/^DEF/.test(h)&&!/open/i.test(h)),
      huecos.find(h=>/^DEF/.test(h)));

// --- hasta el final ---------------------------------------------------------
while(n<180){n+=1;await pick(n);}
check("180 de 180: el draft se declara completo",
      /draft complete/i.test(await page.locator(".room-state").innerText()));
check("y la entrada pasa a revisar el draft",
      (await page.locator(".room-replay-enter").count())===1);
await page.screenshot({path:`${OUT}/draft12-1440-late.png`});

// --- prueba de los cinco segundos (fase 44), como hechos comprobables -------
console.log("\n=== los cinco segundos ===");
check("¿quién acaba de ser fichado? — el feed lo dice arriba",
      (await page.locator(".room-feed .feed-who").count())>0);
// La frontera hecho/consejo está tras divulgación progresiva a propósito:
// nadie lee prosa de validación en mitad de un draft. Lo comprobable: el
// resumen está visible y al abrirlo la declaración aparece.
check("¿qué es hecho y qué consejo? — la metodología está a un toque",
      (await page.locator(".room-method summary").isVisible()));
await page.locator(".room-method summary").click();
check("…y abierta declara «not a recommendation»",
      /not.*a recommendation/i.test(await page.locator(".room-method").innerText()));

// --- móvil y tablet del draft ----------------------------------------------
for(const [width,height] of [[390,844],[768,1024]]){
  const c2=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  await c2.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),
    {...LIGA,leagueId:`S12${width}`,draftId:`DS12${width}`});
  const m=await c2.newPage();
  await m.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await m.waitForSelector(".room-list button");
  // Seis picks: el séptimo es mío (puesto 7 de 12) — el reloj móvil de verdad.
  for(let i=1;i<=6;i+=1){
    await m.locator(".room-list button:enabled").first().click();
    await m.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),i);
  }
  check(`${width}px draft: el reloj también es inconfundible`,
        /on the clock|your pick/i.test(await m.locator(".room-state").innerText()));
  await m.screenshot({path:`${OUT}/draft12-${width}-onclock.png`});
  for(let i=7;i<=8;i+=1){
    await m.locator(".room-list button:enabled").first().click();
    await m.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),i);
  }
  check(`${width}px draft: sin desbordamiento`,
        await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  await m.screenshot({path:`${OUT}/draft12-${width}-mid.png`});
  await c2.close();
}
await ctx.close();

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
