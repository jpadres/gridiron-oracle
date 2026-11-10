/**
 * MÓVIL: que nada se monte encima de nada.
 *
 * En una captura de 390 px el nombre «Ashton Jeanty» salía escrito ENCIMA de
 * sus etiquetas NEWS y QUESTIONABLE, y en el ranking semanal la etiqueta de
 * estado se metía dentro de la columna de proyección. Los dos son el mismo
 * fallo: contenido que no cabe en su celda y se sale, y nadie lo comprobaba
 * porque en el DOM está todo y las pruebas de contenido pasan.
 *
 * Este laboratorio mide GEOMETRÍA, que es lo único que distingue «está» de «se
 * ve»:
 *
 *   1. Ningún texto se sale de su celda (con un margen de 1 px por el redondeo).
 *   2. Dos elementos en línea de la misma celda no se solapan.
 *   3. La página no desborda a lo ancho.
 *
 * Se pasa por las pantallas con tablas densas, que son donde esto ocurre, y en
 * los dos anchos de teléfono que se usan de verdad.
 *
 *     SKIP_BUILD=1 node tools/lab/movil.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { startServer } from "./server.mjs";
import { listados } from "./tablas.mjs";
import { kickoffMs } from "../../app/gameClock.js";

import { USERNAME, crearLiga, crearMock, emitir, montar, slotOf } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4522);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SHOTS
  ?? "/tmp/claude-0/-home-user-gridiron-oracle/2ba586eb-a73c-5614-b014-9ed94d875f6d/scratchpad/shots";

const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const KICKERS = model.fantasy.specialists.kickers;
const DEFENSES = model.fantasy.specialists.defenses;
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([s, g]) => [g, s]));

if (!process.env.SKIP_BUILD) {
  await new Promise((r, j) => {
    const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
    b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`))));
  });
}
/* EL ARRANQUE, COMPARTIDO. `startServer` se NIEGA a lanzar si el puerto ya
   contesta: un `next start` huérfano de otra ejecución responde al primer
   intento y este laboratorio mediría un BUILD QUE NO ES EL SUYO — y la lectura
   equivocada culpa al producto, no al laboratorio. Se escribió el 13 de
   septiembre de 2026 y llegó sólo a `apuestas` y `reloj`: el 7 de octubre esa
   cobertura a medias produjo un rojo de `headshot-shots` que no existía. Dos
   superficies del mismo arreglo con distinta cobertura, otra vez. */
const { stop } = await startServer({ port: PORT, cwd: WEB });

const browser = await launch();
let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

/* La liga del doble, sembrada como una de verdad: sin plantillas no hay marcas
   que puedan solaparse, que es justo lo que se quiere medir. */
const ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN"];
const L1 = crearLiga({ id: "LG12", draftId: "DR12", teams: 12, roster: ROSTER, mySlot: 7,
  rounds: 15, name: "Sunday Twelve" });
const MOCK = crearMock({ draftId: "MK1", teams: 12, mySlot: 4, rounds: 15, name: "Tuesday mock" });
{
  const mios = [BOARD[0], BOARD[3], BOARD[10], DEFENSES[0], KICKERS[0]];
  let no = 1;
  for (const row of mios) {
    while (slotOf(no, 12) !== 7) no += 1;
    emitir(L1, no, row, SLEEPER_OF);
    no += 1;
  }
  /* MIS TITULARES, COMO LOS PUBLICA SLEEPER: un array alineado con
     `roster_positions` y «0» en el hueco vacío. Sin esto la pantalla de Lineups
     no tenía alineación puesta, y por tanto NUNCA un hueco congelado: al
     inyectar el fallo de «RBIN PROGRESS» este laboratorio siguió verde, porque
     la etiqueta de estado no llegaba a pintarse. Un doble que no se parece a
     una liga de verdad prueba otra cosa — séptima vez. */
  {
    const yo = L1.rosters.find((r) => r.roster_id === 7);
    const filaDe = (sid) => [...BOARD, ...DEFENSES, ...KICKERS]
      .find((r) => SLEEPER_OF[r.player_id] === sid) ?? null;
    const admite = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"],
      DEF: ["DST", "DEF"], K: ["K"] };
    const libres = new Set(yo.players);
    yo.starters = ROSTER.filter((slot) => slot !== "BN").map((slot) => {
      const sid = [...libres].find((id) =>
        (admite[slot] ?? []).includes(String(filaDe(id)?.position ?? "").toUpperCase()));
      if (!sid) return "0";
      libres.delete(sid);
      return sid;
    });
  }
  const pool = BOARD.filter((r) => SLEEPER_OF[r.player_id] && !mios.includes(r));
  let k = 0;
  for (let ronda = 1; ronda <= 9; ronda += 1) {
    for (let slot = 1; slot <= 12; slot += 1) {
      if (slot === 7) continue;
      const row = pool[k]; k += 1;
      if (!row) break;
      const roster = L1.rosters.find((r) => r.roster_id === slot);
      roster.players.push(SLEEPER_OF[row.player_id]);
      if (roster.starters.length < 6) roster.starters.push(SLEEPER_OF[row.player_id]);
    }
  }
}

