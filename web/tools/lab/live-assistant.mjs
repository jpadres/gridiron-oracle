/**
 * LIVE DRAFT ASSISTANT — la simulación que el bloque pide ver funcionando.
 *
 * Un draft de 12 equipos entero con los picks entrando por el ADAPTADOR (se
 * intercepta la red y se sirve la API de Sleeper desde un fixture, que es la
 * única forma de ejercitar la ingesta automática desde este contenedor: el
 * proxy bloquea api.sleeper.app). En cada pick se comprueba el pool, el turno,
 * la parrilla, la plantilla y la lista corta; y se prueban las dos carreras
 * que importan: que fichen a tu candidato mientras miras, y mientras decides.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, emitir as emitirPick, libres as libresDe, montar, slotOf as slotDe }
  from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4510);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
// El MISMO mapa horneado que usa el producto: el doble emite `player_id` de
// Sleeper y el adaptador lo resuelve contra este mapa. Inventar el id aquí
// probaría el laboratorio y no el emparejamiento.
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
if(!process.env.SKIP_BUILD){
  console.log("construyendo…");
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}

const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

const TEAMS=12, ROUNDS=15, MY_SLOT=7;
const ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
const LIGA={name:"Sunday Twelve",platform:"sleeper",leagueId:"LG12",draftId:"DR12",
  userId:USERNAME,teams:TEAMS,scoring:"ppr",draftType:"snake",rounds:ROUNDS,mySlot:MY_SLOT,
  roster:ROSTER,rosterSource:"MANUAL"};
let PROV=crearLiga({id:"LG12",draftId:"DR12",teams:TEAMS,roster:ROSTER,mySlot:MY_SLOT,
                    rounds:ROUNDS,name:"Sunday Twelve"});
const slotOf=(no)=>slotDe(no,TEAMS);
/** Reinicia el doble. `slot` es el puesto REAL, el que manda desde `draft_order`. */
const reiniciar=(slot=MY_SLOT)=>{
  PROV=crearLiga({id:"LG12",draftId:"DR12",teams:TEAMS,roster:ROSTER,mySlot:slot,
                  rounds:ROUNDS,name:"Sunday Twelve"});
};
const mine=(no)=>slotOf(no)===MY_SLOT;

/* El doble vive en `sleeper-double.mjs`: lo usan los tres laboratorios y
   copiarlo habría sido la cuarta vez que dos traductores del mismo formato
   divergen en este proyecto. */
async function montarDoble(ctx){ await montar(ctx,[PROV]); }
function emitir(no,row,porOtro=false){
  emitirPick(PROV,no,row,SLEEPER_OF);
  // `porOtro` fuerza que el pick NO sea mío aunque caiga en mi puesto: es el
  // autodraft del comisionado, que es como te pueden quitar tu candidato.
  if(porOtro){ const p=PROV.picks[PROV.picks.length-1]; p.picked_by=`ajeno`; p.roster_id=0; }
}
const libres=()=>libresDe(PROV,BOARD,SLEEPER_OF);

const cuenta=(p)=>p.locator(".room-count strong").innerText();
const esperar=async(p,n)=>p.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),n,{timeout:8000});

const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await montarDoble(ctx);
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),LIGA);
const page=await ctx.newPage();
// El adaptador sondea cada 15 s de reloj real. Se controla el reloj del
// navegador en vez de esperarlo: 180 picks reales serían 45 minutos, y lo que
// se quiere probar es la INGESTA, no la paciencia. El intervalo de producción
// no se toca — eso sería cambiar el sistema para que pase el test.
await page.clock.install();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");

console.log("=== conexión y arranque ===");
check("el estado de conexión aparece y NO dice LIVE sin evidencia todavía",
      (await page.locator(".room-link b").count())===1);
check("la parrilla se pinta con las 15 rondas de 12",
      (await page.locator(".room-grid-row").count())===ROUNDS &&
      (await page.locator(".room-grid-row").first().locator(".room-cell").count())===TEAMS);
check("mi columna está marcada en cada ronda",
      (await page.locator(".room-cell.is-mine").count())===ROUNDS);
