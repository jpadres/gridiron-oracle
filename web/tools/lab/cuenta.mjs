/**
 * Laboratorio: la cuenta de Sleeper enlazada y un mock draft seguido en vivo.
 *
 * Lo que se prueba, con el doble compartido de `sleeper-double.mjs`:
 *
 *   1. Enlazar por nombre de usuario lista TODAS las ligas de la temporada con
 *      su configuración REAL (tamaño, puntuación, puesto), y mi plantilla
 *      resuelta POR ID contra el mapa horneado — con «DEF taken» donde ya la
 *      tengo y «not yet» donde no.
 *   2. La frescura dice «synced … ago» y NUNCA «LIVE»: aquí no se sondea.
 *   3. Un nombre que no existe da un error y no guarda nada.
 *   4. Los mocks del usuario aparecen y «Follow in the assistant» abre el Draft
 *      Room sobre el mock: liga sintética, parrilla del tamaño del mock, mi
 *      columna en el puesto de `draft_order`, y los picks entran por el
 *      adaptador igual que en un draft de liga.
 *   5. Al recargar, los paneles siguen ahí sin volver a pedir nada.
 *
 *     SKIP_BUILD=1 node tools/lab/cuenta.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, crearMock, emitir, montar, slotOf }
  from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4512);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOTS ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b) { try { await fetch(b, { signal: AbortSignal.timeout(1500) }); } catch { return; } throw new Error(`zombi en ${b}`); }
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const DEFENSES = model.fantasy.specialists?.defenses ?? [];
const KICKERS = model.fantasy.specialists?.kickers ?? [];
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
const SEASON = String(model.fantasy.season);

if (!process.env.SKIP_BUILD) {
  console.log("construyendo…");
  await new Promise((r, j) => { const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" }); b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`)))); });
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 400)); }

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

/* === el doble: dos ligas y un mock ======================================= */
const ROSTER12 = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN", "BN", "BN", "BN", "BN"];
const ROSTER10 = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN", "BN", "BN"];
const L1 = crearLiga({ id: "LG12", draftId: "DR12", teams: 12, roster: ROSTER12, mySlot: 7,
  rounds: 15, name: "Sunday Twelve", scoring: { rec: 1 } });
L1.draft.status = "complete";
const L2 = crearLiga({ id: "LG10", draftId: "DR10", teams: 10, roster: ROSTER10, mySlot: 2,
  rounds: 13, name: "Half Ten", scoring: { rec: 0.5 } });
L2.draft.status = "pre_draft";
const MOCK = crearMock({ draftId: "MK1", teams: 12, mySlot: 4, rounds: 15, scoringType: "ppr",
  name: "Tuesday mock" });

// Siembra: en la liga 1 ya tengo cinco jugadores, entre ellos una defensa y un
// pateador; en la 2 nada todavía. Todo por el MISMO mapa horneado del producto.
const mine1 = [BOARD[0], BOARD[3], BOARD[10], DEFENSES[0], KICKERS[0]];
let no = 1;
for (const row of mine1) {
  // El pick cae en MI puesto: `emitir` rellena `rosters[7].players`.
  while (slotOf(no, 12) !== 7) no += 1;
  emitir(L1, no, row, SLEEPER_OF);
  no += 1;
}
const myRoster1 = L1.rosters.find((r) => r.roster_id === 7);
// Titulares: tres jugadores y la defensa, para que la alineación tenga algo SIN proyección.
myRoster1.starters = [...myRoster1.players.slice(0, 3), myRoster1.players[3]];
myRoster1.settings = { wins: 2, losses: 1, ties: 0 };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await montar(ctx, [L1, L2, MOCK]);
const page = await ctx.newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

/* === 1. enlazar ========================================================== */
console.log("=== enlazar la cuenta ===");
await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#cc-user");
await page.fill("#cc-user", "nadie-con-este-nombre");
await page.click(".cc-link button[type=submit]");
await page.waitForSelector(".sleeper-error", { timeout: 8000 });
check("un nombre que no existe da un error visible", (await page.locator(".sleeper-error").count()) === 1);
check("y no enlaza nada", (await page.locator(".cc-account-line").count()) === 0);

