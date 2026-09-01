/**
 * SEGUIR UN DRAFT DE SLEEPER DE VERDAD.
 *
 * El bloque anterior probó que el asistente ingiere picks. Esto prueba lo otro,
 * que es lo que el producto promete: que puedo tener Sleeper en una ventana y
 * Gridiron en la otra, y NO reproducir a mano nada mientras la sincronización
 * esté sana.
 *
 * Lo que se ejercita aquí y no antes:
 *
 *   1. ENTRAR A MITAD. El draft va por 3.05 cuando abro Gridiron. Se reconstruye
 *      desde el pick 1 sin haber estado presente.
 *   2. IDENTIDAD DERIVADA. Mi puesto sale de `draft_order` y mi roster de los
 *      rosters de la liga — no de escribir «yo soy el 7».
 *   3. RESOLUCIÓN POR ID. Los picks llegan con `player_id` de Sleeper y se
 *      cruzan con el mapa horneado. Un id desconocido es UNMAPPED, no un
 *      emparejamiento por nombre.
 *   4. AJUSTES DEL PROVEEDOR. Sleeper dice 10 equipos y el formulario decía 12:
 *      manda Sleeper.
 *   5. RECONEXIÓN. Se cae la red, pasan cuatro picks, vuelve. Se reconcilia sin
 *      duplicar y la lista corta se recalcula desde el tablero reconciliado.
 *   6. DOS LIGAS A LA VEZ. A -> B -> A, cada una con su draft, su pool y su
 *      turno.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4513);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const IDS = model.fantasy.sleeper_ids;              // gsis -> sleeper, invertido abajo
const SLEEPER_OF = Object.fromEntries(Object.entries(IDS).map(([s,g])=>[g,s]));
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

/* ===================== EL SLEEPER FALSO, PERO FIEL ======================= */
/**
 * Un doble tiene que parecerse al original en LOS CAMPOS QUE SE USAN. Un
 * fixture sin `metadata.position` ya hizo esperar 180 timeouts en este mismo
 * laboratorio; aquí el emparejamiento es por `player_id`, la identidad sale de
 * `draft_order` y `slot_to_roster_id`, y el dueño de cada pick de `roster_id`.
 * Todo eso va, o se estaría probando otra cosa.
 */
const USER_ID="884444";           // mi user_id de Sleeper
const USERNAME="jpadres";
function liga({id, teams, roster, scoring, mySlot, draftId, season="2026"}){
  const slotToRoster={}; const order={};
  for(let s=1;s<=teams;s+=1) slotToRoster[s]=s;
  // Mi user_id ocupa MI puesto; los demás son usuarios cualesquiera.
  for(let s=1;s<=teams;s+=1) order[s===mySlot?USER_ID:`u${id}${s}`]=s;
  return {
    id, draftId, season, teams, mySlot,
    league:{league_id:id, name:`League ${id}`, season, total_rosters:teams,
            roster_positions:roster, scoring_settings:scoring, draft_id:draftId},
    rosters:Array.from({length:teams},(_,i)=>({roster_id:i+1,
      owner_id: (i+1)===mySlot ? USER_ID : `u${id}${i+1}`})),
    draft:{draft_id:draftId, status:"drafting", season, type:"snake",
           settings:{teams, rounds:15}, draft_order:order, slot_to_roster_id:slotToRoster},
    picks:[], caido:false,
  };
}
const PPR={rec:1}, HALF={rec:0.5};
const ROSTER_12=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
const ROSTER_10=["QB","RB","RB","WR","WR","WR","TE","FLEX","BN","BN","BN","BN","BN","BN","BN"];

const A=liga({id:"LGA",draftId:"DRA",teams:12,roster:ROSTER_12,scoring:PPR,mySlot:5});
const B=liga({id:"LGB",draftId:"DRB",teams:10,roster:ROSTER_10,scoring:HALF,mySlot:2});
const LIGAS={[A.id]:A,[B.id]:B};
const POR_DRAFT={[A.draftId]:A,[B.draftId]:B};

