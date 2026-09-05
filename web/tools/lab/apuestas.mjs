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
  /* NO BET, DICHO. Un tamaño de cero se pintaba «0», que se lee como celda
     vacía. Ahora cada lado sin apuesta nombra el freno que lo paró, y «not
     sized» —el respaldo cuando el espejo no sabe— no puede aparecer nunca
     sobre el payload real. Se cuenta contra los mercados del payload, no
     contra lo pintado. */
  const sinApuesta = (model.markets ?? []).filter((m) => !(m.stake_fraction > 0)).length;
  const celdas = await page.locator(".bk-markets tbody .bk-nomarket").allInnerTexts();
  const noBet = celdas.filter((t) => /^no bet · /i.test(t));
  check(`${width}: cada lado sin apuesta dice NO BET y su motivo`,
    noBet.length === sinApuesta && noBet.every((t) => /minimum|price/i.test(t)),
    `${noBet.length} pintados / ${sinApuesta} en el payload · ${[...new Set(noBet)].join(" | ")}`);
  check(`${width}: ninguno queda «not sized»`, !celdas.some((t) => /not sized/i.test(t)));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`${width}: sin desbordamiento horizontal`, !overflow);
  check(`${width}: sin errores de página`, errores.length === 0, errores.join(" | "));
  await page.screenshot({ path: `${OUT}/apuestas-${width}.png`, fullPage: width === 1440 });
  await ctx.close();
}

/* === EL PLAN DE LA SEMANA: el tamaño sigue a la banca ====================
   La propiedad que pidió esta pantalla es direccional, y una prueba unitaria
   la demuestra en el módulo pero no en la PANTALLA — que es donde se lee y
   donde se decide. Aquí se siembran tres libros con la misma banca inicial y
   se comparan los tres «suggested per bet» que salen pintados.

       ABAJO  <  IGUAL  <  ARRIBA,  y ABAJO nunca por encima de IGUAL.

   Si alguien cambia el plan para «recuperar lo perdido», el primer `<` se da
   la vuelta y esto se pone rojo. */
console.log("\n=== el plan de la semana ===");
const LIBRO = (bets) => ({
  month: "2026-09", starting: 10000, unitIsPercent: true, unitValue: 1, limits: {}, bets,
});
/* El libro histórico va en OTRA jornada que la que se planifica, y eso no es un
   truco del fixture: el plan responde «cuánto me queda por poner ESTA semana»,
   así que lo apostado en la semana que se planifica descuenta del tope y taparía
   la comparación con un cero. Lo que se compara aquí es el TAMAÑO, no el resto. */
const APUESTA = (id, status, stake, odds) => ({
  id, status, market: "SPREAD", label: `${id} bet`, selection: "X", line: -3, odds, stake,
  gameId: id, team: "BUF", season: 2026, week: 18, snapshot: { model: 4, market: 3 },
  createdAt: 1, placedAt: 2, settledAt: status === "PLACED" ? null : 3,
});
const ESCENARIOS = {
  // Sin liquidar nada: la banca es la inicial.
  igual: LIBRO([]),
  // −1.500: banca 8.500, un 15% abajo. A propósito SIN cruzar el umbral del
  // freno (−20%): así lo que encoge la apuesta es la aritmética del porcentaje
  // sobre la banca actual, no la regla del freno — que es lo que se afirma.
  abajo: LIBRO([APUESTA("d1", "LOST", 1500, -110)]),
  // +2.000 a +200: banca 12.000.
  arriba: LIBRO([APUESTA("u1", "WON", 1000, 200)]),
};
const perBet = async (nombre) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript((libro) => {
    try {
      localStorage.setItem("gridiron-bank-months-v1", JSON.stringify(["2026-09"]));
      localStorage.setItem("gridiron-bank-v1:2026-09", JSON.stringify(libro));
    } catch { /* bloqueado */ }
  }, ESCENARIOS[nombre]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/betting`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bk-plan-grid", { timeout: 10000 });
  const txt = await page.locator(".bk-plan-nums > div", { hasText: "Suggested per bet" }).innerText();
  const unidad = await page.locator(".bk-plan-nums > div", { hasText: "1 unit now" }).innerText();
  const estado = await page.locator(".bk-plan-tag").innerText();
  await ctx.close();
  const dolar = (t) => Number((t.match(/\$([\d,]+(?:\.\d+)?)/) ?? [])[1]?.replace(/,/g, "") ?? NaN);
  return { perBet: dolar(txt), unit: dolar(unidad), estado: estado.trim() };
};
const abajo = await perBet("abajo");
const igual = await perBet("igual");
const arriba = await perBet("arriba");
check("la pantalla dice UP / DOWN / EVEN según la banca, con la palabra escrita",
  abajo.estado === "DOWN" && igual.estado === "EVEN" && arriba.estado === "UP",
  `${abajo.estado}/${igual.estado}/${arriba.estado}`);
/* La primera versión de esto comprobaba `abajo < igual`, y se probó inyectando
   el fallo que existe para cazar: un multiplicador de recuperación de 1,15 daba
   97,75 en vez de 85 y la comprobación SEGUÍA VERDE, porque perseguir un 15% no
   llega a cancelar una caída del 15%. Un guardián que sólo caza la persecución
   COMPLETA no es un guardián. La propiedad exacta es que el tamaño es la MISMA
   fracción de la banca en los tres casos: cualquier factor que dependa de ir
   arriba o abajo la rompe, por pequeño que sea. */
const FRACCION = 0.01;                      // la unidad del mes: 1%
check("PERDER ENCOGE la apuesta sugerida: nada aquí persigue pérdidas",
  abajo.perBet === Math.round(8500 * FRACCION * 100) / 100,
  `abajo ${abajo.perBet}, esperado ${8500 * FRACCION}`);
check("y ganar la agranda por la MISMA aritmética, ni más ni menos",
  arriba.perBet === Math.round(12000 * FRACCION * 100) / 100 && igual.perBet === 100,
  `arriba ${arriba.perBet} · igual ${igual.perBet}`);
check("la unidad se mueve con la banca y no con la inicial",
  abajo.unit === 85 && igual.unit === 100 && arriba.unit === 120,
  `${abajo.unit}/${igual.unit}/${arriba.unit}`);

await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
