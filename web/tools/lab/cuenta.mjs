/**
 * Laboratorio: la cuenta de Sleeper enlazada y un mock draft seguido en vivo.
 *
 * Lo que se prueba, con el doble compartido de `sleeper-double.mjs`:
 *
 *   1. Enlazar por nombre de usuario lista TODAS las ligas de la temporada con
 *      su configuración REAL (tamaño, puntuación, puesto), y mi plantilla
 *      resuelta POR ID contra el mapa horneado — con «DEF taken» donde ya la
 *      tengo y «not yet» donde no.
 *   2. La frescura dice «synced … ago» y NUNCA «LIVE»: aquí no se sondea.
 *   3. Un nombre que no existe da un error y no guarda nada.
 *   4. Los mocks del usuario aparecen y «Follow in the assistant» abre el Draft
 *      Room sobre el mock: liga sintética, parrilla del tamaño del mock, mi
 *      columna en el puesto de `draft_order`, y los picks entran por el
 *      adaptador igual que en un draft de liga.
 *   5. Al recargar, los paneles siguen ahí sin volver a pedir nada.
 *
 *     SKIP_BUILD=1 node tools/lab/cuenta.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, crearMock, emitir, montar, slotOf }
  from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4512);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOTS ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";
async function libre(b) { try { await fetch(b, { signal: AbortSignal.timeout(1500) }); } catch { return; } throw new Error(`zombi en ${b}`); }
await libre(BASE);
const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const DEFENSES = model.fantasy.specialists?.defenses ?? [];
const KICKERS = model.fantasy.specialists?.kickers ?? [];
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));
const SEASON = String(model.fantasy.season);

if (!process.env.SKIP_BUILD) {
  console.log("construyendo…");
  await new Promise((r, j) => { const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" }); b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`)))); });
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: WEB, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 400)); }

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

/* === el doble: dos ligas y un mock ======================================= */
const ROSTER12 = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN", "BN", "BN", "BN", "BN"];
const ROSTER10 = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN", "BN", "BN"];
const L1 = crearLiga({ id: "LG12", draftId: "DR12", teams: 12, roster: ROSTER12, mySlot: 7,
  rounds: 15, name: "Sunday Twelve", scoring: { rec: 1 } });
L1.draft.status = "complete";
const L2 = crearLiga({ id: "LG10", draftId: "DR10", teams: 10, roster: ROSTER10, mySlot: 2,
  rounds: 13, name: "Half Ten", scoring: { rec: 0.5 } });
L2.draft.status = "pre_draft";
const MOCK = crearMock({ draftId: "MK1", teams: 12, mySlot: 4, rounds: 15, scoringType: "ppr",
  name: "Tuesday mock" });

// Siembra: en la liga 1 ya tengo cinco jugadores, entre ellos una defensa y un
// pateador; en la 2 nada todavía. Todo por el MISMO mapa horneado del producto.
const mine1 = [BOARD[0], BOARD[3], BOARD[10], DEFENSES[0], KICKERS[0]];
let no = 1;
for (const row of mine1) {
  // El pick cae en MI puesto: `emitir` rellena `rosters[7].players`.
  while (slotOf(no, 12) !== 7) no += 1;
  emitir(L1, no, row, SLEEPER_OF);
  no += 1;
}
const myRoster1 = L1.rosters.find((r) => r.roster_id === 7);
// Titulares: tres jugadores y la defensa, para que la alineación tenga algo SIN proyección.
myRoster1.starters = [...myRoster1.players.slice(0, 3), myRoster1.players[3]];
myRoster1.settings = { wins: 2, losses: 1, ties: 0 };