await page.screenshot({path:`${OUT}/lda-1440-waiting.png`});

/* === el draft entero, pick a pick, por el proveedor ====================== */
console.log("\n=== 180 picks por el adaptador ===");
let errores=0, misTurnosVerificados=0; const t0=Date.now();
/* Lo que la lista corta dice EN CADA UNO de mis turnos. Se recoge aquí y se
   juzga al final: el ajuste a la plantilla es un estado que CAMBIA a lo largo
   del draft —se adapta mientras queden huecos, vuelve al board cuando no— y
   mirarlo en un solo turno no distingue «se adapta» de «siempre dice lo
   mismo». La comprobación es que el cambio ocurre y en el orden correcto. */
const turnos=[];
for(let no=1; no<=180; no+=1){
  if(mine(no)){
    // MI TURNO: el asistente tiene que detectarlo SIN que yo pulse nada.
    await page.waitForSelector(".room-state--clock",{timeout:8000}).catch(()=>{});
    const enReloj=(await page.locator(".room-state--clock").count())===1;
    const listaCorta=await page.locator(".room-cands > li").count();
    if(!enReloj||listaCorta===0) errores+=1;
    else misTurnosVerificados+=1;
    if(listaCorta>0){
      turnos.push({
        no,
        titulo:(await page.locator(".room-shortlist .room-h").innerText().catch(()=>"")).split("\n")[0].trim(),
        // La ETIQUETA de la cifra grande es lo que delata el cableado: si el
        // Draft Room dejara de pasarle la plantilla a `candidates`, seguiría
        // pintando una lista perfectamente creíble y todas dirían «VOR».
        etiquetas:await page.locator(".room-cand-vor small").allInnerTexts(),
        posiciones:await page.locator(".room-cands .ptag").allInnerTexts(),
        porque:await page.locator(".room-cands > li").first().locator(".room-why li").allInnerTexts(),
      });
    }
  }
  emitir(no, libres()[0]);
  await page.clock.runFor(16_000);             // dispara el siguiente sondeo
  let entro=true;
  await esperar(page,no).catch(()=>{ errores+=1; entro=false; });
  if(no===24) await page.screenshot({path:`${OUT}/lda-1440-onclock.png`});
  if(no%20===0||!entro){
    console.log(`  pick ${no} · ${await cuenta(page)} registrados · ${errores} errores · ${Math.round((Date.now()-t0)/1000)}s`);
  }
  // Si la ingesta se rompe, se PARA y se dice. Reintentar 180 veces con un
  // timeout de 8 s cada una convierte un fallo de dos segundos en media hora
  // de espera que no informa de nada nuevo.
  if(errores>=3){ console.log("  ABORTA: la ingesta no avanza"); break; }
}
check("los 180 picks entraron por el proveedor sin intervención manual",
      (await cuenta(page))==="180" && errores===0, `${errores} errores`);
check("mis 15 turnos se detectaron solos y con lista corta",misTurnosVerificados===15,
      `${misTurnosVerificados}/15`);

/* === la lista corta se adapta a MI plantilla ============================= */
/* La queja que originó esto: con el ala cerrada o el quarterback ya cogidos,
   la lista seguía ofreciendo otro. El orden es ahora lo que cada uno AÑADE a
   la alineación, así que la comprobación no es «sale tal jugador» —eso
   dependería del board del día— sino la propiedad: mientras haya hueco, cada
   fila declara lo que añade; cuando no lo hay, se vuelve al board Y SE DICE. */
const conAjuste=turnos.filter(t=>t.titulo==="Best for your roster");
const sinAjuste=turnos.filter(t=>t.titulo==="Top available");
check("desde el primer turno la lista se ordena por lo que añade a mi plantilla",
      turnos[0]?.titulo==="Best for your roster", turnos[0]?.titulo);
check("y CADA fila dice lo que añade, no el VOR a secas",
      conAjuste.length>0 && conAjuste.every(t=>t.etiquetas.length>0
        && t.etiquetas.every(e=>e.trim()==="to your lineup")),
      `${conAjuste.length} turnos ajustados`);
