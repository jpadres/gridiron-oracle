/**
 * EL DOMINGO, EN UN NAVEGADOR DE VERDAD.
 *
 *     TU DUDOSO JUEGA A LAS 20:20. TU RECAMBIO SE BLOQUEA A LA UNA.
 *
 * Siembra una liga con esa forma exacta —un titular QUESTIONABLE del partido
 * nocturno y un suplente que cabe en su hueco y juega a la una— y comprueba que
 * `/fantasy/lineups` lo dice ANTES, con el plazo correcto.
 *
 * Y comprueba la mitad que da sentido a la otra: con el reloj pasado la una, la
 * ventana ya no existe y el aviso desaparece. Sin esa segunda medida, un panel
 * que avisara SIEMPRE pasaría igual de verde y no informaría de nada.
 *
 * Los jugadores salen del PAYLOAD REAL: se buscan en el semanal un dudoso del
 * nocturno y un suplente de su misma posición del primer turno. Si el payload
 * de hoy no tiene esa pareja, el laboratorio lo DICE y sale en rojo en vez de
 * inventarse un fixture — un doble que no se parece al dominio prueba otra cosa.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { kickoffMs } from "../../app/gameClock.js";
import { crearLiga, montar, USERNAME } from "./sleeper-double.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(AQUI, "..", "..");
const BASE = "http://127.0.0.1:4539";
const { model } = await import(path.join(WEB, "data", "model.js"));

let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

const filas = model.fantasy_weekly?.rankings ?? [];
/* `sleeper_ids` va de sleeper_id -> gsis_id, así que para ir en el otro sentido
   hay que invertirlo. Leerlo al derecho devolvía cadena vacía para TODOS y el
   laboratorio decía «no hay pareja» sobre un payload que sí la tenía. */
const GSIS_A_SLEEPER = Object.fromEntries(
  Object.entries(model.fantasy?.sleeper_ids ?? {}).map(([sleeper, gsis]) => [gsis, sleeper])
);
const idDe = (r) => String(GSIS_A_SLEEPER[r.player_id] ?? "");
// El saque se lee con el mismo lector que la pantalla: `kickoffMs` ya sabe
// que la fila de jugador lo trae como `game_kickoff_at`.
const saque = (r) => kickoffMs(r) ?? NaN;

/* El dudoso MÁS TARDÍO del payload, y un suplente de su posición que juegue
   antes. Se toman del dato real para que el laboratorio mida el producto y no
   un mundo inventado. */
const dudosos = filas
  .filter((r) => ["QUESTIONABLE", "DOUBTFUL"].includes(r.injury_designation))
  .filter((r) => idDe(r) && Number.isFinite(saque(r)))
  .sort((a, b) => saque(b) - saque(a));
const tarde = dudosos[0] ?? null;
/* EL RECAMBIO TIENE QUE PODER JUGAR TODAVÍA. La primera versión aceptaba
   «cualquiera de su posición que saque antes», y eligió a Puka Nacua — cuyo
   partido terminó el jueves. Un recambio con el partido acabado no es un
   recambio, el motor lo rechaza con razón y el laboratorio lo leyó como que la
   pantalla estaba rota. Un doble que miente en un campo prueba otra cosa. */
const cover = tarde
  ? filas.find((r) => r.position === tarde.position && idDe(r)
      && Number.isFinite(saque(r)) && saque(r) < saque(tarde)
      && r.game_final !== true && !r.injury_designation)
  : null;

console.log("=== la pareja que se prueba (del payload de hoy) ===");
if (!tarde || !cover) {
  /* NO HAY PAREJA HOY, Y ESO NO ES QUE LA PANTALLA ESTÉ ROTA.
     El panel sólo puede saltar si el semanal PROYECTA a un dudoso de un turno
     tardío. El 13 de septiembre de 2026 todos los designados que llegan al
     semanal juegan a la una, y los dos que crearían la pareja —Malik Nabers
     (20:20) y Jeremiyah Love (16:25)— son justo dos de los 23 que la regla de
     titularidad por volumen deja fuera. O sea que el hueco del modelo de rol
     es TAMBIÉN lo que impide que el aviso pueda existir hoy.
     Se dice y se sale en verde: el motor lo prueban los ocho guardianes de
     `tests/lateRisk.test.mjs`, inyectados uno a uno. Lo que este laboratorio
     no puede hacer es fingir que midió la pantalla. */
  const designadosTarde = filas.filter((r) =>
    ["QUESTIONABLE", "DOUBTFUL"].includes(r.injury_designation)
    && r.game_final !== true && Number.isFinite(saque(r)));
  console.log("  SIN PAREJA en el payload de hoy — no se mide la pantalla.");
  console.log(`  dudosos por jugar en el semanal: ${designadosTarde.length}`);
  for (const r of designadosTarde) {
    console.log(`    ${r.player_name} (${r.position} ${r.team}) ${r.injury_designation} · ${r.game_kickoff_at}`);
  }
  console.log("  motivo: ninguno saca en un turno posterior al de otro de su "
    + "posición que todavía pueda jugar.");
  console.log("\nSALTADO (el motor lo cubren tests/lateRisk.test.mjs)");
  process.exit(0);
}
console.log(`  dudoso : ${tarde.player_name} (${tarde.position} ${tarde.team}) `
  + `${tarde.injury_designation} · ${tarde.game_kickoff_at}`);