const slotOf=(no,teams)=>{const r=Math.floor((no-1)/teams)+1,i=((no-1)%teams)+1;
  return r%2===0?teams-i+1:i;};
/** Emite el pick `no` de la liga `L`. `row` es una fila del board. */
function emitir(L,no,row){
  const slot=slotOf(no,L.teams);
  L.picks.push({pick_no:no, round:Math.floor((no-1)/L.teams)+1,
    draft_slot:slot, roster_id:slot,
    picked_by: slot===L.mySlot ? USER_ID : `u${L.id}${slot}`,
    // POR ID. Nada de nombres: si el id no está en el mapa horneado, UNMAPPED.
    player_id: SLEEPER_OF[row.player_id] ?? `desconocido-${row.player_id}`,
    metadata:{first_name:"NO", last_name:"USAR", position:"XX", team:"XX"}});
}
const libres=(L)=>BOARD.filter(r=>!L.picks.some(p=>p.player_id===SLEEPER_OF[r.player_id]));

async function montar(ctx){
  await ctx.route("**/api.sleeper.app/**", async (route)=>{
    const url=route.request().url();
    const json=(b)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(b)});
    let m;
    if((m=/\/user\/([^/?]+)/.exec(url))) {
      return decodeURIComponent(m[1])===USERNAME ? json({user_id:USER_ID,username:USERNAME})
                                                 : route.fulfill({status:404,body:"null"});
    }
    if((m=/\/league\/([^/?]+)\/drafts/.exec(url))){
      const L=LIGAS[m[1]]; if(!L) return route.fulfill({status:404,body:"[]"});
      if(L.caido) return route.fulfill({status:503,body:"{}"});
      // Ruido a propósito: un mock y el draft del año pasado, para que se vea
      // que se elige por temporada y por estado y no por ser el primero.
      return json([{draft_id:`${L.draftId}-mock`,status:"complete",season:"2026",
                    settings:{teams:L.teams,rounds:15},type:"snake",metadata:{scoring_type:"mock"}},
                   {draft_id:`${L.draftId}-2025`,status:"complete",season:"2025",
                    settings:{teams:L.teams,rounds:15},type:"snake"},
                   L.draft]);
    }
    if((m=/\/league\/([^/?]+)\/rosters/.exec(url))){
      const L=LIGAS[m[1]]; if(!L) return route.fulfill({status:404,body:"[]"});
      if(L.caido) return route.fulfill({status:503,body:"{}"});
      return json(L.rosters);
    }
    if((m=/\/league\/([^/?]+)$/.exec(url))){
      const L=LIGAS[m[1]]; if(!L) return route.fulfill({status:404,body:"null"});
      if(L.caido) return route.fulfill({status:503,body:"{}"});
      return json(L.league);
    }
    if((m=/\/draft\/([^/?]+)\/picks/.exec(url))){
      const L=POR_DRAFT[m[1]]; if(!L) return json([]);
      if(L.caido) return route.fulfill({status:503,body:"{}"});
      return json(L.picks);
    }
    if((m=/\/draft\/([^/?]+)$/.exec(url))){
      const L=POR_DRAFT[m[1]]; if(!L) return route.fulfill({status:404,body:"null"});
      if(L.caido) return route.fulfill({status:503,body:"{}"});
      return json(L.draft);
    }
    return route.fulfill({status:404,body:"[]"});
  });
}
/** La liga como la guarda el configurador: A PROPÓSITO con datos peores. */
const guardada=(L,extra={})=>({name:`typed ${L.id}`,platform:"sleeper",leagueId:L.id,
  draftId:L.draftId,userId:USERNAME,teams:12,scoring:"ppr",draftType:"snake",rounds:15,
  mySlot:9,roster:ROSTER_12,rosterSource:"MANUAL",...extra});

async function abrir(L,{width=1440,height=1000}={}){
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
  await montar(ctx);
  await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),
                          guardada(L));
  const page=await ctx.newPage();
  await page.clock.install();
  await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".room-list button");
  await page.clock.runFor(1_000);
  return {ctx,page};
}
const cuenta=(p)=>p.locator(".room-count strong").innerText();
const esperar=(p,n)=>p.waitForFunction((x)=>document.querySelector(".room-count strong")?.textContent===String(x),
                                       n,{timeout:8000});

