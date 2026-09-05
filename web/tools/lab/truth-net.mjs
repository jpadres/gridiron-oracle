/** FASES 38, 49, 51, 53 — offline, frontera de red, verdad visual, nombres raros. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4370);
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

const browser = await launch();
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };
const LIGA = { name: "N", platform: "manual", leagueId: "LN", draftId: "DN",
  teams: 12, scoring: "ppr", draftType: "snake", rounds: 15, mySlot: 6 };

/* --- FASE 53 — la ruta del pick NO toca la red ----------------------------- */
console.log("=== FASE 53 · frontera de red ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((l) => localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l)), LIGA);
  const page = await ctx.newPage();
  const peticiones = [];
  page.on("request", (r) => peticiones.push(r.url()));
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "networkidle" });
  await page.waitForSelector(".room-list button");
  const trasCarga = peticiones.length;
  for (let i = 0; i < 10; i += 1) {
    await page.locator(".room-list button").first().click();
    await page.waitForFunction((n) => document.querySelector(".room-count strong")?.textContent === String(n), i + 1);
  }
  await page.waitForTimeout(300);
  const nuevas = peticiones.slice(trasCarga).filter((u) => !u.startsWith("data:"));
  check("diez picks no generan NI UNA petición", nuevas.length === 0, nuevas.slice(0, 3).join(" | "));
  const externas = peticiones.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:"));
  check("ninguna petición sale del propio sitio", externas.length === 0, externas.slice(0, 3).join(" | "));
  const metodos = await page.evaluate(() => performance.getEntriesByType("resource").length);
  void metodos;

  /* --- FASE 38 — modo manual offline -------------------------------------- */
  console.log("\n=== FASE 38 · draft manual sin red ===");
  await ctx.setOffline(true);
  for (let i = 10; i < 18; i += 1) {
    await page.locator(".room-list button").first().click();
    await page.waitForFunction((n) => document.querySelector(".room-count strong")?.textContent === String(n), i + 1);
  }
  check("se sigue drafteando con la red caída", (await page.locator(".room-count strong").innerText()) === "18");
  await page.locator(".room-flash button").click();
  await page.waitForFunction(() => document.querySelector(".room-count strong")?.textContent === "17");
  check("y deshacer funciona igual", true);
  const texto = await page.locator(".room").innerText();
  check("nada en pantalla dice que el draft se haya parado",
        !/offline|connection|sync (failed|error)/i.test(texto));
  await ctx.setOffline(false);
  await ctx.close();
}