/**
 * Los solapes de una pantalla, medidos en el navegador.
 *
 * Se miran las celdas de las tablas y las filas de las listas densas. Dentro de
 * cada una, se comparan los rectángulos de sus hijos EN LÍNEA: si dos se pisan
 * en horizontal Y en vertical, se están montando. Se ignora lo que esté oculto
 * o vacío, y se da 1 px de margen por el redondeo del navegador.
 */
async function solapes(page) {
  return page.evaluate(() => {
    const MARGEN = 1;
    const fuera = [];
    const encima = [];
    const texto = (el) => (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    const visible = (el) => {
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && el.getClientRects().length > 0;
    };
    /* RECTÁNGULOS POR LÍNEA, no la caja envolvente.
       Un `<span>` en línea que envuelve a dos renglones tiene UNA caja
       envolvente que cruza a sus vecinos de las dos líneas sin estar encima de
       ninguno. `getClientRects()` da un rectángulo por renglón, que es lo que
       de verdad se pinta — y lo único con lo que se puede afirmar que dos cosas
       se montan. */
    const rects = (el) => [...el.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    const cruzan = (a, b) =>
      a.left < b.right - MARGEN && b.left < a.right - MARGEN
      && a.top < b.bottom - MARGEN && b.top < a.bottom - MARGEN;
    for (const celda of document.querySelectorAll("td, .room-row, .pick, .cc-league, li")) {
      if (!visible(celda)) continue;
      const caja = celda.getBoundingClientRect();
      const hijos = [...celda.querySelectorAll(":scope > *, :scope > span > *")]
        .filter((el) => visible(el) && texto(el).length > 0
          && getComputedStyle(el).position !== "absolute");
      for (const hijo of hijos) {
        /* Sólo el eje HORIZONTAL. Un botón táctil de 44 px con margen negativo
           —el patrón que este proyecto usa para no engordar la fila— sobresale
           por arriba y por abajo A PROPÓSITO, y marcarlo sería castigar la
           regla de accesibilidad que se cumplió. Lo que rompe la lectura es
           salirse por la derecha. */
        for (const r of rects(hijo)) {
          if (r.right > caja.right + MARGEN) {
            fuera.push(`${texto(hijo)} se sale de ${texto(celda).slice(0, 24)}`);
            break;
          }
        }
      }
      for (let i = 0; i < hijos.length; i += 1) {
        for (let j = i + 1; j < hijos.length; j += 1) {
          if (hijos[i].contains(hijos[j]) || hijos[j].contains(hijos[i])) continue;
          const as = rects(hijos[i]);
          const bs = rects(hijos[j]);
          if (as.some((a) => bs.some((b) => cruzan(a, b)))) {
            encima.push(`«${texto(hijos[i])}» encima de «${texto(hijos[j])}»`);
          }
        }
      }
    }
    return { fuera: [...new Set(fuera)], encima: [...new Set(encima)] };
  });
}

/* Tres condiciones, y las dos últimas son las de la captura que lo destapó: un
   teléfono en MODO OSCURO y con el texto agrandado. Ninguna de las dos se
   probaba, y las dos cambian la geometría — el tamaño de fuente porque todo
   mide en `rem`, y el tema porque los fondos de las celdas fijas salen de él. */
const ESCENARIOS = [
  { w: 390, h: 844, tema: "light", fuente: 16 },
  { w: 360, h: 780, tema: "light", fuente: 16 },
  { w: 390, h: 844, tema: "dark", fuente: 16 },
  { w: 390, h: 844, tema: "dark", fuente: 20 },
];
for (const { w, h, tema, fuente } of ESCENARIOS) {
  console.log(`\n=== ${w} px · ${tema} · ${fuente}px ===`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, reducedMotion: "reduce", colorScheme: tema,
  });
  await ctx.addInitScript((px) => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.fontSize = `${px}px`;
    });
  }, fuente);
  await montar(ctx, [L1, MOCK]);
  // Y una banca del mes con libro: el plan, la curva y la tabla por jornada no
  // existen sin ella, así que /betting sin sembrar sólo probaría la pantalla de
  // «crea tu banca» — que es justo la que no tiene geometría densa. La caída del
  // 25% saca además el aviso de freno, que es el texto más largo de la tarjeta.
  await ctx.addInitScript(() => {
    const bets = [
      { id: "b1", status: "LOST", market: "SPREAD", label: "BUF −2.5 vs MIA", selection: "BUF",
        line: -2.5, odds: -110, stake: 2500, gameId: "g1", team: "BUF", season: 2026, week: 1,
        snapshot: { model: 4.1, market: 2.5 }, createdAt: 1, placedAt: 2, settledAt: 3 },
      { id: "b2", status: "WON", market: "PROP_REC_YDS", label: "J.Chase O78.5 receiving yards",
        selection: "OVER", line: 78.5, odds: -115, stake: 300, gameId: "g2", team: "CIN",
        season: 2026, week: 1, snapshot: { model: 86.2, market: 78.5 }, createdAt: 4, placedAt: 5, settledAt: 6 },
      { id: "b3", status: "PUSH", market: "SPREAD", label: "KC −3 vs LAC", selection: "KC",
        line: -3, odds: -110, stake: 200, gameId: "g3", team: "KC", season: 2026, week: 2,
        snapshot: { model: 3.0, market: 3.0 }, createdAt: 7, placedAt: 8, settledAt: 9 },
      { id: "b4", status: "PLACED", market: "SPREAD", label: "SF −6.5 vs SEA", selection: "SF",
        line: -6.5, odds: -110, stake: 150, gameId: "g4", team: "SF", season: 2026, week: 2,
        snapshot: { model: 8.0, market: 6.5 }, createdAt: 10, placedAt: 11, settledAt: null },
      // Y una en el SLIP: es la fila más densa de la pantalla —etiqueta larga,
      // dos campos, la cuenta en unidades y el aviso de límite— y sin ella el
      // laboratorio medía la geometría de todo menos de donde se teclea.
      { id: "b5", status: "CONSIDERING", market: "PROP_PASS_YDS",
        label: "J.Allen O267.5 passing yards", selection: "OVER", line: 267.5, odds: -115,
        stake: 400, gameId: "g5", playerId: "p1", team: "BUF", season: 2026, week: 2,
        snapshot: { model: 281.4, market: 267.5 }, createdAt: 12, placedAt: null, settledAt: null },
    ];
    try {
      localStorage.setItem("gridiron-bank-months-v1", JSON.stringify(["2026-09"]));
      localStorage.setItem("gridiron-bank-v1:2026-09", JSON.stringify({
        month: "2026-09", starting: 10000, unitIsPercent: true, unitValue: 1,
        // Un límite declarado para que el aviso de la fila del slip se pinte.
        limits: { maxStakePct: 2 }, bets,
      }));
    } catch { /* almacenamiento bloqueado: la pantalla lo cuenta por su cuenta */ }
  });
  const page = await ctx.newPage();

  // Con la cuenta enlazada: es cuando aparecen las marcas de propiedad, que son
  // las que empujaron a las de estado fuera de su sitio.
  await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#cc-user");
  await page.fill("#cc-user", USERNAME);
  await page.click(".cc-link button[type=submit]");
  await page.waitForSelector(".cc-panel", { timeout: 10000 });

  for (const url of ["/fantasy", "/fantasy/semanal", "/fantasy/resto", "/fantasy/analisis",
                     "/fantasy/lineups", "/fantasy/draft", "/fantasy/leagues", "/betting",
                     // `/salud` es una tabla de siete columnas con insignias y
                     // metadatos por fila: exactamente la forma que ya se salió
                     // de su caja en el board y en el Draft Room. Una pantalla
                     // nueva con tabla densa entra aquí el mismo día.
                     "/salud",
                     // WAIVERS NO ESTABA. Es la pantalla del listado que el
                     // dueño señaló el 10 de noviembre —texto a la derecha,
                     // contenido cortado— y este laboratorio, que existe para
                     // eso, no la recorría: entró en `smoke` y aquí no.
                     "/fantasy/waivers"]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("table, .room-row, .pick, .cc-panel, .lu-panel, .bk-plan-grid", { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const etiqueta = `${w}·${tema}·${fuente}`;
    /* PRIMERO: que lo que se quiere medir esté en pantalla. Una comprobación de
       geometría sobre una página que se quedó en su estado vacío sale VERDE sin
       haber mirado nada — el fallo del laboratorio que aprobaba el fallo que
       existía para cazar. Cada ruta declara la pieza densa que la define. */
    const EXIGIDO = {
      // El plan, el slip (donde se teclea) y el libro (donde se lee).
      "/betting": [".bk-plan-grid", ".bk-slip > li", ".bk-ledger tbody tr"],
      "/fantasy/resto": [".ros-filters .pos-option[aria-pressed]", ".rank-table tbody tr"],
      "/fantasy/semanal": [".wk-table"],
      // Con la cuenta enlazada tiene que haber un panel por liga y sus filas.
      "/fantasy/lineups": [".lu-panel", ".lu-rows > li"],
      "/fantasy": ["table"],
      // La tabla de salud, con sus filas: una comprobación de geometría sobre
      // el estado vacío de esta página saldría verde sin medir nada.
      "/salud": [".rank-table--stack tbody tr", ".grid .stat"],
      // Con cuenta: la tabla de movimientos, además de defensas y pateadores.
      "/fantasy/waivers": [".rank-table--stack tbody tr"],
    }[url] ?? [];
    for (const sel of EXIGIDO) {
      check(`${etiqueta}: ${url} — trae lo que se quiere medir (${sel})`,
        await page.locator(sel).count() > 0);
    }
    const { fuera, encima } = await solapes(page);
    check(`${etiqueta}: ${url} — nada se sale de su celda`, fuera.length === 0,
      `${fuera.length}: ${fuera.slice(0, 3).join(" | ")}`);
    check(`${etiqueta}: ${url} — nada se monta encima de nada`, encima.length === 0,
      `${encima.length}: ${encima.slice(0, 3).join(" | ")}`);
    /* Y LOS LISTADOS: que la tabla que promete caber quepa DENTRO de su
       envoltorio (el desbordamiento de página de abajo no lo ve, porque el
       envoltorio recorta), que ninguna frase vaya alineada a la derecha y que
       un chip no sea una barra. Ver `tablas.mjs`. */
    const l = await listados(page);
    check(`${etiqueta}: ${url} — las tablas apiladas caben en su hueco`, l.anchas.length === 0,
      l.anchas.slice(0, 2).join(" | "));
    check(`${etiqueta}: ${url} — ninguna frase alineada a la derecha`, l.derecha.length === 0,
      `${l.derecha.length}: ${l.derecha.slice(0, 2).join(" | ")}`);
    check(`${etiqueta}: ${url} — un chip es una etiqueta, no una barra`, l.chips.length === 0,
      l.chips.slice(0, 3).join(" | "));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    // Qué lo provoca, no sólo que ocurra: sin el culpable, un desbordamiento en
    // una página larga se busca a mano durante media hora.
    const culpables = overflow ? await page.evaluate(() => {
      const ancho = document.documentElement.clientWidth;
      const malos = [];
      /* Se busca al CULPABLE, no a las víctimas. Un elemento demasiado ancho
         estira a su antepasado y entonces TODO lo que hay dentro sobresale: la
         lista de los que sobresalen se llena de enlaces del menú que no tienen
         la culpa de nada. El culpable es el que mide más que la pantalla y a
         quien nadie recorta. */
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right <= ancho + 1) continue;
        let recortado = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ov = getComputedStyle(p).overflowX;
          if (ov === "auto" || ov === "scroll" || ov === "hidden") { recortado = true; break; }
        }
        if (recortado) continue;
        malos.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} w${Math.round(r.width)} +${Math.round(r.right - ancho)} «${(el.innerText ?? "").trim().slice(0, 18)}»`);
      }
      return [...new Set(malos)].slice(0, 5);
    }) : [];
    check(`${etiqueta}: ${url} — sin desbordamiento horizontal`, !overflow, culpables.join(" | "));
    /* NINGUNA MARCA DESBORDA SU PROPIA CAJA. `.mark` es un círculo de 1 rem
       pensado para glifos de UNA letra; una etiqueta con palabras dentro que
       no suelte `width`/`height` se pinta FUERA y encima de lo de al lado. Ha
       pasado dos veces («EXEMPT LIST», «69% PRIOR») y el detector de solapes no
       lo veía porque el texto desbordado no es un elemento propio. Esto sí: se
       compara el contenido con la caja. */
    const desbordadas = await page.evaluate(() => {
      const malas = [];
      for (const m of document.querySelectorAll(".mark")) {
        if (m.scrollWidth > m.clientWidth + 1 || m.scrollHeight > m.clientHeight + 1) {
          malas.push(`${m.className} «${(m.textContent ?? "").trim().slice(0, 14)}» `
            + `${m.scrollWidth}x${m.scrollHeight} en ${m.clientWidth}x${m.clientHeight}`);
        }
      }
      return [...new Set(malas)].slice(0, 4);
    });
    check(`${etiqueta}: ${url} — ninguna marca se sale de su caja`, desbordadas.length === 0,
      desbordadas.join(" | "));

    /* LAS CELDAS FIJAS TIENEN QUE SER OPACAS. Con `background: inherit` sobre
       una fila transparente, al desplazar la tabla a lo ancho los números de la
       derecha se leen POR DEBAJO del nombre: es exactamente lo que se ve en la
       captura del dueño, y sólo pasa cuando hay desplazamiento horizontal. */
    const traslucidas = await page.evaluate(() => {
      const malas = [];
      for (const celda of document.querySelectorAll(".rank-table .rk, .rank-table .who")) {
        const bg = getComputedStyle(celda).backgroundColor;
        const alfa = /rgba?\(([^)]+)\)/.exec(bg);
        const partes = alfa ? alfa[1].split(",").map((x) => parseFloat(x)) : [];
        const donde = celda.closest("thead") ? "thead" : "tbody";
        if (partes.length === 4 && partes[3] < 0.99) malas.push(`${donde} ${celda.className} ${bg}`);
        if (bg === "transparent") malas.push(`${donde} ${celda.className} transparent`);
      }
      return [...new Set(malas)];
    });
    check(`${etiqueta}: ${url} — las columnas fijas son opacas`, traslucidas.length === 0,
      traslucidas.join(", "));
    // Las capturas se hacen en OSCURO y desplazando hasta la tabla: es como
    // llegó el informe del dueño, y una captura de la cabecera no enseña la
    // fila, que es donde estaba el fallo.
    if (fuente === 16 && tema === "dark" && w === 390) {
      await page.locator("table, .room-list, .room-roster").first()
        .scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/movil-${url.replace(/\//g, "-") || "-raiz"}.png` });
    }
  }
  await ctx.close();
}