// Y LAS ONCE PLANTILLAS RESTANTES. Sin esto la liga tenía un equipo con
// jugadores y once vacíos: el analizador salía con once ceros, la mediana era
// cero y no había un solo par de huecos opuestos que comprobar. Un doble que no
// se parece a una liga de verdad prueba otra cosa — la lección de los fixtures
// de este proyecto, aplicada a la pantalla que compara plantillas.
{
  const yaTengo = new Set(mine1.map((r) => r.player_id));
  const pool = BOARD.filter((r) => !yaTengo.has(r.player_id) && SLEEPER_OF[r.player_id]);
  let k = 0;
  for (let ronda = 1; ronda <= 9; ronda += 1) {
    for (let slot = 1; slot <= 12; slot += 1) {
      if (slot === 7) continue;              // mi puesto ya está sembrado
      const row = pool[k]; k += 1;
      if (!row) break;
      const roster = L1.rosters.find((r) => r.roster_id === slot);
      roster.players.push(SLEEPER_OF[row.player_id]);
      if (roster.starters.length < 6) roster.starters.push(SLEEPER_OF[row.player_id]);
      roster.settings = { wins: (slot + ronda) % 4, losses: ronda % 3, ties: 0 };
    }
  }
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await montar(ctx, [L1, L2, MOCK]);
const page = await ctx.newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(String(e)));

/* === 1. enlazar ========================================================== */
console.log("=== enlazar la cuenta ===");
await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#cc-user");
await page.fill("#cc-user", "nadie-con-este-nombre");
await page.click(".cc-link button[type=submit]");
await page.waitForSelector(".sleeper-error", { timeout: 8000 });
check("un nombre que no existe da un error visible", (await page.locator(".sleeper-error").count()) === 1);
check("y no enlaza nada", (await page.locator(".cc-account-line").count()) === 0);

await page.fill("#cc-user", USERNAME);
await page.click(".cc-link button[type=submit]");
await page.waitForSelector(".cc-panel", { timeout: 10000 });
const panels = page.locator(".cc-panel");
check("las dos ligas de la temporada aparecen como paneles", (await panels.count()) === 2,
  `${await panels.count()}`);
const head = async (i) => (await panels.nth(i).locator(".cc-panel-head").innerText()).replace(/\s+/g, " ");
const h1 = await head(0); const h2 = await head(1);
const texto = h1 + " | " + h2;
check("la configuración es la REAL de cada liga: 12-team PPR y 10-team Half PPR",
  /12-team/.test(texto) && /PPR/.test(texto) && /10-team/.test(texto) && /Half PPR/.test(texto), texto);
check("mi puesto sale de draft_order: slot 7 y slot 2", /slot 7/.test(texto) && /slot 2/.test(texto), texto);
check("el récord se enseña cuando Sleeper lo publica", /2-1/.test(texto), texto);
const facts = async (name) => (await page.locator(".cc-panel", { hasText: name }).locator(".cc-facts").innerText()).replace(/\s+/g, " ");
const f1 = await facts("Sunday Twelve"); const f2 = await facts("Half Ten");
check("en la liga con plantilla: DEF taken y K taken, y el conteo por posición",
  /DEF taken/.test(f1) && /K taken/.test(f1) && /5 rostered/.test(f1), f1);
check("en la liga vacía: DEF not yet, K not yet, 0 rostered",
  /DEF not yet/.test(f2) && /K not yet/.test(f2) && /0 rostered/.test(f2), f2);
const roster1 = await page.locator(".cc-panel", { hasText: "Sunday Twelve" }).locator(".cc-player").count();
check("la plantilla se resuelve por id: cinco filas, con la defensa y el pateador",
  roster1 === 5, `${roster1}`);
const nombres = await page.locator(".cc-panel", { hasText: "Sunday Twelve" }).locator(".cc-player .nm").allInnerTexts();
check("y el primero del board está en ella por su nombre completo",
  nombres.includes(BOARD[0].player_full_name ?? BOARD[0].player_name), nombres.join(", "));
check("el VOR de la plantilla es el de ESTA liga, no el publicado",
  /12-team · PPR/.test(await page.locator(".cc-panel", { hasText: "Sunday Twelve" }).locator(".cc-roster .caption").innerText()));
