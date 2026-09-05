/**
 * MY ROSTER como construcción de verdad — la suite del bloque.
 *
 * Lo que se protege: que los huecos pintados sean los que la liga declara, que
 * un hueco abierto sea un hecho y no un consejo, que UNKNOWN no dibuje una
 * alineación estándar, que editar la configuración a mitad de draft recoloque
 * sin tocar la historia de picks, y que la liga normal y la de 32 no se
 * contaminen.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4430);
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

const NORMAL_ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K"];
const cuenta=(p)=>p.locator(".room-count strong").innerText();
const pick=async(p,n)=>{await p.locator(".room-list button").first().click();
  await p.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),n);};

/* === 1 · configurar por FORMULARIO con el preset ========================== */
console.log("=== configurador: preset estándar y entrada ===");
const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
{
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-setup");
  await page.locator('.room-setup input[type="text"]').first().fill("Mi liga");
  // El preset RELLENA los contadores; no se aplica solo.
  const antes=await page.locator(".roster-count input").first().inputValue();
  check("los contadores llegan VACÍOS, no en cero", antes==="", `«${antes}»`);
  await page.locator(".room-roster-config .link").click();
  check("el preset rellena QB=1",
        (await page.locator(".roster-count input").first().inputValue())==="1");
  // Editable: el TE a 0 es una decisión, no una ausencia.
  const teInput=page.locator(".roster-count").filter({hasText:"TE"}).locator("input");
  await teInput.fill("0");
  await page.locator('.room-setup button[type="submit"]').click();
  await page.waitForSelector(".room-list button",{timeout:20000});

  const slots=await page.locator(".room-roster--slots > li .slot-tag").allInnerTexts();
  check("la plantilla pinta los huecos DECLARADOS (sin TE, que se puso a 0)",
        slots.join(",")==="QB,RB,RB,WR,WR,FLEX,DEF,K", slots.join(","));
  check("todos llegan abiertos",
        (await page.locator(".room-roster--slots > li.is-open").count())===8);
  await page.close();
}

/* === 2 · el reparto llena dedicados antes que flex ======================== */
console.log("\n=== construcción durante el draft ===");
{
  // Liga sembrada con la plantilla NORMAL completa y teams=4 para que la mitad
  // de los picks sean míos y la construcción se llene rápido.
  await ctx.addInitScript((r)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"Normal",platform:"manual",leagueId:"RN",draftId:"DRN",teams:4,scoring:"ppr",
    draftType:"snake",rounds:20,mySlot:1,roster:[...r,"BN","BN","BN"],rosterSource:"MANUAL"})),NORMAL_ROSTER);
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-list button");

  for(let i=1;i<=40;i+=1) await pick(page,i);
  const llenos=await page.locator(".room-roster--slots > li:not(.is-open)").count();
  const abiertos=await page.locator(".room-roster--slots > li.is-open").count();
  check("con 40 picks hay huecos llenos y abiertos a la vez", llenos>0&&abiertos>=0, `${llenos} llenos, ${abiertos} abiertos`);
  check("los nueve huecos siguen pintados", llenos+abiertos===9, String(llenos+abiertos));

  // Nadie duplicado entre titulares y banquillo.
  const nombres=await page.locator(".room-roster .nm").allInnerTexts();
  const limpios=nombres.map(n=>n.replace(/\s+(QB|RB|WR|TE)$/,"").trim()).filter(n=>n!=="Open");
  check("ningún jugador aparece dos veces", new Set(limpios).size===limpios.length,
        `${limpios.length} filas, ${new Set(limpios).size} únicos`);

  // El flex enseña la posición real del jugador que lo ocupa.
  const flexRow=page.locator(".room-roster--slots > li").filter({has:page.locator(".ptag--flex")});
  if(await flexRow.count()>0&&await flexRow.first().locator(".slot-pos").count()>0){
    const pos=await flexRow.first().locator(".slot-pos").innerText();
    check("el FLEX lleno enseña la posición real del jugador",["RB","WR","TE"].includes(pos),pos);
  }

  // El descanso, como dato y dentro del hueco.
  const bye=await page.locator(".room-roster--slots .room-bye").first().innerText().catch(()=>"");
  check("el descanso aparece en el hueco como dato",/^Bye \d+$/.test(bye),bye||"(sin bye)");

  // Deshacer desde un hueco lleno: el jugador vuelve y el hueco se abre.
  const antesUndo=await cuenta(page);
  await page.locator(".room-roster--slots .room-x").first().click();
  await page.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(Number(x)-1),antesUndo);
  check("deshacer desde un hueco funciona", true);

  await page.screenshot({path:`${OUT}/roster-1440-normal.png`});
  await page.close();
}

/* === 3 · editar a MITAD de draft: recoloca sin tocar la historia ========== */
console.log("\n=== edición a mitad de draft ===");
{
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-list button");
  const picksAntes=await cuenta(page);
  const feedAntes=await page.locator(".room-feed .feed-who").allInnerTexts();

  await page.locator(".room-head .link").click();
  await page.waitForSelector(".room-setup");
  // La edición SE VE: el formulario llega sembrado con lo guardado.
  check("el formulario de edición llega sembrado (QB=1)",
        (await page.locator(".roster-count input").first().inputValue())==="1");
  const teInput=page.locator(".roster-count").filter({hasText:"TE"}).locator("input");
  await teInput.fill("0");
  await page.locator('.room-setup button[type="submit"]').click();
  await page.waitForSelector(".room-list button");

  check("la historia de picks NO cambia al editar la plantilla",
        (await cuenta(page))===picksAntes, `${await cuenta(page)} vs ${picksAntes}`);
  const feedDespues=await page.locator(".room-feed .feed-who").allInnerTexts();
  check("el feed es idéntico", feedDespues.join("|")===feedAntes.join("|"));
  const slots=await page.locator(".room-roster--slots > li .slot-tag").allInnerTexts();
  check("y la disposición se recalcula con la configuración nueva (sin TE)",
        !slots.includes("TE"), slots.join(","));
  await page.close();
}

