/**
 * EL RELOJ DEL PARTIDO, EN UN NAVEGADOR DE VERDAD.
 *
 *     UN PARTIDO EN MARCHA NO SE PUEDE APOSTAR NI CAMBIAR DE HUECO.
 *
 * No se puede comprobar esperando: los trece partidos de la tarde arrancan a lo
 * largo de siete horas. Se ADELANTA el reloj de la página —`Date.now` y `new
 * Date()` en el contexto, antes de cargar nada— y se mira lo que la pantalla
 * dice en tres momentos del mismo domingo:
 *
 *   ANTES DE TODO   ningún partido cerrado salvo los que ya tienen marcador
 *   TRAS LA UNA     los de la una cerrados, los de las cuatro y veinte NO
 *   TRAS LA NOCHE   los dieciséis cerrados
 *
 * El tercer momento es el que distingue esto de un test que pasa en vacío: si
 * el reloj no se estuviera leyendo, el segundo y el tercero darían lo mismo que
 * el primero.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { startServer } from "./server.mjs";
import { hasStarted, kickoffMs } from "../../app/gameClock.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(AQUI, "..", "..");
const BASE = "http://127.0.0.1:4537";
const { model } = await import(path.join(WEB, "data", "model.js"));
const PREDICTIONS = model.predictions ?? [];
const MARKETS = model.markets ?? [];

let fallos = 0;
const check = (n, ok, d = "") => { if (!ok) fallos += 1; console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`); };

/* La expectativa sale del MISMO módulo que la pantalla. Estas dos funciones
   rehacían la comparación a mano (`ms >= Date.parse(kickoff_at)`), que es una
   segunda definición de la regla que este laboratorio existe para comprobar: si
   las dos se equivocan igual, el laboratorio sale verde sobre el fallo. */

/** Cuántos partidos han empezado a una hora dada, según el propio payload. */
function empezados(ms) {
  return PREDICTIONS.filter((g) => hasStarted(g, ms)).length;
}

/** Los mercados de esos partidos: es lo que la tabla tiene que cerrar. */
function mercadosCerrados(ms) {
  const cerrados = new Set(PREDICTIONS.filter((g) => hasStarted(g, ms)).map((g) => g.game_id));
  return MARKETS.filter((m) => cerrados.has(m.game_id)).length;
}

/* El arranque vive en `server.mjs`: comprueba que el puerto esté LIBRE antes de
   lanzar, porque engancharse a un `next start` huérfano hace que este
   laboratorio mida un build que no es el suyo — y eso ya se leyó una vez como
   «/betting no carga» con el producto sano. */
const { stop } = await startServer({ port: 4537, cwd: WEB });
const browser = await launch();
try {
  // Los tres momentos, en hora del Este: antes del primer saque, entre el de la
  // una y el de las 16:25, y después del último.
  /* LOS TRES MOMENTOS SALEN DEL PAYLOAD, NO DEL CALENDARIO DE QUIEN ESCRIBIÓ ESTO.
     Estaban clavados al 13 de septiembre de 2026 —el domingo de la jornada 1— y
     se quedaron viejos en cuanto el payload pasó a la jornada 2: los tres
     instantes caían ANTES del primer saque, así que los tres cerraban cero
     mercados, la propiedad de «respuestas crecientes» fallaba y el laboratorio
     acusaba al producto de no leer el reloj cuando lo leía perfectamente.

     Ahora se derivan de los saques que el propio payload publica: una hora antes
     del primero, entre el primero y el último, y una hora después del último. Es
     la misma corrección que ya se le hizo a `apuestas.mjs`, por la misma razón:
     un laboratorio con la fecha escrita a mano caduca solo. */
  /* El saque se lee con `kickoffMs`, no con `Date.parse` a mano: fuera de
     `gameClock.js` nadie parsea un campo de saque, y el guardián de esa regla
     —escrito el 13 de septiembre— cazó esta misma línea al escribirla. Segunda
     copia evitada en el fichero que existe para probar el reloj. */
  const saques = PREDICTIONS
    .map((g) => kickoffMs(g))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (saques.length < 2) throw new Error("el payload no trae saques con los que fijar el reloj");
  const primero = saques[0];
  const ultimo = saques[saques.length - 1];
  // El de en medio: el primer saque ESTRICTAMENTE posterior al primero, para que
  // el momento intermedio cierre unos partidos y no todos.
  const intermedio = saques.find((ms) => ms > primero) ?? ultimo;
  const MOMENTOS = [
    ["antes del primer saque", primero - 3600e3],
    ["tras el primer saque", intermedio - 60e3],
    ["tras el último", ultimo + 3600e3],
  ];
  const vistos = [];
  for (const [nombre, ms] of MOMENTOS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // El reloj se pisa ANTES de cargar: React lo lee al montar.
    await ctx.addInitScript(`{
      const FIJO = ${ms};
      const Real = Date;
      Date = class extends Real {
        constructor(...a) { return a.length ? new Real(...a) : new Real(FIJO); }
        static now() { return FIJO; }
      };
      Date.parse = Real.parse; Date.UTC = Real.UTC;
    }`);
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    await page.goto(`${BASE}/betting`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bk-start, .bk-head", { timeout: 15000 });
    if (await page.locator(".bk-start").count()) {
      await page.fill(".bk-start-form input[type=number]", "10000");
      await page.click(".bk-start-form button");
      await page.waitForSelector(".bk-head", { timeout: 8000 });
    }
    await page.waitForSelector(".bk-markets tbody tr", { timeout: 8000 });
    const marcas = await page.locator(".bk-markets tbody .mark--out").allInnerTexts();
    const cerrados = marcas.filter((t) => /FINAL|IN PROGRESS|KICKOFF UNKNOWN/i.test(t)).length;
    const esperados = mercadosCerrados(ms);
    console.log(`\n=== ${nombre} (${empezados(ms)}/${PREDICTIONS.length} partidos empezados) ===`);
    check(`${nombre}: la tabla cierra exactamente los mercados de los partidos empezados`,
      cerrados === esperados, `${cerrados} pintados / ${esperados} esperados`);
    check(`${nombre}: sin errores de página`, errores.length === 0, errores.join(" | "));
    vistos.push(cerrados);
    await ctx.close();
  }
  // LA PROPIEDAD QUE DISTINGUE ESTO DE UN TEST EN VACÍO: los tres momentos
  // tienen que dar respuestas DISTINTAS y crecientes. Con el reloj sin leer,
  // los tres darían el mismo número.
  check("el reloj se está leyendo: los tres momentos dan cierres CRECIENTES",
    vistos[0] < vistos[1] && vistos[1] < vistos[2],
    vistos.join(" -> "));
  check("al final del lunes están cerrados TODOS", vistos[2] === MARKETS.length,
    `${vistos[2]} de ${MARKETS.length}`);
} finally {
  await browser.close();
  stop();
}
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO VERDE");
process.exit(fallos ? 1 : 0);