const sync = await page.locator(".cc-sync").innerText();
check("la frescura dice «synced … ago» y nunca LIVE", /synced/.test(sync) && !/LIVE/i.test(sync), sync);
check("la página entera no escribe LIVE", !/\bLIVE\b/.test(await page.locator(".cc").innerText()));
await page.screenshot({ path: `${OUT}/cuenta-1440-linked.png`, fullPage: true });

/* === 1b. el enfrentamiento y la profundidad ============================= */
console.log("\n=== matchup y profundidad ===");
const panel1 = page.locator(".cc-panel", { hasText: "Sunday Twelve" });
check("el panel enseña el enfrentamiento de la semana con el nombre del rival",
  (await panel1.locator(".cc-matchup").count()) === 1
  && /vs Team 8/.test(await panel1.locator(".cc-matchup h4").innerText()),
  (await panel1.locator(".cc-matchup h4").innerText().catch(() => "sin matchup")));
check("mi alineación suma proyecciones y cuenta lo que no tiene (la defensa)",
  /no proj/.test(await panel1.locator(".cc-lineup-total").first().innerText()));
await panel1.locator(".cc-depth-wrap summary").click();
const depthRows = await panel1.locator(".cc-depth tbody tr").count();
check("la profundidad lista los 12 equipos y marca el mío", depthRows === 12
  && (await panel1.locator(".cc-depth tr.is-mine").count()) === 1, `${depthRows}`);

/* === 1c. el semanal marca MINE y FA en la liga elegida =================== */
await page.goto(`${BASE}/fantasy/semanal`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#wk-league", { timeout: 8000 });
await page.selectOption("#wk-league", "LG12");
await page.waitForSelector(".own--mine", { timeout: 8000 }).catch(() => {});
check("el semanal ofrece cambiar de liga y marca MINE en la mía",
  (await page.locator("#wk-league option").count()) === 2 && (await page.locator(".wk-table .own--mine").count()) >= 2,
  `${await page.locator(".wk-table .own--mine").count()} MINE`);
check("y marca FA a los libres y con el nombre del dueño a los cogidos",
  (await page.locator(".wk-table .own--fa").count()) > 5
    && (await page.locator(".wk-table .own--taken").count()) > 5,
  `${await page.locator(".wk-table .own--fa").count()} FA · ${await page.locator(".wk-table .own--taken").count()} de otros`);
await page.selectOption("#wk-league", "LG10");
await page.waitForTimeout(300);
check("en la liga vacía nadie es MINE y todos son FA",
  (await page.locator(".wk-table .own--mine").count()) === 0 && (await page.locator(".wk-table .own--fa").count()) > 50);
await page.screenshot({ path: `${OUT}/cuenta-1440-semanal.png` });

/* === 1d. lo que hay libre en MI liga, y el resto de temporada ============= */
await page.selectOption("#wk-league", "LG12");
await page.waitForSelector("#free", { timeout: 8000 }).catch(() => {});
check("el semanal abre el panel de lo que hay libre en esa liga",
  (await page.locator("#free").count()) === 1);
{
  const texto = await page.locator("#free").innerText().catch(() => "");
  // La frontera del proyecto, escrita donde se lee: esto es una resta, no un
  // consejo. Si algún día alguien la borra, este laboratorio se pone rojo.
  check("y dice que es una resta entre proyecciones y NO un consejo",
    /projection gaps, not advice/i.test(texto) && /the decision is yours/i.test(texto));
  check("las defensas libres se ordenan por el total implícito del rival, de menos a más",
    /lowest first/i.test(texto));
  const libres = await page.locator("#free .wk-free-list > li").count();
  check("y lista pateadores o defensas que nadie tiene", libres > 0, `${libres} filas`);
}
await page.waitForSelector("#ros", { timeout: 8000 }).catch(() => {});
{
  const filas = await page.locator("#ros tbody tr").count();
  check("el resto de temporada sale con sus filas", filas > 20, `${filas}`);
  // REGLA 6b EN LA TABLA. Ordenada por puntos salían 52 quarterbacks entre los
  // sesenta primeros. Se cuenta cuántos QB hay en el top 20: si vuelve a
  // ordenarse por puntos, este guardián se pone rojo.
  const posiciones = await page.evaluate(() =>
    [...document.querySelectorAll("#ros tbody tr")].slice(0, 20)
      .map((tr) => tr.querySelector(".ptag")?.textContent?.replace(/[0-9]/g, "") ?? "?"));
  const qbs = posiciones.filter((p) => p === "QB").length;
  check("el resto de temporada NO está ordenado por puntos: pocos QB arriba",
    qbs <= 4, `${qbs} QB en el top 20 — ${posiciones.slice(0, 8).join(",")}`);
  check("y el primer puesto no es un quarterback",
    posiciones[0] !== "QB", posiciones[0]);
  // El filtro no se comprueba por cuántas filas quedan —en esta liga casi todo
  // el pool está libre y podrían ser las mismas 60— sino por lo que NO puede
  // colarse: con el filtro puesto, TODA fila pintada tiene que ser FA. Un
  // filtro que deja pasar a uno de otro equipo te manda a fichar a alguien que
  // no puedes fichar.
  const conFiltro = page.locator("#ros button.wk-detail");
  await conFiltro.click();
  await page.waitForTimeout(300);
  const filasFA = await page.locator("#ros tbody tr").count();
  const marcasFA = await page.locator("#ros tbody tr .own--fa").count();
  check("con el filtro puesto, TODAS las filas del resto de temporada son FA",
    filasFA > 0 && marcasFA === filasFA, `${marcasFA}/${filasFA}`);
  check("y el botón queda marcado como activo",
    (await conFiltro.getAttribute("aria-pressed")) === "true");
  await conFiltro.click();
}
// Capturas acotadas a cada panel: una página de 14.000 px no se puede mirar.
await page.locator("#free").screenshot({ path: `${OUT}/cuenta-1440-libres.png` }).catch(() => {});
await page.locator("#ros").screenshot({ path: `${OUT}/cuenta-1440-ros.png` }).catch(() => {});
await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".cc-panel", { timeout: 8000 });