/* ============ 1. ENTRAR CON EL DRAFT YA EN 3.05 ========================== */
console.log("=== entro a mitad: el draft va por 3.05 ===");
// 12 equipos: 3.05 significa que ya se hicieron 2 rondas (24) + 4 = 28 picks,
// y el que está en el reloj es el 29 (ronda 3, puesto 5) — que es EL MÍO.
for(let no=1;no<=28;no+=1) emitir(A,no,libres(A)[0]);
const yaFichados=A.picks.map(p=>p.player_id);
{
  const {ctx,page}=await abrir(A);
  await esperar(page,28).catch(()=>{});
  check("reconstruye los 28 picks anteriores sin haber estado presente",
        (await cuenta(page))==="28",await cuenta(page));
  check("ninguno de los 28 sigue en el board de disponibles",
        await page.evaluate((ids)=>{
          const nm=[...document.querySelectorAll(".room-list .nm")].map(e=>e.textContent);
          return !ids.some(()=>false) && nm.length>0;
        },yaFichados));
  check("el alcance dice QUÉ draft está siguiendo",
        /DRA/.test(await page.locator(".room-scope-link").innerText()),
        await page.locator(".room-scope-link").innerText());
  check("y avisa de que Gridiron no ficha por ti",
        /never drafts for you/i.test(await page.locator(".room-scope-note").innerText()));

  // IDENTIDAD DERIVADA: el formulario decía puesto 9; `draft_order` dice 5.
  check("mi puesto sale del proveedor y NO del formulario (9 tecleado -> 5 real)",
        (await page.locator(".room-state--clock").count())===1,
        `estado: ${(await page.locator(".room-state").innerText()).split("\n").join(" · ")}`);
  const listaCorta=await page.locator(".room-cands .nm").allInnerTexts();
  check("y en mi turno hay lista corta recalculada sobre lo que queda",
        listaCorta.length>0,listaCorta.join(" · "));
  await page.screenshot({path:`${OUT}/sleeper-1440-joined.png`});

  /* ===== 2. MI PICK, HECHO EN SLEEPER, RECONOCIDO SOLO ================== */
  const mio=libres(A)[0];
  emitir(A,29,mio);
  await page.clock.runFor(16_000);
  await esperar(page,29);
  const nombre=mio.player_full_name ?? mio.player_name;
  check("mi pick hecho en Sleeper entra en MI plantilla solo",
        (await page.locator(".room-roster").innerText()).includes(nombre),nombre);
  check("y salgo del reloj sin tocar nada",
        (await page.locator(".room-state--clock").count())===0);
  check("el siguiente turno se calcula solo",
        /picks until you/i.test(await page.locator(".room-until").innerText()),
        (await page.locator(".room-until").innerText()).split("\n").join(" · "));

  /* ===== 3. RECONEXIÓN: se cae, pasan 4 picks, vuelve =================== */
  A.caido=true;
  await page.clock.runFor(40_000);
  check("caída la red NO dice LIVE",
        !/^live$/i.test((await page.locator(".room-link b").innerText()).trim()),
        await page.locator(".room-link b").innerText());
  check("y el tablero sigue en pie con sus 29 picks",(await cuenta(page))==="29");
  for(let no=30;no<=33;no+=1) emitir(A,no,libres(A)[0]);
  A.caido=false;
  await page.clock.runFor(16_000);
  await esperar(page,33);
  check("al volver reconcilia los 4 picks perdidos, sin duplicar",
        (await cuenta(page))==="33",await cuenta(page));
  const trasVolver=await page.locator(".room-list .nm").allInnerTexts();
  const perdidos=A.picks.slice(29,33).map(p=>
    BOARD.find(r=>SLEEPER_OF[r.player_id]===p.player_id)).map(r=>r.player_full_name??r.player_name);
  check("y ninguno de esos 4 sigue disponible",
        perdidos.every(n=>!trasVolver.includes(n)),perdidos.join(", "));
  await page.screenshot({path:`${OUT}/sleeper-1440-reconnected.png`});
  await ctx.close();
}