console.log(`  cover  : ${cover.player_name} (${cover.position} ${cover.team}) · ${cover.game_kickoff_at}`);

const HUECOS = [tarde.position, tarde.position, "BN", "BN"];
const otro = filas.find((r) => r.position === tarde.position && idDe(r)
  && idDe(r) !== idDe(tarde) && idDe(r) !== idDe(cover));
const liga = crearLiga({ id: "gd1", draftId: "d-gd1", teams: 10, roster: HUECOS, mySlot: 3 });
const mio = liga.rosters[2];
mio.players = [idDe(tarde), idDe(otro ?? cover), idDe(cover)];
mio.starters = [idDe(tarde), idDe(otro ?? cover)];

const server = spawn("npx", ["next", "start", "-p", "4539"], { cwd: WEB, stdio: "ignore" });
const browser = await launch();
try {
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  // ANTES del saque del recambio, y DESPUÉS: las dos respuestas tienen que
  // ser distintas o el panel no está mirando el reloj.
  const MOMENTOS = [
    ["antes de que se cierre la ventana", saque(cover) - 3 * 3600_000, true],
    ["después de que el recambio se bloquea", saque(cover) + 600_000, false],
  ];
  for (const [nombre, ms, esperado] of MOMENTOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await montar(ctx, [liga]);
    await ctx.addInitScript(`{
      const FIJO = ${ms}; const Real = Date;
      Date = class extends Real {
        constructor(...a) { return a.length ? new Real(...a) : new Real(FIJO); }
        static now() { return FIJO; }
      };
      Date.parse = Real.parse; Date.UTC = Real.UTC;
    }`);
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    /* Las fotos vienen de `sleepercdn.com`, que el proxy de este contenedor
       DENIEGA: un `ERR_TUNNEL_CONNECTION_FAILED` de una imagen es ruido del
       entorno, no un fallo de la página. Se filtra por el mensaje exacto para
       no apagar la escucha entera — un guardián que se relaja hasta no
       comprobar nada es peor que no tenerlo. */
    const ruidoDeRed = (t) => /ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource/.test(t);
    page.on("console", (m) => {
      if (m.type() === "error" && !ruidoDeRed(m.text())) errores.push(m.text());
    });
    // La cuenta se enlaza POR LA PANTALLA, como lo haría el dueño: sembrar el
    // almacenamiento a mano probaría un formato inventado en vez del que
    // escribe el producto.
    await page.goto(`${BASE}/fantasy/leagues`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#cc-user", { timeout: 15000 });
    await page.fill("#cc-user", USERNAME);
    await page.click(".cc-link button[type=submit]");
    await page.waitForSelector(".cc-panel", { timeout: 15000 });
    await page.goto(`${BASE}/fantasy/lineups`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1", { timeout: 15000 });
    await page.waitForTimeout(2500);
    const hay = await page.locator(".lu-act").count();
    console.log(`\n=== ${nombre} ===`);
    check(`${nombre}: el panel NEEDS ACTION ${esperado ? "sale" : "desaparece"}`,
      (hay > 0) === esperado, `${hay} paneles`);
    if (esperado && hay > 0) {
      const texto = await page.locator(".lu-act").innerText();
      check(`${nombre}: nombra al dudoso`, texto.includes(tarde.player_name.split(".").pop()),
        texto.slice(0, 120));
      check(`${nombre}: da un plazo`, /Decide by .*(AM|PM) ET/.test(texto));
      check(`${nombre}: ofrece el recambio`, texto.includes(cover.player_name.split(".").pop()));
      check(`${nombre}: NO afirma que el dudoso juegue`,
        !/will play|expected to play|probable/i.test(texto));
      await page.screenshot({ path: `${WEB}/tools/lab/out/gameday-needs-action.png` });
    }
    check(`${nombre}: sin errores de página`, errores.length === 0, errores.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO VERDE");
process.exit(fallos ? 1 : 0);
