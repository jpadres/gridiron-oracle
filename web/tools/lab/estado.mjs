/**
 * APARTADOS: se ven en la fila y NO se recomiendan.
 *
 * El caso que trae esto es real y es el peor que ha tenido el board: Josh
 * Jacobs salía en el puesto 38 con su número normal estando en la Lista de
 * Exentos del Comisionado sin fecha de vuelta. Los datos de plantilla dicen
 * `ACT` en Green Bay —porque cobra y ocupa sitio— así que nada en pantalla
 * chirriaba. Un board que ofrece a alguien que no puede jugar no es optimista:
 * es falso sobre un hecho comprobable.
 *
 * Se comprueba en la pantalla, no en el payload, porque el fallo de hoy fue
 * exactamente ése: el dato viajaba y la fila no lo pintaba.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4518);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b){try{await fetch(b,{signal:AbortSignal.timeout(1500)});}catch{return;}throw new Error(`zombi en ${b}`);}
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const APARTADOS = BOARD.filter((r) => r.status_severity === "OUT");
if(!process.env.SKIP_BUILD){
  await new Promise((r,j)=>{const b=spawn("npx",["next","build"],{cwd:WEB,stdio:"ignore"});b.on("exit",c=>c===0?r():j(new Error(`build ${c}`)));});
}
const server=spawn("npx",["next","start","-p",String(PORT)],{cwd:WEB,stdio:"ignore",detached:true});
const stop=()=>{try{process.kill(-server.pid);}catch{/* ya no está */}};process.on("exit",stop);
for(let i=0;i<60;i+=1){try{if((await fetch(BASE)).ok)break;}catch{/* aún no */}await new Promise(r=>setTimeout(r,400));}
const browser=await launch();
let fallos=0;
const check=(n,ok,d="")=>{if(!ok)fallos+=1;console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`);};

console.log("=== lo que viaja ===");
check("hay jugadores marcados como apartados",APARTADOS.length>0,
      APARTADOS.map(r=>`${r.player_name} ${r.status_label}`).join(" · "));
check("cada marca lleva fuente y las dos fechas",
      APARTADOS.every(r=>r.status_effective_at&&r.status_verified_at
                       &&Array.isArray(r.status_sources)&&r.status_sources.length>0));
check("y NINGUNA cambió el número de su fila",
      APARTADOS.every(r=>Number.isFinite(r.projected_points)&&Number.isFinite(r.vor)),
      "la marca no calcula: regla 8");

const ROSTER=["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN","BN","BN","BN"];
const GUARDADA={name:"Manual",platform:"manual",teams:12,scoring:"ppr",draftType:"snake",
  rounds:15,mySlot:1,roster:ROSTER,rosterSource:"MANUAL"};
const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
await ctx.addInitScript((l)=>localStorage.setItem("gridiron-room-league-v1",JSON.stringify(l)),GUARDADA);
const page=await ctx.newPage();
await page.goto(`${BASE}/fantasy/draft`,{waitUntil:"domcontentloaded"});
await page.waitForSelector(".room-list button");

console.log("\n=== la fila lo dice ===");
const objetivo=APARTADOS[0];
await page.fill(".room-board input", objetivo.player_full_name ?? objetivo.player_name);
await page.waitForTimeout(200);
// La fila pinta el nombre COMPLETO; buscar por el abreviado no encuentra nada.
const nombre=objetivo.player_full_name ?? objetivo.player_name;
const fila=page.locator(".room-list li",{hasText:nombre}).first();
check("el apartado sigue en el board y se encuentra",await fila.count()>0,nombre);
const marca=fila.locator(".room-row-out");
check("con su marca en la fila",(await marca.count())===1,
      await marca.innerText().catch(()=>"sin marca"));
const titulo=await marca.getAttribute("title").catch(()=>"");
check("y el título dice el motivo, desde cuándo y quién lo dice",
      /In effect since/.test(titulo)&&/Verified|LAST VERIFIED/.test(titulo)&&/Source/.test(titulo),
      titulo);
check("y deja claro que NO mueve el número",/Changes no number|changes no number/i.test(titulo));
await page.fill(".room-board input","");

console.log("\n=== y no se recomienda ===");
await page.waitForTimeout(200);
const cands=await page.locator(".room-cands .nm").allInnerTexts();
const apartadosVisibles=new Set(APARTADOS.flatMap(r=>[r.player_full_name,r.player_name].filter(Boolean)));
check("ningún apartado entra en la lista corta",
      cands.every(n=>!apartadosVisibles.has(n)),cands.join(" · "));
check("pero la lista corta NO está vacía por ello",cands.length>0,`${cands.length} candidatos`);

console.log("\n=== la tabla publicada también ===");
await page.goto(`${BASE}/fantasy`,{waitUntil:"domcontentloaded"});
await page.waitForSelector("table");
const marcas=await page.locator(".mark--out").allInnerTexts();
check("el board de /fantasy pinta la misma marca",marcas.length>0,marcas.slice(0,6).join(" · "));

await ctx.close(); await browser.close(); stop();
console.log(fallos===0?"\nSIN FALLOS":`\n${fallos} FALLOS`);
process.exit(fallos===0?0:1);
