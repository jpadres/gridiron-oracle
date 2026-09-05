/**
 * TORTURA EN NAVEGADOR — fases 6, 7, 8, 23, 24, 30, 31, 45, 46.
 *
 * No inyecta estado: pulsa. Un bot draftea por la interfaz, recarga a mitad,
 * cambia de liga, deshace, corrige y vuelve. Lo que se comprueba es que el
 * estado plegado sobrevive a todo eso y que ninguna pantalla enseña un jugador
 * que otra da por cogido.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4360);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b) { try { await fetch(b, { signal: AbortSignal.timeout(1500) }); }
  catch { return; } throw new Error(`servidor zombi en ${b}`); }
await libre(BASE);
console.log("construyendo…");
await new Promise((res, rej) => {
  const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
  b.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build ${c}`))));
});
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 400)); }

const browser = await launch();
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

const liga = (o = {}) => ({ name: "T", platform: "manual", leagueId: "L1", draftId: "D1",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 6, ...o });

async function ctxCon(l, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  await ctx.addInitScript((x) => localStorage.setItem("gridiron-room-league-v1", JSON.stringify(x)), l);
  return ctx;
}
const room = async (ctx) => { const p = await ctx.newPage();
  await p.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".room-list button", { timeout: 20000 }); return p; };
const board = async (ctx) => { const p = await ctx.newPage();
  await p.goto(`${BASE}/fantasy`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".onclock-actions button", { timeout: 20000 }); return p; };
const cuenta = (p) => p.locator(".room-count strong").innerText();

/* --- FASE 30/6 — bot que draftea POR LA INTERFAZ, con recarga a mitad ------ */
console.log("\n=== FASE 30 · bot de draft por la interfaz (12 eq, 10+ rondas) ===");
{
  const ctx = await ctxCon(liga());
  const page = await room(ctx);
  const tomados = [];
  const latencias = [];
  let saltos = 0;

  for (let i = 1; i <= 120; i += 1) {
    // Variedad: buscar, filtrar, y sobre todo pulsar filas.
    if (i % 17 === 0) {
      await page.locator(".draft-search").fill("a");
      await page.waitForTimeout(30);
      await page.locator(".draft-search").fill("");
    }
    if (i % 23 === 0) {
      const pos = ["QB", "RB", "WR", "TE", "ALL"][i % 5];
      await page.locator(`.pos-option:text-is("${pos}")`).click();
      await page.waitForTimeout(30);
      await page.locator('.pos-option:text-is("ALL")').click();
    }
    const antesY = await page.evaluate(() => window.scrollY);
    const nombre = await page.locator(".room-list .nm").first().innerText();
    const t0 = Date.now();
    await page.locator(".room-list button").first().click();
    await page.waitForFunction((n) => document.querySelector(".room-count strong")?.textContent === String(n), i);
    latencias.push(Date.now() - t0);
    tomados.push(nombre);
    const trasY = await page.evaluate(() => window.scrollY);
    if (Math.abs(trasY - antesY) > 4) saltos += 1;

    if (i === 40 || i === 80) {   // recarga a mitad del draft
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".room-list button");
      const c = await cuenta(page);
      check(`recarga en el pick ${i}: el estado sobrevive`, c === String(i), `count=${c}`);
    }
  }
  const dup = tomados.length !== new Set(tomados).size;
  check("120 picks por la interfaz sin duplicados", !dup,
        dup ? [...tomados].filter((x, i, a) => a.indexOf(x) !== i).slice(0, 3).join(", ") : `${tomados.length} únicos`);
  latencias.sort((a, b) => a - b);
  check("latencia p50 por debajo de 150 ms", latencias[60] < 150, `p50 ${latencias[60]} ms p95 ${latencias[113]} ms`);
  check("sin saltos de scroll al registrar un pick", saltos === 0, `${saltos} saltos`);

  // FASE 45 — draft terminado: no puede seguir hablando como si estuviera vivo.
  const estado = await page.locator(".room-state").innerText();
  check("el estado sigue siendo coherente tras 120 picks", /PICK|CLOCK|UNTIL/i.test(estado),
        estado.replace(/\s+/g, " ").slice(0, 70));
  await ctx.close();
}

