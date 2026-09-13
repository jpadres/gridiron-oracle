/**
 * EL RELOJ DEL PARTIDO, EN UN NAVEGADOR DE VERDAD.
 *
 *     UN PARTIDO EN MARCHA NO SE PUEDE APOSTAR NI CAMBIAR DE HUECO.
 *
 * No se puede comprobar esperando: los trece partidos de la tarde arrancan a lo
 * largo de siete horas. Se ADELANTA el reloj de la página —`Date.now` y `new
 * Date()` en el contexto, antes de cargar nada— y se mira lo que la pantalla
 * dice en tres momentos del mismo domingo:
 *
 *   ANTES DE TODO   ningún partido cerrado salvo los que ya tienen marcador
 *   TRAS LA UNA     los de la una cerrados, los de las cuatro y veinte NO
 *   TRAS LA NOCHE   los dieciséis cerrados
 *
 * El tercer momento es el que distingue esto de un test que pasa en vacío: si
 * el reloj no se estuviera leyendo, el segundo y el tercero darían lo mismo que
 * el primero.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(AQUI, "..", "..");
const BASE = "http://127.0.0.1:4537";
const { model } = await import(path.join(WEB, "data", "model.js"));
const PREDICTIONS = model.predictions ?? [];
const MARKETS = model.markets ?? [];

let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

/** Cuántos partidos han empezado a una hora dada, según el propio payload. */
function empezados(ms) {
  return PREDICTIONS.filter((g) => {
    if (g.final === true) return true;
    const k = Date.parse(g.kickoff_at ?? "");
    return Number.isFinite(k) && ms >= k;
  }).length;
}

/** Los mercados de esos partidos: es lo que la tabla tiene que cerrar. */
function mercadosCerrados(ms) {
  const cerrados = new Set(PREDICTIONS.filter((g) => {
    if (g.final === true) return true;
    const k = Date.parse(g.kickoff_at ?? "");
    return Number.isFinite(k) && ms >= k;
  }).map((g) => g.game_id));
  return MARKETS.filter((m) => cerrados.has(m.game_id)).length;
}

const server = spawn("npx", ["next", "start", "-p", "4537"], { cwd: WEB, stdio: "ignore" });
const browser = await launch();
try {
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  // Los tres momentos, en hora del Este: antes del primer saque, entre el de la
  // una y el de las 16:25, y después del último.
  const MOMENTOS = [
    ["antes de la una", Date.parse("2026-09-13T16:00:00Z")],
    ["tras la una", Date.parse("2026-09-13T18:00:00Z")],
    ["tras el lunes por la noche", Date.parse("2026-09-15T06:00:00Z")],
  ];
  const vistos = [];
  for (const [nombre, ms] of MOMENTOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // El reloj se pisa ANTES de cargar: React lo lee al montar.
    await ctx.addInitScript(`{
      const FIJO = ${ms};
      const Real = Date;
      Date = class extends Real {
        constructor(...a) { return a.length ? new Real(...a) : new Real(FIJO); }
        static now() { return FIJO; }
      };
      Date.parse = Real.parse; Date.UTC = Real.UTC;
    }`);
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    await page.goto(`${BASE}/betting`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bk-start, .bk-head", { timeout: 15000 });
    if (await page.locator(".bk-start").count()) {
      await page.fill(".bk-start-form input[type=number]", "10000");
      await page.click(".bk-start-form button");
      await page.waitForSelector(".bk-head", { timeout: 8000 });
    }
    await page.waitForSelector(".bk-markets tbody tr", { timeout: 8000 });
    const marcas = await page.locator(".bk-markets tbody .mark--out").allInnerTexts();
    const cerrados = marcas.filter((t) => /FINAL|IN PROGRESS|KICKOFF UNKNOWN/i.test(t)).length;
    const esperados = mercadosCerrados(ms);
    console.log(`\n=== ${nombre} (${empezados(ms)}/${PREDICTIONS.length} partidos empezados) ===`);
    check(`${nombre}: la tabla cierra exactamente los mercados de los partidos empezados`,
      cerrados === esperados, `${cerrados} pintados / ${esperados} esperados`);
    check(`${nombre}: sin errores de página`, errores.length === 0, errores.join(" | "));
    vistos.push(cerrados);
    await ctx.close();
  }
  // LA PROPIEDAD QUE DISTINGUE ESTO DE UN TEST EN VACÍO: los tres momentos
  // tienen que dar respuestas DISTINTAS y crecientes. Con el reloj sin leer,
  // los tres darían el mismo número.
  check("el reloj se está leyendo: los tres momentos dan cierres CRECIENTES",
    vistos[0] < vistos[1] && vistos[1] < vistos[2],
    vistos.join(" -> "));
  check("al final del lunes están cerrados TODOS", vistos[2] === MARKETS.length,
    `${vistos[2]} de ${MARKETS.length}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO VERDE");
process.exit(fallos ? 1 : 0);
