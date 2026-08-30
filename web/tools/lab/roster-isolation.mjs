/**
 * REGRESIÓN CRÍTICA — la plantilla normal y la liga especial de 32 no se tocan.
 *
 * El producto es multi-liga, así que la configuración de una NO puede filtrarse
 * a otra. Se prueba el ciclo entero: normal → 32 → normal, con picks en medio,
 * y se exige que la normal vuelva exactamente como estaba.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4390);
const BASE = `http://127.0.0.1:${PORT}`;
async function libre(b) { try { await fetch(b, { signal: AbortSignal.timeout(1500) }); } catch { return; }
  throw new Error(`servidor zombi en ${b}`); }
await libre(BASE);
await new Promise((res, rej) => { const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
  b.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build ${c}`)))); });
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 400)); }

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

// La NORMAL y la ESPECIAL. Dos identidades, dos configuraciones, cero mezcla.
const NORMAL = { name: "Normal", platform: "manual", leagueId: "NORM", draftId: "DNORM",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 5 };
const ESPECIAL = { name: "32man", platform: "manual", leagueId: "MTY32", draftId: "D32",
  teams: 32, scoring: "ppr", draftType: "snake", rounds: 8, mySlot: 17 };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const abrir = async (l) => {
  await ctx.addInitScript((x) => localStorage.setItem("gridiron-room-league-v1", JSON.stringify(x)), l);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".room-list button", { timeout: 20000 });
  return p;
};
const cuenta = (p) => p.locator(".room-count strong").innerText();
const contexto = async (p) => (await p.locator(".room-head p").innerText()).replace(/\s+/g, " ");
const pick = async (p, n) => { await p.locator(".room-list button").first().click();
  await p.waitForFunction((x) => document.querySelector(".room-count strong")?.textContent === String(x), n); };

console.log("=== ciclo normal → 32 → normal ===");

// 1. Normal: cuatro picks.
let pn = await abrir(NORMAL);
const ctxNormalAntes = await contexto(pn);
check("la normal se identifica como 12 equipos", /12-TEAM/i.test(ctxNormalAntes), ctxNormalAntes);
for (let i = 1; i <= 4; i += 1) await pick(pn, i);
const nombresNormal = await pn.locator(".room-roster .nm, .room-feed .feed-who").allInnerTexts();
const estadoNormal = await pn.locator(".room-state").innerText();
await pn.close();

// 2. Especial de 32: seis picks.
let pe = await abrir(ESPECIAL);
const ctxEspecial = await contexto(pe);
check("la especial se identifica como 32 equipos", /32-TEAM/i.test(ctxEspecial), ctxEspecial);
check("y NO hereda el estado de la normal", (await cuenta(pe)) === "0", await cuenta(pe));
for (let i = 1; i <= 6; i += 1) await pick(pe, i);
check("la especial registra sus propios 6 picks", (await cuenta(pe)) === "6");
const estadoEspecial = await pe.locator(".room-state").innerText();
check("y su reloj usa SUS 32 equipos, no los 12 de la normal",
      estadoEspecial !== estadoNormal, estadoEspecial.replace(/\s+/g, " ").slice(0, 60));
await pe.close();

// 3. Vuelta a la normal: intacta.
pn = await abrir(NORMAL);
check("la normal vuelve con sus 4 picks, ni uno más", (await cuenta(pn)) === "4", await cuenta(pn));
check("y con su identidad sin tocar", (await contexto(pn)) === ctxNormalAntes,
      `${await contexto(pn)} vs ${ctxNormalAntes}`);
const nombresVuelta = await pn.locator(".room-roster .nm, .room-feed .feed-who").allInnerTexts();
check("los mismos jugadores, en el mismo orden",
      nombresVuelta.join("|") === nombresNormal.join("|"),
      `${nombresVuelta.length} vs ${nombresNormal.length}`);
check("el reloj de la normal vuelve a hablar de 12 equipos",
      (await pn.locator(".room-state").innerText()) === estadoNormal);
await pn.close();

// 4. Y otra vez la especial: tampoco perdió nada.
pe = await abrir(ESPECIAL);
check("la especial conserva sus 6 tras la ida y vuelta", (await cuenta(pe)) === "6", await cuenta(pe));
await pe.close();

// 5. Las claves de almacenamiento, separadas.
const inspector = await ctx.newPage();
await inspector.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
const claves = await inspector.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith(":log")));
check("una clave de registro por liga", claves.length === 2, claves.join(" | "));
check("y ninguna comparte identidad",
      claves.some((k) => k.includes("NORM")) && claves.some((k) => k.includes("MTY32")));
await inspector.close();

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