/* === LINEUPS CON LA JORNADA EMPEZADA =======================================
   El hueco CONGELADO sólo existe cuando el partido de un titular ya ha
   arrancado, y eso depende de la hora a la que corre el laboratorio: con el
   payload recién exportado no hay ninguno, y un guardián cuyo veredicto depende
   del reloj no es un guardián (`apuestas.mjs`, 13 de septiembre). Se pisa el
   reloj a una hora después del ÚLTIMO saque que el payload publica —derivado,
   no escrito a mano— y se exige que la etiqueta de estado esté en pantalla
   antes de medir nada. */
{
  const saques = (model.predictions ?? [])
    .map((g) => kickoffMs(g)).filter((ms) => Number.isFinite(ms));
  if (saques.length === 0) throw new Error("el payload no trae saques con los que fijar el reloj");
  const FIJO = Math.max(...saques) + 3600e3;
  console.log("\n=== 390 px · tras el último saque · lineups ===");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await ctx.addInitScript(`{
    const FIJO = ${FIJO};
    const Real = Date;
    Date = class extends Real {
      constructor(...a) { return a.length ? new Real(...a) : new Real(FIJO); }
      static now() { return FIJO; }
    };
    Date.parse = Real.parse; Date.UTC = Real.UTC;
  }`);
  await montar(ctx, [L1, MOCK]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#cc-user");
  await page.fill("#cc-user", USERNAME);
  await page.click(".cc-link button[type=submit]");
  await page.waitForSelector(".cc-panel", { timeout: 10000 });
  await page.goto(`${BASE}/fantasy/lineups`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lu-rows > li", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const congelados = await page.locator(".lu-rows .lu-locked").count();
  check("lineups tras el saque — hay huecos congelados que medir (.lu-locked)", congelados > 0,
    `${congelados}`);
  const l = await listados(page);
  check("lineups tras el saque — un chip es una etiqueta, no una barra ni un contenedor",
    l.chips.length === 0, l.chips.slice(0, 3).join(" | "));
  // El estado, DENTRO del ancho de su fila: debajo del chip se salía por la
  // derecha de una columna de 52 px y se metía bajo el nombre.
  const salidos = await page.evaluate(() => [...document.querySelectorAll(".lu-rows .lu-locked")]
    .filter((el) => {
      const fila = el.closest("li").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const nombre = el.closest("li").querySelector(".mu-cell--mine")?.getBoundingClientRect();
      const pisa = nombre && r.left < nombre.right - 1 && nombre.left < r.right - 1
        && r.top < nombre.bottom - 1 && nombre.top < r.bottom - 1;
      return r.right > fila.right + 1 || r.left < fila.left - 1 || pisa;
    }).length);
  check("lineups tras el saque — el estado del partido no pisa al jugador", salidos === 0,
    `${salidos} de ${congelados}`);
  const { fuera, encima } = await solapes(page);
  check("lineups tras el saque — nada se sale ni se monta", fuera.length + encima.length === 0,
    [...fuera, ...encima].slice(0, 3).join(" | "));
  await ctx.close();
}

/* === ESCRITORIO, CON CUENTA ================================================
   El nombre del laboratorio dice «móvil», y el fallo que originó `tablas.mjs`
   era IGUAL de grave en escritorio: 1.877 px de tabla en 944. `smoke` lo mira
   en 1440 pero SIN cuenta, y la tabla de movimientos de waivers —la del
   listado— sólo existe con una liga enlazada. Una pasada corta, sólo por las
   pantallas con listados de prosa. */
{
  console.log("\n=== 1440 px · con cuenta · listados ===");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await montar(ctx, [L1, MOCK]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#cc-user");
  await page.fill("#cc-user", USERNAME);
  await page.click(".cc-link button[type=submit]");
  await page.waitForSelector(".cc-panel", { timeout: 10000 });
  for (const [url, sel, minimo] of [["/fantasy/waivers", "table.rank-table--stack", 3],
                                    ["/salud", "table.rank-table--stack", 1],
                                    ["/fantasy/lineups", ".lu-rows > li", 1]]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(sel, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const n = await page.locator(sel).count();
    check(`1440: ${url} — trae lo que se quiere medir (${sel})`, n >= minimo, `${n}, se esperaban ${minimo}`);
    const l = await listados(page);
    const malos = [...l.anchas, ...l.derecha, ...l.chips];
    check(`1440: ${url} — los listados caben y se leen desde la izquierda`, malos.length === 0,
      `${malos.length}: ${malos.slice(0, 3).join(" | ")}`);
  }
  await ctx.close();
}

await browser.close();
stop();
console.log(`\n${fallos === 0 ? "TODO VERDE" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