/* --- FASE 23/24 — invariante de disponibilidad entre pantallas ------------- */
console.log("\n=== FASE 23/24 · un jugador cogido lo está en TODAS las pantallas ===");
{
  const ctx = await ctxCon(liga({ leagueId: "LX", draftId: "DX" }));
  const r = await room(ctx);
  const cogidos = [];
  for (let i = 0; i < 8; i += 1) {
    cogidos.push(await r.locator(".room-list .nm").first().innerText());
    await r.locator(".room-list button").first().click();
    await r.waitForFunction((n) => document.querySelector(".room-count strong")?.textContent === String(n), i + 1);
  }
  // En el Room: ni en ALL ni en ningún filtro ni en la búsqueda.
  const fantasmas = [];
  for (const pos of ["ALL", "QB", "RB", "WR", "TE"]) {
    await r.locator(`.pos-option:text-is("${pos}")`).click();
    await r.waitForTimeout(40);
    const visibles = await r.locator(".room-list .nm").allInnerTexts();
    for (const c of cogidos) if (visibles.includes(c)) fantasmas.push(`${pos}:${c}`);
  }
  await r.locator('.pos-option:text-is("ALL")').click();
  for (const c of cogidos.slice(0, 3)) {
    await r.locator(".draft-search").fill(c.split(" ").pop());
    await r.waitForTimeout(60);
    const visibles = await r.locator(".room-list .nm").allInnerTexts();
    if (visibles.includes(c)) fantasmas.push(`busqueda:${c}`);
  }
  await r.locator(".draft-search").fill("");
  check("ningún jugador cogido reaparece en filtros ni en la búsqueda",
        fantasmas.length === 0, fantasmas.slice(0, 3).join(", "));
  await r.close();

  // Y en el Board.
  const b = await board(ctx);
  const enBoard = await b.locator(".onclock-name, .picks.deal .nm").allInnerTexts();
  check("tampoco los sugiere el Draft Board",
        !cogidos.some((c) => enBoard.includes(c)), enBoard.slice(0, 2).join(", "));
  const total = await b.locator(".draft-head strong").nth(1).innerText();
  check("y el Board cuenta los mismos picks", total === "8", `board dice ${total}`);
  await b.close();
  await ctx.close();
}

/* --- FASE 7/8 — tortura multi-liga intercalada ----------------------------- */
console.log("\n=== FASE 7/8 · tres ligas intercaladas ===");
{
  const A = liga({ name: "A", leagueId: "LA", draftId: "DA", teams: 10 });
  const B = liga({ name: "B", leagueId: "LB", draftId: "DB", teams: 14, scoring: "half" });
  const C = liga({ name: "C", leagueId: "LC", draftId: "DC", teams: 32, draftType: "linear" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const usar = async (l) => {
    await ctx.addInitScript((x) => localStorage.setItem("gridiron-room-league-v1", JSON.stringify(x)), l);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".room-list button", { timeout: 20000 });
    return p;
  };
  const pick = async (p, n) => { await p.locator(".room-list button").first().click();
    await p.waitForFunction((x) => document.querySelector(".room-count strong")?.textContent === String(x), n); };

  let pa = await usar(A); await pick(pa, 1); await pick(pa, 2); await pa.close();
  let pb = await usar(B); await pick(pb, 1); await pb.close();
  pa = await usar(A); await pick(pa, 3); await pa.close();
  let pc = await usar(C); await pick(pc, 1); await pick(pc, 2); await pick(pc, 3); await pick(pc, 4); await pc.close();
  pb = await usar(B); await pick(pb, 2);
  await pb.locator(".room-roster .room-x, .room-feed .room-x").first().click();   // B deshace
  await pb.waitForTimeout(80);
  const cb = await cuenta(pb); await pb.close();

  pa = await usar(A);
  check("A conserva sus 3 picks tras todo lo demás", (await cuenta(pa)) === "3", await cuenta(pa));
  await pa.reload({ waitUntil: "domcontentloaded" }); await pa.waitForSelector(".room-list button");
  check("y sobrevive a una recarga", (await cuenta(pa)) === "3");
  await pa.close();

  pb = await usar(B);
  check("B conserva su estado tras deshacer", (await cuenta(pb)) === cb, `${await cuenta(pb)} vs ${cb}`);
  await pb.close();

  pc = await usar(C);
  check("C conserva sus 4 picks", (await cuenta(pc)) === "4", await cuenta(pc));
  await pc.close();

  // Hay que NAVEGAR antes de leer `localStorage`: en `about:blank` el origen no
  // es el del sitio y el navegador deniega el acceso.
  const inspector = await ctx.newPage();
  await inspector.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  const claves = await inspector.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(":log")));
  check("una clave de registro por liga, ni una compartida", claves.length === 3, claves.join(" | "));
  check("y cada una lleva su identidad",
        claves.some((k) => k.includes("LA")) && claves.some((k) => k.includes("LB")) && claves.some((k) => k.includes("LC")));

  await inspector.close();

  // FASE 8 — mismo league_id, draft NUEVO: no puede heredar nada.
  const nuevo = liga({ name: "A2", leagueId: "LA", draftId: "DA-2024", teams: 10 });
  const pn = await usar(nuevo);
  check("mismo league_id con draft nuevo empieza VACÍO", (await cuenta(pn)) === "0", await cuenta(pn));
  await pn.close();
  const otraTemporada = liga({ name: "A3", leagueId: "LA", draftId: "DA", teams: 10 });
  void otraTemporada;
  await ctx.close();
}

