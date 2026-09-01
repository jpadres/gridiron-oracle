/**
 * LIVE DRAFT ASSISTANT — lo que la simulación lineal no puede contestar.
 *
 * `live-assistant.mjs` prueba que un draft entero entra por el adaptador. Aquí
 * van las tres preguntas que un draft normal NO ejercita porque en un draft
 * normal no pasan:
 *
 *   1. una CORRIDA de posición (cinco receptores seguidos): ¿el tablero
 *      reacciona, o la lista corta sigue diciendo lo mismo?
 *   2. la MATRIZ de configuraciones: superflex, media recepción, plantilla
 *      rara y una liga de 32 — donde el valor deja de estar validado y hay que
 *      DECIRLO.
 *   3. la FRESCURA de la sincronización: LIVE sólo con evidencia, y qué se
 *      escribe cuando la red se cae y cuando vuelve.
 *
 * El reloj del navegador se controla (`page.clock`) porque lo que se prueba es
 * la máquina de estados de frescura, no la paciencia: envejecer diez minutos de
 * verdad para leer una etiqueta no comprueba nada más que el `setInterval`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { HALF, PPR, USERNAME, crearLiga, emitir as emitirPick, libres as libresDe, montar as montarDoble }
  from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4511);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
// El mapa horneado del producto: el doble emite ids de Sleeper de verdad.
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}

const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

/* El doble es el compartido. `provider.actual` es la liga que se está
   sirviendo: cada bloque la reconstruye con SUS ajustes, porque desde este
   bloque lo que dice el proveedor manda sobre lo que se teclea — y un doble
   que no lleve los ajustes del caso probaría otra configuración. */
const provider={actual:null};
function prov({teams=12,roster=ROSTER_12,scoring=PPR,mySlot=1,id="LGX",draftId="DRX",rounds=15}={}){
  provider.actual=crearLiga({id,draftId,teams,roster,scoring,mySlot,rounds});
  return provider.actual;
}
async function montar(ctx){ await montarDoble(ctx,[provider.actual]); }
function emitir(no,row){ emitirPick(provider.actual,no,row,SLEEPER_OF); }
const libres=()=>libresDe(provider.actual,BOARD,SLEEPER_OF);
const ROSTER_12=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];

const ESCALA={ppr:PPR,half:HALF};
/** Los mismos ajustes que la liga guardada, en forma de proveedor. */
const desde=(l)=>prov({teams:l.teams,roster:l.roster,scoring:ESCALA[l.scoring]??PPR,
                       mySlot:l.mySlot,id:l.leagueId,draftId:l.draftId,rounds:l.rounds});

async function abrir(liga,{width=1440,height=1000,conservar=false}={}){
  // Por defecto el doble se reconstruye con los ajustes de ESTA liga. Los
  // bloques que emiten picks antes de abrir llaman a `desde` ellos y pasan
  // `conservar`, para no tirar lo que acaban de sembrar.
  if(!conservar) desde(liga);
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  await montar(ctx);
  await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),liga);
  const page=await ctx.newPage();
  await page.clock.install();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-list button");
  return {ctx,page};
}
const BASE_LIGA={name:"Matrix",platform:"sleeper",leagueId:"LGX",draftId:"DRX",userId:"me",
  teams:12,scoring:"ppr",draftType:"snake",rounds:15,mySlot:1,
  roster:["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"],
  rosterSource:"MANUAL"};