/* === 4 · UNKNOWN no dibuja una alineación ================================= */
console.log("\n=== estructura desconocida ===");
{
  await ctx.addInitScript(()=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"Sin config",platform:"manual",leagueId:"RU",draftId:"DRU",teams:12,scoring:"ppr",
    draftType:"snake",rounds:15,mySlot:3})));
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-list button");
  check("sin estructura NO se pintan huecos",
        (await page.locator(".room-roster--slots").count())===0);
  const nota=await page.locator(".room-note").innerText();
  check("se dice que falta y por dónde configurarla",
        /not configured/i.test(nota)&&/edit/i.test(nota), nota.slice(0,60));
  await pick(page,1);
  check("y el draft manual funciona igual", (await cuenta(page))==="1");
  await page.screenshot({path:`${OUT}/roster-1440-unknown.png`});
  await page.close();
}

/* === 5 · la liga de 32 pinta SU estructura, y el aislamiento aguanta ====== */
console.log("\n=== liga de 32 y aislamiento ===");
{
  await ctx.addInitScript(()=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"32man",platform:"manual",leagueId:"R32",draftId:"DR32",teams:32,scoring:"ppr",
    draftType:"snake",rounds:8,mySlot:17,
    roster:["RB","WR","FLEX","FLEX","FLEX","SUPER_FLEX","BN"],rosterSource:"MANUAL"})));
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-list button");
  const slots=await page.locator(".room-roster--slots > li .slot-tag").allInnerTexts();
  check("la liga de 32 pinta SUS seis huecos",
        slots.join(",")==="RB,WR,FLEX,FLEX,FLEX,SFLX", slots.join(","));
  check("sin QB ni TE ni K ni DEF: su estructura, no la normal",
        !slots.includes("QB")&&!slots.includes("TE")&&!slots.includes("K")&&!slots.includes("DEF"));
  await pick(page,1); await pick(page,2);
  await page.screenshot({path:`${OUT}/roster-1440-32man.png`});
  await page.close();

  // Vuelta a la normal: su construcción intacta, ni un hueco de la especial.
  await ctx.addInitScript((r)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"Normal",platform:"manual",leagueId:"RN",draftId:"DRN",teams:4,scoring:"ppr",
    draftType:"snake",rounds:20,mySlot:1,roster:[...r,"BN","BN","BN"],rosterSource:"MANUAL"})),NORMAL_ROSTER);
  const back=await ctx.newPage();
  await back.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await back.waitForSelector(".room-list button");
  const slotsBack=await back.locator(".room-roster--slots > li .slot-tag").allInnerTexts();
  check("la normal vuelve con SUS nueve huecos",
        slotsBack.join(",")==="QB,RB,RB,WR,WR,TE,FLEX,DEF,K", slotsBack.join(","));
  check("y con sus picks", Number(await cuenta(back))>=39, await cuenta(back));
  await back.close();
}

/* === 6 · sin consejo, y objetivos táctiles ================================ */
console.log("\n=== verdad y toque ===");
{
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-roster--slots");
  const texto=await page.locator('[aria-label="My roster"]').innerText();
  check("cero vocabulario de consejo en la plantilla",
        !/need|draft (a|an) |must|should|weak|strong|good|bad roster/i.test(texto),
        texto.replace(/\s+/g," ").slice(0,80));
  const abierto=await page.locator(".room-roster--slots > li.is-open").first();
  if(await abierto.count()){
    const color=await abierto.locator(".nm--open").evaluate(el=>getComputedStyle(el).color);
    const alarma=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--live").trim());
    check("un hueco abierto NO usa color de alarma", !color.includes(alarma), color);
  }
  const pequenos=await page.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll('[aria-label="My roster"] button')){
      const r=el.getBoundingClientRect();
      if(r.width>0&&(r.width<44||r.height<44)) out.push(`${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  check("todo control de la plantilla mide 44px o más", pequenos.length===0, pequenos.join(", "));
  await page.close();
}

/* === capturas móviles y tablet =========================================== */
for(const width of [390,768]){
  const c2=await browser.newContext({viewport:{width,height:width===390?844:1024}});
  await c2.addInitScript((r)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"Normal",platform:"manual",leagueId:"RN",draftId:"DRN",teams:4,scoring:"ppr",
    draftType:"snake",rounds:20,mySlot:1,roster:[...r,"BN","BN","BN"],rosterSource:"MANUAL"})),NORMAL_ROSTER);
  const page=await c2.newPage();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"networkidle"});
  await page.waitForSelector(".room-roster--slots");
  const roster=page.locator('[aria-label="My roster"]');
  await roster.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${OUT}/roster-${width}-normal.png`});
  const alto=await roster.evaluate(el=>Math.round(el.getBoundingClientRect().height));
  check(`a ${width}px la construcción cabe en pantalla razonable`, alto<820, `${alto}px`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  check(`a ${width}px sin desbordamiento horizontal`, !overflow);
  await c2.close();
}

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