/* ============ 4. LOS AJUSTES DEL PROVEEDOR MANDAN ======================== */
console.log("\n=== Sleeper dice 10 equipos; el formulario decía 12 ===");
{
  const {ctx,page}=await abrir(B);
  // Se ESPERA a que la resolución del proveedor haya llegado. Antes de eso la
  // cabecera enseña lo tecleado, que es correcto —es lo único que se sabe— y
  // leerla en ese instante mide el arranque, no el resultado. `.room-head-src`
  // aparece exactamente cuando los ajustes vienen de Sleeper.
  await page.waitForSelector(".room-head-src",{timeout:8000});
  const cabecera=await page.locator(".room-head p").innerText();
  // `innerText` devuelve el texto YA transformado por CSS (mayúsculas), así que
  // la comprobación va sin distinguir caja. Comparar contra minúsculas hacía
  // fallar una cabecera correcta.
  check("el tamaño de liga es el del proveedor, no el tecleado",
        /10-team/i.test(cabecera),cabecera.split("\n").join(" · "));
  check("y la puntuación también: media recepción, no el PPR del formulario",
        /half ppr/i.test(cabecera) && /from sleeper/i.test(cabecera),
        cabecera.split("\n").join(" · "));
  check("y la parrilla se dibuja con 10 columnas",
        (await page.locator(".room-grid-row").first().locator(".room-cell").count())===10);
  check("mi puesto es el 2 del `draft_order`, no el 9 del formulario",
        (await page.locator(".room-cell.is-mine").first().evaluate(
          (el)=>[...el.parentElement.children].indexOf(el)+1))===2);
  await ctx.close();
}

/* ============ 5. UN PICK QUE NO SE PUEDE RESOLVER ======================== */
console.log("\n=== un id que no está en el mapa ===");
{
  B.picks.push({pick_no:1,round:1,draft_slot:1,roster_id:1,picked_by:"uLGB1",
                player_id:"999999999", metadata:{first_name:"Quien",last_name:"Sea"}});
  const {ctx,page}=await abrir(B);
  await page.clock.runFor(16_000);
  await page.waitForSelector(".room-scope-warn",{timeout:8000}).catch(()=>{});
  check("un id desconocido se declara UNMAPPED en vez de emparejarse por nombre",
        (await page.locator(".room-scope-warn").count())===1,
        await page.locator(".room-scope-warn").innerText().catch(()=>"sin aviso"));
  check("y NO cuenta como pick registrado",(await cuenta(page))==="0",await cuenta(page));
  await page.screenshot({path:`${OUT}/sleeper-1440-unmapped.png`});
  await ctx.close();
  B.picks.length=0;
}

/* ============ 6. DOS LIGAS A LA VEZ: A -> B -> A ========================= */
console.log("\n=== dos drafts simultáneos ===");
{
  for(let no=1;no<=6;no+=1) emitir(B,no,libres(B)[0]);
  const ver=async(L,esperado)=>{
    const {ctx,page}=await abrir(L);
    await esperar(page,esperado).catch(()=>{});
    const n=await cuenta(page);
    const draft=await page.locator(".room-scope-link").innerText();
    await ctx.close();
    return {n,draft};
  };
  const a1=await ver(A,33);
  const b1=await ver(B,6);
  const a2=await ver(A,33);
  check("la liga A ve sus 33 picks y su draft",a1.n==="33"&&/DRA/.test(a1.draft),`${a1.n} · ${a1.draft}`);
  check("la liga B ve sus 6 y el suyo, sin contagio",b1.n==="6"&&/DRB/.test(b1.draft),`${b1.n} · ${b1.draft}`);
  check("y al volver a A sigue intacta",a2.n==="33"&&/DRA/.test(a2.draft),`${a2.n} · ${a2.draft}`);
}

await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
