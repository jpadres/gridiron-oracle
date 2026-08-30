/**
 * QA del board: 3 anchos x 5 estados, más la conservación de estado.
 *
 * Lo que de verdad se comprueba aquí no es que se vea bien: es que cambiar de
 * posición en mitad de un draft NO borre el draft. Eso no se ve en una captura.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// `next start` tiene que arrancar en `web/`, no en el directorio desde el que se
// lance esta herramienta. Lanzada desde la raíz del repo, `npx next start`
// buscaba el build en la raíz, no lo encontraba y la conexión salía rechazada:
// el mismo fallo de cwd que ya se corrigió en `audit-spanish.mjs`.
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PORT = 4343, BASE = `http://127.0.0.1:${PORT}`;

// Un `next-server` zombi de una ejecución anterior sigue escuchando en el
// puerto y sirve un BUILD VIEJO. La herramienta lo encuentra respondiendo, lo da
// por bueno, y falla contra una página que ya no existe — que es exactamente el
// falso fallo que costó una ronda de diagnóstico aquí. Mejor reventar y decirlo.
async function assertPortFree(base) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(1500) });
  } catch {
    return; // nadie escucha: lo normal
  }
  throw new Error(
    `Ya hay algo sirviendo en ${base}. Es un servidor zombi de otra ejecución y ` +
    `sirve un build viejo. Ciérralo antes de medir:\n` +
    `  ps -eo pid,args --no-headers | grep "[n]ext-server" | awk '{print $1}' | xargs -r kill -9`
  );
}

await assertPortFree(BASE);

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

const ESTADOS = [
  ["Draft / ALL", ""],
  ["Draft / WR", "?pos=WR"],
  ["Consensus / RB", "?view=consensus&pos=RB"],
  ["Risk / TE", "?view=risk&pos=TE"],
  ["Validation", "?view=validation"],
];

let fallos = 0;
const fallo = (msg) => { console.log(`   FALLO  ${msg}`); fallos += 1; };

console.log("\n=== 3 anchos x 5 estados ===\n");
console.log(`${"estado".padEnd(17)}${"ancho".padStart(6)}${"overflow".padStart(10)}${"tablas".padStart(8)}${"filas".padStart(7)}${"1ª fila".padStart(9)}  vista/pos activos`);
for (const [nombre, query] of ESTADOS) {
  for (const w of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    await page.goto(`${BASE}/fantasy${query}`, { waitUntil: "networkidle" });
    // `ol.picks` sólo existe después de hidratar: DraftMode lo pinta en cliente.
    // Se espera "attached" y no "visible" porque en las vistas que no son Draft
    // vive dentro de un contenedor con `hidden`, y ahí nunca sería visible.
    await page.waitForSelector("ol.picks", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const y = (e) => e ? Math.round(e.getBoundingClientRect().top + scrollY) : null;
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        tablas: document.querySelectorAll("table").length,
        filas: document.querySelectorAll("tbody tr").length,
        primeraFila: y(document.querySelector("tbody tr")),
        vista: document.querySelector('.view-tab[aria-current="page"]')?.textContent ?? "—",
        pos: document.querySelector('.pos-option[aria-pressed="true"]')?.textContent ?? "—",
        posiciones: [...new Set([...document.querySelectorAll("tbody .ptag")].map(n => n.textContent))],
      };
    });
    console.log(`${nombre.padEnd(17)}${String(w).padStart(6)}${String(r.overflow).padStart(10)}${String(r.tablas).padStart(8)}${String(r.filas).padStart(7)}${String(r.primeraFila).padStart(9)}  ${r.vista}/${r.pos}`);
    if (r.overflow > 0) fallo(`${nombre} @${w}: desborda ${r.overflow}px`);
    if (r.tablas > 1) fallo(`${nombre} @${w}: ${r.tablas} tablas montadas`);
    // El filtro tiene que filtrar de verdad.
    if (query.includes("pos=WR") && r.posiciones.some(p => p !== "WR")) fallo(`${nombre}: la tabla trae ${r.posiciones}`);
    if (query.includes("pos=TE") && r.posiciones.some(p => p !== "TE")) fallo(`${nombre}: la tabla trae ${r.posiciones}`);
    await page.close();
  }
}

console.log("\n=== conservación de estado con un draft activo ===\n");
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${BASE}/fantasy`, { waitUntil: "networkidle" });
await page.waitForSelector("ol.picks li.pick button", { state: "attached", timeout: 20000 });
  await page.waitForTimeout(300);

// Se toma un jugador: el primer botón «Mine» de la lista.
const antes = await page.locator("ol.picks li.pick").first().innerText();
await page.locator("ol.picks li.pick button", { hasText: "Mine" }).first().click();
await page.waitForTimeout(200);
const leerRosterDom = () => page.evaluate(() =>
  document.querySelector(".draft-head")?.textContent.match(/(\d+)\s+yours/)?.[1] ?? "ausente");
const trasTomar = await leerRosterDom();
console.log(`  tomado un jugador -> "${trasTomar} yours"`);
if (trasTomar !== "1") fallo("el jugador tomado no se registró");

const leerRoster = leerRosterDom;

for (const [paso, accion] of [
  ["cambiar a WR", async () => page.locator(".pos-option", { hasText: "WR" }).click()],
  ["cambiar a RB", async () => page.locator(".pos-option", { hasText: "RB" }).click()],
  ["volver a ALL", async () => page.locator(".pos-option", { hasText: "ALL" }).click()],
  ["ir a Consensus", async () => page.locator(".view-tab", { hasText: "Consensus" }).click()],
  ["volver a Draft", async () => page.locator(".view-tab", { hasText: "Draft" }).click()],
  ["atrás", async () => page.goBack()],
  ["adelante", async () => page.goForward()],
  ["recargar", async () => page.reload({ waitUntil: "networkidle" })],
]) {
  await accion();
  await page.waitForTimeout(250);
  const ahora = await leerRoster();
  const url = new URL(page.url()).search || "(sin query)";
  console.log(`  ${paso.padEnd(16)} roster="${ahora}"  url=${url}`);
  if (ahora !== "1") fallo(`${paso}: el roster pasó de 1 a "${ahora}"`);
}

// El jugador tomado ya no debe aparecer como sugerencia.
const despues = await page.locator("ol.picks li.pick").first().innerText();
console.log(`\n  1ª sugerencia antes: ${antes.split("\n")[1] ?? antes}`);
console.log(`  1ª sugerencia ahora: ${despues.split("\n")[1] ?? despues}`);
if (antes === despues) fallo("el jugador tomado sigue siendo la primera sugerencia");

console.log(`\n${fallos === 0 ? "SIN FALLOS" : `${fallos} FALLOS`}\n`);
await browser.close();
try { process.kill(-server.pid); } catch {}
process.exit(fallos === 0 ? 0 : 1);