await page.fill("#cc-user", USERNAME);
await page.click(".cc-link button[type=submit]");
await page.waitForSelector(".cc-panel", { timeout: 10000 });
const panels = page.locator(".cc-panel");
check("las dos ligas de la temporada aparecen como paneles", (await panels.count()) === 2,
  `${await panels.count()}`);
const head = async (i) => (await panels.nth(i).locator(".cc-panel-head").innerText()).replace(/\s+/g, " ");
const h1 = await head(0); const h2 = await head(1);
const texto = h1 + " | " + h2;
check("la configuración es la REAL de cada liga: 12-team PPR y 10-team Half PPR",
  /12-team/.test(texto) && /PPR/.test(texto) && /10-team/.test(texto) && /Half PPR/.test(texto), texto);
check("mi puesto sale de draft_order: slot 7 y slot 2", /slot 7/.test(texto) && /slot 2/.test(texto), texto);
check("el récord se enseña cuando Sleeper lo publica", /2-1/.test(texto), texto);
const facts = async (name) => (await page.locator(".cc-panel", { hasText: name }).locator(".cc-facts").innerText()).replace(/\s+/g, " ");
const f1 = await facts("Sunday Twelve"); const f2 = await facts("Half Ten");
check("en la liga con plantilla: DEF taken y K taken, y el conteo por posición",
  /DEF taken/.test(f1) && /K taken/.test(f1) && /5 rostered/.test(f1), f1);
check("en la liga vacía: DEF not yet, K not yet, 0 rostered",
  /DEF not yet/.test(f2) && /K not yet/.test(f2) && /0 rostered/.test(f2), f2);
const roster1 = await page.locator(".cc-panel", { hasText: "Sunday Twelve" }).locator(".cc-player").count();
check("la plantilla se resuelve por id: cinco filas, con la defensa y el pateador",
  roster1 === 5, `${roster1}`);
const nombres = await page.locator(".cc-panel", { hasText: "Sunday Twelve" }).locator(".cc-player .nm").allInnerTexts();
check("y el primero del board está en ella por su nombre completo",
  nombres.includes(BOARD[0].player_full_name ?? BOARD[0].player_name), nombres.join(", "));
check("el VOR de la plantilla es el de ESTA liga, no el publicado",
  /12-team · PPR/.test(await page.locator(".cc-panel", { hasText: "Sunday Twelve" }).locator(".cc-roster .caption").innerText()));
const sync = await page.locator(".cc-sync").innerText();
check("la frescura dice «synced … ago» y nunca LIVE", /synced/.test(sync) && !/LIVE/i.test(sync), sync);
check("la página entera no escribe LIVE", !/\bLIVE\b/.test(await page.locator(".cc").innerText()));
await page.screenshot({ path: `${OUT}/cuenta-1440-linked.png`, fullPage: true });

/* === 1b. el enfrentamiento y la profundidad ============================= */
console.log("\n=== matchup y profundidad ===");
const panel1 = page.locator(".cc-panel", { hasText: "Sunday Twelve" });
check("el panel enseña el enfrentamiento de la semana con el nombre del rival",
  (await panel1.locator(".cc-matchup").count()) === 1
  && /vs Team 8/.test(await panel1.locator(".cc-matchup h4").innerText()),
  (await panel1.locator(".cc-matchup h4").innerText().catch(() => "sin matchup")));
check("mi alineación suma proyecciones y cuenta lo que no tiene (la defensa)",
  /no proj/.test(await panel1.locator(".cc-lineup-total").first().innerText()));
await panel1.locator(".cc-depth-wrap summary").click();
const depthRows = await panel1.locator(".cc-depth tbody tr").count();
check("la profundidad lista los 12 equipos y marca el mío", depthRows === 12
  && (await panel1.locator(".cc-depth tr.is-mine").count()) === 1, `${depthRows}`);

/* === 1c. el semanal marca MINE y FA en la liga elegida =================== */
await page.goto(`${BASE}/fantasy/semanal`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#wk-league", { timeout: 8000 });
await page.selectOption("#wk-league", "LG12");
await page.waitForSelector(".own--mine", { timeout: 8000 }).catch(() => {});
check("el semanal ofrece cambiar de liga y marca MINE en la mía",
  (await page.locator("#wk-league option").count()) === 2 && (await page.locator(".wk-table .own--mine").count()) >= 2,
  `${await page.locator(".wk-table .own--mine").count()} MINE`);
check("y marca FA a los que nadie tiene en esa liga", (await page.locator(".wk-table .own--fa").count()) > 50);
await page.selectOption("#wk-league", "LG10");
await page.waitForTimeout(300);
check("en la liga vacía nadie es MINE y todos son FA",
  (await page.locator(".wk-table .own--mine").count()) === 0 && (await page.locator(".wk-table .own--fa").count()) > 50);
await page.screenshot({ path: `${OUT}/cuenta-1440-semanal.png` });
await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".cc-panel", { timeout: 8000 });