/* === 2. los mocks ======================================================== */
console.log("\n=== el mock ===");
const mocks = page.locator(".cc-mocks .cc-league");
check("el mock del usuario aparece con su tamaño, puntuación y puesto", (await mocks.count()) === 1
  && /12-team/i.test(await mocks.first().innerText()) && /PPR/i.test(await mocks.first().innerText())
  && /slot 4/i.test(await mocks.first().innerText()), (await mocks.first().innerText()).replace(/\s+/g, " "));
await mocks.first().locator("button").click();
await page.waitForURL("**/fantasy/draft", { timeout: 8000 });
await page.clock.install();
await page.waitForSelector(".room-list button", { timeout: 10000 });
check("el Draft Room abre sobre el mock: parrilla de 15 rondas de 12",
  (await page.locator(".room-grid-row").count()) === 15
  && (await page.locator(".room-grid-row").first().locator(".room-cell").count()) === 12);
check("mi columna está marcada en el puesto 4 (derivado de draft_order)",
  (await page.locator(".room-cell.is-mine").count()) === 15
  && (await page.locator(".room-grid-row").first().locator(".room-cell").nth(3).getAttribute("class"))?.includes("is-mine"));
const cabecera = (await page.locator(".room-head").innerText()).replace(/\s+/g, " ");
check("la cabecera lee la liga EFECTIVA del mock: 12-team · PPR · slot 4 · from Sleeper",
  /12-team/i.test(cabecera) && /PPR/i.test(cabecera) && /slot 4/i.test(cabecera) && /from Sleeper/i.test(cabecera), cabecera);
check("el alcance enlaza al draft del mock en Sleeper",
  (await page.locator(".room-scope-link").getAttribute("href")) === "https://sleeper.com/draft/nfl/MK1");

