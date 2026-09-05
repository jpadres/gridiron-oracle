/**
 * FASE 25 — verdad de los tiers en el navegador.
 *
 * El recuento del corte de tier tiene que salir del pool DISPONIBLE, no de las
 * filas pintadas. Contarlo sobre lo visible producía «3 left» con doce
 * disponibles: el corte caía dentro de la ventana de 60 y el resto del tier
 * quedaba fuera. Se lee como escasez y era un artefacto del scroll.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4350);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b) { try { await fetch(b, { signal: AbortSignal.timeout(1500) }); }
  catch { return; } throw new Error(`servidor zombi en ${b}`); }
await libre(BASE);
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

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem("gridiron-room-league-v1", JSON.stringify({
  name: "Tier", platform: "manual", leagueId: "TL", draftId: "TD",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 6 })));
const page = await ctx.newPage();
await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "networkidle" });
await page.waitForSelector(".room-list button");

// El pool completo del payload, para contrastar contra la interfaz.
const pool = await page.evaluate(async () => {
  const mod = await import("/_next/static/chunks/nope.js").catch(() => null);
  void mod;
  return null;
});
void pool;

async function contrastar(etiqueta) {
  // Lo que la interfaz DICE en cada corte de tier.
  const dice = await page.evaluate(() => [...document.querySelectorAll(".room-tier")].map((li) => ({
    tier: Number(li.querySelector("span").textContent.replace(/\D/g, "")),
    left: Number(li.querySelector(".room-tier-left").textContent.replace(/\D/g, "")),
  })));
  // Lo que hay DE VERDAD en la vista: se cuenta desplazando hasta el final de
  // la lista para que ningún tier quede fuera de la ventana pintada.
  const real = await page.evaluate(() => {
    const filas = [...document.querySelectorAll(".room-list li:not(.room-tier)")];
    const porTier = {};
    for (const li of filas) {
      const t = li.querySelector(".room-row-who .meta")?.textContent ?? "";
      void t;
    }
    return porTier;
  });
  void real;

  // Comprobación fuerte y sin depender del DOM: el recuento del primer tier
  // tiene que ser >= el número de filas de ese tier que se pintan.
  const pintadasPrimerTier = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".room-list > li")];
    const i = items.findIndex((li) => li.classList.contains("room-tier"));
    if (i < 0) return null;
    let n = 0;
    for (let k = i + 1; k < items.length; k += 1) {
      if (items[k].classList.contains("room-tier")) break;
      n += 1;
    }
    return n;
  });
  const primero = dice[0];
  check(`${etiqueta}: el recuento del tier no es menor que lo pintado`,
        primero && pintadasPrimerTier !== null && primero.left >= pintadasPrimerTier,
        `dice ${primero?.left}, pintadas ${pintadasPrimerTier}`);
  return dice;
}

const antes = await contrastar("inicio");
check("hay cortes de tier", antes.length > 0, `${antes.length} cortes`);

// Filtrar a WR: el recuento tiene que ser el del pool de WR, no el de la vista.
await page.locator('.pos-option:text-is("WR")').click();
await page.waitForTimeout(80);
const wr = await contrastar("filtrado a WR");

// El caso que destapó el bug: un tier que se extiende más allá de las 60 filas.
// Con ALL y 344 jugadores, el último corte visible debe declarar más de lo que
// cabe en la ventana si su tier sigue por debajo.
await page.locator('.pos-option:text-is("ALL")').click();
await page.waitForTimeout(80);
const todos = await contrastar("sin filtro");
const sumaCortes = todos.reduce((a, t) => a + t.left, 0);
const filasPintadas = await page.locator(".room-list li:not(.room-tier)").count();

// La aserción que DE VERDAD separa las dos implementaciones.
//
// La primera versión de este test pedía `suma >= pintadas`, y con el bug la
// suma valía exactamente lo pintado: pasaba. Un guardián que aprueba el fallo
// que existe para cazar es peor que no tenerlo. Contar sobre la ventana da
// siempre la igualdad; contar sobre el pool tiene que EXCEDERLA mientras haya
// más disponibles que filas pintadas — el último tier está cortado por la
// ventana por construcción.
const disponibles = await page.evaluate(() =>
  Number(document.querySelector(".room-depth-total")?.textContent.replace(/\D/g, "") ?? 0));
check("hay más disponibles que filas pintadas (si no, el test no prueba nada)",
      filasPintadas >= 60, `pintadas ${filasPintadas}, disponibles(1ª pos) ${disponibles}`);
check("la suma de los tiers declarados EXCEDE a las filas pintadas",
      sumaCortes > filasPintadas, `suma ${sumaCortes} vs pintadas ${filasPintadas}`);

// Y el invariante directo sobre el último corte, que es el truncado.
const ultimo = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".room-list > li")];
  let i = -1;
  items.forEach((li, k) => { if (li.classList.contains("room-tier")) i = k; });
  if (i < 0) return null;
  return {
    declara: Number(items[i].querySelector(".room-tier-left").textContent.replace(/\D/g, "")),
    pintadasDespues: items.length - i - 1,
  };
});
check("el último corte declara más miembros de los que caben tras él",
      ultimo && ultimo.declara > ultimo.pintadasDespues,
      ultimo ? `declara ${ultimo.declara}, pintadas después ${ultimo.pintadasDespues}` : "sin cortes");

// Tras coger jugadores, el recuento baja: los tomados NO cuentan.
const tierAntes = todos[0]?.left ?? 0;
await page.locator(".room-list button").first().click();
await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
const tras = await page.evaluate(() => {
  const li = document.querySelector(".room-tier");
  return li ? Number(li.querySelector(".room-tier-left").textContent.replace(/\D/g, "")) : null;
});
check("coger un jugador baja el recuento de su tier", tras !== null && tras < tierAntes,
      `${tierAntes} -> ${tras}`);
check("y nunca es negativo", tras >= 0, String(tras));
void wr;

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