/* === 1. CORRIDA DE POSICIÓN ============================================== */
console.log("=== corrida: cinco receptores seguidos ===");
{
  const {ctx,page}=await abrir({...BASE_LIGA,mySlot:6});
  // Se cuenta sobre el POOL que el producto declara («N on board»), NO sobre
  // las filas pintadas: la lista se corta en 60 y contar lo renderizado es el
  // artefacto exacto que ya produjo un «2 left in tier» falso en esta pantalla.
  const wrLibres=async()=>page.evaluate(()=>{
    const fila=[...document.querySelectorAll("[aria-label='Position depth'] li")]
      .find(li=>li.textContent.trim().startsWith("WR"));
    return fila?Number(/(\d+)\s*on board/.exec(fila.textContent)?.[1] ?? NaN):NaN;
  });
  const antesWR=await wrLibres();

  // Cinco receptores seguidos, los cinco mejores disponibles de la posición.
  const corrida=[];
  for(let no=1;no<=5;no+=1){
    const wr=libres().find(r=>r.position==="WR");
    corrida.push(wr.player_full_name ?? wr.player_name);
    emitir(no,wr);
  }
  await page.clock.runFor(16_000);
  await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="5",
                             null,{timeout:8000});
  const despuesWR=await wrLibres();
  check("los cinco receptores salen del board",despuesWR===antesWR-5,`${antesWR} -> ${despuesWR}`);
  const enBoard=await page.locator(".room-list .nm").allInnerTexts();
  check("y ninguno de los cinco sigue seleccionable",
        corrida.every(n=>!enBoard.includes(n)),corrida.join(", "));

  // La profundidad de WR es un CONTEO, y tiene que haber bajado.
  const profundidad=async(pos)=>page.evaluate((p)=>{
    const fila=[...document.querySelectorAll("[aria-label='Position depth'] li")]
      .find(li=>li.textContent.trim().startsWith(p));
    return fila?fila.textContent:null;
  },pos);
  const dWR=await profundidad("WR");
  check("la profundidad de WR se recalcula y no se queda en el valor de inicio",
        dWR!==null,String(dWR));

  // Y en mi turno (pick 6) la lista corta ya refleja la corrida.
  emitir(6,libres()[0]); // no: mi turno es el 6, así que no lo emito.
  provider.actual.picks.pop();
  await page.waitForSelector(".room-cands > li",{timeout:8000});
  const listaTop=await page.locator(".room-cands .nm").allInnerTexts();
  check("en mi turno la lista corta no ofrece a ninguno de los fichados",
        listaTop.every(n=>!corrida.includes(n)),listaTop.join(" · "));
  await page.screenshot({path:`${OUT}/lda-1440-run.png`});
  await ctx.close();
}