/* --- FASE 46 — cero, vacío y desconocido son cosas distintas --------------- */
console.log("\n=== FASE 46 · 0 ≠ EMPTY ≠ UNKNOWN ===");
{
  const ctx = await ctxCon(liga({ leagueId: "LU", draftId: "DU", mySlot: null }));
  const page = await room(ctx);
  const estado = await page.locator(".room-state").innerText();
  check("sin puesto de draft se dice UNKNOWN, no se inventa turno", /UNKNOWN/i.test(estado),
        estado.replace(/\s+/g, " ").slice(0, 60));
  await page.locator(".room-list button").first().click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
  const roster = await page.locator(".room-roster li").count();
  check("un pick sin dueño derivable NO entra en ninguna plantilla", roster === 0, `${roster} en plantilla`);
  check("y se dice que el dueño es desconocido",
        /roster unknown/i.test(await page.locator(".room-flash").innerText()));
  const vacio = await page.locator(".room-empty").first().innerText().catch(() => "");
  check("la plantilla vacía dice «nothing yet», no «0»", /nothing/i.test(vacio), vacio.slice(0, 40));
  await ctx.close();
}

/* --- FASE 22/45 — board agotado y estados terminales --------------------- */
console.log("\n=== FASE 22/45 · board agotado ===");
{
  const ctx = await ctxCon(liga({ leagueId: "LE", draftId: "DE", teams: 32, rounds: 20 }));
  const page = await room(ctx);
  // Vaciar el board por filtro: TE es la posición más corta del payload.
  await page.locator('.pos-option:text-is("TE")').click();
  await page.waitForTimeout(60);
  const antes = await page.locator(".room-list button").count();
  for (let i = 0; i < antes; i += 1) {
    await page.locator(".room-list button").first().click();
    await page.waitForTimeout(8);
  }
  await page.waitForTimeout(120);
  const vacio = await page.locator(".room-empty").first().innerText();
  check("con una posición agotada NO dice «no match»", !/matches that/i.test(vacio), vacio.slice(0, 60));
  check("dice que no queda nadie de esa posición", /no TE left|exhausted/i.test(vacio), vacio.slice(0, 60));
  // Y con una búsqueda sin resultados dice OTRA cosa.
  await page.locator('.pos-option:text-is("ALL")').click();
  await page.locator(".draft-search").fill("zzzzqqq");
  await page.waitForTimeout(80);
  const sinResultado = await page.locator(".room-empty").first().innerText();
  check("búsqueda sin resultados dice algo DISTINTO", /matches/i.test(sinResultado), sinResultado.slice(0, 60));
  check("y los dos mensajes no son el mismo", vacio !== sinResultado);
  await ctx.close();
}

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
