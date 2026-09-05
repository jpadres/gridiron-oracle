/**
 * AUDITORÍA CONTROL POR CONTROL: las doce páginas, todo lo que se puede pulsar.
 *
 * Los otros laboratorios entran hondo en una pantalla cada uno y `smoke.mjs`
 * recorre las doce comprobando que responden. Ninguno PULSA. Este sí: enumera
 * cada botón, enlace, campo y desplegable de cada página, mira su geometría
 * antes de tocarlo y lo activa de uno en uno.
 *
 * Lo que comprueba, y por qué cada cosa está aquí:
 *
 *   NOMBRE      Un control sin nombre accesible no existe para quien navega a
 *               ciegas, y casi siempre significa un icono suelto que nadie
 *               volvió a mirar. `/fantasy` tenía un submit vacío.
 *   TOQUE       44×44 en el móvil. Ya costó una iteración: «Yo»/«Fuera» medían
 *               35×29 y hacen cosas OPUESTAS — fallar el toque corrompía el
 *               estado del draft.
 *   DESBORDE    Ningún control puede salirse del ancho de la ventana.
 *   SOLAPE      Ningún control puede pisar a otro. La caza se hace por
 *               GEOMETRÍA, que es la única forma de ver lo que un test de
 *               contenido no ve nunca (la columna del cara a cara estaba en el
 *               DOM y tapada).
 *   ACTIVAR     Se pulsa cada botón AISLADO —recarga entre uno y otro— y se
 *               exige: ni excepción ni error de consola, el `h1` sigue ahí, y
 *               no aparece desbordamiento horizontal que antes no había.
 *
 * El escuchador va a `console` ADEMÁS de `pageerror`: Next atrapa el fallo de
 * un componente de cliente en su frontera de error y NO llega como `pageerror`.
 * Escuchando sólo eso, este laboratorio se quedaría verde con la página caída
 * — que es exactamente como `/fantasy` estuvo rota cuatro días.
 *
 *     SKIP_BUILD=1 node tools/lab/controles.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { USERNAME, crearLiga, crearMock, emitir, slotOf, montar } from "./sleeper-double.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 4531);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const TODAS = [
  "/", "/modelo", "/predicciones", "/betting",
  "/fantasy", "/fantasy/draft", "/fantasy/leagues", "/fantasy/semanal",
  "/fantasy/resto", "/fantasy/analisis", "/survivor", "/research",
];
/* `SOLO=/ruta,/otra` acota el recorrido. Existe para poder PROBAR LOS
   GUARDIANES inyectando su fallo sin esperar el pase entero: un guardián que no
   se puede poner rojo en un minuto acaba sin probarse, que es como se cuelan
   los que pasan en vacío. La comprobación es la MISMA; sólo cambia por dónde
   pasa. */
const PAGINAS = process.env.SOLO ? process.env.SOLO.split(",") : TODAS;

/* Los que se comportan como CONTROL y no como texto enlazado. Un enlace dentro
   de un párrafo no necesita 44 px; un botón sí, y un `summary` también porque
   es el que abre y cierra secciones enteras. Estrecho a propósito: un validador
   con falsos positivos acaba desactivado y entonces no guarda nada. */
const ES_CONTROL = `button, summary, select, input:not([type=hidden]), [role=button], [role=tab], [role=switch]`;
const TODO = `${ES_CONTROL}, a[href]`;

let fallos = 0;
const check = (ok, texto) => {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok  " : "FALLO"}  ${texto}`);
};

async function libre(b) {
  try { await fetch(b, { signal: AbortSignal.timeout(1500) }); } catch { return; }
  throw new Error(`zombi en ${b}`);
}
await libre(BASE);

if (!process.env.SKIP_BUILD) {
  console.log("construyendo…");
  await new Promise((r, j) => {
    const b = spawn("npx", ["next", "build"], { cwd: WEB, stdio: "ignore" });
    b.on("exit", (c) => (c === 0 ? r() : j(new Error(`build ${c}`))));
  });
}
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: WEB, stdio: "ignore", detached: true,
});
const stop = () => { try { process.kill(-server.pid); } catch { /* ya no está */ } };
process.on("exit", stop);
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 400));
}

