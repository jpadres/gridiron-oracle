/**
 * Capturas de las 8 páginas, para comparar antes y después del rediseño.
 *
 * ## Por qué existe
 *
 * Los tests de código no ven un desbordamiento, ni un número desalineado, ni una
 * tabla que se sale en un móvil. La única forma de saber que una pasada de
 * diseño no rompió nada es mirar — y mirar 16 pantallas a mano después de cada
 * fase no se sostiene.
 *
 * ## Determinismo
 *
 * Un diff falso es peor que ninguna captura: entrena a ignorar los diffs. Se
 * controlan las tres fuentes de ruido que tiene este sitio:
 *
 * 1. **El sello de build del pie** lleva la hora de horneado y cambia en cada
 *    ejecución. Se tapa con `mask`.
 * 2. **Las animaciones** se congelan, o el pulso del esqueleto sale en una fase
 *    distinta cada vez.
 * 3. **El viewport es fijo**, no el de la máquina.
 *
 * Queda una fuente que no se puede eliminar sin falsear la página: la tarjeta de
 * research calcula su antigüedad contra el reloj, así que una comparación hecha
 * en días distintos puede cambiar «último barrido 29/8» por su versión
 * caducada. Es correcto que lo haga; sólo hay que saberlo al leer un diff.
 *
 *   node tools/screenshots.mjs baseline    # antes de tocar nada
 *   node tools/screenshots.mjs after       # después
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const LABEL = process.argv[2] ?? "baseline";
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

// Las ocho rutas, con nombre estable: el fichero se llama igual siempre para que
// el diff sea fichero contra fichero y no una lista que hay que emparejar.
const PAGES = [
  ["home", "/"],
  ["modelo", "/modelo"],
  ["validacion", "/validacion"],
  ["predicciones", "/predicciones"],
  ["fantasy", "/fantasy"],
  ["semanal", "/fantasy/semanal"],
  ["survivor", "/survivor"],
  ["research", "/research"],
];

// Anchos elegidos por dónde rompe el contenido, no por nombres de dispositivo.
// 390 es el móvil común más estrecho que importa; 1440 es donde el contenido
// deja de crecer y empieza a sobrar margen.
const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
];

async function main() {
  const outDir = path.join("tools", "shots", LABEL);
  mkdirSync(outDir, { recursive: true });

  await assertPortFree();
  const server = startServer();
  await waitForServer();
  const browser = await chromium.launch({
    // Ruta explícita: el entorno trae Chromium preinstalado y descargarlo otra
    // vez son 150 MB por nada.
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });

  try {
    for (const [device, width, height] of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        // Fija el idioma y el huso: `toLocaleDateString("es-ES")` cambia de
        // formato según la máquina, y eso sería un diff en cada fecha.
        locale: "es-ES",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();

      for (const [name, route] of PAGES) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        // Guardia contra el fallo que costó una ronda de diagnóstico: si la hoja
        // de estilos no cargó, la captura sale con el estilo por defecto del
        // navegador y **parece** un rediseño radical. Mejor fallar aquí.
        const styled = await page.evaluate(
          () => getComputedStyle(document.body).margin === "0px"
        );
        if (!styled) {
          throw new Error(`${route}: la hoja de estilos no se aplicó. ` +
            "Suele ser un servidor zombi sirviendo un build borrado.");
        }
        const file = path.join(outDir, `${name}-${device}.png`);
        await page.screenshot({
          path: file,
          fullPage: true,
          animations: "disabled",
          // El sello de build lleva la hora: sin taparlo, las 16 capturas
          // saldrían distintas en cada ejecución y el diff no valdría nada.
          mask: await page.locator(".build").all(),
        });
        console.log(`  ${name}-${device}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    stopServer(server);
  }
  console.log(`\n16 capturas en ${outDir}`);
}

/**
 * Aborta si el puerto ya responde. Un servidor ajeno escuchando ahí es
 * exactamente el zombi que sirvió un build borrado: mejor negarse a capturar
 * que capturar contra algo que no es este build.
 */
async function assertPortFree() {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(1000) });
  } catch {
    return; // Nadie escucha. Es lo que queremos.
  }
  throw new Error(
    `Ya hay algo escuchando en ${BASE}. Mátalo antes de capturar: ` +
      "`pkill -f next-server`."
  );
}

/**
 * Mata el grupo entero. ESRCH significa que ya se había ido — no es un fallo,
 * y dejar que propague enmascara el error real que hizo salir del `try`.
 */
function stopServer(server) {
  try {
    process.kill(-server.pid);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function startServer() {
  return spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    // Grupo de procesos propio. `npx` lanza `next` como nieto, así que matar
    // `npx` deja el servidor vivo: un zombi que sigue escuchando en el puerto.
    // La siguiente ejecución lo encuentra respondiendo, lo da por bueno, y
    // captura contra un build que ya no existe en disco — CSS 404 y páginas sin
    // estilo. Costó una ronda entera de diagnóstico creer que el CSS estaba
    // roto cuando el roto era esto.
    detached: true,
  });
}

/** Espera a que el servidor responda. Sin esto la primera página sale en blanco. */
async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {
      // Todavía no escucha. Se reintenta.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`El servidor no respondió en ${BASE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
