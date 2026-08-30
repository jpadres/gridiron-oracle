/**
 * Mide el coste de llegar al primer jugador. Es el criterio principal del
 * rediseño del board, y sin número antes/después no se puede afirmar nada.
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

const LABEL = process.argv[2] ?? "before";
const PORT = 4340, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

const rutas = process.argv.slice(3);
const objetivos = rutas.length ? rutas : ["/fantasy"];

console.log(`\n### ${LABEL.toUpperCase()}\n`);
for (const ruta of objetivos) {
  console.log(`ruta ${ruta}`);
  console.log("   ancho   1er jugador  palabras  controles  tablas   filas  overflow");
  for (const w of [390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
    const r = await page.evaluate(() => {
      const top = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      const fila = document.querySelector("tbody tr");
      const yFila = top(fila);
      const controles = document.querySelector(".board-controls, .jump");
      const doc = document.documentElement;
      return {
        primerJugador: yFila,
        palabras: [...document.querySelectorAll("p, li")]
          .filter((n) => yFila !== null && top(n) < yFila && !n.closest("table"))
          .reduce((n, p) => n + p.innerText.trim().split(/\s+/).filter(Boolean).length, 0),
        altoControles: controles ? Math.round(controles.getBoundingClientRect().height) : 0,
        tablas: document.querySelectorAll("table").length,
        filas: document.querySelectorAll("tbody tr").length,
        overflow: doc.scrollWidth - doc.clientWidth,
        alturaTotal: doc.scrollHeight,
      };
    });
    console.log(`${String(w).padStart(8)} ${String(r.primerJugador).padStart(12)} ${String(r.palabras).padStart(9)}`
      + ` ${String(r.altoControles).padStart(10)} ${String(r.tablas).padStart(7)} ${String(r.filas).padStart(7)}`
      + ` ${String(r.overflow).padStart(9)}   alto ${r.alturaTotal}`);
    await page.close();
  }
  console.log();
}
await browser.close();
try { process.kill(-server.pid); } catch {}