const { model } = await import(path.join(WEB, "data/model.js"));
const BOARD = model.fantasy.board;
const DEFENSES = model.fantasy.specialists?.defenses ?? [];
const KICKERS = model.fantasy.specialists?.kickers ?? [];
const SLEEPER_OF = Object.fromEntries(
  Object.entries(model.fantasy.sleeper_ids).map(([sid, gsis]) => [gsis, sid]));

const browser = await chromium.launch({ executablePath: CHROME });

/** Vigila las DOS vías por las que un fallo de cliente puede llegar. */
function vigilar(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(`pageerror: ${e}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Un 404 de recurso o un aviso de red del doble no es un fallo del producto.
    if (/favicon|net::ERR|Failed to load resource/i.test(t)) return;
    errores.push(`console: ${t.slice(0, 200)}`);
  });
  return errores;
}

/** Inventario geométrico de los controles visibles. */
const INVENTARIO = `(() => {
  const CONTROL = ${JSON.stringify(ES_CONTROL)};
  const TODO = ${JSON.stringify(TODO)};
  /* LA VISIBILIDAD SE PREGUNTA AL NAVEGADOR, NO SE DEDUCE.
     (Sin acentos graves aquí: este bloque vive dentro de una plantilla.)
     La primera version de esto miraba a mano rect, display, visibility y
     opacity, y daba 136 hallazgos FALSOS. El motivo: un DETAILS CERRADO
     conserva la caja de layout de su contenido —190x44 px, display flex,
     visibility visible— y solo checkVisibility sabe que no se pinta. O sea que
     el desplegable del movil entero contaba como controles en pantalla: de ahi
     los nombres vacios (innerText si sabe que no se pinta y devuelve "") y casi
     todos los solapes.

     Un guardian con falsos positivos acaba desactivado, y este habria nacido
     desactivado. */
  const visible = (e) => {
    if (!e.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    const r = e.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const nombre = (e) => (
    e.getAttribute("aria-label")
    || (e.labels && e.labels[0] && e.labels[0].innerText)
    || e.innerText
    || e.textContent
    || e.getAttribute("title")
    || e.getAttribute("placeholder")
    || (e.getAttribute("aria-labelledby")
        && (document.getElementById(e.getAttribute("aria-labelledby")) || {}).innerText)
    || ""
  ).trim().replace(/\\s+/g, " ");
  const desc = (e) => {
    const cls = (e.className && typeof e.className === "string")
      ? "." + e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return e.tagName.toLowerCase() + (e.type ? "[" + e.type + "]" : "") + cls;
  };
  const filas = [...document.querySelectorAll(TODO)].filter(visible).map((e, i) => {
    const r = e.getBoundingClientRect();
    return {
      i, sel: desc(e), nombre: nombre(e).slice(0, 60),
      esControl: e.matches(CONTROL),
      /* LA EXCEPCION DE «DENTRO DE UNA FRASE».
         El minimo tactil de 44 px no se le exige a un control que va EN LINEA
         dentro de un texto —la propia norma lo exime— y este producto lo usa a
         proposito: «synced hace 3 min · Refresh · All leagues · Sign out» es una
         frase, y un boton de 44 px ahi la parte en tres renglones. La prueba es
         la de la norma y no una lista de clases: el padre tiene texto DE VERDAD
         fuera del control. */
      enFrase: (() => {
        /* Y UNA ETIQUETA NO ES UNA FRASE. La primera version de esta excepcion
           solo miraba «el padre tiene texto», y el padre de casi todos los
           campos es su propio LABEL —«League name» es un nodo de texto—, asi
           que la exencion desactivaba EN SILENCIO la comprobacion de 44 px en
           todos los campos del sitio. Lo destapo la inyeccion: quite el estilo
           base de los campos, quedaron a 21 px y el guardian siguio VERDE.

           El texto de un label NOMBRA al control; no lo mete en una frase. */
        const padre = e.parentElement;
        if (!padre || /^(LABEL|FIELDSET|LEGEND)$/.test(padre.tagName)) return false;
        return [...padre.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      })(),
      enNav: !!e.closest("nav, .menu, [role=navigation]"),
      x: r.x, y: r.y, w: r.width, h: r.height,
      href: e.getAttribute("href") || null,
      deshabilitado: !!e.disabled,
      opacidad: Number(getComputedStyle(e).opacity),
      fondo: getComputedStyle(e).backgroundColor,
      clases: String(e.className || ""),
      // Para el solape: sólo interesan pares que NO estén anidados.
      ruta: (() => { let p = e, s = []; while (p && s.length < 12) { s.push(p.tagName); p = p.parentElement; } return s.join(">"); })(),
    };
  });
  return {
    filas,
    anchoDoc: document.documentElement.scrollWidth,
    anchoVista: document.documentElement.clientWidth,
    h1: document.querySelectorAll("h1").length,
  };
})()`;

/** Pares de controles que se pisan, sin contar los anidados uno en otro. */
function solapes(filas) {
  const out = [];
  for (let a = 0; a < filas.length; a += 1) {
    for (let b = a + 1; b < filas.length; b += 1) {
      const A = filas[a], B = filas[b];
      const dx = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
      const dy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      // 2 px de tolerancia: un borde compartido no es un solape.
      if (dx > 2 && dy > 2) out.push([A, B, Math.round(dx), Math.round(dy)]);
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. GEOMETRÍA Y NOMBRE, en escritorio y en móvil
 * ══════════════════════════════════════════════════════════════════════════ */
const VISTAS = [
  { nombre: "1440", viewport: { width: 1440, height: 900 }, movil: false },
  { nombre: "390", viewport: { width: 390, height: 844 }, movil: true },
];

const sinNombre = [];
const pequenos = [];
const desbordan = [];
const pisan = [];
const mudos = [];   // deshabilitados que se pintan como si estuvieran activos
const sinEstilo = []; // primarios con el botón por defecto del sistema

/* El gris del agente de usuario. Si un botón que la interfaz llama PRIMARIO
   sale con este fondo, es que nadie lo vistió: `.pick--mine` declaraba sólo
   tamaño y sus tres botones —«Link», «Find» y «Connect», todo el flujo de
   Sleeper— se pintaban como un botón del sistema operativo. */
const GRIS_DEL_SISTEMA = /^rgba?\(239,\s*239,\s*239/;
const ES_PRIMARIO = /(^|\s)(pick--mine|act--primary|lg-primary|bk-primary)(\s|$)/;

/* LA MISMA ACCIÓN, UN SOLO COLOR.
   La acción principal se pintaba de tres colores según la pantalla: negro en
   /betting, ámbar en fantasy y azul en la barra de cuenta. Ninguno era un error
   por separado; juntos son tres respuestas a la misma pregunta, y dos de ellos
   gastaban un color que ya significaba otra cosa (`--live` es identidad,
   `--accent` es el color de los enlaces).

   `.act--mine` queda FUERA de este conteo a propósito: ése no es un primario,
   es la marca de «este pick es mío», y su pareja es `.act--gone`. */
const coloresPrimarios = new Map();

for (const vista of VISTAS) {
  console.log(`\n=== ${vista.nombre}: geometría y nombre de cada control ===`);
  const ctx = await browser.newContext({ viewport: vista.viewport });
  const page = await ctx.newPage();
  for (const ruta of PAGINAS) {
    await page.goto(BASE + ruta, { waitUntil: "networkidle" });
    const { filas, anchoDoc, anchoVista } = await page.evaluate(INVENTARIO);

    for (const f of filas) {
      if (!f.nombre) sinNombre.push(`${vista.nombre} ${ruta} → ${f.sel}`);
      // El toque sólo se exige en el móvil y sólo a lo que se comporta como
      // control. Un enlace dentro de un párrafo no es un objetivo táctil.
      if (vista.movil && f.esControl && !f.enFrase && f.h < 44 - 0.5) {
        pequenos.push(`${ruta} → ${f.sel} «${f.nombre}» ${Math.round(f.w)}×${Math.round(f.h)}`);
      }
      if (f.x + f.w > anchoVista + 1) {
        desbordan.push(`${vista.nombre} ${ruta} → ${f.sel} «${f.nombre}» hasta ${Math.round(f.x + f.w)} de ${anchoVista}`);
      }
      /* UN CONTROL DESHABILITADO TIENE QUE VERSE DESHABILITADO. Nueve del
         producto se deshabilitan por estado y sólo tres lo decían; el peor era
         «Link» en /fantasy/leagues, idéntico a un botón activo con el campo
         vacío. Pulsar y que no pase nada se lee como pantalla rota. */
      if (f.deshabilitado && f.opacidad >= 0.99) {
        mudos.push(`${vista.nombre} ${ruta} → ${f.sel} «${f.nombre}» deshabilitado y opaco al 100%`);
      }
      if (ES_PRIMARIO.test(f.clases) && GRIS_DEL_SISTEMA.test(f.fondo)) {
        sinEstilo.push(`${vista.nombre} ${ruta} → ${f.sel} «${f.nombre}» con el fondo del sistema (${f.fondo})`);
      }
      if (ES_PRIMARIO.test(f.clases) && !vista.movil) {
        if (!coloresPrimarios.has(f.fondo)) coloresPrimarios.set(f.fondo, []);
        coloresPrimarios.get(f.fondo).push(`${ruta} «${f.nombre}»`);
      }
    }
    for (const [A, B, dx, dy] of solapes(filas)) {
      pisan.push(`${vista.nombre} ${ruta} → ${A.sel} «${A.nombre}» pisa ${B.sel} «${B.nombre}» (${dx}×${dy} px)`);
    }
    if (anchoDoc > anchoVista + 1) {
      desbordan.push(`${vista.nombre} ${ruta} → LA PÁGINA desborda: ${anchoDoc} > ${anchoVista}`);
    }
  }
  await ctx.close();
}

check(sinNombre.length === 0, `todo control tiene nombre accesible — ${sinNombre.length} sin él`);
for (const s of sinNombre.slice(0, 12)) console.log(`        · ${s}`);
check(pequenos.length === 0, `en 390 ningún control baja de 44 px de alto — ${pequenos.length} por debajo`);
for (const s of pequenos.slice(0, 20)) console.log(`        · ${s}`);
check(desbordan.length === 0, `ningún control se sale del ancho — ${desbordan.length} se salen`);
for (const s of desbordan.slice(0, 12)) console.log(`        · ${s}`);
check(pisan.length === 0, `ningún control pisa a otro — ${pisan.length} pares`);
for (const s of pisan.slice(0, 12)) console.log(`        · ${s}`);
check(mudos.length === 0, `lo deshabilitado se ve deshabilitado — ${mudos.length} mudos`);
for (const s of mudos.slice(0, 12)) console.log(`        · ${s}`);
check(sinEstilo.length === 0, `ningún primario sale con el botón del sistema — ${sinEstilo.length}`);
for (const s of sinEstilo.slice(0, 12)) console.log(`        · ${s}`);
check(coloresPrimarios.size === 1,
  `la acción principal tiene UN color en todo el producto — ${coloresPrimarios.size}`);
for (const [color, donde] of coloresPrimarios) {
  console.log(`        · ${color}: ${donde.slice(0, 4).join(", ")}`);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. TODO ENLACE INTERNO RESPONDE
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("\n=== todos los enlaces internos de todas las páginas ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const destinos = new Map();
  for (const ruta of PAGINAS) {
    await page.goto(BASE + ruta, { waitUntil: "networkidle" });
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
    for (const h of hrefs) {
      if (!h || h.startsWith("http") || h.startsWith("mailto:")) continue;
      const limpio = h.split("#")[0] || "/";
      if (!destinos.has(limpio)) destinos.set(limpio, ruta);
    }
  }
  const rotos = [];
  for (const [destino, desde] of destinos) {
    const r = await fetch(BASE + destino).catch(() => null);
    if (!r || !r.ok) rotos.push(`${destino} (desde ${desde}) → ${r ? r.status : "sin respuesta"}`);
  }
  check(rotos.length === 0, `los ${destinos.size} destinos internos responden — ${rotos.length} rotos`);
  for (const s of rotos) console.log(`        · ${s}`);
  await ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. PULSAR CADA BOTÓN, AISLADO
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("\n=== se pulsa cada botón, uno por uno, recargando entre medias ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errores = vigilar(page);
  const rotos = [];
  let pulsados = 0;

  for (const ruta of PAGINAS) {
    await page.goto(BASE + ruta, { waitUntil: "networkidle" });
    const n = await page.locator("button:visible, summary:visible").count();
    for (let i = 0; i < n; i += 1) {
      await page.goto(BASE + ruta, { waitUntil: "networkidle" });
      errores.length = 0;
      const control = page.locator("button:visible, summary:visible").nth(i);
      if ((await control.count()) === 0) continue;
      const etiqueta = ((await control.innerText().catch(() => "")) || "(sin texto)")
        .trim().replace(/\s+/g, " ").slice(0, 30);
      // `noWaitAfter` para que un submit que no navega no bloquee el laboratorio.
      await control.click({ timeout: 4000, noWaitAfter: true }).catch(() => {});
      await page.waitForTimeout(220);
      pulsados += 1;

      const despues = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length,
        anchoDoc: document.documentElement.scrollWidth,
        anchoVista: document.documentElement.clientWidth,
        cuerpo: document.body.innerText.trim().length,
      }));
      if (errores.length) rotos.push(`${ruta} «${etiqueta}» → ${errores[0]}`);
      if (despues.h1 === 0) rotos.push(`${ruta} «${etiqueta}» → la página se quedó SIN h1`);
      if (despues.cuerpo < 200) rotos.push(`${ruta} «${etiqueta}» → cuerpo casi vacío (${despues.cuerpo} car.)`);
      if (despues.anchoDoc > despues.anchoVista + 1) {
        rotos.push(`${ruta} «${etiqueta}» → introdujo desbordamiento (${despues.anchoDoc}>${despues.anchoVista})`);
      }
    }
  }
  check(rotos.length === 0, `${pulsados} botones pulsados sin romper nada — ${rotos.length} rotos`);
  for (const s of rotos.slice(0, 20)) console.log(`        · ${s}`);
  await ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. LA MITAD DEL PRODUCTO QUE SÓLO EXISTE CON CUENTA
 *
 * Sin cuenta enlazada, cuatro pantallas enseñan un formulario y nada más: los
 * paneles de liga, el marcado del semanal, la propiedad del resto de temporada,
 * el analizador y el Draft Room entero no llegan a existir. Auditar sólo el
 * estado de bienvenida es auditar la portada de un producto que se usa
 * enlazado — y es EXACTAMENTE el hueco por el que `/fantasy` estuvo caída
 * cuatro días: todos los laboratorios entraban sin liga, que es donde el efecto
 * roto no llegaba a ejecutarse.
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("\n=== con la cuenta de Sleeper enlazada ===");
if (process.env.SIN_CUENTA) console.log("  (saltada por SIN_CUENTA)");
else {
  const ROSTER12 = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K",
                    "BN", "BN", "BN", "BN", "BN", "BN"];
  const L1 = crearLiga({ id: "LG12", draftId: "DR12", teams: 12, roster: ROSTER12,
                         mySlot: 7, rounds: 15, name: "Sunday Twelve", scoring: { rec: 1 } });
  L1.draft.status = "complete";
  const MOCK = crearMock({ draftId: "MK1", teams: 12, mySlot: 4, rounds: 15,
                           scoringType: "ppr", name: "Tuesday mock" });

  // Plantillas de verdad en los DOCE equipos. Un doble con un solo roster
  // sembrado hace que el analizador compare contra once equipos vacíos: la
  // mediana sale cero y la pantalla se prueba en un estado que no existe.
  const mios = [BOARD[0], BOARD[3], BOARD[10], DEFENSES[0], KICKERS[0]].filter(Boolean);
  let no = 1;
  for (const row of mios) {
    while (slotOf(no, 12) !== 7) no += 1;
    emitir(L1, no, row, SLEEPER_OF);
    no += 1;
  }
  const mio = L1.rosters.find((r) => r.roster_id === 7);
  mio.starters = mio.players.slice(0, 4);
  mio.settings = { wins: 2, losses: 1, ties: 0 };
  {
    const ya = new Set(mios.map((r) => r.player_id));
    const pool = BOARD.filter((r) => !ya.has(r.player_id) && SLEEPER_OF[r.player_id]);
    let k = 0;
    for (let ronda = 1; ronda <= 9; ronda += 1) {
      for (let slot = 1; slot <= 12; slot += 1) {
        if (slot === 7) continue;
        const row = pool[k]; k += 1;
        if (!row) break;
        const r = L1.rosters.find((x) => x.roster_id === slot);
        r.players.push(SLEEPER_OF[row.player_id]);
        if (r.starters.length < 6) r.starters.push(SLEEPER_OF[row.player_id]);
        r.settings = { wins: (slot + ronda) % 4, losses: ronda % 3, ties: 0 };
      }
    }
  }

  const CON_CUENTA = ["/fantasy/leagues", "/fantasy/semanal", "/fantasy/resto",
                      "/fantasy/analisis", "/fantasy"];
  const malos = { sinNombre: [], pequenos: [], desbordan: [], pisan: [], mudos: [] };
  const rotos = [];
  let pulsados = 0;

  for (const vista of VISTAS) {
    const ctx = await browser.newContext({ viewport: vista.viewport, reducedMotion: "reduce" });
    await montar(ctx, [L1, MOCK]);
    const page = await ctx.newPage();
    const errores = vigilar(page);

    // Se enlaza COMO UNA PERSONA, por la pantalla: inyectar el almacenamiento
    // probaría un estado que el producto quizá no sabe producir.
    await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#cc-user", { timeout: 10000 });
    await page.fill("#cc-user", USERNAME);
    await page.click(".cc-link button[type=submit]");
    await page.waitForSelector(".cc-panel", { timeout: 15000 });

    for (const ruta of CON_CUENTA) {
      await page.goto(BASE + ruta, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const { filas, anchoDoc, anchoVista } = await page.evaluate(INVENTARIO);
      for (const f of filas) {
        if (!f.nombre) malos.sinNombre.push(`${vista.nombre} ${ruta} → ${f.sel}`);
        if (vista.movil && f.esControl && !f.enFrase && f.h < 44 - 0.5) {
          malos.pequenos.push(`${ruta} → ${f.sel} «${f.nombre}» ${Math.round(f.w)}×${Math.round(f.h)}`);
        }
        if (f.x + f.w > anchoVista + 1) {
          malos.desbordan.push(`${vista.nombre} ${ruta} → ${f.sel} «${f.nombre}»`);
        }
        if (f.deshabilitado && f.opacidad >= 0.99) {
          malos.mudos.push(`${vista.nombre} ${ruta} → ${f.sel} «${f.nombre}»`);
        }
      }
      for (const [A, B, dx, dy] of solapes(filas)) {
        malos.pisan.push(`${vista.nombre} ${ruta} → ${A.sel} «${A.nombre}» pisa ${B.sel} «${B.nombre}» (${dx}×${dy})`);
      }
      if (anchoDoc > anchoVista + 1) {
        malos.desbordan.push(`${vista.nombre} ${ruta} → LA PÁGINA desborda ${anchoDoc}>${anchoVista}`);
      }
    }

    // Pulsar, sólo en escritorio: en móvil el layout cambia pero los manejadores
    // son los mismos, y recargar veinte veces por vista no añade cobertura.
    if (!vista.movil) {
      for (const ruta of CON_CUENTA) {
        await page.goto(BASE + ruta, { waitUntil: "networkidle" });
        const n = await page.locator("button:visible, summary:visible").count();
        for (let i = 0; i < n; i += 1) {
          await page.goto(BASE + ruta, { waitUntil: "networkidle" });
          await page.waitForTimeout(150);
          errores.length = 0;
          const c = page.locator("button:visible, summary:visible").nth(i);
          if ((await c.count()) === 0) continue;
          const etiqueta = ((await c.innerText().catch(() => "")) || "(sin texto)")
            .trim().replace(/\s+/g, " ").slice(0, 30);
          await c.click({ timeout: 4000, noWaitAfter: true }).catch(() => {});
          await page.waitForTimeout(250);
          pulsados += 1;
          const d = await page.evaluate(() => ({
            h1: document.querySelectorAll("h1").length,
            cuerpo: document.body.innerText.trim().length,
            anchoDoc: document.documentElement.scrollWidth,
            anchoVista: document.documentElement.clientWidth,
          }));
          if (errores.length) rotos.push(`${ruta} «${etiqueta}» → ${errores[0]}`);
          if (d.h1 === 0) rotos.push(`${ruta} «${etiqueta}» → sin h1`);
          if (d.cuerpo < 200) rotos.push(`${ruta} «${etiqueta}» → cuerpo casi vacío`);
          if (d.anchoDoc > d.anchoVista + 1) {
            rotos.push(`${ruta} «${etiqueta}» → introdujo desbordamiento`);
          }
        }
      }

      /* EL DRAFT ROOM: la pantalla más densa del producto, y la única a la que
         no se llega por URL — hay que entrar desde el mock. */
      /* SE VUELVE A ENLAZAR. El barrido de arriba pulsa TODOS los botones de
         /fantasy/leagues, y uno de ellos es «Sign out»: al llegar aquí la cuenta
         ya no estaba y el mock no podía aparecer. La primera lectura de eso fue
         «el Draft Room no se ha podido auditar», que sonaba a fallo del producto
         y era del laboratorio pisándose a sí mismo. */
      await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "networkidle" });
      if ((await page.locator("#cc-user").count()) > 0) {
        await page.fill("#cc-user", USERNAME);
        await page.click(".cc-link button[type=submit]");
        await page.waitForSelector(".cc-panel", { timeout: 15000 }).catch(() => {});
      }
      const mock = page.locator(".cc-mocks .cc-league").first();
      if (await mock.count()) {
        await mock.locator("button").first().click();
        await page.waitForURL("**/fantasy/draft", { timeout: 10000 }).catch(() => {});
        await page.waitForSelector(".room-list button", { timeout: 15000 }).catch(() => {});
        const { filas, anchoDoc, anchoVista } = await page.evaluate(INVENTARIO);
        console.log(`  (draft room: ${filas.length} controles visibles)`);
        for (const f of filas) {
          if (!f.nombre) malos.sinNombre.push(`draft-room → ${f.sel}`);
          if (f.x + f.w > anchoVista + 1) malos.desbordan.push(`draft-room → ${f.sel} «${f.nombre}»`);
        }
        for (const [A, B, dx, dy] of solapes(filas)) {
          malos.pisan.push(`draft-room → ${A.sel} «${A.nombre}» pisa ${B.sel} «${B.nombre}» (${dx}×${dy})`);
        }
        if (anchoDoc > anchoVista + 1) {
          malos.desbordan.push(`draft-room → LA PÁGINA desborda ${anchoDoc}>${anchoVista}`);
        }
        check(filas.length > 20, `el Draft Room abre con sus controles — ${filas.length}`);
      } else {
        check(false, "el mock no aparece: el Draft Room no se ha podido auditar");
      }
    }
    await ctx.close();
  }

  check(malos.sinNombre.length === 0, `con cuenta: todo control tiene nombre — ${malos.sinNombre.length} sin él`);
  for (const s of malos.sinNombre.slice(0, 12)) console.log(`        · ${s}`);
  check(malos.pequenos.length === 0, `con cuenta, en 390 ninguno baja de 44 px — ${malos.pequenos.length}`);
  for (const s of malos.pequenos.slice(0, 20)) console.log(`        · ${s}`);
  check(malos.desbordan.length === 0, `con cuenta: nada se sale del ancho — ${malos.desbordan.length}`);
  for (const s of malos.desbordan.slice(0, 12)) console.log(`        · ${s}`);
  check(malos.pisan.length === 0, `con cuenta: nada pisa a nada — ${malos.pisan.length} pares`);
  for (const s of malos.pisan.slice(0, 12)) console.log(`        · ${s}`);
  check(malos.mudos.length === 0, `con cuenta: lo deshabilitado se ve — ${malos.mudos.length} mudos`);
  for (const s of malos.mudos.slice(0, 12)) console.log(`        · ${s}`);
  check(rotos.length === 0, `con cuenta: ${pulsados} botones pulsados sin romper nada — ${rotos.length}`);
  for (const s of rotos.slice(0, 20)) console.log(`        · ${s}`);
}

await browser.close();
console.log(fallos === 0 ? "\nTODO VERDE" : `\n${fallos} COMPROBACIONES EN ROJO`);
process.exit(fallos === 0 ? 0 : 1);