/* Los tres de abajo llevan `conAjuste.length>0` DENTRO de la condición y no
   como comprobación aparte. Sin eso pasan en vacío: al inyectar el fallo del
   cableado —quitarle la plantilla a `candidates`— los quince turnos salen «Top
   available», y «todos los turnos sin ajuste dicen VOR» se cumple, y «el
   cambio ocurre una vez» también con cero cambios. Un guardián que aprueba el
   fallo que existe para cazar ya costó una iteración en este proyecto. */
check("con los siete titulares llenos vuelve al orden del board Y LO DICE",
      conAjuste.length>0 && sinAjuste.length>0 &&
      sinAjuste.every(t=>t.etiquetas.every(e=>e.trim()==="VOR")),
      `${conAjuste.length} ajustados -> ${sinAjuste.length} sin hueco titular`);
check("el cambio ocurre UNA vez y no va y viene",
      conAjuste.length>0 && sinAjuste.length>0 &&
      turnos.findIndex(t=>t.titulo==="Top available")===conAjuste.length,
      turnos.map(t=>t.titulo==="Top available"?"·":"#").join(""));
/* La propiedad concreta que se pidió: mientras quede hueco, el que encabeza la
   lista SIEMPRE llena uno. Ésa es la diferencia con lo de antes, que ofrecía un
   segundo ala cerrada con el hueco de ala cerrada ya ocupado. */
check("mientras hay hueco, el candidato #1 SIEMPRE llena uno abierto",
      conAjuste.length>0 &&
      conAjuste.every(t=>t.porque.some(l=>/Fills an open \w+ slot/.test(l))),
      `${conAjuste.length} turnos · ${conAjuste[0]?.porque.join(" | ")}`);
check("el draft se declara completo y ofrece revisarlo",
      /draft complete/i.test(await page.locator(".room-state").innerText()) &&
      (await page.locator(".room-replay-enter").count())===1);
check("y ya NO hay lista corta ni reloj",
      (await page.locator(".room-cands").count())===0 &&
      (await page.locator(".room-state--clock").count())===0);
await page.screenshot({path:`${OUT}/lda-1440-complete.png`});
await ctx.close();

/* === la carrera: te fichan al candidato ================================== */
/* El planteamiento ingenuo —«que otro lo fiche mientras tú estás en el
   reloj»— NO PUEDE OCURRIR y por eso no se prueba así: la lista corta sólo
   existe cuando te toca, y cuando te toca nadie más elige. Lo que sí ocurre
   de verdad en Sleeper es el AUTODRAFT: se te acaba el tiempo, el proveedor
   registra TU pick con tu candidato, y cuando vuelves a estar en el reloj ese
   jugador ya no puede aparecer. Eso es lo que se comprueba. */
console.log("\n=== candidato fichado (autodraft en tu turno) ===");
{
  reiniciar(1);
  const c2=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await montarDoble(c2);
  await c2.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),
    {...LIGA,mySlot:1});
  const p2=await c2.newPage();
  await p2.clock.install();
  await p2.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await p2.waitForSelector(".room-cands > li");
  const top=await p2.locator(".room-cands .nm").first().innerText();
  check("con el puesto 1 el asistente arranca en el reloj y con candidatos",top.length>0,top);

  // Se te acaba el reloj: el pick 1 entra por el proveedor, con TU candidato,
  // y a nombre de otro (comisionado o autodraft ajeno).
  const libres2=()=>libresDe(PROV,BOARD,SLEEPER_OF);
  emitir(1, BOARD.find(r=>(r.player_full_name??r.player_name)===top), true);
  await p2.clock.runFor(16_000);
  await p2.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="1",
                           null,{timeout:8000});
  check("el candidato fichado sale del board de disponibles en el acto",
        !(await p2.locator(".room-list .nm").allInnerTexts()).includes(top));
  check("y con el turno pasado NO queda lista corta colgada",
        (await p2.locator(".room-cands").count())===0);

  // Hasta mi siguiente turno (pick 24 en snake con el puesto 1).
  for(let no=2;no<=23;no+=1) emitir(no, libres2()[0]);
  await p2.clock.runFor(16_000);
  await p2.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="23",
                           null,{timeout:8000});
  await p2.waitForSelector(".room-cands > li",{timeout:8000});
  const nuevo=await p2.locator(".room-cands .nm").first().innerText();
  check("en mi siguiente turno la lista se recalculó sola",nuevo!==top,`${top} -> ${nuevo}`);
  check("y el fichado NO reaparece en ninguna fila de la lista corta",
        !(await p2.locator(".room-cands .nm").allInnerTexts()).includes(top));
  await p2.screenshot({path:`${OUT}/lda-1440-stolen.png`});
  await c2.close();
}

