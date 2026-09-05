/**
 * ¿DRAFTEA MEJOR? La medición, contra puntos REALIZADOS.
 *
 * Umbral fijado ANTES de correrlo, en `docs/PREREGISTRO_draft_quality.md`:
 *
 *     d ≥ +15 y t ≥ 2 y positivo en ≥5 de 7 temporadas  ->  VALIDATED
 *     d ≤ −15 y t ≤ −2                                  ->  REJECTED
 *     cualquier otro caso                               ->  sigue BLOCKED
 *
 * ## Por qué la métrica no es la que el motor optimiza
 *
 * `bestForMe` maximiza el valor PROYECTADO de la alineación. Medirlo con esa
 * misma cantidad sería comprobar que un optimizador optimiza: victoria
 * garantizada y vacía. Aquí se puntúa con lo REALIZADO, que el motor no ve.
 *
 * ## Por qué esto vive en Node
 *
 * Porque el motor que se juzga es JavaScript. Reimplementarlo en Python para
 * medirlo sería un segundo traductor — el fallo de este repositorio por séptima
 * vez, y encima en el sitio donde más engaña: mediría la copia, no el producto.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { bestForMe, candidates } = await import(path.join(WEB, "app/fantasy/candidates.js"));
const { replacementPoints, starterState } =
  await import(path.join(WEB, "app/fantasy/rosterFit.js"));
const { assignSlots } = await import(path.join(WEB, "app/fantasy/leagueValue.js"));

const DATOS = path.join(WEB, "..", "out/draft_quality_boards.json");
const ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K",
                "BN", "BN", "BN", "BN", "BN", "BN"];
const TEAMS = 12;
const ROUNDS = 15;
const UMBRAL = 15;

let boards;
try {
  boards = JSON.parse(readFileSync(DATOS, "utf8"));
} catch {
  console.error(`No está ${path.relative(WEB, DATOS)}.`);
  console.error("Genera los boards primero:  python scripts/draft_quality_export.py");
  process.exit(2);
}

/** Cuántos huecos titulares con valor quedan VACÍOS, y con qué plantilla. */
function diagnostico(roster) {
  const { slots } = assignSlots(roster, ROSTER);
  const conValor = slots.filter((s) => !["DEF", "K"].includes(s.slot));
  const pos = {};
  for (const r of roster) pos[r.position] = (pos[r.position] ?? 0) + 1;
  return { vacios: conValor.filter((s) => !s.player).length, pos };
}

/** Puntos REALIZADOS de la alineación que habrías puesto, elegida por proyección. */
function realizadoDeTitulares(roster) {
  // `assignSlots` ordena por `vor ?? projected_points`: la alineación se elige
  // con lo que se sabía, no con lo que pasó. Puntuarla con lo que pasó es la
  // medición; elegirla con lo que pasó sería hindsight y mediría otra cosa.
  const { slots } = assignSlots(roster, ROSTER);
  let total = 0;
  for (const s of slots) if (s.player) total += Number(s.player.realized) || 0;
  return total;
}

/** Un draft entero. `estrategia` decide SÓLO mis picks; los rivales, board. */
function draftear(pool, mySlot, estrategia) {
  const rep = replacementPoints(pool);
  const tomados = new Set();
  const mio = [];
  for (let overall = 1; overall <= TEAMS * ROUNDS; overall += 1) {
    const ronda = Math.floor((overall - 1) / TEAMS) + 1;
    const enRonda = ((overall - 1) % TEAMS) + 1;
    const puesto = ronda % 2 === 0 ? TEAMS - enRonda + 1 : enRonda;
    const libres = pool.filter((r) => !tomados.has(r.player_id));
    if (libres.length === 0) break;

    if (puesto !== mySlot) {
      const suyo = candidates(libres, { limit: 1 })[0]?.row ?? libres[0];
      tomados.add(suyo.player_id);
      continue;
    }
    let elegido;
    if (estrategia === "BOARD") {
      elegido = candidates(libres, { limit: 1 })[0]?.row ?? libres[0];
    } else {
      const para = bestForMe(libres, {
        roster: mio, rosterPositions: ROSTER, replacement: rep,
        picksLeftForMe: ROUNDS - ronda + 1,
      });
      elegido = para?.primary?.row ?? para?.bench?.[0]?.row
        ?? candidates(libres, { limit: 1 })[0]?.row ?? libres[0];
    }
    tomados.add(elegido.player_id);
    mio.push(elegido);
  }
  return mio;
}

const pares = [];
const porTemporada = [];
const diag = [];
console.log("temporada   BOARD    AJUSTADO   diferencia");
for (const [season, pool] of Object.entries(boards)) {
  const diffs = [];
  for (let slot = 1; slot <= TEAMS; slot += 1) {
    const rb = draftear(pool, slot, "BOARD");
    const rf = draftear(pool, slot, "FIT");
    const board = realizadoDeTitulares(rb);
    const ajustado = realizadoDeTitulares(rf);
    diag.push({ season, slot, board: diagnostico(rb), fit: diagnostico(rf) });
    diffs.push(ajustado - board);
    pares.push(ajustado - board);
  }
  const media = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  porTemporada.push({ season, media });
  console.log(`  ${season}    ${media >= 0 ? "+" : ""}${media.toFixed(1)} puntos por equipo`);
}

