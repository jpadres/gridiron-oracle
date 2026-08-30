/**
 * QA de interacción del Draft Room tras el pase visual.
 *
 * Lo que se comprueba no es que exista un control: es que se puede USAR con el
 * pulgar mientras corre un reloj. Objetivo táctil, foco visible, estados, y que
 * el pick siga siendo inmediato.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4345;
const BASE = `http://127.0.0.1:${PORT}`;

async function assertPortFree(base) {
  try { await fetch(base, { signal: AbortSignal.timeout(1500) }); } catch { return; }
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
let fallos = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const LEAGUE = {
  name: "QA", platform: "manual", leagueId: "QA1", draftId: "DQA1",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 8,
};

for (const width of [390, 768, 1440]) {
  console.log(`\n=== ${width}px ===`);
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  await ctx.addInitScript((l) => {
    localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l));
  }, LEAGUE);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button", { timeout: 20000 });

  // --- un toque en la fila entera registra el pick, y sigue siendo inmediato
  const nombre = await page.locator(".room-list .nm").first().innerText();
  const t0 = Date.now();
  await page.locator(".room-list button").first().click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
  const ms = Date.now() - t0;
  check("un toque en la fila registra el pick", true, `${ms} ms`);
  check("el pick sigue por debajo de 150 ms", ms < 150, `${ms} ms`);
  check("el jugador sale del board",
        (await page.locator(".room-list .nm").first().innerText()) !== nombre);

  // --- deshacer desde el flash
  check("aparece deshacer", await page.locator(".room-flash").isVisible());
  await page.locator(".room-flash button").click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "0");
  check("deshacer devuelve al jugador",
        (await page.locator(".room-list .nm").first().innerText()) === nombre);

  // --- objetivos táctiles de TODOS los controles activos
  await page.locator(".room-list button").first().click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
  const pequenos = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".room button, .room input, .room summary")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.width < 44 || r.height < 44) {
        out.push(`${(el.className || el.tagName).toString().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
  check("todo control activo mide 44px o más", pequenos.length === 0, pequenos.join(", "));

  // --- filtro de posición, incluidas K y DST
  for (const pos of ["QB", "K", "DST", "ALL"]) {
    await page.locator(`.pos-option:text-is("${pos}")`).click();
    const marcado = await page.locator(`.pos-option:text-is("${pos}")`).getAttribute("aria-pressed");
    check(`filtro ${pos} se marca como pulsado`, marcado === "true");
  }
  // K es FICHABLE desde 2026-08: filas con hechos de la temporada anterior,
  // sin VOR ni rank, y una nota de autoridad encima. La lista vacía de antes
  // era el producto sin la capacidad; esto es la capacidad con su recorte.
  await page.locator('.pos-option:text-is("ALL")').click();
  await page.locator('.pos-option:text-is("K")').click();
  check("K enseña pateadores fichables (32 filas, sin rank ni VOR)",
        (await page.locator(".room-list .room-row").count()) === 32 &&
        (await page.locator(".room-list .room-row-vor").first().innerText()) === "—");
  check("…con la nota de autoridad visible",
        /draftable, not ranked/i.test(await page.locator(".room-note").first().innerText()));
  // Multi-selección: K+DST a la vez es una vista real (los dos huecos finales).
  await page.locator('.pos-option:text-is("DST")').click();
  check("K+DST juntos: la ventana llena (60) con las dos posiciones presentes",
        (await page.locator(".room-list .room-row").count()) === 60 &&
        (await page.locator(".room-list .ptag--k").count()) > 0 &&
        (await page.locator(".room-list .ptag--dst").count()) > 0);
  await page.locator('.pos-option:text-is("ALL")').click();

  // --- búsqueda inmediata
  await page.locator(".draft-search").fill("jefferson");
  await page.waitForFunction(() => document.querySelectorAll(".room-list button").length <= 5);
  check("la búsqueda filtra al instante",
        /jefferson/i.test(await page.locator(".room-list .nm").first().innerText()));
  // Con búsqueda activa NO hay separadores de tier: el orden es otro.
  check("sin separadores de tier durante una búsqueda",
        (await page.locator(".room-tier").count()) === 0);
  await page.locator(".draft-search").fill("");

  // --- foco visible en la fila
  await page.locator(".room-list button").first().focus();
  const foco = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { clase: el.className, outline: s.outlineWidth, estilo: s.outlineStyle };
  });
  check("la fila enfocada tiene contorno visible",
        foco.clase.includes("room-row") && parseFloat(foco.outline) >= 2, JSON.stringify(foco));

  // --- metodología detrás de divulgación
  const detalles = page.locator(".room-method");
  check("la metodología llega plegada", (await detalles.evaluate((d) => d.open)) === false);
  await page.locator(".room-method summary").click();
  check("y se puede abrir", await detalles.evaluate((d) => d.open));

  // --- recargar conserva
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button");
  check("recargar conserva el draft",
        (await page.locator(".room-count strong").innerText()) === "1");

  check("sin desbordamiento horizontal",
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await ctx.close();
}

// --- movimiento reducido -----------------------------------------------------
console.log("\n=== reduced motion ===");
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
  });
  await ctx.addInitScript((l) => {
    localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l));
  }, LEAGUE);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button");
  await page.locator(".room-list button").first().click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "1");
  const anim = await page.evaluate(() => {
    const li = document.querySelector(".room-feed > li");
    return li ? getComputedStyle(li).animationName : "sin-feed";
  });
  check("sin animación con movimiento reducido", anim === "none" || anim === "sin-feed", anim);
  await ctx.close();
}

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