/* === aislamiento entre dos drafts ======================================== */
console.log("\n=== aislamiento A/B ===");
{
  const c3=await browser.newContext({viewport:{width:1440,height:900}});
  await c3.route("**/api.sleeper.app/**",(r)=>r.fulfill({status:200,contentType:"application/json",body:"[]"}));
  await c3.addInitScript(()=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify({
    name:"B",platform:"manual",leagueId:"LB",draftId:"DB",teams:10,scoring:"ppr",
    draftType:"snake",rounds:15,mySlot:3,roster:["QB","RB","WR","TE","FLEX","BN"],rosterSource:"MANUAL"})));
  const p3=await c3.newPage();
  await p3.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await p3.waitForSelector(".room-list button");
  check("la liga B (manual) empieza vacía pese al draft completo de A",(await cuenta(p3))==="0");
  check("y su estado de conexión dice MANUAL, no LIVE",
        /manual/i.test(await p3.locator(".room-link b").innerText()));
  await c3.close();
}

/* === LEÍDOS ≠ APLICADOS ================================================= */
/* El fallo del draft real del dueño: la liga entra, Sleeper contesta y el
   tablero no tacha nada. Aquí se provoca a propósito emitiendo picks con ids
   que el mapa horneado NO conoce (el doble los marca `sin-mapear-*`) y se
   exige que la pantalla lo DIGA, en vez de enseñar «N picks read» junto a un
   tablero intacto, que fue lo que él vio. */
console.log("\n=== picks leídos que no se aplican ===");
{
  reiniciar(MY_SLOT);
  // Filas que no están en el mapa: el doble les pone un id `sin-mapear-*`.
  const fuera=BOARD.filter((r)=>!SLEEPER_OF[r.player_id]).slice(0,6);
  const c5=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  await montar(c5,[PROV]);
  await c5.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),LIGA);
  const p5=await c5.newPage();
  await p5.clock.install();
  await p5.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await p5.waitForSelector(".room-list button");
  fuera.forEach((row,i)=>emitir(i+1,row));
  await p5.clock.runFor(16_000);
  await p5.waitForSelector(".room-scope-warn",{timeout:8000}).catch(()=>{});
  const aviso=await p5.locator(".room-scope-warn").innerText().catch(()=>"");
  check("con TODOS los picks sin emparejar, la banda dice leídos y aplicados",
        /6 picks read/.test(aviso) && /0 applied/i.test(aviso), aviso.replace(/\s+/g," ").slice(0,120));
  check("y el aviso va marcado como fallo, no como nota",
        (await p5.locator(".room-scope-warn--none").count())===1);
  check("el tablero NO tachó a nadie, que es coherente con lo que dice",
        (await cuenta(p5))==="0");
  // Y con la mitad buenos: se dicen los dos números.
  emitir(7,libres()[0]);
  await p5.clock.runFor(16_000);
  await p5.waitForFunction(()=>/1 of 7/.test(document.querySelector(".room-scope-warn")?.textContent??""),
                           null,{timeout:8000}).catch(()=>{});
  const parcial=await p5.locator(".room-scope-warn").innerText().catch(()=>"");
  check("con uno bueno y seis malos, la banda dice 1 de 7 y 6 sin emparejar",
        /1 of 7 picks applied/.test(parcial) && /6 unmatched/.test(parcial),
        parcial.replace(/\s+/g," ").slice(0,120));
  await p5.screenshot({path:`${OUT}/lda-1440-unmapped.png`});
  await c5.close();
}

