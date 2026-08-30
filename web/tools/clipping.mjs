/**
 * ¿Se corta algún texto al traducirlo?
 *
 * Un cambio de idioma no toca el layout, pero sí la longitud de cada cadena.
 * «Fuera» mide cinco letras y «Questionable» doce: la caja no cambia, el texto
 * sí, y lo que antes cabía ahora se recorta. `overflow.mjs` no lo ve, porque
 * mide el documento entero y una etiqueta recortada no desborda la página —
 * desaparece dentro de su propia caja, en silencio.
 *
 * Se miran tres cosas por elemento con texto propio:
 *
 * 1. **Recorte horizontal**: `scrollWidth > clientWidth` con el desbordamiento
 *    oculto. Es texto que existe y no se lee.
 * 2. **Recorte vertical**: lo mismo en alto. Coge las fichas y los botones a los
 *    que la segunda línea les sobra.
 * 3. **Objetivo táctil**: los controles por debajo de 44x44, que es donde ya
 *    apareció un fallo real en el modo draft.
 *
 * No se busca «feo»: se busca «ilegible». Un texto que envuelve a dos líneas
 * está bien y no sale aquí.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4324;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = ["/", "/modelo", "/validacion", "/predicciones",
               "/fantasy", "/fantasy/semanal", "/survivor", "/research"];
const WIDTHS = [390, 768, 1440];


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

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

let fallos = 0;
for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  console.log(`\n=== ${width}px ===`);
  for (const route of PAGES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const hallazgos = await page.evaluate(() => {
      const out = [];
      const visible = (node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      for (const node of document.querySelectorAll("body *")) {
        if (node.closest("[hidden]") || !visible(node)) continue;
        // Sólo elementos con texto propio: si el texto lo pone un hijo, el
        // recorte se le atribuye al hijo y no se cuenta dos veces.
        const propio = [...node.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(" ");
        if (!propio) continue;
        const estilo = getComputedStyle(node);
        const oculto = (eje) => estilo[eje] === "hidden" || estilo[eje] === "clip";
        const etiqueta = `${node.tagName.toLowerCase()}.${node.className || "-"}`;
        if (oculto("overflowX") && node.scrollWidth > node.clientWidth + 1) {
          out.push({ tipo: "recorte horizontal", etiqueta, texto: propio.slice(0, 60) });
        }
        if (oculto("overflowY") && node.scrollHeight > node.clientHeight + 1) {
          out.push({ tipo: "recorte vertical", etiqueta, texto: propio.slice(0, 60) });
        }
        if (["BUTTON", "A"].includes(node.tagName)) {
          const box = node.getBoundingClientRect();
          // La navegación superior es una fila de enlaces de texto, no botones:
          // su objetivo táctil es la línea entera y el mínimo de 44px no aplica.
          if (node.closest("nav.top") || node.closest("p") || node.closest("li")) continue;
          if (box.height < 44 || box.width < 44) {
            out.push({ tipo: `objetivo táctil ${Math.round(box.width)}x${Math.round(box.height)}`,
                       etiqueta, texto: propio.slice(0, 40) });
          }
        }
      }
      return out;
    });
    const marca = hallazgos.length === 0 ? "ok  " : "FALLA";
    console.log(`  ${marca}  ${route.padEnd(18)} ${hallazgos.length}`);
    for (const h of hallazgos.slice(0, 8)) {
      console.log(`         ${h.tipo}: ${h.etiqueta} — «${h.texto}»`);
    }
    fallos += hallazgos.length;
  }
  await page.close();
}

await browser.close();
try { process.kill(-server.pid); } catch { /* ya no está */ }
console.log(fallos === 0 ? "\nSin texto recortado." : `\n${fallos} hallazgos.`);
process.exit(fallos === 0 ? 0 : 1);
