/**
 * BETTING COMMAND CENTER — el escenario de los $10.000, por el navegador.
 *
 * Crear el mes, llevar cuatro apuestas del board al slip (un spread, un total
 * y dos props con la línea tecleada), asignar stakes, registrarlas, liquidar
 * ganada/perdida/push dejando una abierta, y comprobar que CADA número que
 * pinta la pantalla cuadra con la aritmética. Después: recarga, segundo mes,
 * aislamiento, primer viewport a tres anchos y capturas.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4500);
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
const stat=async(p,label)=>{
  const dd=await p.locator(`.bk-stats div:has(dt:text-is("${label}")) dd`).innerText();
  return dd.split("\n")[0].trim();
};

const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:"reduce"});
const page=await ctx.newPage();
page.on("pageerror",(e)=>console.log("  PAGEERROR:",String(e).slice(0,300)));
await page.goto(`${BASE}/betting`,{waitUntil:"domcontentloaded"});

/* === crear el mes ========================================================= */
console.log("=== crear septiembre con $10.000 ===");
await page.waitForSelector(".bk-start");
check("sin mes no hay board: primero la banca",(await page.locator(".bk-leans").count())===0);
await page.locator('.bk-start-form input[type="month"]').fill("2026-09");
await page.locator('.bk-start-form input[type="number"]').fill("10000");
await page.locator(".bk-start-form .bk-primary").click();
await page.waitForSelector(".bk-head");
check("la cabecera dice el mes y la banca",
      /2026-09/.test(await page.locator(".bk-month h1").innerText())&&
      /\$10,000 starting/.test(await page.locator(".bk-starting").innerText()));
check("disponible = $10,000, cero expuesto",
      (await stat(page,"Available"))==="$10,000"&&(await stat(page,"Open"))==="$0");

/* === primer viewport ====================================================== */
console.log("\n=== el primer viewport responde ===");
const lean1=await page.locator(".bk-leans > li").first().boundingBox();
check("banca Y primer lean dentro del primer viewport (1440×900)",
      lean1!==null&&lean1.y+lean1.height<900,`lean en y=${Math.round(lean1?.y ?? -1)}`);
await page.screenshot({path:`${OUT}/bk-1440-fresh.png`});

/* === al slip: spread y total desde los leans ============================== */
console.log("\n=== construir el slip ===");
const leanLabels=await page.locator(".bk-leans .bk-lean-what b").allInnerTexts();
const familias=await page.locator(".bk-leans .bk-lean-what small").allInnerTexts();
const iSpread=familias.findIndex(t=>/^Spread/.test(t));
const iTotal=familias.findIndex(t=>/^Total/.test(t));
check("hay leans de spread y de total en el top",iSpread>=0&&iTotal>=0,
      leanLabels.slice(0,3).join(" | "));
await page.locator(".bk-leans > li button").nth(iSpread).click();
await page.locator(".bk-leans > li button").nth(iTotal).click();

// Dos props: la línea la teclea el usuario. Antes de teclear: market unavailable.
check("sin línea tecleada, el prop dice MARKET UNAVAILABLE",
      (await page.locator(".bk-props .bk-nomarket").count())>0);
const qbProj=Number((await page.locator(".bk-props tbody tr").first().locator(".bk-proj").innerText()).replace(",",""));
await page.locator(".bk-props tbody tr").first().locator(".bk-line").fill(String(qbProj-12));
await page.waitForTimeout(60);
check("con línea, aparece el lean OVER con la diferencia",
      /OVER/.test(await page.locator(".bk-props tbody tr").first().innerText()));
await page.locator(".bk-props tbody tr").first().locator("td:last-child button").click();
await page.locator('.pos-option:text-is("Receptions")').click();
const wrProj=Number((await page.locator(".bk-props tbody tr").first().locator(".bk-proj").innerText()).replace(",",""));
await page.locator(".bk-props tbody tr").first().locator(".bk-line").fill(String((wrProj+1.5).toFixed(1)));
await page.waitForTimeout(60);
check("una línea por encima de la media da UNDER",
      /UNDER/.test(await page.locator(".bk-props tbody tr").first().innerText()));
await page.locator(".bk-props tbody tr").first().locator("td:last-child button").click();

check("el slip lleva 4 en consideración y nada expuesto aún",
      (await page.locator(".bk-slip > li").count())===4&&(await stat(page,"Open"))==="$0");

/* === stakes y registro ==================================================== */
const stakes=[150,100,100,100];
for(let i=0;i<4;i+=1){
  await page.locator(".bk-slip > li").nth(i).locator('label:has-text("Stake") input').fill(String(stakes[i]));
}
await page.waitForTimeout(60);
check("el % de banca y las unidades se calculan solos",
      /1\.5% bank · 1\.5u/.test((await page.locator(".bk-slip > li").first().locator(".bk-slip-math").innerText()).replace(/\s+/g," ")));
check("la nueva exposición del pie suma $450",
      /\$450/.test(await page.locator(".bk-slip-foot").innerText()));
