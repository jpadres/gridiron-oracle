/**
 * Red team del Draft Room, en un navegador de verdad.
 *
 * Los tests de `draftLog` prueban el fold. Esto prueba el PRODUCTO: que veinte
 * picks seguidos no se pisen, que deshacer renumere, que recargar no pierda el
 * draft y que la liga A no toque a la B.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4328;
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

async function room(ctx, league) {
  const page = await ctx.newPage();
  await page.addInitScript((l) => {
    localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l));
  }, league);
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button", { timeout: 15000 });
  return page;
}

const count = (page) => page.locator(".room-count strong").innerText();
const firstRow = (page) => page.locator(".room-list button").first();

for (const width of [390, 768, 1440]) {
  console.log(`\n=== ${width}px ===`);
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "dark" });
  const page = await room(ctx, LEAGUE());

  // --- un pick es un toque
  const name = await firstRow(page).locator(".nm").innerText();
  const t0 = Date.now();
  await firstRow(page).click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
  check("un toque registra el pick", true, `${name} en ${Date.now() - t0} ms`);
  check("el jugador sale del board",
        (await firstRow(page).locator(".nm").innerText()) !== name);
  check("aparece deshacer", await page.locator(".room-flash").isVisible());

  // --- deshacer
  await page.locator(".room-flash button").click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "0");
  check("deshacer devuelve al jugador",
        (await firstRow(page).locator(".nm").innerText()) === name);

  // --- veinte picks rápidos
  const inicio = Date.now();
  for (let i = 0; i < 20; i += 1) await firstRow(page).click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "20");
  const ms = Date.now() - inicio;
  check("veinte picks seguidos sin pisarse", (await count(page)) === "20", `${ms} ms total`);
  const nombres = await page.locator(".room-feed .feed-who").allInnerTexts();
  check("sin duplicados en el feed", new Set(nombres).size === nombres.length);

  // --- el reloj avanza
  const estado = await page.locator(".room-state").innerText();
  check("el estado del draft se actualiza", /PICK|CLOCK|UNTIL/i.test(estado),
        estado.split("\n").slice(0, 2).join(" | "));

  // --- recargar
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button");
  check("recargar conserva el draft", (await count(page)) === "20");

  await ctx.close();
}

// --- aislamiento entre ligas -------------------------------------------------
console.log("\n=== aislamiento ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await room(ctx, LEAGUE());
  for (let i = 0; i < 5; i += 1) await firstRow(a).click();
  await a.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "5");
  const primeroA = await firstRow(a).locator(".nm").innerText();
  await a.close();

  const b = await room(ctx, LEAGUE({ name: "B", leagueId: "LB", draftId: "DB", teams: 10 }));
  check("la liga B empieza vacía", (await count(b)) === "0");
  const primeroB = await firstRow(b).locator(".nm").innerText();
  check("el jugador cogido en A sigue libre en B", primeroA !== primeroB);
  await b.close();

  const vuelta = await room(ctx, LEAGUE());
  check("volver a A recupera sus cinco picks", (await count(vuelta)) === "5");
  await vuelta.close();
  await ctx.close();
}

// --- puesto desconocido ------------------------------------------------------
console.log("\n=== puesto desconocido ===");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await room(ctx, LEAGUE({ mySlot: null, leagueId: "LC", draftId: "DC" }));
  const estado = await page.locator(".room-state").innerText();
  check("sin puesto se dice UNKNOWN, no se inventa turno", /UNKNOWN/i.test(estado));
  await firstRow(page).click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
  const roster = await page.locator(".room-roster li").count();
  check("un pick sin dueño NO entra en mi plantilla", roster === 0);
  check("y se dice que el roster es desconocido",
        /roster unknown/i.test(await page.locator(".room-flash").innerText()));
  await ctx.close();
}

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