/* === 2. los mocks ======================================================== */
console.log("\n=== el mock ===");
const mocks = page.locator(".cc-mocks .cc-league");
check("el mock del usuario aparece con su tamaño, puntuación y puesto", (await mocks.count()) === 1
  && /12-team/i.test(await mocks.first().innerText()) && /PPR/i.test(await mocks.first().innerText())
  && /slot 4/i.test(await mocks.first().innerText()), (await mocks.first().innerText()).replace(/\s+/g, " "));
await mocks.first().locator("button").click();
await page.waitForURL("**/fantasy/draft", { timeout: 8000 });
await page.clock.install();
await page.waitForSelector(".room-list button", { timeout: 10000 });
check("el Draft Room abre sobre el mock: parrilla de 15 rondas de 12",
  (await page.locator(".room-grid-row").count()) === 15
  && (await page.locator(".room-grid-row").first().locator(".room-cell").count()) === 12);
check("mi columna está marcada en el puesto 4 (derivado de draft_order)",
  (await page.locator(".room-cell.is-mine").count()) === 15
  && (await page.locator(".room-grid-row").first().locator(".room-cell").nth(3).getAttribute("class"))?.includes("is-mine"));
const cabecera = (await page.locator(".room-head").innerText()).replace(/\s+/g, " ");
check("la cabecera lee la liga EFECTIVA del mock: 12-team · PPR · slot 4 · from Sleeper",
  /12-team/i.test(cabecera) && /PPR/i.test(cabecera) && /slot 4/i.test(cabecera) && /from Sleeper/i.test(cabecera), cabecera);
check("el alcance enlaza al draft del mock en Sleeper",
  (await page.locator(".room-scope-link").getAttribute("href")) === "https://sleeper.com/draft/nfl/MK1");

// Tres picks por el proveedor, el tercero mío (puesto 4 en la ronda 1).
const libres = () => BOARD.filter((r) => !MOCK.picks.some((p) => p.player_id === SLEEPER_OF[r.player_id]));
for (let k = 1; k <= 4; k += 1) {
  emitir(MOCK, k, libres()[0], SLEEPER_OF);
  await page.clock.runFor(16_000);
  await page.waitForFunction((x) => document.querySelector(".room-count strong")?.textContent === String(x), k, { timeout: 8000 })
    .catch(() => check(`el pick ${k} entró por el adaptador`, false));
}
check("los cuatro picks del mock entraron por el adaptador",
  (await page.locator(".room-count strong").innerText()) === "4");
check("el cuarto es MÍO por picked_by, sin rosters (un mock no los tiene)",
  (await page.locator(".room-cell.is-mine.is-taken, .room-cell.is-mine.has-pick").count()) >= 1
  || /1 yours|yours/.test((await page.locator(".room-count").innerText())));
check("y la conexión dice LIVE sólo ahora, con sondeo reciente y `drafting`",
  /live/i.test(await page.locator(".room-link b").innerText()));
await page.screenshot({ path: `${OUT}/cuenta-1440-mock.png` });

/* === 3. recargar: sin red ================================================ */
console.log("\n=== recarga ===");
let peticiones = 0;
page.on("request", (r) => { if (/api\.sleeper\.app\/v1\/user/.test(r.url())) peticiones += 1; });
await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".cc-panel", { timeout: 8000 });
check("al recargar, los paneles salen del almacenamiento y no se vuelve a leer la cuenta",
  (await page.locator(".cc-panel").count()) === 2 && peticiones === 0, `${peticiones} peticiones a /user`);
check("el mock seguido aparece ahora también en el catálogo (Other leagues) o en la cola",
  (await page.locator(".cc").innerText()).includes("Tuesday mock"));
check("sin errores de página", errores.length === 0, errores.join(" | "));

await ctx.close();
await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