// Captura del slip SIN fullPage: la emulación de página completa redimensiona
// el viewport y el click siguiente aterrizaba en un árbol re-renderizado.
await page.locator(".bk-slip-foot").scrollIntoViewIfNeeded();
await page.screenshot({path:`${OUT}/bk-1440-slip.png`});
await page.locator(".bk-slip-foot .bk-primary").click();
await page.waitForSelector(".bk-open");
check("registradas: $450 abiertos y $9,550 disponibles",
      (await stat(page,"Open"))==="$450"&&(await stat(page,"Available"))==="$9,550");
check("el slip queda vacío",(await page.locator(".bk-slip > li").count())===0);

/* === liquidar: ganada, perdida, push; una queda ============================ */
console.log("\n=== liquidar ===");
const settle=async(i,res)=>{await page.locator(".bk-open > li").nth(i)
  .locator(`.bk-settle button:text-is("${res}")`).click();await page.waitForTimeout(80);};
await settle(0,"won");   // spread $150 a -110 (por defecto)
await settle(0,"lost");  // total $100
await settle(0,"push");  // prop pase $100
const pl=150*(100/110)-100;   // +36.36
check("P/L liquidado = +$36.36 (1W 1L 1P a -110)",
      (await stat(page,"Settled P/L"))==="+$36.36",await stat(page,"Settled P/L"));
check("récord 1-1-1 y una abierta de $100",
      /^1-1-1$/.test(await stat(page,"Record"))&&(await stat(page,"Open"))==="$100");
const disponible=10000+pl-100;
check("disponible = inicial + P/L − expuesto, al centavo",
      (await stat(page,"Available"))===`$${(Math.round(disponible*100)/100).toLocaleString("en-US",{minimumFractionDigits:2})}`,
      await stat(page,"Available"));
check("el historial pinta WON/LOST/PUSH con su color",
      (await page.locator(".bk-hist--won").count())===1&&
      (await page.locator(".bk-hist--lost").count())===1&&
      (await page.locator(".bk-hist--push").count())===1);
check("la exposición agrupada nombra el partido de la abierta",
      /by game/i.test(await page.locator(".bk-exposure").innerText()));

/* === recarga: el dinero no se olvida ====================================== */
await page.reload({waitUntil:"domcontentloaded"});
await page.waitForSelector(".bk-head");
check("tras recargar, cada número sigue igual",
      (await stat(page,"Open"))==="$100"&&(await stat(page,"Settled P/L"))==="+$36.36");
await page.screenshot({path:`${OUT}/bk-1440-settled.png`,fullPage:true});

/* === segundo mes: aislamiento ============================================= */
console.log("\n=== octubre aparte ===");
await page.locator('.bk-newmonth input[type="month"]').fill("2026-10");
await page.locator('.bk-newmonth input[type="number"]').fill("8000");
await page.locator(".bk-newmonth button").click();
await page.waitForFunction(()=>document.querySelector(".bk-month h1")?.textContent?.includes("2026-10"));
check("octubre arranca con SU banca, sin arrastre",
      (await stat(page,"Available"))==="$8,000"&&(await page.locator(".bk-history > li").count())===0);
await page.locator(".bk-month select").selectOption("2026-09");
await page.waitForFunction(()=>document.querySelector(".bk-month h1")?.textContent?.includes("2026-09"));
check("septiembre intacto al volver",
      (await stat(page,"Settled P/L"))==="+$36.36"&&(await page.locator(".bk-history > li").count())===3);

/* === móvil y tablet ======================================================= */
console.log("\n=== 390 y 768 ===");
for(const [width,height] of [[390,844],[768,1024]]){
  const c2=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  const m=await c2.newPage();
  await m.goto(`${BASE}/betting`,{waitUntil:"domcontentloaded"});
  await m.waitForSelector(".bk-start");
  await m.locator('.bk-start-form input[type="month"]').fill("2026-09");
  await m.locator('.bk-start-form input[type="number"]').fill("10000");
  await m.locator(".bk-start-form .bk-primary").click();
  await m.waitForSelector(".bk-head");
  const box=await m.locator(".bk-stats").boundingBox();
  check(`${width}px: la banca entera dentro del primer viewport`,
        box!==null&&box.y+box.height<height,`stats hasta y=${Math.round((box?.y??0)+(box?.height??0))}`);
  check(`${width}px: sin desbordamiento`,
        await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  const pequenos=await m.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll(".bk button, .bk input, .bk select")){
      const r=el.getBoundingClientRect();
      if(r.width>0&&r.height>0&&r.height<44) out.push(`${(el.textContent||el.type).trim().slice(0,12)} ${Math.round(r.height)}px`);
    }
    return out;
  });
  check(`${width}px: controles de 44px o más`,pequenos.length===0,pequenos.join(", "));
  await m.screenshot({path:`${OUT}/bk-${width}-fresh.png`,fullPage:width===768});
  await c2.close();
}
await ctx.close();

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
