/**
 * E17 — convergencia del estado de draft, en un navegador de verdad.
 *
 * Los unitarios prueban que el fold es correcto. Esto prueba lo que el usuario
 * ve: que tachar en `/fantasy` y draftear en `/fantasy/draft` son la MISMA
 * acción sobre el MISMO draft, que deshacer funciona desde las dos, y que la
 * liga A sigue sin poder tocar a la B ahora que comparten registro.
 *
 * Escenarios 11-19 de `docs/PREREGISTRO_convergencia.md`, fijados antes.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4331;
const BASE = `http://127.0.0.1:${PORT}`;

async function assertPortFree(base) {
  try { await fetch(base, { signal: AbortSignal.timeout(1500) }); }
  catch { return; }
  throw new Error(`Ya hay algo sirviendo en ${base}: servidor zombi con un build viejo.`);
}
await assertPortFree(BASE);
console.log("construyendo…");
await new Promise((res, rej) => {
  const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
  b.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build ${c}`))));
});
const server = spawn("npx", ["next", "start", "-p", String(PORT)],
                     { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 400));
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
let fallos = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const LEAGUE = (over = {}) => ({
  name: "A", platform: "manual", leagueId: "LA", draftId: "DA",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 8, ...over,
});

/** Un contexto con la liga ya configurada: es lo que hace que las DOS páginas
 *  resuelvan la misma identidad. Sin ella, el board cae al ámbito local — que
 *  también es correcto, pero es otro draft. */
async function ctxWith(league, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  await ctx.addInitScript((l) => {
    localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l));
  }, league);
  return ctx;
}

async function board(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".onclock-actions button", { timeout: 20000 });
  return page;
}
async function room(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button", { timeout: 20000 });
  return page;
}
const roomCount = (page) => page.locator(".room-count strong").innerText();
const boardTotal = (page) => page.locator(".draft-head strong").nth(1).innerText();

// --- 11 · 13 · 16: del board al Room ----------------------------------------
console.log("\n=== board -> room ===");
{
  const ctx = await ctxWith(LEAGUE());
  const b = await board(ctx);
  check("el board dice en qué draft está marcando",
        /same draft as the room/i.test(await b.locator(".draft-tools .caption").first().innerText()));

  const mio = await b.locator(".onclock-name").innerText();
  await b.locator(".onclock-actions .act--mine").click();          // MINE
  await b.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("1 off"));
  const suyo = await b.locator(".picks.deal .pick .nm").first().innerText();
  await b.locator(".picks.deal .pick").first().locator("button.ghost").click();   // GONE
  await b.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("2 off"));
  await b.close();

  const r = await room(ctx);
  check("E17.11 — lo tachado en el board ya no está en el Room",
        (await roomCount(r)) === "2", `count=${await roomCount(r)}`);
  const libres = await r.locator(".room-list .nm").allInnerTexts();
  check("los dos jugadores salieron del board del Room",
        !libres.includes(mio) && !libres.includes(suyo));

  const roster = await r.locator(".room-roster li").allInnerTexts();
  const enRoster = roster.join(" ");
  check("E17.13 — «Mine» entra en la plantilla del Room", enRoster.includes(mio),
        `roster: ${enRoster.slice(0, 80) || "(vacío)"}`);
  check("E17.13 — «Gone» NO entra en la plantilla de nadie", !enRoster.includes(suyo));
  await r.close();
  await ctx.close();
}

// --- 12 · 14 · 16: del Room al board ----------------------------------------
console.log("\n=== room -> board ===");
{
  const ctx = await ctxWith(LEAGUE({ leagueId: "LR", draftId: "DR" }));
  const r = await room(ctx);
  const nombres = [];
  for (let i = 0; i < 3; i += 1) {
    nombres.push(await r.locator(".room-list .nm").first().innerText());
    await r.locator(".room-list button").first().click();
  }
  await r.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "3");
  await r.close();

  const b = await board(ctx);
  check("E17.12 — los picks del Room están en el board", (await boardTotal(b)) === "3",
        `off the board = ${await boardTotal(b)}`);
  const sugeridos = await b.locator(".onclock-name, .picks.deal .nm").allInnerTexts();
  check("E17.16 — y ninguno se sigue sugiriendo",
        nombres.every((n) => !sugeridos.includes(n)));
  await b.close();

  // deshacer EN EL ROOM, comprobar EN EL BOARD
  const r2 = await room(ctx);
  await r2.locator(".room-list button").first().click();
  await r2.locator(".room-flash button").click();
  await r2.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "3");
  await r2.close();
  const b2 = await board(ctx);
  check("E17.14 — deshacer en el Room se ve en el board", (await boardTotal(b2)) === "3");
  await b2.close();
  await ctx.close();
}