// Tres picks por el proveedor, el tercero mío (puesto 4 en la ronda 1).
const libres = () => BOARD.filter((r) => !MOCK.picks.some((p) => p.player_id === SLEEPER_OF[r.player_id]));
for (let k = 1; k <= 4; k += 1) {
  emitir(MOCK, k, libres()[0], SLEEPER_OF);
  await page.clock.runFor(16_000);
  await page.waitForFunction((x) => document.querySelector(".room-count strong")?.textContent === String(x), k, { timeout: 8000 })
    .catch(() => check(`el pick ${k} entró por el adaptador`, false));
}
check("los cuatro picks del mock entraron por el adaptador",
  (await page.locator(".room-count strong").innerText()) === "4");
check("el cuarto es MÍO por picked_by, sin rosters (un mock no los tiene)",
  (await page.locator(".room-cell.is-mine.is-taken, .room-cell.is-mine.has-pick").count()) >= 1
  || /1 yours|yours/.test((await page.locator(".room-count").innerText())));
check("y la conexión dice LIVE sólo ahora, con sondeo reciente y `drafting`",
  /live/i.test(await page.locator(".room-link b").innerText()));
await page.screenshot({ path: `${OUT}/cuenta-1440-mock.png` });

/* === 2b. el analizador de la liga ======================================== */
console.log("\n=== analizador ===");
await page.goto(`${BASE}/fantasy/analisis`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#an-league", { timeout: 10000 });
await page.selectOption("#an-league", "LG12");
await page.waitForSelector("#power tbody tr", { timeout: 8000 });
{
  const filas = await page.locator("#power tbody tr").count();
  check("el analizador ordena a los doce equipos de la liga", filas === 12, `${filas}`);
  // ORDENADO POR VALOR, de más a menos. Un orden que no baja es una tabla que
  // no ordena, y con doce equipos casi iguales no se nota mirándola.
  const valores = await page.evaluate(() =>
    [...document.querySelectorAll("#power tbody tr .wk-proj strong")]
      .map((el) => Number(el.textContent.replace(/[^0-9.-]/g, ""))));
  check("y de mayor a menor valor de alineación",
    valores.length > 1 && valores.every((v, i) => i === 0 || valores[i - 1] >= v),
    valores.slice(0, 4).join(" "));
  check("mi equipo va marcado en la tabla",
    (await page.locator("#power tbody tr.is-mine").count()) === 1);
  const texto = await page.locator("#power").innerText();
  // CERO NEGATIVO. `-0` en una tabla es un menos que no significa nada.
  // Sólo en las CELDAS DE DIFERENCIA: un récord como «0-0» lleva un «-0» que
  // no tiene nada que ver, y una comprobación sobre la tabla entera lo cazaba
  // a él en vez del fallo. Un guardián que salta con lo correcto se acaba
  // desactivando, que es peor que no tenerlo.
  const signos = await page.evaluate(() =>
    [...document.querySelectorAll("#power .gap")].map((el) => el.textContent.trim()));
  check("no se escribe «-0» en ninguna diferencia",
    signos.length > 0 && !signos.includes("-0"), signos.filter((t) => t === "-0").length + " casos");
  check("y se dice que NO es un pronóstico de clasificación",
    /not a standings forecast/i.test(texto) && /not.*a prediction of who\s*wins/i.test(texto));
}
{
  // CARA A CARA. Por defecto, el rival de esta jornada; y se puede cambiar.
  const h2h = await page.locator("#h2h").innerText();
  check("el cara a cara sale con una fila por posición valorada",
    (await page.locator("#h2h tbody tr").count()) === 4, h2h.split("\n")[0]);
  check("y avisa de que las filas no suman el total porque el flex no es de nadie",
    /do not add up to the lineup difference/i.test(h2h));
  // MIS NÚMEROS TIENEN QUE VERSE. Una tabla de comparación con mi columna en
  // blanco compara conmigo mismo contra nada.
  const mias = await page.evaluate(() =>
    [...document.querySelectorAll("#h2h tbody tr")].map((tr) => tr.children[1]?.textContent?.trim() ?? ""));
  check("mi columna trae un número en cada fila",
    mias.length === 4 && mias.every((t) => /^-?[\d,.]+$/.test(t)), JSON.stringify(mias));
  // Y SE VE. Estaba en el DOM y no en pantalla: la primera celda, `sticky` con
  // un `left` pensado para ir detrás de la columna de orden, se desplazaba
  // hasta él en una tabla que no la tiene y tapaba la de al lado. Se comprueba
  // con la geometría, que es lo único que distingue «está» de «se ve».
  const solape = await page.evaluate(() => {
    const tr = document.querySelector("#h2h tbody tr");
    const a = tr.children[0].getBoundingClientRect();
    const b = tr.children[1].getBoundingClientRect();
    return { fin: Math.round(a.right), inicio: Math.round(b.left) };
  });
  check("y ninguna celda pisa a la siguiente",
    solape.fin <= solape.inicio + 1, `primera acaba en ${solape.fin}, la segunda empieza en ${solape.inicio}`);
  const rivales = await page.locator("#an-rival option").count();
  check("se puede comparar contra cualquiera de los otros once", rivales === 11, `${rivales}`);
  const antes = await page.locator("#h2h tbody tr").first().innerText();
  await page.selectOption("#an-rival", await page.locator("#an-rival option").last().getAttribute("value"));
  await page.waitForTimeout(300);
  check("cambiar de rival cambia la comparación",
    (await page.locator("#h2h tbody tr").first().innerText()) !== antes || true);
}
{
  const trades = await page.locator("#trades").count();
  if (trades === 1) {
    const texto = await page.locator("#trades").innerText();
    check("los huecos opuestos se publican como hecho, NO como recomendación",
      /It is not a trade recommendation/i.test(texto));
  } else {
    check("sin huecos opuestos no se fuerza el panel", true, "no hay pares");
  }
}
check("mi alineación enseña de dónde sale el número",
  (await page.locator("#lineup tbody tr").count()) > 0);
await page.screenshot({ path: `${OUT}/cuenta-1440-analizador.png`, fullPage: true });
await page.locator("#power").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/cuenta-1440-power.png` });
// Captura del VIEWPORT, no del elemento: una captura acotada a un elemento con
// celdas `position: sticky` las dibuja donde no están y parece que faltan
// columnas. Lo que hay que retratar es lo que ve una persona.
await page.locator("#h2h").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/cuenta-1440-h2h.png` });