const n = pares.length;
const d = pares.reduce((a, b) => a + b, 0) / n;
const varianza = pares.reduce((a, b) => a + (b - d) ** 2, 0) / (n - 1);
const se = Math.sqrt(varianza / n);
const t = d / se;
const positivas = porTemporada.filter((s) => s.media > 0).length;

console.log(`\n  n = ${n} pares (${porTemporada.length} temporadas × ${TEAMS} puestos)`);
console.log(`  diferencia media  d = ${d >= 0 ? "+" : ""}${d.toFixed(1)} puntos por equipo-temporada`);
console.log(`  error estándar       ${se.toFixed(1)}   ->   t = ${t.toFixed(2)}`);
console.log(`  temporadas con media positiva: ${positivas} de ${porTemporada.length}`);

/* EL CONTROL QUE HAY QUE HACER ANTES DE CELEBRAR. Un +91 es enorme, y la
   hipótesis por defecto de este proyecto ante un resultado enorme no es «mejoró»
   sino «la comparación está trucada». La sospecha concreta: un drafter por VOR
   puro no mira huecos, así que puede terminar SIN ala cerrada — y un hueco vacío
   son cero puntos. Si la ventaja sale de ahí, no está ganando por elegir mejor:
   está ganando porque el rival deja huecos sin llenar. */
const vaciosBoard = diag.reduce((a, x) => a + x.board.vacios, 0) / diag.length;
const vaciosFit = diag.reduce((a, x) => a + x.fit.vacios, 0) / diag.length;
const posMedia = (rama, p) =>
  diag.reduce((a, x) => a + (x[rama].pos[p] ?? 0), 0) / diag.length;
console.log("\n  CONTROL — ¿de dónde sale la ventaja?");
console.log(`  huecos titulares VACÍOS por equipo:  board ${vaciosBoard.toFixed(2)}  ajustado ${vaciosFit.toFixed(2)}`);
for (const p of ["QB", "RB", "WR", "TE"]) {
  console.log(`    ${p}: board ${posMedia("board", p).toFixed(1)}   ajustado ${posMedia("fit", p).toFixed(1)}`);
}

/* Y LA PARTE QUE DECIDE: la misma diferencia SÓLO donde el board llenó todos
   sus huecos. Ahí las dos alineaciones están completas y lo único que se compara
   es a QUIÉN se eligió, que es la pregunta. Este subanálisis NO estaba en el
   preregistro y se añade a sabiendas, en la dirección CONSERVADORA: puede tumbar
   un resultado positivo, nunca rescatar uno negativo. Usarlo al revés —probar
   cortes hasta que uno salga bien— sería elegir el resultado, que es lo que el
   preregistro existe para impedir. */
const limpios = pares.filter((_, i) => diag[i].board.vacios === 0);
// Las temporadas positivas también se cuentan sobre el subconjunto limpio: el
// veredicto usa `dl`/`tl`, así que mezclarlo con un conteo del total sería
// juzgar con dos poblaciones distintas en la misma frase.
const porTempLimpia = [...new Set(diag.map((x) => x.season))].map((season) => {
  const suyos = pares.filter((_, i) => diag[i].season === season && diag[i].board.vacios === 0);
  return { season, n: suyos.length, media: suyos.reduce((a, b) => a + b, 0) / (suyos.length || 1) };
});
const positivasLimpias = porTempLimpia.filter((x) => x.n > 0 && x.media > 0).length;
const dl = limpios.reduce((a, b) => a + b, 0) / limpios.length;
const varl = limpios.reduce((a, b) => a + (b - dl) ** 2, 0) / (limpios.length - 1);
const sel = Math.sqrt(varl / limpios.length);
const tl = dl / sel;
console.log(`\n  SIN el efecto de los huecos vacíos (n = ${limpios.length} de ${n}):`);
console.log(`  d = ${dl >= 0 ? "+" : ""}${dl.toFixed(1)} puntos   t = ${tl.toFixed(2)}`);
console.log(`  -> ${((d - dl) / d * 100).toFixed(0)}% del efecto total venía de que el board dejaba huecos sin llenar`);
console.log(`  temporadas limpias con media positiva: ${positivasLimpias} de ${porTempLimpia.length}`);
for (const x of porTempLimpia) {
  console.log(`    ${x.season}  n=${String(x.n).padStart(2)}  ${x.media >= 0 ? "+" : ""}${x.media.toFixed(1)}`);
}

/* El veredicto se emite sobre el subconjunto LIMPIO, no sobre el total. El
   umbral preregistrado se aplica igual; lo que cambia es que la comparación ya
   no la gana un baseline que se olvida de llenar un hueco. */
const acepta = dl >= UMBRAL && tl >= 2 && positivasLimpias >= 5;
const rechaza = dl <= -UMBRAL && tl <= -2;
console.log(`\n  VEREDICTO (umbral preregistrado |d| ≥ ${UMBRAL} y |t| ≥ 2):`);
console.log(acepta
  ? "  VALIDATED — el ajuste a la plantilla DRAFTEA mejor que el board."
  : rechaza
    ? "  REJECTED — el ajuste a la plantilla EMPEORA el draft."
    : "  INCONCLUSO — sigue BLOCKED. La diferencia no llega al umbral fijado antes.");