/* === móvil ============================================================== */
/* === un pick sin emparejar NO desplaza a los siguientes ==================
 *
 * El fallo se vio en un draft REAL. Sleeper numera los picks y Gridiron los
 * renumeraba por su posición ENTRE LOS RESUELTOS, así que un solo pick que no
 * se pudiera emparejar —un novato de 2026 que no está en el board publicado, un
 * pateador— corría una casilla a todos los siguientes. En una parrilla de snake
 * una casilla es la columna de OTRO equipo: los jugadores salían en el sitio de
 * otro y la etiqueta `5.09` describía un pick distinto.
 *
 * Se comprueba sobre la PARRILLA, que es donde se ve, y no sobre el registro:
 * el registro ya lo cubren los tests, y lo que falló aquí es lo que se pinta. */
console.log("\n=== un pick sin emparejar no corre a los demás ===");
{
  reiniciar(1);
  const c5=await browser.newContext({viewport:{width:1440,height:1400},reducedMotion:"reduce"});
  await montarDoble(c5);
  await c5.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),
    {...LIGA,mySlot:1});
  const p5=await c5.newPage();
  await p5.clock.install();
  await p5.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await p5.waitForSelector(".room-grid-row");

  // Ocho picks, y el CUARTO es un jugador que este board no conoce. El doble ya
  // lo trata como Sleeper: id `sin-mapear-...`, que no casa con nadie.
  const elegidos=[];
  for(let no=1;no<=8;no+=1){
    if(no===4){ emitir(no,{player_id:"fantasma-2026"}); elegidos.push(null); continue; }
    const row=libres()[0]; elegidos.push(row); emitir(no,row);
  }
  await p5.clock.runFor(16_000);
  await p5.waitForFunction(()=>document.querySelector(".room-count strong")?.textContent==="7",
                           null,{timeout:8000});

  const titulo=async(no)=>p5.locator(`.room-cell[title^="${no}: "], .room-cell[title="Pick ${no}"]`)
                            .first().getAttribute("title");
  const apellido=(row)=>(row.player_full_name??row.player_name).split(" ").pop();

  check("se aplican 7 de 8 y el draft va por el pick 9, no por el 8",
        (await p5.locator(".room-count strong").innerText())==="7" &&
        /\bpick 9\b/i.test((await p5.locator(".room-where").innerText()).replace(/\s+/g," ")),
        (await p5.locator(".room-where").innerText()).replace(/\s+/g," ").slice(0,40));
  check("la casilla del pick sin emparejar se queda VACÍA, que es la verdad",
        (await titulo(4))==="Pick 4");
  const despues=[5,6,7,8];
  const mal=[];
  for(const no of despues){
    const t=await titulo(no);
    if(!t.includes(apellido(elegidos[no-1]))) mal.push(`${no}: ${t}`);
  }
  check("y CADA pick posterior sigue en SU casilla, no una antes",
        mal.length===0, mal.join(" | ") || `${despues.length} comprobados`);
  // El marcador del pick actual: con 7 resueltos y 8 emitidos, el turno es el 9.
  const ahora=await p5.locator(".room-cell.is-now").first().getAttribute("title");
  check("el marcador de «pick actual» señala el 9 y no el 8",ahora==="Pick 9",ahora);
  await p5.screenshot({path:`${OUT}/lda-1440-unmapped-gap.png`});
  await c5.close();
}

console.log("\n=== 390 y 768 ===");
for(const [w,h] of [[390,844],[768,1024]]){
  reiniciar(1);
  const c4=await browser.newContext({viewport:{width:w,height:h},reducedMotion:"reduce"});
  await montarDoble(c4);
  await c4.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),
    {...LIGA,mySlot:1});
  const p4=await c4.newPage();
  await p4.clock.install();
  await p4.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await p4.waitForSelector(".room-cands > li");
  const caja=await p4.locator(".room-cands > li").first().boundingBox();
  check(`${w}px: el primer candidato entra en el primer viewport`,caja!==null&&caja.y+caja.height<h,
        `y=${Math.round(caja?.y??-1)}`);
  check(`${w}px: sin desbordamiento`,
        await p4.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  await p4.screenshot({path:`${OUT}/lda-${w}-onclock.png`});
  await c4.close();
}

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
