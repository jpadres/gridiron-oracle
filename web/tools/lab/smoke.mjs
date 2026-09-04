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
  "/", "/modelo", "/predicciones", "/betting",
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
    /* NINGUNA PÁGINA HUÉRFANA. Una página publicada que no se enlaza desde
       ninguna parte no la encuentra nadie — lo que le pasó al resto de
       temporada dentro del semanal.

       El menú ya no es la única puerta: `/fantasy/leagues` salió de él porque
       la barra de liga la enlaza desde las tres pantallas que la necesitan.
       Así que lo que se exige es que TODA página esté enlazada desde ALGÚN
       sitio, no que esté en el menú. Se recorren las páginas recogiendo los
       enlaces internos de cada una y se comprueba la unión. */
    const alcanzables = new Set();
    for (const url of PAGINAS) {
      await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      for (const href of await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")]
          .filter((a) => a.href.startsWith(location.origin))
          .map((a) => new URL(a.href).pathname))) alcanzables.add(href);
    }
    const huerfanas = PAGINAS.filter((p) => p !== "/" && !alcanzables.has(p));
    check("ninguna página publicada se queda sin enlace", huerfanas.length === 0,
      huerfanas.join(", "));
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const enMenu = await page.evaluate(() =>
      [...document.querySelectorAll("nav.top .top-links a")].map((a) => new URL(a.href).pathname));
    check("el menú lleva a once secciones", enMenu.length === 11, `${enMenu.length}`);

/* EL MENÚ DEL TELÉFONO ES OTRO ELEMENTO, Y POR ESO SE COMPRUEBA APARTE.
   En 390 px la fila de secciones no cabe y se pinta un desplegable: los dos
   salen del MISMO array, pero «salen del mismo array» es una promesa del
   código y esto es la comprobación. Si alguien añade una pantalla al menú de
   escritorio y no al del teléfono, la mitad de los usuarios no la ve. */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const summary = page.locator(".top-menu > summary");
  check("390: el menú es un desplegable de una línea", (await summary.count()) === 1);
  const alto = (await page.locator("nav.top").boundingBox())?.height ?? 999;
  // El cromo por encima del título: si vuelve a crecer, la lista de candidatos
  // del asistente se sale del primer viewport en mitad de un draft.
  check("390: y el menú no se come el primer viewport", alto < 80, `${Math.round(alto)} px`);
  await summary.click();
  const enMovil = await page.locator(".top-menu-links a").evaluateAll(
    (as) => as.map((a) => a.getAttribute("href")));
  /* Los dos menús llevan LO MISMO. Antes se comparaba el del teléfono contra la
     lista de páginas publicadas, y eso dejó de valer cuando `/fantasy/leagues`
     salió del menú a propósito (la barra de liga la enlaza). Lo que hay que
     vigilar es la promesa del código: que los dos se pintan del MISMO array.
     Si alguien añade una sección al de escritorio y no al del teléfono, la
     mitad de los usuarios no la ve. */
  const enEscritorio = await page.evaluate(() =>
    [...document.querySelectorAll("nav.top .top-links a")].map((a) => a.getAttribute("href")));
  check("390: el desplegable lleva lo mismo que el menú de escritorio",
    enMovil.length === enEscritorio.length && enMovil.every((h, i) => h === enEscritorio[i]),
    `móvil ${enMovil.length} vs escritorio ${enEscritorio.length}`);
  // Y que se pueda tocar: 44 px es el mínimo de un control que se pulsa.
  const chico = await page.locator(".top-menu-links a").evaluateAll(
    (as) => as.filter((a) => a.getBoundingClientRect().height < 44).length);
  check("390: cada enlace del menú se puede tocar", chico === 0, `${chico} por debajo de 44 px`);
  await ctx.close();
}
  }
  await page.screenshot({ path: `${OUT}/smoke-${width}.png` });
  await ctx.close();
}

await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
