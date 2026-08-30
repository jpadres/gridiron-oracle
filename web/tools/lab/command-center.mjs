/**
 * CENTRO DE MANDO MULTI-LIGA — la suite del bloque.
 *
 * Lo crítico, por orden: que la cola sólo lleve HECHOS operativos (los
 * descansos jamás), que el orden documentado se cumpla tal cual está escrito,
 * que una liga sin configuración se diga UNKNOWN y no se disfrace de cero, que
 * abrir ligas desde aquí no contamine estados (E14 por la puerta nueva), y que
 * a veinte ligas la página siga siendo una lista que se escanea.
 *
 * Fixtures del bloque: A una liga tranquila (y el estado all-clear), B tres
 * mezcladas (activa / completada / plantilla sin configurar), C diez densas
 * (con una liga sólo-registro), D veinte de estrés con la de 32 equipos y una
 * liga EN EL RELOJ.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4470);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";

async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);

const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy?.board ?? [];
if (BOARD.length < 40) throw new Error("payload sin board: regenerar web/data");

console.log("construyendo…");
await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}

const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

/* === constructores de fixtures =========================================== */
const NORMAL=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
const SEASON=2026;
let cursorBoard=0;                       // jugadores reales, sin repetir por liga
const jugador=()=>BOARD[(cursorBoard+=1)%BOARD.length].player_id;

const liga=(leagueId,extra={})=>({
  name:leagueId,platform:"manual",season:SEASON,leagueId,draftId:`D${leagueId.replace(/\W/g,"")}`,
  teams:10,scoring:"ppr",draftType:"snake",rounds:15,mySlot:4,
  roster:NORMAL,rosterSource:"MANUAL",...extra,
});
const scopeDe=(l)=>`gridiron-draft-v2:${l.platform}:${l.season}:${l.leagueId}:${l.draftId}`;
// mios = lista de ordinales (1-based) que son MÍOS; el resto, rivales.
const eventos=(n,mios=[])=>Array.from({length:n},(_,i)=>({
  kind:"TAKE",playerId:jugador(),roster:mios.includes(i+1)?"MINE":"OPPONENT",
  rosterSource:"DERIVED",overall:i+1,source:"MANUAL",providerId:null,at:i+1,seq:i+1,
}));

function fixture(ligas){
  const catalog={}, logs={};
  for(const {config,picks=0,mine=[],soloRegistro=false} of ligas){
    const scope=scopeDe(config);
    if(!soloRegistro) catalog[scope]={...config,savedAt:1};
    if(picks>0||soloRegistro) logs[`${scope}:log`]=eventos(picks,mine);
  }
  return {catalog,logs};
}

// A — una liga tranquila: configurada, sin picks. La cola debe quedar vacía.
const FIX_A=fixture([{config:liga("Home League"),picks:0}]);

// B — tres mezcladas. Office: activa, mi pick fue el 5 (slot 4 de 8… no: slot 5)
//     con 6 picks hechos mi próximo turno es el overall 12 → faltan 5.
const OFFICE=liga("Office League",{teams:8,mySlot:5,rounds:15});
const DYNASTY=liga("Dynasty Rivals",{teams:4,mySlot:2,rounds:3,roster:["QB","RB","WR","TE","FLEX","BN"]});
const MYSTERY=liga("Mystery League",{teams:12,roster:null,rosterSource:null,mySlot:null});
const FIX_B=fixture([
  {config:OFFICE,picks:6,mine:[5]},
  {config:DYNASTY,picks:12,mine:[2,7,10]},       // 4×3 = 12: draft COMPLETO
  {config:MYSTERY,picks:0},
]);

// C — diez densas: las tres de B + seis tranquilas + una SÓLO-REGISTRO de
//     Sleeper (identidad real, configuración honestamente desconocida).
const SOLO_LOG={name:null,platform:"sleeper",season:SEASON,leagueId:"99887766",draftId:"55443322"};
const FIX_C=fixture([
  {config:OFFICE,picks:6,mine:[5]},
  {config:DYNASTY,picks:12,mine:[2,7,10]},
  {config:MYSTERY,picks:0},
  ...["Alpha","Bravo","Charlie","Delta","Echo","Foxtrot"].map((n,i)=>({
    config:liga(`${n} League`,{teams:10+2*(i%3),scoring:["ppr","half","standard"][i%3]}),picks:0})),
  {config:SOLO_LOG,picks:3,soloRegistro:true},
]);