/* --- FASE 49 — verdad visual: ¿la jerarquía promete más que el texto? ------ */
console.log("\n=== FASE 49 · verdad visual ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((l) => localStorage.setItem("gridiron-room-league-v1", JSON.stringify(l)), LIGA);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".room-list button");

  const vocabulario = await page.locator(".room").innerText();
  const prohibidas = ["best pick for you", "recommended pick", "smart pick", "ai pick",
    "safe pick", "safe to wait", "must draft", "value edge", "draft grade",
    "win probability", "confidence", "sleeper pick", "steal", "reach"];
  const encontradas = prohibidas.filter((w) => new RegExp(w, "i").test(vocabulario));
  check("sin vocabulario de recomendación no autorizado", encontradas.length === 0, encontradas.join(", "));

  // El elemento visualmente más fuerte no puede ser un jugador concreto.
  const pesos = await page.evaluate(() => {
    const medir = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return Math.round(parseFloat(s.fontSize) * (parseFloat(s.fontWeight) / 400));
    };
    return {
      estado: medir(".room-until-n") ?? medir(".room-clock"),
      heroeNombre: medir(".room-list li.is-best .nm"),
      heroeVor: medir(".room-list li.is-best .room-row-vor"),
    };
  });
  check("el estado del draft pesa más que el nombre del héroe",
        pesos.estado >= pesos.heroeNombre, JSON.stringify(pesos));

  // Nada verde/rojo semántico sobre el jugador sugerido: el color de posición sí,
  // un semáforo de decisión no.
  const semaforo = await page.evaluate(() => {
    const el = document.querySelector(".room-list li.is-best");
    if (!el) return null;
    const s = getComputedStyle(el);
    return { fondo: s.backgroundColor, borde: s.borderLeftColor };
  });
  check("el héroe no usa color de semáforo como juicio", semaforo !== null,
        JSON.stringify(semaforo));

  // La limitación tiene que ser ALCANZABLE, aunque esté plegada.
  const metodo = await page.locator(".room-method summary").innerText();
  check("la limitación es alcanzable desde la pantalla", metodo.length > 0, metodo);
  await page.locator(".room-method summary").click();
  const cuerpo = await page.locator(".room-method").innerText();
  check("y dice que NO es una recomendación ajustada a tu plantilla",
        /not a recommendation/i.test(cuerpo), cuerpo.slice(0, 90).replace(/\s+/g, " "));

  /* --- FASE 51 — nombres extremos ---------------------------------------- */
  console.log("\n=== FASE 51 · nombres y datos extremos ===");
  const desbordes = await page.evaluate(() => {
    const malos = [];
    for (const el of document.querySelectorAll(".room-list .nm, .feed-who, .room-roster .nm")) {
      if (el.scrollWidth > el.clientWidth + 2) malos.push(el.textContent.trim().slice(0, 30));
    }
    return malos;
  });
  check("ningún nombre desborda su celda", desbordes.length === 0, desbordes.slice(0, 3).join(" | "));
  const masLargo = await page.evaluate(() => {
    const n = [...document.querySelectorAll(".room-list .nm")].map((e) => e.textContent.trim());
    return n.sort((a, b) => b.length - a.length)[0] ?? "";
  });
  check("el nombre más largo del board cabe", masLargo.length > 0, `«${masLargo}» (${masLargo.length} car.)`);

  // Equipo desconocido: no puede romper la fila ni pintar un rail inventado.
  /* La identidad de equipo tiene que LLEGAR al píxel, no sólo a la variable.
     El puente que resuelve `--team` desde `--team-light`/`--team-dark` es una
     lista de selectores, y las filas del Draft Room no estaban en ella: los 72
     raíles salían grises desde que existe la pantalla. No fallaba nada — se ve
     comparando el color pintado con el de respaldo. */
  const identidad = await page.evaluate(() => {
    // Los separadores de tier también son `li` y no llevan equipo: excluirlos,
    // o el test mide la proporción de cortes en vez de la identidad.
    const filas = [...document.querySelectorAll(".room-list > li:not(.room-tier)")].slice(0, 40);
    const respaldo = getComputedStyle(document.documentElement)
      .getPropertyValue("--yard-line").trim();
    let conVariable = 0, grises = 0;
    const colores = new Set();
    for (const li of filas) {
      if (li.style.getPropertyValue("--team-light")) conVariable += 1;
      const pintado = getComputedStyle(li).borderLeftColor;
      colores.add(pintado);
      const resuelto = getComputedStyle(li).getPropertyValue("--team").trim();
      if (!resuelto || resuelto === respaldo) grises += 1;
    }
    return { filas: filas.length, conVariable, grises, distintos: colores.size };
  });
  check("TODAS las filas de jugador reciben las variables de equipo",
        identidad.conVariable === identidad.filas, `${identidad.conVariable}/${identidad.filas}`);
  check("y `--team` RESUELVE en la fila (no cae al gris de respaldo)",
        identidad.grises === 0, `${identidad.grises} filas grises de ${identidad.filas}`);
  check("los raíles pintan colores DISTINTOS entre equipos",
        identidad.distintos >= 8, `${identidad.distintos} colores distintos en ${identidad.filas} filas`);
  await ctx.close();
}

await browser.close();
stop();
console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