/* === 2. MATRIZ DE CONFIGURACIONES ======================================== */
console.log("\n=== matriz de configuraciones ===");
const CONFIGS=[
  {etiqueta:"12 PPR estándar", liga:{...BASE_LIGA}, profundo:false},
  {etiqueta:"12 superflex", profundo:false,
   liga:{...BASE_LIGA,name:"SF",leagueId:"LGSF",draftId:"DRSF",
     roster:["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","DEF","K","BN","BN","BN","BN","BN"]}},
  {etiqueta:"10 media recepción", profundo:false,
   liga:{...BASE_LIGA,name:"HALF",leagueId:"LGH",draftId:"DRH",teams:10,scoring:"half",
     roster:["QB","RB","RB","WR","WR","WR","TE","FLEX","BN","BN","BN","BN","BN","BN","BN"]}},
  {etiqueta:"14 plantilla rara (2QB 3WR 2TE)", profundo:false,
   liga:{...BASE_LIGA,name:"RARA",leagueId:"LGR",draftId:"DRR",teams:14,
     roster:["QB","QB","RB","WR","WR","WR","TE","TE","FLEX","BN","BN","BN","BN","BN","BN"]}},
  {etiqueta:"32 equipos (profundidad no validada)", profundo:true,
   liga:{...BASE_LIGA,name:"DEEP",leagueId:"LGD",draftId:"DRD",teams:32,rounds:15}},
];
const ordenes={};
for(const {etiqueta,liga,profundo} of CONFIGS){
  const {ctx,page}=await abrir(liga);
  await page.waitForSelector(".room-cands > li",{timeout:8000});
  const top=await page.locator(".room-cands .nm").allInnerTexts();
  ordenes[etiqueta]=top;
  check(`${etiqueta}: hay lista corta en el turno 1`,top.length>0,top.slice(0,2).join(" · "));
  const aviso=await page.locator(".room-depth-warn").count();
  check(`${etiqueta}: la calificación de profundidad ${profundo?"SE DICE":"no aparece"}`,
        (aviso===1)===profundo, profundo?await page.locator(".room-depth-warn").innerText().catch(()=>""):"");
  const desborde=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  check(`${etiqueta}: sin desbordamiento horizontal`,!desborde);
  if(profundo) await page.screenshot({path:`${OUT}/lda-1440-deep.png`});
  await ctx.close();
}
// La prueba de que la configuración IMPORTA. NO se mide en los cuatro primeros:
// E18b midió que superflex mueve 13 de los 50 primeros, y los de arriba del todo
// no son de los que se mueven — esperar que cambien sería inventarse la
// predicción del experimento. Se mide donde el experimento dice que ocurre: en
// cuántos quarterbacks entran en los 50 primeros del board.
console.log("\n=== superflex: donde E18b dice que se mueve ===");
{
  const qbTop=async(liga)=>{
    const {ctx,page}=await abrir(liga);
    const n=await page.evaluate(()=>
      [...document.querySelectorAll(".room-list .ptag")].slice(0,50)
        .filter(e=>/^QB/.test(e.textContent)).length);
    await ctx.close();
    return n;
  };
  const estandar=await qbTop({...BASE_LIGA,leagueId:"LGSTD2",draftId:"DRSTD2"});
  const superflex=await qbTop({...BASE_LIGA,name:"SF",leagueId:"LGSF2",draftId:"DRSF2",
    roster:["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","DEF","K","BN","BN","BN","BN","BN"]});
  check("superflex mete MÁS quarterbacks en los 50 primeros que la estándar",
        superflex>estandar,`${estandar} -> ${superflex}`);
}

/* === 3. FRESCURA DE LA SINCRONIZACIÓN ==================================== */
console.log("\n=== frescura: LIVE, envejecer, caer y volver ===");
{
  const {ctx,page}=await abrir({...BASE_LIGA,name:"FRESH",leagueId:"LGF",draftId:"DRF"});
  const banda=()=>page.locator(".room-link b").innerText();
  const nivel=()=>page.locator(".room-link").getAttribute("class");

  await page.clock.runFor(1_000);
  await page.waitForFunction(()=>/live/i.test(document.querySelector(".room-link b")?.textContent??""),
                             null,{timeout:8000}).catch(()=>{});
  check("con sondeo correcto y draft en curso, y sólo entonces, dice LIVE",
        /live/i.test(await banda()) && /room-link--live/.test(await nivel()),await banda());

  // Envejecer sin sondeo: el reloj corre pero la red no contesta.
  provider.actual.caido=true;
  await page.clock.runFor(40_000);
  const trasCaida=await banda();
  check("caída la red, la banda NO sigue diciendo LIVE",!/^live$/i.test(trasCaida.trim()),trasCaida);
  check("y dice que es un error de sincronización, no un estado sano",
        /sync error/i.test(trasCaida)||/room-link--error/.test(await nivel()),trasCaida);
  const picksTrasCaida=await page.locator(".room-count strong").innerText();
  check("el tablero manual sobrevive a la caída (no se borra nada)",picksTrasCaida==="0",picksTrasCaida);
  await page.screenshot({path:`${OUT}/lda-1440-syncerror.png`});

  // Vuelve la red y llega un pick: se recupera sola, sin botón.
  provider.actual.caido=false;
  emitir(1,libres()[0]);
  await page.clock.runFor(16_000);
  await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="1",
                             null,{timeout:8000});
  check("vuelve la red y se recupera sola, sin botón de refrescar",
        /live/i.test(await banda()),await banda());

  // Draft terminado según el proveedor: no se puede seguir diciendo que pasa algo.
  provider.actual.draft.status="complete";
  await page.clock.runFor(16_000);
  await page.waitForFunction(()=>!/^live$/i.test(document.querySelector(".room-link b")?.textContent?.trim()??""),
                             null,{timeout:8000}).catch(()=>{});
  check("con el draft `complete` en el proveedor deja de decir LIVE",
        !/^live$/i.test((await banda()).trim()),await banda());
  await ctx.close();
}

