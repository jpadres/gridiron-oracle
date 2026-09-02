/**
 * Laboratorio de la página de apuestas: los mercados, partido a partido.
 *
 * Comprueba que cada spread aparece con sus DOS lados y el signo del
 * handicap en convención de casa (favorito negativo), que el stake se escala
 * al bankroll del mes, que el moneyline justo sale de la probabilidad del
 * modelo, y que nada se desborda a 390 px.
 *
 *     SKIP_BUILD=1 node tools/lab/apuestas.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4518);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOTS ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
const { model } = await import(path.join(WEB, "data/model.js"));
const MARKETS = model.markets ?? [];
const PREDICTIONS = model.predictions ?? [];

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

/* === el payload: convención del handicap ================================ */
console.log("=== payload ===");
const spreads = MARKETS.filter((m) => String(m.market).startsWith("spread"));
check("cada partido con línea tiene dos lados", spreads.length === 2 * PREDICTIONS.filter((g) => Number.isFinite(Number(g.spread_line))).length, `${spreads.length}`);
let signosOk = true;
for (const g of PREDICTIONS) {
  const line = Number(g.spread_line);
  if (!Number.isFinite(line)) continue;
  const home = spreads.find((m) => m.game_id === g.game_id && m.selection === g.home_team);
  const away = spreads.find((m) => m.game_id === g.game_id && m.selection === g.away_team);
  // Local favorito (línea positiva) => el local se apuesta a -x y el visitante a +x.
  const homeHandicap = Number(String(home?.market).replace("spread ", ""));
  const awayHandicap = Number(String(away?.market).replace("spread ", ""));
  if (!(Math.abs(homeHandicap + line) < 1e-9 && Math.abs(awayHandicap - line) < 1e-9)) { signosOk = false; console.log("   signo mal:", g.game_id, line, home?.market, away?.market); }
}
check("el handicap lleva el signo de la casa: favorito negativo, no el del margen", signosOk);
check("los dos lados de un spread suman 1 de probabilidad decidida",
  PREDICTIONS.every((g) => { const s = spreads.filter((m) => m.game_id === g.game_id); return s.length === 0 || Math.abs(s[0].model_prob + s[1].model_prob - 1) < 1e-6; }));

/* === la página ========================================================== */
for (const width of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.goto(`${BASE}/betting`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bk-start, .bk-head", { timeout: 10000 });
  if (await page.locator(".bk-start").count()) {
    await page.fill(".bk-start-form input[type=number]", "10000");
    await page.click(".bk-start-form button");
    await page.waitForSelector(".bk-head", { timeout: 8000 });
  }
  console.log(`\n=== página a ${width} ===`);
  const rows = await page.locator(".bk-markets tbody tr").count();
  check(`${width}: la tabla de mercados tiene una fila por lado`, rows === spreads.length, `${rows} vs ${spreads.length}`);
  const texto = await page.locator(".bk-markets").innerText();
  check(`${width}: el moneyline justo se enseña por partido`, /[+-]\d{3}/.test(texto));
  const bets = model.bets ?? [];
  check(`${width}: las apuestas que pasan el umbral salen con stake a este bankroll`,
    (await page.locator(".bk-bets > li").count()) === bets.length
      && (bets.length === 0 || /\$\d/.test(await page.locator(".bk-bets").innerText())), `${bets.length}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`${width}: sin desbordamiento horizontal`, !overflow);
  check(`${width}: sin errores de página`, errores.length === 0, errores.join(" | "));
  await page.screenshot({ path: `${OUT}/apuestas-${width}.png`, fullPage: width === 1440 });
  await ctx.close();
}
await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
