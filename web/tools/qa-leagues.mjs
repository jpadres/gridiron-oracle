/**
 * Aislamiento entre ligas, en un navegador de verdad.
 *
 * Los tests de `draftStorage` prueban el módulo. Esto prueba el PRODUCTO: que
 * `localStorage` real, con React montado y el ciclo de vida de los efectos,
 * no mezcla dos ligas. Es la diferencia entre «la función es correcta» y «la
 * pantalla enseña lo correcto», y el defecto original vivía en la segunda.
 *
 * No se conecta a Sleeper: se siembra `localStorage` con dos contextos y se
 * comprueba qué lee la página. El camino del navegador a Sleeper sigue sin
 * verificar (SLEEPER_LIVE_BROWSER = BLOCKED) y este test no lo verifica.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;

async function assertPortFree(base) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(1500) });
  } catch {
    return;
  }
  throw new Error(`Ya hay algo sirviendo en ${base}: servidor zombi con un build viejo.`);
}
await assertPortFree(BASE);

console.log("construyendo…");
await new Promise((resolve, reject) => {
  const build = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
  build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
});
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
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const A = "gridiron-draft-v2:sleeper:2026:111:aaa";
const B = "gridiron-draft-v2:sleeper:2026:222:bbb";
const LOCAL = "gridiron-draft-v2:local:2026";
const LEGACY = "gridiron-draft-v1";

// El estado de draft pasó de `{gone, mine}` a un REGISTRO de eventos (E17). Lo
// que se comprueba aquí no cambia —que una liga no pueda tocar a otra— pero la
// forma sí, así que las aserciones miran el registro. Las claves de marcas v2
// siguen sembradas a propósito: si la convergencia las leyera desde el ámbito
// equivocado, esto lo cazaría.
const log = (scope) => `${scope}:${"log"}`;
const tomados = (raw) => {
  const eventos = JSON.parse(raw ?? "null") ?? [];
  const vivos = new Set();
  for (const e of eventos.sort((a, b) => a.at - b.at || a.seq - b.seq)) {
    if (e.kind === "UNDO") vivos.delete(e.playerId);
    else vivos.add(e.playerId);
  }
  return [...vivos];
};

for (const width of [390, 768, 1440]) {
  console.log(`\n=== ${width}px ===`);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();

  // Se siembra ANTES de cargar: los efectos leen en el montaje.
  await page.addInitScript(([a, b, local, legacy]) => {
    localStorage.setItem(a, JSON.stringify({ gone: ["ga1", "ga2", "ga3"], mine: ["ma1"] }));
    localStorage.setItem(b, JSON.stringify({ gone: ["gb1"], mine: ["mb1", "mb2"] }));
    localStorage.setItem(local, JSON.stringify({ gone: [], mine: [] }));
    localStorage.removeItem(legacy);
  }, [A, B, LOCAL, LEGACY]);

  await page.goto(`${BASE}/fantasy`, { waitUntil: "networkidle" });
  await page.waitForSelector("ol.picks", { state: "attached", timeout: 15000 });

  // Sin liga conectada el ámbito es el LOCAL, así que no debe leer ni A ni B.
  const roster = await page.locator(".draft-tools").innerText();
  check("sin conectar no se lee el estado de ninguna liga",
        /0\s+yours/.test(roster), roster.split("\n")[0]);

  // Y ninguna de las dos claves sembradas se ha tocado.
  const intactas = await page.evaluate(([a, b]) => ({
    a: localStorage.getItem(a),
    b: localStorage.getItem(b),
  }), [A, B]);
  check("la liga A sigue intacta",
        JSON.parse(intactas.a).gone.length === 3);
  check("la liga B sigue intacta",
        JSON.parse(intactas.b).mine.length === 2);

  // Marcar un jugador a mano escribe SÓLO en el ámbito local.
  await page.locator(".onclock .act--mine").click();
  await page.waitForTimeout(300);
  const tras = await page.evaluate(([a, b, local, logLocal, logA, logB]) => ({
    a: JSON.parse(localStorage.getItem(a)),
    b: JSON.parse(localStorage.getItem(b)),
    local: localStorage.getItem(local),
    logLocal: localStorage.getItem(logLocal),
    logA: localStorage.getItem(logA),
    logB: localStorage.getItem(logB),
  }), [A, B, LOCAL, log(LOCAL), log(A), log(B)]);
  check("marcar escribe en el registro del ámbito local",
        tomados(tras.logLocal).length === 1, tras.logLocal ? "" : "sin registro local");
  check("marcar NO toca la liga A",
        tras.a.mine.length === 1 && tras.a.gone.length === 3 && tras.logA === null);
  check("marcar NO toca la liga B",
        tras.b.mine.length === 2 && tras.b.gone.length === 1 && tras.logB === null);

  await context.close();
}

// --- migración desde la clave global v1, en el navegador --------------------
console.log("\n=== migración v1 ===");
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(([legacy, a]) => {
    localStorage.clear();
    localStorage.setItem(legacy, JSON.stringify({
      gone: ["viejo1", "viejo2"], mine: ["viejoM"], league: "111", userId: "u1",
    }));
    localStorage.setItem(a, JSON.stringify({ gone: [], mine: [] }));
  }, [LEGACY, A]);
  await page.goto(`${BASE}/fantasy`, { waitUntil: "networkidle" });
  await page.waitForSelector("ol.picks", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(400);

  const after = await page.evaluate(([legacy, a, local, logLocal, logA]) => ({
    legacy: localStorage.getItem(legacy),
    a: JSON.parse(localStorage.getItem(a)),
    logLocal: localStorage.getItem(logLocal),
    logA: localStorage.getItem(logA),
    local: localStorage.getItem(local),
    prefs: JSON.parse(localStorage.getItem("gridiron-draft-prefs-v1") ?? "null"),
  }), [LEGACY, A, LOCAL, log(LOCAL), log(A)]);

  check("la clave v1 se borra", after.legacy === null);
  check("el estado v1 NO se atribuye a la liga 111",
        after.a.gone.length === 0 && after.logA === null);
  check("el estado v1 aterriza en el registro del tablero manual",
        tomados(after.logLocal).length === 3,
        `${tomados(after.logLocal).join(", ") || "(vacío)"}`);
  check("la liga v1 se conserva como preferencia", after.prefs?.league === "111");
  await context.close();
}

// --- estados del draft, con Sleeper simulado --------------------------------
//
// El camino navegador -> Sleeper NO está verificado (SLEEPER_LIVE_BROWSER =
// BLOCKED) y este bloque no lo verifica: intercepta las peticiones y responde
// él. Lo que prueba es la MÁQUINA DE ESTADOS —qué dice la interfaz ante un
// draft sin empezar, en curso o terminado— que es justo lo que no se podía
// comprobar antes de que existiera.
console.log("\n=== estados del draft (Sleeper simulado) ===");
const ESCENARIOS = [
  ["pre_draft", "Draft not started", true],
  ["drafting", "Live", true],
  ["complete", "Draft complete", false],
];
for (const [status, esperado, deberiaRecomendar] of ESCENARIOS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route("**/api.sleeper.app/v1/league/*/drafts", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{
        draft_id: "D1", season: "2026", status, type: "snake",
        settings: { teams: 12, rounds: 15 },
        draft_order: { u1: 8 },
      }]),
    }));
  await page.route("**/api.sleeper.app/v1/draft/*/picks", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api.sleeper.app/v1/league/*/users", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("gridiron-draft-prefs-v1",
                         JSON.stringify({ league: "111", userId: "u1" }));
  });
  await page.goto(`${BASE}/fantasy`, { waitUntil: "networkidle" });
  await page.waitForSelector(".draft-context", { timeout: 15000 });
  // `innerText` devuelve el texto ya en versales por `text-transform`, y con un
  // salto entre etiqueta y valor. Se normaliza en vez de comparar literal.
  const crudo = await page.locator(".draft-context").innerText();
  const texto = crudo.replace(/\s+/g, " ").toUpperCase();
  check(`${status}: la píldora dice «${esperado}»`, texto.includes(esperado.toUpperCase()), texto);
  check(`${status}: el puesto sale de draft_order`, /SLOT 8\b/.test(texto));
  check(`${status}: el tipo y las rondas se leen`,
        texto.includes("SNAKE") && texto.includes("ROUNDS 15"));
  check(`${status}: la limitación del board está a la vista`,
        texto.includes("NOT LEAGUE-SPECIFIC"));
  // Un draft terminado no tiene «siguiente pick»: enseñarlo invita a mirar un
  // turno que ya no llega.
  check(`${status}: el siguiente turno sólo si el draft sigue vivo`,
        texto.includes("NEXT PICK") === (status !== "complete"));
  const recomienda = await page.locator(".onclock:not(.onclock--held)").count();
  check(`${status}: ${deberiaRecomendar ? "recomienda" : "NO recomienda"} un pick`,
        (recomienda > 0) === deberiaRecomendar);
  await context.close();
}

await browser.close();
try { process.kill(-server.pid); } catch { /* ya no está */ }
console.log(fallos === 0 ? "\nSIN FUGAS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