// --- 15 · 17 · 18: deshacer y reiniciar desde el board -----------------------
console.log("\n=== deshacer y reiniciar desde el board ===");
{
  const ctx = await ctxWith(LEAGUE({ leagueId: "LU", draftId: "DU" }), 390);
  const b = await board(ctx);
  const mio = await b.locator(".onclock-name").innerText();
  await b.locator(".onclock-actions .act--mine").click();
  await b.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("1 off"));
  await b.locator("ul.mine .link").first().click();               // undo
  await b.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("0 off"));
  await b.close();

  const r = await room(ctx);
  check("E17.15 — deshacer en el board se ve en el Room", (await roomCount(r)) === "0");
  check("y el jugador vuelve a estar disponible",
        (await r.locator(".room-list .nm").allInnerTexts()).includes(mio));
  await r.close();

  // recargar conserva
  const b2 = await board(ctx);
  await b2.locator(".onclock-actions .act--mine").click();
  await b2.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("1 off"));
  await b2.reload({ waitUntil: "domcontentloaded" });
  await b2.waitForSelector(".onclock-actions button");
  check("E17.18 — recargar conserva el estado compartido", (await boardTotal(b2)) === "1");

  // start over: vacía el registro y NO desconecta nada
  // La preferencia de conexión se siembra a mano: es lo que la versión anterior
  // borraba sin querer, porque el botón reemplazaba el objeto de estado entero.
  await b2.evaluate(() => localStorage.setItem(
    "gridiron-draft-prefs-v1", JSON.stringify({ league: "999888", userId: "u9" })));
  const antes = await b2.evaluate(() => ({
    liga: localStorage.getItem("gridiron-room-league-v1"),
    prefs: localStorage.getItem("gridiron-draft-prefs-v1"),
  }));
  await b2.locator(".draft-head .link").click();
  await b2.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("0 off"));
  const despues = await b2.evaluate(() => ({
    liga: localStorage.getItem("gridiron-room-league-v1"),
    prefs: localStorage.getItem("gridiron-draft-prefs-v1"),
  }));
  check("E17.17 — «start over» vacía el board", (await boardTotal(b2)) === "0");
  check("E17.17 — y NO desconecta la liga",
        antes.liga !== null && antes.liga === despues.liga);
  check("E17.17 — ni borra la preferencia de conexión",
        despues.prefs === antes.prefs, `${antes.prefs} -> ${despues.prefs}`);
  await b2.close();

  const r2 = await room(ctx);
  check("E17.17 — el reinicio también vacía el Room", (await roomCount(r2)) === "0");
  await r2.close();
  await ctx.close();
}

// --- 19: el aislamiento sigue en pie ----------------------------------------
console.log("\n=== aislamiento con estado compartido ===");
{
  const ctx = await ctxWith(LEAGUE({ name: "A", leagueId: "LX", draftId: "DX" }));
  const b = await board(ctx);
  await b.locator(".onclock-actions .act--mine").click();
  await b.waitForFunction(() => document.querySelector(".draft-head")?.textContent?.includes("1 off"));
  const suyoA = await b.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.endsWith(":log")));
  check("el registro se guarda bajo la identidad de la liga",
        suyoA.length === 1 && suyoA[0].includes("LX") && suyoA[0].includes("DX"),
        suyoA.join(", "));
  await b.close();

  // Cambiar de liga: mismo navegador, otra identidad.
  await ctx.addInitScript((l) => {
    localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l));
  }, LEAGUE({ name: "B", leagueId: "LY", draftId: "DY", teams: 10 }));
  const rB = await room(ctx);
  check("E17.19 — la liga B empieza vacía", (await roomCount(rB)) === "0");
  await rB.close();
  const bB = await board(ctx);
  check("E17.19 — y su board tampoco hereda nada", (await boardTotal(bB)) === "0");
  check("E17.19 — el board dice que está en la liga B",
        /league LY|>B</i.test(
          await bB.locator(".draft-tools .caption").first().innerHTML()));
  await bB.close();
  await ctx.close();
}

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
