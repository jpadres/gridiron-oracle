/**
 * Laboratorio: el navegador BLOQUEA el almacenamiento del sitio.
 *
 * Chrome con «bloquear todas las cookies», una política de empresa o algunos
 * modos privados hacen que el getter `window.localStorage` lance
 * `SecurityError`. Antes eso tumbaba las cinco pantallas con estado a «This
 * page could not load» — con un navegador sano y sin nada guardado. Aquí se
 * inyecta exactamente ese fallo y se exige que cada página renderice, que el
 * board siga drafteable en modo manual y que lo diga.
 *
 *     SKIP_BUILD=1 node tools/lab/storage-blocked.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4520);
const BASE = `http://127.0.0.1:${PORT}`;

if (!process.env.SKIP_BUILD) {
  await new Promise((r, j) => { const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" }); b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`)))); });
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 400)); }

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  Object.defineProperty(window, "localStorage", {
    get() { throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", "SecurityError"); },
  });
});
const page = await ctx.newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(String(e).slice(0, 200)));

for (const url of ["/fantasy", "/fantasy/draft", "/fantasy/leagues", "/fantasy/semanal", "/betting"]) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const broken = await page.locator("text=This page could not load").count();
  check(`${url} renderiza con el almacenamiento bloqueado`, broken === 0 && errores.length === 0, errores[0] ?? "");
  errores.length = 0;
}

await page.goto(`${BASE}/fantasy`, { waitUntil: "load" });
await page.waitForSelector(".draft-tools", { timeout: 8000 }).catch(() => {});
check("el modo draft sale de «Loading» y ofrece el tablero manual", (await page.locator("#draft-search").count()) === 1);
check("y dice que este navegador no guarda nada", /blocks site storage/.test(await page.locator(".draft").innerText()));
await page.fill("#draft-search", "nacua");
await page.waitForSelector(".picks--found .pick", { timeout: 5000 }).catch(() => {});
await page.locator(".picks--found .pick button", { hasText: "Gone" }).first().click().catch(() => {});
await page.waitForTimeout(300);
check("tachar a alguien sigue funcionando en memoria", /1<\/strong> off the board|1 off the board/.test((await page.locator(".draft-head").innerHTML()).replace(/\s+/g, " ")));

await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "load" });
await page.waitForSelector(".room-setup", { timeout: 8000 }).catch(() => {});
check("la antesala del Draft Room aparece en vez de colgarse", (await page.locator(".room-setup").count()) === 1);

await ctx.close();
await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
