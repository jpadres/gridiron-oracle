/**
 * ¿Alguna página desborda horizontalmente en móvil?
 *
 * Es la prueba de aceptación del rediseño móvil y la única que no admite
 * interpretación: o el documento cabe en el ancho del viewport, o no.
 * `scrollWidth > clientWidth` es exactamente esa pregunta.
 *
 * Además se listan los elementos culpables, porque «la página desborda» no dice
 * qué arreglar.
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

const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = ["/", "/modelo", "/validacion", "/predicciones",
               "/fantasy", "/fantasy/semanal", "/survivor", "/research"];
const WIDTH = Number(process.argv[2] ?? 390);


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

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: WEB,
    stdio: "ignore",
    // Grupo de procesos propio. `npx` lanza `next` como nieto, así que matar
    // `npx` deja el servidor vivo: un zombi que sigue escuchando en el puerto.
    // La siguiente ejecución lo encuentra respondiendo, lo da por bueno, y
    // captura contra un build que ya no existe en disco — CSS 404 y páginas sin
    // estilo. Costó una ronda entera de diagnóstico creer que el CSS estaba
    // roto cuando el roto era esto.
    detached: true,
  });
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: 844 } });

console.log(`Ancho de viewport: ${WIDTH}px\n`);
let failures = 0;
for (const route of PAGES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const culprits = [];
    if (overflow > 0) {
      for (const node of document.querySelectorAll("*")) {
        const box = node.getBoundingClientRect();
        if (box.right > doc.clientWidth + 1 && box.width > 40) {
          const id = node.className && typeof node.className === "string"
            ? `${node.tagName.toLowerCase()}.${node.className.split(" ")[0]}`
            : node.tagName.toLowerCase();
          if (!culprits.includes(id)) culprits.push(id);
        }
      }
    }
    return { overflow, height: doc.scrollHeight, culprits: culprits.slice(0, 4) };
  });
  const mark = result.overflow > 0 ? "DESBORDA" : "ok      ";
  if (result.overflow > 0) failures += 1;
  console.log(`  ${mark} ${route.padEnd(18)} alto ${String(result.height).padStart(6)}px` +
    (result.overflow > 0 ? `  +${result.overflow}px  ${result.culprits.join(", ")}` : ""));
}
console.log(`\n${failures} de ${PAGES.length} páginas desbordan.`);
await browser.close();
// ESRCH = el grupo ya se fue. No es un fallo.
try { process.kill(-server.pid); } catch (e) { if (e.code !== "ESRCH") throw e; }