// D — veinte de estrés: EN EL RELOJ (4 equipos, slot 1, 8 picks → el 9 es mío),
//     la estructura de 32 equipos ACTIVA, y diecisiete más de relleno real.
const CLOCK=liga("Thursday Clock",{teams:4,mySlot:1,rounds:8,roster:["QB","RB","WR","TE","FLEX","BN"]});
const MTY32=liga("32 man MTY",{teams:32,mySlot:9,rounds:7,
  roster:["RB","WR","FLEX","FLEX","FLEX","SUPER_FLEX","BN","BN"]});
const FIX_D=fixture([
  {config:CLOCK,picks:8,mine:[1,8]},
  {config:MTY32,picks:40,mine:[9]},              // activa: 40 de 224
  {config:OFFICE,picks:6,mine:[5]},
  {config:DYNASTY,picks:12,mine:[2,7,10]},
  {config:MYSTERY,picks:0},
  {config:SOLO_LOG,picks:3,soloRegistro:true},
  ...Array.from({length:14},(_,i)=>({
    config:liga(`Filler ${String(i+1).padStart(2,"0")}`,{teams:8+2*(i%4)}),picks:0})),
]);

/* === arranque ============================================================= */
const siembra=(f)=>({catalog:JSON.stringify(f.catalog),logs:Object.fromEntries(
  Object.entries(f.logs).map(([k,v])=>[k,JSON.stringify(v)]))});
async function abrir(fix,{width=1440,height=1100}={}){
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  if(fix) await ctx.addInitScript((s)=>{
    localStorage.setItem("gridiron-leagues-v1",s.catalog);
    for(const [k,v] of Object.entries(s.logs)) localStorage.setItem(k,v);
  },siembra(fix));
  const page=await ctx.newPage();
  await page.goto(`${BASE}/fantasy/leagues`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".cc");
  return {ctx,page};
}

/* === 0. estado vacío ====================================================== */
console.log("=== estado vacío ===");
{
  const {ctx,page}=await abrir(null);
  const cuerpo=await page.locator(".cc").innerText();
  check("sin ligas se dice y se dan los dos caminos",/no leagues yet/i.test(cuerpo));
  check("enlaza al Draft Room y al Board",
        (await page.locator('.cc-empty a[href="/fantasy/draft"]').count())===1&&
        (await page.locator('.cc-empty a[href="/fantasy"]').count())===1);
  check("y no hay cola ni catálogo fantasma",
        (await page.locator(".cc-queue, .cc-list").count())===0);
  await ctx.close();
}

/* === A. una liga tranquila + all-clear ==================================== */
console.log("\n=== fixture A: tranquila / all-clear ===");
{
  const {ctx,page}=await abrir(FIX_A);
  check("una fila de liga",(await page.locator(".cc-league").count())===1);
  check("all-clear: nada necesita tus ojos",
        /nothing needs your eyes/i.test(await page.locator(".cc-clear").innerText()));
  check("sin cola cuando no hay nada operativo",(await page.locator(".cc-item").count())===0);
  const fila=await page.locator(".cc-league").innerText();
  check("la fila dice «no picks yet», sin urgencia",/no picks yet/i.test(fila),fila.replace(/\s+/g," ").slice(0,80));
  // La estructura ES conocida (9 titulares, 0 elegidos): huecos como hecho de
  // fila — y como no hay draft vivo, ese mismo hecho NO puede estar en la cola.
  check("los huecos abiertos se dicen en la fila…",/9 starter slots open/i.test(fila),
        fila.replace(/\s+/g," ").slice(0,120));
  await page.screenshot({path:`${OUT}/cc-1440-quiet.png`,fullPage:true});
  await ctx.close();
}

