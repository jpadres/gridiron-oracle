/**
 * QA de humo: TODAS las páginas del sitio, en tres anchos, sin cuenta enlazada.
 *
 * Los otros laboratorios entran hondo en una pantalla cada uno. Éste es lo
 * contrario y hacía falta: recorre todo lo publicado y comprueba lo que nunca
 * debería fallar en ninguna parte —que responde, que no lanza, que tiene un
 * título, que no desborda a lo ancho y que no se queda en el esqueleto de
 * carga—, incluida la página nueva de cada semana, que es justo la que nadie
 * vuelve a mirar.
 *
 * Sin cuenta a propósito: es el estado en el que llega cualquiera la primera
 * vez, y el que más veces se ha roto en este proyecto (las cinco pantallas a
 * «could not load» con el almacenamiento bloqueado salieron así).
 *
 *     SKIP_BUILD=1 node tools/lab/smoke.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4521);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOTS
  ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";

const PAGINAS = [
  "/", "/modelo", "/validacion", "/predicciones", "/betting",
  "/fantasy", "/fantasy/draft", "/fantasy/leagues", "/fantasy/semanal",
  "/fantasy/resto", "/fantasy/analisis", "/survivor", "/research",
];

if (!process.env.SKIP_BUILD) {
  await new Promise((r, j) => {
    const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
    b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`))));
  });
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 400));
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

for (const width of [390, 768, 1440]) {
  console.log(`\n=== ${width} px ===`);
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));
  for (const url of PAGINAS) {
    errores.length = 0;
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    // Un cliente que aún no ha hidratado no es un fallo: se le da margen y se
    // exige que salga del esqueleto, que es lo que ve una persona.
    await page.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 8000 })
      .catch(() => {});
    const roto = await page.locator("text=This page could not load").count();
    const titulo = await page.locator("h1").first().innerText().catch(() => "");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    check(`${url}`,
      res?.status() === 200 && roto === 0 && titulo.length > 0 && !overflow && errores.length === 0,
      [
        res?.status() !== 200 ? `HTTP ${res?.status()}` : "",
        roto ? "could not load" : "",
        titulo ? "" : "sin h1",
        overflow ? "desborda" : "",
        errores[0] ?? "",
      ].filter(Boolean).join(" · "));
  }
  if (width === 1440) {
    // La navegación tiene que llevar a TODO lo publicado: una página sin enlace
    // es una página que nadie encuentra.
    const enlaces = await page.evaluate(() =>
      [...document.querySelectorAll("nav a")].map((a) => new URL(a.href).pathname));
    const huerfanas = PAGINAS.filter((p) => !enlaces.includes(p));
    check("todas las páginas están en la navegación", huerfanas.length === 0, huerfanas.join(", "));
  }
  await page.screenshot({ path: `${OUT}/smoke-${width}.png` });
  await ctx.close();
}

await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
