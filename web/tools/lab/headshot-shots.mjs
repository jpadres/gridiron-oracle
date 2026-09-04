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
  /* UNA FOTO POR FILA PINTADA, y «pintada» es la palabra que importa.
     Antes se exigía `> 100` porque el board renderizaba los 564 jugadores. Se
     pinta por tramos de 100 desde 2026-09, así que la cifra exacta 100 hacía
     fallar la comprobación sin que nada estuviera roto — y peor, la habría
     dejado pasar un board de 101 filas con cincuenta sin foto. Lo que se quiere
     saber es que ninguna fila se queda sin retrato, así que se cuenta contra
     las filas que hay.

     Se cuenta sobre las celdas de jugador (`.hs-who`), no sobre todas las `tr` de
     la página: /fantasy lleva varias tablas y sólo la del board lleva retrato. */
  const filas = await page.locator("td.hs-who").count();
  const imgs = await page.locator("td.hs-who img.hs, td.hs-who span.hs").count();
  check(`${width}: el board pinta una foto o iniciales por fila`,
        filas > 0 && imgs === filas, `${imgs} retratos / ${filas} filas de jugador`);
  const src = await page.locator("img.hs").first().getAttribute("src");
  check(`${width}: la URL es la miniatura por sleeper_id`, /sleepercdn\.com\/content\/nfl\/players\/thumb\/\d+\.jpg$/.test(src ?? ""), src ?? "");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`${width}: sin desbordamiento horizontal en el board`, !overflow);
  // LOS OUT AL PIE. Un exento con VOR de puesto 38 no puede estar en el puesto
  // 38 de la vista: va debajo de la banda «Unavailable», con su número.
  const bandIndex = await page.evaluate(() => [...document.querySelectorAll(".rank-table tbody tr")].findIndex((tr) => tr.classList.contains("tier-band--out")));
  const firstOutIndex = await page.evaluate(() => [...document.querySelectorAll(".rank-table tbody tr")].findIndex((tr) => tr.classList.contains("is-out")));
  const lastPlayableIndex = await page.evaluate(() => { const trs = [...document.querySelectorAll(".rank-table tbody tr")]; let i = -1; trs.forEach((tr, k) => { if (!tr.classList.contains("is-out") && !tr.classList.contains("tier-band") && !tr.classList.contains("tier-band--out")) i = k; }); return i; });
  check(`${width}: los OUT del board van bajo la banda Unavailable, después del último jugable`,
    bandIndex > 0 && firstOutIndex === bandIndex + 1 && lastPlayableIndex < bandIndex, `banda ${bandIndex}, primer OUT ${firstOutIndex}, último jugable ${lastPlayableIndex}`);
  check(`${width}: Jacobs conserva su número dentro del bloque`,
    /38/.test(await page.locator(".rank-table tr.is-out").first().locator("td.rk").innerText().catch(() => "")));
  // DOS AFIRMACIONES DE DISPONIBILIDAD EN LA MISMA FILA. La del dossier es de
  // agosto y la marca de estado es de hoy: la vieja tiene que llevar su fecha
  // a la vista y no puede competir con la de hoy. Con el código anterior salía
  // «QUESTIONABLE» a secas junto a «EXEMPT LIST» y la fecha vivía en el title.
  const dossierTags = await page.evaluate(() => [...document.querySelectorAll(".rank-table .avail")].map((el) => ({
    text: el.innerText.trim(),
    superseded: el.classList.contains("avail--superseded"),
    conMarca: Boolean(el.closest("td")?.querySelector(".mark--out, .mark--risk")),
  })));
  check(`${width}: toda etiqueta del dossier lleva su fecha (o UNDATED) delante`,
    dossierTags.length > 0 && dossierTags.every((t) => /^(\d{1,2}\/\d{1,2}|UNDATED)\s/i.test(t.text)),
    `${dossierTags.length} etiquetas, p.ej. ${dossierTags[0]?.text ?? "-"}`);
  const conAmbas = dossierTags.filter((t) => t.conMarca);
  check(`${width}: donde conviven con una marca de estado de hoy, van subordinadas`,
    conAmbas.length > 0 && conAmbas.every((t) => t.superseded), `${conAmbas.length} filas con las dos`);
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
  // En la sala, los OUT no aparecen en la ventana de 60 en ALL; con RB
  // filtrado, Jacobs sale al final tras el separador, y la lista corta no lo
  // propone.
  // En ALL los OUT también están, pero detrás de la ventana y del separador:
  // ninguno delante de un jugable.
  const orderAll = await page.evaluate(() => [...document.querySelectorAll(".room-list > li")].map((li) => li.classList.contains("is-out") ? "o" : li.classList.contains("room-out-divider") ? "|" : "p").join(""));
  check(`${width}: en ALL los OUT van al final, tras el separador`, /^p+\|o+$/.test(orderAll), orderAll.slice(-12));
  await page.locator(".pos-filter .pos-option", { hasText: /^RB$/ }).click();
  await page.waitForTimeout(300);
  const divider = await page.locator(".room-out-divider").count();
  const outRows = await page.locator(".room-list > li.is-out").count();
  const order = await page.evaluate(() => [...document.querySelectorAll(".room-list > li")].map((li) => li.classList.contains("is-out") ? "o" : li.classList.contains("room-out-divider") ? "|" : "p").join(""));
  check(`${width}: con RB filtrado, los OUT van tras el separador y ninguno antes`, divider === 1 && outRows >= 1 && /^p+\|o+$/.test(order), order.slice(-12));
  // `innerText` respeta el `text-transform: uppercase` de la banda.
  check(`${width}: la banda cuenta los no disponibles`, /unavailable/i.test(await page.locator(".room-pool").innerText()));
  await page.locator(".pos-filter .pos-option", { hasText: /^ALL$/ }).click();
  await page.waitForTimeout(200);
  await page.waitForSelector(".room-timer", { timeout: 8000 }).catch(() => {});
  check(`${width}: en LIVE hay reloj del pick, derivado de Sleeper`, /\u2248\d+:\d\d/.test(await page.locator(".room-timer").innerText().catch(() => "")));
  check(`${width}: la parrilla lleva foto en cada pick hecho`, (await page.locator(".room-cell.is-taken .hs").count()) === 4);
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