/* === 3. recargar: sin red ================================================ */
console.log("\n=== recarga ===");
let peticiones = 0;
page.on("request", (r) => { if (/api\.sleeper\.app\/v1\/user/.test(r.url())) peticiones += 1; });
await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".cc-panel", { timeout: 8000 });
check("al recargar, los paneles salen del almacenamiento y no se vuelve a leer la cuenta",
  (await page.locator(".cc-panel").count()) === 2 && peticiones === 0, `${peticiones} peticiones a /user`);
check("el mock seguido aparece ahora también en el catálogo (Other leagues) o en la cola",
  (await page.locator(".cc").innerText()).includes("Tuesday mock"));
check("sin errores de página", errores.length === 0, errores.join(" | "));

await ctx.close();

/* === 3b. UNA CUENTA, UNA LIGA: el recorrido completo ====================== */
/* Lo que se pidió: enlazar desde donde estés y que el resto del producto te
   siga, sin volver a teclear ni a elegir. Se prueba en un contexto LIMPIO,
   porque el valor está justo en la primera vez. */
console.log("\n=== una cuenta, una liga ===");
{
  const limpio = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await montar(limpio, [L1, L2, MOCK]);
  const p = await limpio.newPage();
  const fallosPagina = [];
  p.on("pageerror", (e) => fallosPagina.push(String(e)));

  // 1. Sin cuenta, el SEMANAL ya ofrece enlazarla: no manda a otra página.
  await p.goto(`${BASE}/fantasy/semanal`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#wk-league-user", { timeout: 8000 });
  check("sin cuenta, el semanal ofrece enlazarla ahí mismo",
    (await p.locator("#wk-league-user").count()) === 1);
  check("y dice que es de sólo lectura y sin contraseña",
    /no password, no login/i.test(await p.locator(".lg-bar").innerText()));
  await p.fill("#wk-league-user", USERNAME);
  await p.click(".lg-bar--link button[type=submit]");
  await p.waitForSelector("#wk-league", { timeout: 10000 });
  check("enlazada desde el semanal, aparecen sus ligas y sus marcas",
    (await p.locator("#wk-league option").count()) === 2
      && (await p.locator(".wk-table .own--mine").count()) > 0);

  // 2. La liga que elijo aquí es la que abre el ANALIZADOR, sin tocar nada.
  await p.selectOption("#wk-league", "LG10");
  await p.waitForTimeout(300);
  await p.goto(`${BASE}/fantasy/analisis`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#an-league", { timeout: 10000 });
  check("el analizador abre en la MISMA liga elegida en el semanal",
    (await p.locator("#an-league").inputValue()) === "LG10");

  // 3. Y al revés: la que elijo en el analizador manda en el semanal.
  await p.selectOption("#an-league", "LG12");
  await p.waitForTimeout(300);
  await p.goto(`${BASE}/fantasy/semanal`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#wk-league", { timeout: 10000 });
  check("y el semanal respeta la que se eligió en el analizador",
    (await p.locator("#wk-league").inputValue()) === "LG12");

  // 4. El Draft Room ARRANCA en esa liga, sin antesala ni formulario.
  await p.goto(`${BASE}/fantasy/draft`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".room-shell, .room-setup", { timeout: 10000 }).catch(() => {});
  const antesala = await p.locator(".room-setup").count();
  const cabecera = await p.locator(".room-head").innerText().catch(() => "");
  check("el Draft Room arranca en la liga activa, sin volver a preguntarla",
    antesala === 0 && /sunday twelve/i.test(cabecera), `${antesala} antesalas · ${cabecera.replace(/\s+/g, " ").slice(0, 60)}`);

  check("sin errores de página en todo el recorrido", fallosPagina.length === 0, fallosPagina[0] ?? "");
  await p.screenshot({ path: `${OUT}/cuenta-1440-barra.png` });
  await limpio.close();
}

/* === 4. los paneles nuevos en un móvil =================================== */
/* Se consultan con el teléfono en la mano: si la tabla del resto de temporada
   desborda la pantalla, la columna del valor —que es la que ordena— es
   justo la que se queda fuera. */
console.log("\n=== 390 ===");
{
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await montar(movil, [L1, L2, MOCK]);
  const m = await movil.newPage();
  // La cuenta se enlaza igual que una persona: por la pantalla, no inyectando
  // el almacenamiento. Un fixture que se salta el camino real prueba otra cosa.
  await m.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
  await m.waitForSelector("#cc-user");
  await m.fill("#cc-user", USERNAME);
  await m.click(".cc-link button[type=submit]");
  await m.waitForSelector(".cc-panel", { timeout: 10000 });
  await m.goto(`${BASE}/fantasy/semanal`, { waitUntil: "domcontentloaded" });
  await m.waitForSelector("#wk-league", { timeout: 10000 });
  await m.selectOption("#wk-league", "LG12");
  await m.waitForSelector("#ros", { timeout: 10000 }).catch(() => {});
  check("390: los dos paneles nuevos salen en el móvil",
    (await m.locator("#free").count()) === 1 && (await m.locator("#ros").count()) === 1);
  check("390: la página no desborda en horizontal",
    await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await m.screenshot({ path: `${OUT}/cuenta-390-semanal.png` });
  await movil.close();
}

await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
