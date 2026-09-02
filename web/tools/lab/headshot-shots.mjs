/**
 * Capturas con las fotos de los jugadores en cada superficie, a tres anchos.
 *
 * Desde el contenedor de desarrollo el CDN de Sleeper está bloqueado, así que
 * lo que se ve es el RESPALDO (iniciales) — que es exactamente lo que verá un
 * usuario si el CDN falla. Lo que sí se comprueba: que cada fila lleva su
 * `<img>` con la URL por `sleeper_id` o su círculo de iniciales, que nada se
 * desborda a 390 px y que la cuenta enlazada pinta la plantilla con fotos.
 *
 *     SKIP_BUILD=1 node tools/lab/headshot-shots.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, emitir, montar, slotOf } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4515);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOTS ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const DEFENSES = model.fantasy.specialists?.defenses ?? [];
const SLEEPER_OF = Object.fromEntries(Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));

if (!process.env.SKIP_BUILD) {
  await new Promise((r, j) => { const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" }); b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`)))); });
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 400)); }

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

const L1 = crearLiga({ id: "LG12", draftId: "DR12", teams: 12, mySlot: 7, rounds: 15, name: "Sunday Twelve",
  roster: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN", "BN"], scoring: { rec: 1 } });
let no = 1;
for (const row of [BOARD[0], BOARD[1], BOARD[5], DEFENSES[3]]) {
  while (slotOf(no, 12) !== 7) no += 1;
  emitir(L1, no, row, SLEEPER_OF); no += 1;
}

for (const width of [390, 768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  await montar(ctx, [L1]);
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.goto(`${BASE}/fantasy`, { waitUntil: "domcontentloaded" });
  // El esqueleto de carga de Next se pinta antes que la tabla: la captura
  // espera a la tabla, o retrata el esqueleto y parece que el board no carga.
  await page.waitForSelector("table", { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 10000 }).catch(() => {});
  const imgs = await page.locator("img.hs, span.hs").count();
  check(`${width}: el board pinta una foto o iniciales por fila`, imgs > 100, `${imgs}`);
  const src = await page.locator("img.hs").first().getAttribute("src");
  check(`${width}: la URL es la miniatura por sleeper_id`, /sleepercdn\.com\/content\/nfl\/players\/thumb\/\d+\.jpg$/.test(src ?? ""), src ?? "");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`${width}: sin desbordamiento horizontal en el board`, !overflow);
  await page.screenshot({ path: `${OUT}/fotos-${width}-board.png` });

  await page.goto(`${BASE}/fantasy/semanal`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hs", { timeout: 8000 }).catch(() => {});
  check(`${width}: el ranking semanal lleva fotos`, (await page.locator(".hs").count()) > 20);
  await page.screenshot({ path: `${OUT}/fotos-${width}-semanal.png` });

  await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#cc-user");
  await page.fill("#cc-user", USERNAME);
  await page.click(".cc-link button[type=submit]");
  await page.waitForSelector(".cc-panel", { timeout: 10000 });
  check(`${width}: la plantilla de la cuenta lleva una foto por jugador`, (await page.locator(".cc-player .hs").count()) === 4);
  check(`${width}: la defensa va por escudo`, /team_logos\/nfl\/[a-z]{2,3}\.png$/.test(await page.locator(".cc-player img.hs--team").first().getAttribute("src").catch(() => "") ?? ""));
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`${width}: sin desbordamiento en Leagues`, !overflow2);
  await page.screenshot({ path: `${OUT}/fotos-${width}-leagues.png`, fullPage: true });

  await page.locator(".cc-panel button", { hasText: /draft/i }).first().click();
  await page.waitForURL("**/fantasy/draft", { timeout: 8000 });
  await page.waitForSelector(".room-list button", { timeout: 10000 });
  check(`${width}: el Draft Room pinta fotos en la lista`, (await page.locator(".room-row .hs").count()) > 10);
  // Una fila CON marca (NEWS/RISK) mantiene el VOR en la misma línea que el
  // número de orden: con tres columnas declaradas, la marca lo empujaba abajo.
  const marked = page.locator(".room-list > li", { has: page.locator(".room-row-news, .room-row-risk") }).first();
  if (await marked.count()) {
    const tops = await marked.evaluate((li) => [li.querySelector(".room-row-rank"), li.querySelector(".room-row-vor")]
      .map((e) => e?.getBoundingClientRect().top ?? -1));
    check(`${width}: en una fila con marca el VOR sigue en la misma línea`, Math.abs(tops[0] - tops[1]) < 24, `${tops.join(" / ")}`);
  }
  await page.screenshot({ path: `${OUT}/fotos-${width}-room.png` });
  check(`${width}: sin errores de página`, errores.length === 0, errores.join(" | "));
  await ctx.close();
}
await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
