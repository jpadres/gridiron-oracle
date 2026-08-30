/**
 * Lo que se ve sin hacer scroll, en cada ancho.
 *
 * Una captura de página entera de 22.000 px no se puede mirar: se reduce hasta
 * ser una columna de píxeles. Y la primera pantalla es justamente la que decide
 * si un producto parece premium o parece un informe, así que es la que hay que
 * poder ver a tamaño real.
 *
 * Uso:  node web/tools/fold.mjs [etiqueta] [alto]
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4326;
const BASE = `http://127.0.0.1:${PORT}`;
const LABEL = process.argv[2] ?? "fold";
const HEIGHT = Number(process.argv[3] ?? 1000);
// El tema es parte del diseño, no una variante: la paleta de campo vive en el
// oscuro. Capturar sólo el claro deja sin mirar la mitad del producto.
const SCHEME = process.argv[4] ?? "light";
const PAGES = [
  ["/", "home"], ["/modelo", "modelo"], ["/validacion", "validacion"],
  ["/predicciones", "predicciones"], ["/fantasy", "fantasy"],
  ["/fantasy/draft", "room"],
  ["/fantasy/semanal", "semanal"], ["/survivor", "survivor"], ["/research", "research"],
];
const WIDTHS = [390, 768, 1440];

// `next start` sirve el ÚLTIMO build, no el código en disco. Capturar sin
// reconstruir produce capturas idénticas a las anteriores y la conclusión falsa
// de que el cambio de CSS no hizo nada. Costó una ronda.
console.log("construyendo…");
await new Promise((resolve, reject) => {
  const build = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
  build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build salió ${code}`))));
});


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

const server = spawn("npx", ["next", "start", "-p", String(PORT)],
                     { cwd: WEB, stdio: "ignore", detached: true });
// Si la herramienta revienta a mitad, el servidor detached sobrevive y la
// siguiente ejecución falla contra su propio zombi. Se cierra pase lo que pase.
const stopServer = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stopServer);
process.on("uncaughtException", (error) => { stopServer(); throw error; });
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 500));
}

const outDir = path.join(WEB, "tools", "shots", LABEL);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: HEIGHT }, colorScheme: SCHEME });
  // Sin animaciones: una captura a media entrada produce diffs falsos, y un diff
  // falso entrena a ignorar los diffs.
  //
  // Va como `addInitScript` y no como `addStyleTag`: la hoja inyectada se pierde
  // en la primera navegación, así que sólo protegía a la primera página. Las
  // otras siete se capturaban con la animación a medias — y la captura del war
  // room salió con media lista desvanecida, que se lee como un bug de opacidad
  // que no existe.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
  for (const [route, name] of PAGES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
  }
  await page.close();
  console.log(`  ${width}px listo`);
}

await browser.close();
try { process.kill(-server.pid); } catch { /* ya no está */ }
console.log(`\n${PAGES.length * WIDTHS.length} capturas en tools/shots/${LABEL}`);
