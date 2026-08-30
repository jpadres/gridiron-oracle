/**
 * Auditoría visual del Draft Room. Mide antes de tocar nada.
 *
 * No comprueba «no hay overflow»: mide la INTENCIÓN. Cuánto scroll hay hasta el
 * primer jugador accionable, cuántos caben en la primera pantalla, cuánto pesa
 * cada sección y cuántas cajas hay dentro de cuántas cajas.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4340);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
const LABEL = process.env.LABEL ?? "antes";

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

const LEAGUE = {
  name: "Audit", platform: "manual", leagueId: "AUD", draftId: "DAUD",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 8,
};

const medir = () => {
  const y = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().top + window.scrollY);
  };
  const h = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  };
  const vh = window.innerHeight;
  const filas = [...document.querySelectorAll(".room-list li")];
  const enPrimeraPantalla = filas.filter((li) => {
    const r = li.getBoundingClientRect();
    return r.top + window.scrollY < vh && r.bottom + window.scrollY > 0;
  }).length;

  // Cajas: cualquier elemento con borde visible o fondo propio.
  const todos = [...document.querySelectorAll(".room *")];
  const conCaja = todos.filter((el) => {
    const s = getComputedStyle(el);
    const borde = ["Top", "Right", "Bottom", "Left"].some(
      (d) => parseFloat(s[`border${d}Width`]) > 0 && s[`border${d}Style`] !== "none"
    );
    const fondo = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
    return borde || fondo;
  });
  const anidadas = conCaja.filter((el) => conCaja.some((o) => o !== el && o.contains(el))).length;

  const estilos = new Set(todos.map((el) => {
    const s = getComputedStyle(el);
    return `${s.fontFamily}|${s.fontSize}|${s.fontWeight}|${s.letterSpacing}|${s.textTransform}`;
  }));

  const botones = [...document.querySelectorAll(".room button, .room input, .room a")];
  const pequenos = botones.filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && (r.width < 44 || r.height < 44);
  }).map((b) => {
    const r = b.getBoundingClientRect();
    return `${(b.className || b.tagName).toString().slice(0, 28)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  });

  return {
    vh,
    primerJugadorY: y(".room-list li"),
    jugadoresPrimeraPantalla: enPrimeraPantalla,
    filasTotales: filas.length,
    altoEstado: h(".room-state"),
    altoDecision: h(".room-decision"),
    altoHerramientas: h(".room-tools"),
    altoRoster: h(".room-side section:first-child"),
    altoFeed: h(".room-side section:last-child"),
    altoTotal: Math.round(document.documentElement.scrollHeight),
    cajas: conCaja.length,
    cajasAnidadas: anidadas,
    botonesVisibles: botones.filter((b) => b.getBoundingClientRect().width > 0).length,
    estilosDeTexto: estilos.size,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    objetivosPequenos: pequenos,
  };
};

const resultados = {};
for (const width of [390, 768, 1440]) {
  const ctx = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 2, colorScheme: "dark",
  });
  await ctx.addInitScript((l) => {
    localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l));
    // Congelar animaciones: sobrevive a goto, `addStyleTag` no.
    const s = document.createElement("style");
    s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
  }, LEAGUE);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "networkidle" });
  await page.waitForSelector(".room-list button", { timeout: 20000 });

  // Estado vacío
  resultados[`${width}-vacio`] = await page.evaluate(medir);
  await page.screenshot({ path: `${OUT}/${LABEL}-${width}-vacio.png` });

  // Con draft en marcha: 14 picks, que es cuando el feed y el roster pesan.
  for (let i = 0; i < 14; i += 1) await page.locator(".room-list button").first().click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "14");
  // Y el estado EN EL RELOJ, que es el que tiene que ser inconfundible.
  if (width === 390) {
    for (let i = 0; i < 2; i += 1) await page.locator(".room-list button").first().click();
    await page.waitForSelector(".room-state--clock", { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/${LABEL}-390-reloj.png` });
    for (let i = 0; i < 2; i += 1) await page.locator(".room-flash button").click().catch(() => {});
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  resultados[`${width}-conpicks`] = await page.evaluate(medir);
  await page.screenshot({ path: `${OUT}/${LABEL}-${width}-conpicks.png` });
  await page.screenshot({ path: `${OUT}/${LABEL}-${width}-completo.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
stop();
console.log(JSON.stringify(resultados, null, 1));