/* === 3b. LOS SEPARADORES DE TIER, EN LA COLA ============================= */
/* Donde se rompen. Arriba, el VOR de la liga y los tiers del board publicado
   coinciden y el corte informa. Al fondo del pool dejan de coincidir: el mismo
   tier reaparecía, con la MISMA `key`, y React se comía las filas de en medio —
   nueve cabeceras seguidas sin un solo jugador debajo. Lo vio una CAPTURA, no un
   test, así que aquí queda el test. */
console.log("\n=== separadores de tier al fondo del pool ===");
{
  const tail={...BASE_LIGA,name:"TAIL",leagueId:"LGT",draftId:"DRT"};
  desde(tail);                       // el doble PRIMERO: hay que sembrarlo
  for(let no=1;no<=180;no+=1) emitir(no,libres()[0]);
  const {ctx,page}=await abrir(tail,{conservar:true});
  await page.clock.runFor(16_000);
  await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="180",
                             null,{timeout:8000});
  const lista=await page.evaluate(()=>[...document.querySelectorAll(".room-list > li")]
    .map(li=>li.classList.contains("room-tier")
      // Del PRIMER span, no de `textContent`: la cabecera lleva «Tier 14» y
      // «164 left» pegados, y leer el nodo entero da «Tier 14164».
      ? {t:"tier", n:Number(/(\d+)/.exec(li.querySelector("span")?.textContent ?? "")?.[1] ?? NaN)}
      : {t:"player"}));
  const tiers=lista.filter(x=>x.t==="tier").map(x=>x.n);
  check("ninguna cabecera de tier se repite",
        new Set(tiers).size===tiers.length,`[${tiers.join(", ")}]`);
  check("las cabeceras no retroceden",
        tiers.every((n,i)=>i===0||n>tiers[i-1]),`[${tiers.join(", ")}]`);
  let huerfanas=0;
  for(let i=0;i<lista.length;i+=1){
    if(lista[i].t==="tier" && (i+1>=lista.length || lista[i+1].t!=="player")) huerfanas+=1;
  }
  check("toda cabecera de tier tiene al menos un jugador debajo",huerfanas===0,
        `${huerfanas} huérfanas de ${tiers.length}`);
  check("y quedan jugadores pintados en la cola",lista.some(x=>x.t==="player"),
        `${lista.filter(x=>x.t==="player").length} filas`);
  await ctx.close();
}

/* === 4. FALLBACK MANUAL Y RENDIMIENTO ==================================== */
console.log("\n=== manual y rendimiento ===");
{
  const {ctx,page}=await abrir({...BASE_LIGA,name:"MAN",platform:"manual",leagueId:"LGM",draftId:"DRM"});
  check("sin liga de Sleeper la banda dice Manual y no un fallo",
        /manual/i.test(await page.locator(".room-link b").innerText()));
  // La regla de velocidad: ver jugador -> un toque -> fuera. Se mide.
  const t=[];
  for(let i=0;i<20;i+=1){
    const t0=Date.now();
    await page.locator(".room-list button").first().click();
    await page.waitForFunction((n)=>document.querySelector(".room-count strong")?.textContent===String(n),
                               i+1,{timeout:4000});
    t.push(Date.now()-t0);
  }
  const p95=t.slice().sort((a,b)=>a-b)[Math.floor(t.length*0.95)];
  check("veinte picks manuales seguidos, p95 por debajo de 250 ms",p95<250,`p95=${p95} ms`);
  check("y los veinte se registraron sin duplicar",
        (await page.locator(".room-count strong").innerText())==="20");
  await page.screenshot({path:`${OUT}/lda-1440-manual.png`});
  await ctx.close();
}

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