/* === B. tres mezcladas: la cola y su orden ================================ */
console.log("\n=== fixture B: activa / completada / sin configurar ===");
let logsAntesDeAbrir=null;
{
  const {ctx,page}=await abrir(FIX_B);
  const items=await page.locator(".cc-item").allInnerTexts();
  check("la cola existe y no lleva a la liga completada",items.length>0&&!items.some(t=>/dynasty/i.test(t)),
        `${items.length} elementos`);
  check("1º: faltan 5 picks (ACTIVE)",/5 picks until you/i.test(items[0]??""),items[0]?.replace(/\s+/g," "));
  check("2º: huecos titulares abiertos (FACT, draft vivo)",/starter slots open/i.test(items[1]??""),items[1]?.replace(/\s+/g," "));
  check("3º: plantilla sin configurar (SETUP)",/roster setup unknown/i.test(items[2]??""),items[2]?.replace(/\s+/g," "));
  check("los descansos NO están en la cola",!items.some(t=>/bye/i.test(t)));

  const filas=await page.locator(".cc-league").allInnerTexts();
  check("orden de filas: activa, luego setup, la completada al final",
        /office/i.test(filas[0])&&/dynasty/i.test(filas[2]),filas.map(f=>f.split("\n")[0]).join(" | "));
  check("la completada dice «Draft complete» y ofrece «Review draft»",
        /draft complete/i.test(filas[2])&&/review draft/i.test(filas[2]));
  check("la fila activa lleva el descanso como dato, no como aviso",
        /bye \d+/i.test(filas[0]),filas[0].replace(/\s+/g," ").slice(0,140));
  check("mystery dice «roster setup unknown» en su fila",/roster setup unknown/i.test(filas[1]));

  // Nada de LIVE: son ligas manuales y la página no sincroniza nada.
  check("la palabra LIVE no aparece",!/\bLIVE\b/.test(await page.locator(".cc").innerText()));

  /* --- aislamiento E14 desde el centro de mando: A → volver → B → volver --- */
  console.log("\n=== aislamiento al abrir ligas ===");
  logsAntesDeAbrir=await page.evaluate(()=>{
    const out={};
    for(let i=0;i<localStorage.length;i+=1){const k=localStorage.key(i);
      if(k.endsWith(":log")) out[k]=localStorage.getItem(k);}
    return out;
  });
  await page.locator(".cc-league",{hasText:"Office League"}).locator("button").click();
  await page.waitForSelector(".room-count strong");
  check("abrir Office lleva a SU draft: 6 picks",
        (await page.locator(".room-count strong").innerText())==="6");
  await page.goBack({waitUntil:"domcontentloaded"});
  await page.waitForSelector(".cc-league");
  await page.locator(".cc-league",{hasText:"Dynasty Rivals"}).locator("button").click();
  await page.waitForSelector(".room-count strong");
  check("abrir Dynasty lleva a SU draft: 12 picks y completo",
        (await page.locator(".room-count strong").innerText())==="12"&&
        /draft complete/i.test(await page.locator(".room-state").innerText()));
  await page.goBack({waitUntil:"domcontentloaded"});
  await page.waitForSelector(".cc-league");
  const filasDespues=await page.locator(".cc-league").allInnerTexts();
  check("de vuelta, Office sigue con sus 5 picks hasta mí",
        /5 picks until you/i.test(filasDespues[0]));
  const logsDespues=await page.evaluate(()=>{
    const out={};
    for(let i=0;i<localStorage.length;i+=1){const k=localStorage.key(i);
      if(k.endsWith(":log")) out[k]=localStorage.getItem(k);}
    return out;
  });
  // Comparación por clave y ORDENADA: el orden de iteración de localStorage
  // cambia tras reescribir una clave, y eso no es un cambio de contenido.
  const claves=[...new Set([...Object.keys(logsAntesDeAbrir),...Object.keys(logsDespues)])].sort();
  const cambiadas=claves.filter((k)=>logsAntesDeAbrir[k]!==logsDespues[k]);
  check("mirar y abrir no cambió NI UN registro",cambiadas.length===0,cambiadas.join(", "));
  await page.screenshot({path:`${OUT}/cc-1440-mixed.png`,fullPage:true});
  await ctx.close();
}

/* === C. diez densas + la sólo-registro ==================================== */
console.log("\n=== fixture C: diez ligas ===");
{
  const {ctx,page}=await abrir(FIX_C);
  check("diez filas",(await page.locator(".cc-league").count())===10);
  const solo=page.locator(".cc-league",{hasText:"sleeper league 99887766"});
  check("la sólo-registro existe con su identidad",await solo.count()===1);
  const soloTxt=await solo.innerText();
  // Con 3 picks y totales desconocidos el draft no se afirma acabado: en
  // progreso con su cuenta, y la configuración dicha UNKNOWN, nunca cero.
  check("…dice «configuration unknown», no cero ni completa",
        /configuration unknown/i.test(soloTxt)&&/3 picks/i.test(soloTxt)&&!/draft complete/i.test(soloTxt),
        soloTxt.replace(/\s+/g," ").slice(0,100));
  check("…y NO ofrece botón: no se puede activar lo que no se conoce",
        (await solo.locator("button").count())===0);
  await page.screenshot({path:`${OUT}/cc-1440-dense10.png`,fullPage:true});
  await ctx.close();
}

