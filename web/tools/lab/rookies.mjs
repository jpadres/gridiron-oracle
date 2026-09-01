/**
 * NOVATOS: existen, se buscan, se draftean — y su valor SALE DE ALGO MEDIDO.
 *
 *     EXISTIR != DRAFTEABLE != PROYECTADO != RANKEADO != RECOMENDABLE
 *
 * La frontera se movió, y esto vigila dónde quedó. Hasta agosto de 2026 un
 * novato no tenía número y la interfaz escribía UNKNOWN, que era correcto
 * mientras no hubiera nada validado que decir. Desde que `ROOKIE_PRIOR` está
 * VALIDATED (E9: Spearman 0,604 walk-forward frente a 0,093 de la media de
 * posición) esconder esa medición ya no es prudencia.
 *
 * Lo que sigue prohibido —y lo que esto caza— es el número SIN respaldo:
 *
 *   - un novato no lleva jamás señal de riesgo, ausencia ni bust: esas se
 *     calculan sobre historial NFL y no lo tiene;
 *   - su número viaja SIEMPRE con el intervalo observado de su celda, porque
 *     la media sola de una celda bimodal no describe a casi nadie;
 *   - dos novatos de rondas distintas NO pueden salir con el mismo valor.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, emitir as emitirPick, montar } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4514);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const ROOKIES = model.fantasy.rookies ?? [];
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

const NOVATOS_BOARD = BOARD.filter(r=>r.rookie);

console.log("=== el universo publicado ===");
check("hay novatos en el board, con valor",NOVATOS_BOARD.length>0,`${NOVATOS_BOARD.length}`);
check("todos traen VOR, proyección y rank",
      NOVATOS_BOARD.every(r=>Number.isFinite(r.vor)&&Number.isFinite(r.projected_points)
                           &&Number.isFinite(r.overall_rank)),
      "el valor sale de la previa por capital de draft, no de un cero");
check("y ninguno trae señal de riesgo, ausencia ni bust",
      NOVATOS_BOARD.every(r=>r.risk_label==null&&r.p_bust==null&&r.missed_rate==null),
      "esas tres necesitan historial NFL");
check("cada uno viaja con el intervalo observado de su celda y su muestra",
      NOVATOS_BOARD.every(r=>Number.isFinite(r.rookie_p25)&&Number.isFinite(r.rookie_p50)
                           &&Number.isFinite(r.rookie_p75)&&r.rookie_sample>0),
      "una previa sin dispersión es el número que la capacidad prohíbe publicar solo");
check("el intervalo está ordenado: p25 <= p50 <= p75",
      NOVATOS_BOARD.every(r=>r.rookie_p25<=r.rookie_p50&&r.rookie_p50<=r.rookie_p75));
{
  // La señal por la que existe la previa: el capital de draft ORDENA. Si dos
  // rondas distintas de la misma posición salieran iguales, el encogimiento se
  // habría comido justo lo que se quería medir.
  const porPosicion={};
  for(const r of NOVATOS_BOARD){
    if(!Number.isFinite(r.rookie_round)) continue;
    (porPosicion[r.position] ??= new Map()).set(r.rookie_round, r.projected_points);
  }
  const monotono=Object.entries(porPosicion).every(([,celdas])=>{
    const rondas=[...celdas.keys()].sort((a,b)=>a-b);
    return rondas.length<2 || celdas.get(rondas[0])>celdas.get(rondas[rondas.length-1]);
  });
  check("una ronda mejor vale más que la peor de su posición",monotono,
        Object.entries(porPosicion).map(([p,c])=>`${p}:${c.size} celdas`).join(" · "));
}
check("los novatos SIN celda aplicable siguen publicándose sin valor",
      ROOKIES.every(r=>r.vor===undefined&&r.projected_points===undefined),
      `${ROOKIES.length} sin previa`);
check("y ninguno de ésos duplica a un jugador del board",
      !ROOKIES.some(r=>BOARD.some(b=>b.player_id===r.player_id)));

const TEAMS=12, ROUNDS=15, MY_SLOT=3;
const ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
let PROV=crearLiga({id:"LGR",draftId:"DRR",teams:TEAMS,roster:ROSTER,mySlot:MY_SLOT,rounds:ROUNDS});
const GUARDADA={name:"Rookie League",platform:"sleeper",leagueId:"LGR",draftId:"DRR",
  userId:USERNAME,teams:TEAMS,scoring:"ppr",draftType:"snake",rounds:ROUNDS,mySlot:MY_SLOT,
  roster:ROSTER,rosterSource:"MANUAL"};

const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await montar(ctx,[PROV]);
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),GUARDADA);
const page=await ctx.newPage();
await page.clock.install();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");
await page.clock.runFor(1_000);

console.log("\n=== visible y buscable ===");
const objetivo=NOVATOS_BOARD[0];
const nombre=objetivo.player_full_name;
await page.fill(".room-board input", nombre);
await page.waitForTimeout(150);
const fila=page.locator(".room-list li", {hasText: nombre}).first();
check("el novato aparece al buscarlo por nombre",await fila.count()>0,`${nombre} (${objetivo.position} ${objetivo.team})`);
const texto=await fila.innerText();
check("con su posición correcta",texto.includes(objetivo.position),texto.split("\n").join(" · "));
check("marcado ROOKIE",/ROOKIE/.test(texto));
// El número pintado NO tiene por qué ser el publicado: la pantalla recompila
// el board con las reglas y la plantilla de ESTA liga, y ahí el reemplazo es
// otro. Lo que se exige es que haya número y que no diga UNKNOWN.
const vorPintado=(await fila.locator(".room-row-vor").innerText()).trim();
check("con su VOR pintado como el de cualquiera, no UNKNOWN",
      /^-?\d+(\.\d+)?$/.test(vorPintado),
      `pintado ${vorPintado} · publicado ${objetivo.vor.toFixed(1)}`);
check("y la marca explica de dónde sale el número, con el intervalo",
      /draft capital/i.test(await fila.locator(".room-row-rookie").getAttribute("title"))
      && /25th\/median\/75th/.test(await fila.locator(".room-row-rookie").getAttribute("title")),
      await fila.locator(".room-row-rookie").getAttribute("title"));
check("el contador distingue rankeados de drafteables",
      /of \d+ draftable/i.test(await page.locator(".room-pool").innerText()),
      await page.locator(".room-pool").innerText());
await page.fill(".room-board input","");

console.log("\n=== la lista corta y el aviso ===");
check("el aviso de «sin valor validado» sólo sale si de verdad hay alguno así",
      (await page.locator(".room-rookie-note").count())===(ROOKIES.length>0?1:0),
      `${ROOKIES.length} sin previa`);
const nombresNovatos=new Set(ROOKIES.map(r=>r.player_full_name));
const cands=await page.locator(".room-cands .nm").allInnerTexts();
check("ningún novato SIN previa entra en la lista corta ordenada por VOR",
      cands.every(n=>!nombresNovatos.has(n)),cands.join(" · "));

console.log("\n=== el rival ficha un novato ===");
const rival=NOVATOS_BOARD[1];
emitirPick(PROV,1,rival,SLEEPER_OF);
emitirPick(PROV,2,BOARD[0],SLEEPER_OF);
await page.clock.runFor(16_000);
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="2",
                           null,{timeout:8000});
check("el pick del novato SE RESUELVE (no UNMAPPED)",
      (await page.locator(".room-scope-warn").count())===0,
      await page.locator(".room-scope-warn").innerText().catch(()=>"sin UNMAPPED"));
check("y cuenta como pick registrado: el reloj avanza",
      (await page.locator(".room-count strong").innerText())==="2");
await page.fill(".room-board input", rival.player_full_name);
await page.waitForTimeout(150);
// Se comprueba sobre los NOMBRES de las filas, no sobre el texto del `li`: el
// mensaje de «sin resultados» repite la consulta, así que buscar al fichado
// encontraba su propio nombre dentro del aviso de que no está.
check("el novato fichado desaparece de disponibles",
      !(await page.locator(".room-list .nm").allInnerTexts()).includes(rival.player_full_name),
      rival.player_full_name);
await page.fill(".room-board input","");

console.log("\n=== lo ficho yo ===");
const mio=NOVATOS_BOARD[2];
emitirPick(PROV,3,mio,SLEEPER_OF);   // pick 3 = mi puesto
await page.clock.runFor(16_000);
await page.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="3",
                           null,{timeout:8000});
check("entra en MI plantilla",
      (await page.locator(".room-roster").innerText()).includes(mio.player_full_name),
      `${mio.player_full_name} (${mio.position})`);
check("y el turno siguiente se calcula bien",
      /picks until you/i.test(await page.locator(".room-until").innerText()),
      (await page.locator(".room-until").innerText()).split("\n").join(" · "));

await ctx.close(); await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
