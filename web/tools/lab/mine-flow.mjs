/**
 * EL FLUJO REAL DE LA DUEÑA, en el navegador: marcar SU ala cerrada y SU
 * quarterback en el Draft Room sin anotar los picks de los demás, y exigir que
 * la recomendación con contexto de plantilla deje de empujar TE y QB.
 *
 * Es el fallo que ni la simulación ni los tests de motor podían ver: el motor
 * estaba bien y lo que fallaba era de QUIÉN se registraba el pick. Un toque
 * en una fila deriva el dueño del contador, y sin anotar la sala entera el
 * contador no está en tu casilla: los dos picks caían en un rival y el motor
 * recomendaba sobre una plantilla vacía. Sólo un navegador ve eso.
 */
import { launch } from "./browser.mjs";
import { spawn } from "node:child_process";
const port = Number(process.env.PORT ?? 4620), base = `http://127.0.0.1:${port}`;
const srv = spawn("npx", ["next","start","-p",String(port)], { stdio:"ignore" });
for (let i=0;i<60;i++){ try{ if((await fetch(base)).ok) break; }catch{} await new Promise(r=>setTimeout(r,1000)); }
let fallos = 0; const check=(n,ok,d="")=>{ if(!ok) fallos++; console.log(`  ${ok?"ok   ":"FALLA"} ${n}${d?` — ${d}`:""}`); };
const b = await launch(); const p = await b.newPage({ viewport:{width:1280,height:2400} });
p.on("pageerror", e=>{ console.log("PAGEERROR", e.message); fallos++; });
await p.goto(`${base}/fantasy/draft`, { waitUntil:"networkidle" });
await p.getByLabel(/League name/i).fill("Mine flow");
const slot = p.getByLabel(/draft slot/i); if (await slot.count()) await slot.first().fill("3");
await p.locator('button').filter({ hasText: /use standard/i }).first().click();
await p.locator('button').filter({ hasText: /Enter draft room|Continue|Start/i }).first().click();
await p.waitForTimeout(1500);
const body = async () => p.locator("body").innerText();
async function tapRow(pos){
  const rows = p.locator('button.room-row'); const n = await rows.count();
  for (let k=0;k<n;k++){ const t=(await rows.nth(k).innerText()).replace(/\n/g," "); if (new RegExp(`\\b${pos}\\d+\\b`).test(t)) { await rows.nth(k).click(); await p.waitForTimeout(600); return t.slice(0,50); } }
  return null;
}
async function mine(){ const b2 = p.locator('.room-flash button').filter({ hasText:/^Mine$/ }); if (await b2.count()) { await b2.first().click(); await p.waitForTimeout(900); return true; } return false; }
function primaryBlock(t){ const i=t.indexOf("Best pick for you"); const j=t.indexOf("Best available"); return i>=0 ? t.slice(i, j>i? j : i+900) : ""; }
function rosterBlock(t){ const i=t.indexOf("My roster"); return i>=0 ? t.slice(i, i+240).replace(/\n/g," ") : ""; }

// A. TE como MI pick
const te = await tapRow("TE"); check("hay una fila de TE que tocar", !!te, te);
check("tras tocar, el flash ofrece «Mine»", await mine(), "no había botón Mine en el flash");
let t = await body();
check("tras TE: mi plantilla tiene el TE", /TE\s+\S.*?(McBride|Bowers|Kittle|LaPorta|Kelce|Hockenson|Ferguson|Kincaid|Andrews|Njoku|\w+)/.test(rosterBlock(t)) && !/TE\s+Open/.test(rosterBlock(t)), rosterBlock(t));
await p.screenshot({ path: "/tmp/mineflow_TE.png" });

// B. QB como MI pick
const qb = await tapRow("QB"); check("hay una fila de QB que tocar", !!qb, qb);
check("tras tocar, el flash ofrece «Mine» otra vez", await mine());
t = await body();
const ros = rosterBlock(t);
check("tras QB: QB lleno y TE lleno", !/QB\s+Open/.test(ros) && !/TE\s+Open/.test(ros), ros);
const prim = primaryBlock(t);
check("la lista con contexto de plantilla SE PINTA aunque el contador no esté en mi casilla", prim.length > 0);
const primaryPos = (prim.match(/\b(QB|RB|WR|TE)\d+\b/g) || []);
check("el candidato principal NO es QB ni TE", primaryPos.length > 0 && !/^(QB|TE)/.test(primaryPos[0]), primaryPos.slice(0,4).join(" "));
check("ninguna alternativa es un QB", !primaryPos.some(x=>/^QB/.test(x)), primaryPos.join(" "));
const ba = t.slice(t.indexOf("Best available"));
check("BEST AVAILABLE sigue enseñando algún QB o TE con su VOR", /\b(QB|TE)\d+\b/.test(ba));
await p.screenshot({ path: "/tmp/mineflow_QB.png" });
console.log("\nPRIMARY tras TE+QB:", prim.replace(/\n+/g," ").slice(0,220));
await b.close(); srv.kill("SIGKILL");
console.log(fallos===0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`); process.exit(fallos===0?0:1);