/* === D. veinte de estrés: reloj, 32 equipos, rendimiento ================== */
console.log("\n=== fixture D: veinte ligas, reloj y 32 equipos ===");
{
  const t0=Date.now();
  const {ctx,page}=await abrir(FIX_D);
  await page.waitForFunction(()=>document.querySelectorAll(".cc-league").length===20);
  const ms=Date.now()-t0;
  check("veinte filas pintadas en menos de 3 s (navegación incluida)",ms<3000,`${ms} ms`);

  const items=await page.locator(".cc-item").allInnerTexts();
  check("el reloj encabeza la cola",/on the clock/i.test(items[0]??""),items[0]?.replace(/\s+/g," "));
  const filas=await page.locator(".cc-league").allInnerTexts();
  check("y encabeza el catálogo, inconfundible",
        /thursday clock/i.test(filas[0])&&(await page.locator(".cc-live").count())===1);
  const mty=page.locator(".cc-league",{hasText:"32 man MTY"});
  // Con reloj derivable manda la distancia al turno (15 picks), no la cuenta
  // bruta: mi próximo pick es el overall 56 (ronda 2, inverso del slot 9).
  const mtyTxt=await mty.innerText();
  check("la de 32 equipos declara su tamaño y su distancia al turno",
        /32-team/i.test(mtyTxt)&&/15 picks until you/i.test(mtyTxt),
        mtyTxt.replace(/\s+/g," ").slice(0,120));

  // Autoridad visual: el CAMPO ámbar es exclusivo del reloj. Antes de la
  // corrección, «on the clock» y «5 picks until you» vestían el mismo fondo y
  // este check estaba ROJO — es el guardián contra el recamuflaje.
  const fondoReloj=await page.locator(".cc-item--clock").evaluate(e=>getComputedStyle(e).backgroundColor);
  const fondoCerca=await page.locator(".cc-item--active").first().evaluate(e=>getComputedStyle(e).backgroundColor);
  check("el fondo del reloj no lo comparte ningún otro elemento de la cola",
        fondoReloj!==fondoCerca,`reloj ${fondoReloj} vs cerca ${fondoCerca}`);

  // Autoridad visual: el reloj y sólo el reloj lleva el trato de vivo.
  const colorReloj=await page.locator(".cc-live").evaluate(e=>getComputedStyle(e).color);
  const colorBye=await page.locator(".cc-byes").first().evaluate(e=>getComputedStyle(e).color).catch(()=>null);
  check("el descanso no viste el color del reloj",colorBye===null||colorBye!==colorReloj,
        `reloj ${colorReloj} vs bye ${colorBye}`);

  // Accesibilidad: listas nombradas y botones alcanzables con el teclado.
  check("las dos listas tienen nombre accesible",
        (await page.locator('[aria-label="Needs your eyes"]').count())===1&&
        (await page.locator('[aria-label="All leagues"]').count())===1);
  let tabs=0,llego=false;
  while(tabs<60){
    if(await page.evaluate(()=>document.activeElement instanceof HTMLButtonElement)){llego=true;break;}
    await page.keyboard.press("Tab");tabs+=1;
  }
  check("un botón de acción se alcanza tabulando",llego,`${tabs} tabs`);

  await page.screenshot({path:`${OUT}/cc-1440-stress20.png`,fullPage:true});
  await ctx.close();
}

/* === móvil y tablet ======================================================= */
console.log("\n=== 390 y 768 ===");
for(const [width,height] of [[390,844],[768,1024]]){
  for(const [nombre,fix] of [["quiet",FIX_A],["mixed",FIX_B],["dense10",FIX_C],["stress20",FIX_D]]){
    const {ctx,page}=await abrir(fix,{width,height});
    if(nombre==="stress20") await page.waitForFunction(()=>document.querySelectorAll(".cc-league").length===20);
    check(`${width}px ${nombre}: sin desbordamiento horizontal`,
          await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
    const pequenos=await page.evaluate(()=>{
      const out=[];
      for(const el of document.querySelectorAll(".cc button, .cc a")){
        const r=el.getBoundingClientRect();
        if(r.width>0&&r.height>0&&r.height<44&&el.tagName==="BUTTON") out.push(`${el.textContent.trim().slice(0,14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    check(`${width}px ${nombre}: botones de 44px o más`,pequenos.length===0,pequenos.join(", "));
    await page.screenshot({path:`${OUT}/cc-${width}-${nombre}.png`,fullPage:width===768});
    await ctx.close();
  }
}

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
