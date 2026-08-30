/**
 * Busca texto en español que pueda llegar al usuario.
 *
 * Lo difícil no es encontrar cadenas: es no engañarse. Un `grep` de acentos da
 * cero resultados en cuanto alguien escribe «Analisis» sin tilde, y da falsos
 * positivos con cada `·` y cada comentario. Este auditor busca **palabras
 * funcionales** del español —las que no se pueden evitar al escribir una frase—
 * y clasifica cada hallazgo en vez de contarlo.
 *
 * Se salta lo que NO ve el usuario: comentarios, imports y nombres de clase.
 */
import { globSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

// La raíz sale de la posición de ESTE fichero, no del directorio desde el que
// se lance. La primera versión usaba `cwd: "web"` y, ejecutada desde dentro de
// `web/`, buscaba en `web/web`: no encontraba nada y anunciaba "cero cadenas en
// español" con toda tranquilidad. Un auditor que falla en silencio es peor que
// no tenerlo, porque da permiso para dejar de mirar.
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Palabras que sólo aparecen en prosa española. No sirven «no», «error» ni
// «total», que son idénticas en inglés.
const FUNCIONALES = /\b(el|la|los|las|un|una|unos|unas|del|al|que|con|para|por|como|pero|sin|sobre|entre|cuando|donde|porque|más|menos|muy|todo|toda|todos|cada|otro|otra|este|esta|estos|estas|ese|esa|aquí|allí|hay|son|está|están|fue|ser|tiene|tienen|puede|pueden|hace|hacen|desde|hasta|aunque|también|sólo|solo|así|ya|si|no se|se ha|lo que)\b/i;

const ARCHIVOS = globSync("app/**/*.jsx", { cwd: WEB })
  .concat(globSync("data/*.js", { cwd: WEB }));
if (ARCHIVOS.length === 0) {
  // Sin ficheros no hay auditoría: reventar es la única respuesta honesta.
  throw new Error(`No se encontró ningún fichero bajo ${WEB}. Nada que auditar.`);
}
console.log(`Auditando ${ARCHIVOS.length} ficheros bajo ${WEB}\n`);

const hallazgos = [];
for (const rel of ARCHIVOS) {
  const lineas = readFileSync(path.join(WEB, rel), "utf8").split("\n");
  let enComentario = false;
  lineas.forEach((linea, i) => {
    const limpia = linea.trim();
    // Comentarios: fuera de scope por decisión del proyecto (van en español).
    if (limpia.startsWith("/*") || limpia.startsWith("/**")) enComentario = true;
    const eraComentario = enComentario;
    if (enComentario && limpia.includes("*/")) enComentario = false;
    if (eraComentario || limpia.startsWith("*") || limpia.startsWith("//")) return;
    if (limpia.startsWith("import ") || limpia.startsWith("export const metadata")) return;

    // Sólo el texto que puede acabar en pantalla: contenido entre etiquetas,
    // cadenas literales y atributos que se leen (title, aria-label, alt...).
    const candidatos = [
      ...linea.matchAll(/>([^<>{}]{4,})</g),
      ...linea.matchAll(/"([^"]{4,})"/g),
      ...linea.matchAll(/`([^`]{4,})`/g),
    ].map((m) => m[1]);

    for (const texto of candidatos) {
      if (!FUNCIONALES.test(texto)) continue;
      // Descarta rutas, clases CSS y expresiones.
      if (/^[\w./-]+$/.test(texto.trim())) continue;
      hallazgos.push({ archivo: rel, linea: i + 1, texto: texto.trim().slice(0, 90) });
    }
  });
}

if (hallazgos.length === 0) {
  console.log("JSX y data/: sin cadenas en español que puedan llegar al usuario.");
} else {
  console.log(`${hallazgos.length} candidatas en el código:\n`);
  for (const h of hallazgos) {
    console.log(`  ${h.archivo}:${h.linea}`);
    console.log(`     ${h.texto}`);
  }
}

/* ------------------------------------------------------------------------- *
 * Segunda pasada: el payload.
 *
 * Auditar sólo los `.jsx` deja fuera la mitad del texto que se lee en pantalla.
 * Las etiquetas de riesgo, el consejo de survivor o el mercado de una apuesta
 * los escribe Python y viajan dentro de `model.b64.js`, que a la vista es un
 * bloque de base64: el auditor de arriba lo mira y no ve nada. Anunciar «cero
 * cadenas en español» con esa cobertura es exactamente el fallo que este
 * fichero existe para no cometer.
 *
 * Se clasifica por ruta y no por contenido, con lista blanca. Una ruta nueva
 * que traiga texto y no esté declarada **rompe la auditoría**: es la única
 * forma de que añadir un campo al payload no abra un agujero en silencio.
 * ------------------------------------------------------------------------- */

// Copy que escribimos nosotros y se pinta tal cual. Tiene que estar en inglés.
const COPY = new Set([
  ".bets[].evidence_label", ".bets[].evidence_verdict", ".bets[].market",
  ".fantasy.board[].bust_label", ".fantasy.board[].risk_label",
  ".fantasy.board[].risk_reasons[]", ".dossier.gap[].risk_label",
  ".research.today[].label", ".separation_bands[].wording",
  ".separation_bands[].confidence", ".survivor.board[].advice",
  ".survivor.board[].advice_why", ".survivor.short_board[].advice",
  ".survivor.short_board[].advice_why", ".validation.calibration[].bin",
  ".fantasy.scoring", ".fantasy_weekly.scoring",
]);

// Datos: nombres propios, códigos, fechas, y la prosa ajena que se cita con su
// fuente. No se traduce porque no es nuestra: el dossier está curado a mano y
// las fichas de research resumen lo que publicó otro. El barrido diario ya
// genera en inglés (`narrative/research.py`), así que esto se vacía solo según
// vayan entrando fichas nuevas; reescribir las viejas sería inventar una cita.
const DATOS = new Set([
  ".bets[].game_id", ".bets[].matchup", ".bets[].selection",
  ".dossier.ambiguous[][]", ".dossier.generated", ".dossier.sources_books[]",
  ".fantasy.board[].player_full_name", ".fantasy.board[].player_id",
  ".fantasy.board[].player_name", ".fantasy.board[].position",
  ".fantasy.board[].previous_team", ".fantasy.board[].team",
  ".fantasy.validation[].position", ".predictions[].away_team",
  ".predictions[].game_id", ".predictions[].home_team", ".ratings[].team",
]);
// Los prefijos que son datos enteros, para no listar campo por campo.
const DATOS_PREFIJOS = [
  ".dossier.camp[]", ".dossier.gap[].analysis", ".dossier.gap[].consensus_risk",
  ".dossier.gap[].player", ".dossier.gap[].position", ".dossier.gap[].team",
  ".dossier.medical[]", ".dossier.reporters[]", ".dossier.sleepers[]",
  ".dossier.sources[]", ".dossier.strategy[]", ".dossier.teams[]",
  ".fantasy_weekly.rankings[]", ".research.items[]", ".survivor.board[].opponent",
  ".survivor.board[].plan[]", ".survivor.board[].team", ".survivor.plan[]",
  ".survivor.short_board[].opponent", ".survivor.short_board[].plan[]",
  ".survivor.short_board[].team", ".survivor.short_plan[]",
];
// Las fichas de research repiten los campos de datos en `today`; el único que
// escribimos nosotros (`label`) ya está declarado arriba como COPY.
const DATOS_RESEARCH_TODAY = [
  "beat", "category", "confidence", "date", "headline", "icon", "impact", "kind",
  "player_ids[]", "players[]", "published", "source_type", "summary", "team",
  "sources[].outlet", "sources[].title", "sources[].url",
].map((campo) => `.research.today[].${campo}`);

/* El registro de capacidades viaja al payload pero **no lo pinta ninguna
 * página**: es la fuente de verdad de qué puede afirmar la interfaz, y hoy sólo
 * la leen los tests. Se avisa en vez de fallar, y el aviso dice qué lo cierra:
 * el bloque D de V2, que es el que lo saca a pantalla, tiene que traducirlo
 * antes de renderizarlo. Sin ese aviso, sacarlo a pantalla publicaría prosa en
 * español dentro de una interfaz en inglés y nadie se enteraría. */
const PENDIENTES_PREFIJOS = [".capabilities"];

function rutasDeTexto(valor, ruta = "", salida = []) {
  if (Array.isArray(valor)) {
    for (const item of valor) rutasDeTexto(item, `${ruta}[]`, salida);
  } else if (valor && typeof valor === "object") {
    for (const [clave, item] of Object.entries(valor)) {
      rutasDeTexto(item, `${ruta}.${clave}`, salida);
    }
  } else if (typeof valor === "string") {
    salida.push([ruta, valor]);
  }
  return salida;
}

const fuenteB64 = readFileSync(path.join(WEB, "data/model.b64.js"), "utf8");
const base64 = fuenteB64.match(/"([A-Za-z0-9+/=]{100,})"/)?.[1];
if (!base64) throw new Error("No se pudo extraer el base64 de data/model.b64.js.");
const payload = JSON.parse(gunzipSync(Buffer.from(base64, "base64")).toString("utf8"));

const datos = new Set([...DATOS, ...DATOS_RESEARCH_TODAY]);
const esPrefijo = (ruta, lista) => lista.some((pre) => ruta.startsWith(pre));

const fallosPayload = [];
const pendientes = new Set();
const sinClasificar = new Set();
for (const [ruta, texto] of rutasDeTexto(payload)) {
  if (datos.has(ruta) || esPrefijo(ruta, DATOS_PREFIJOS)) continue;
  if (esPrefijo(ruta, PENDIENTES_PREFIJOS)) {
    if (FUNCIONALES.test(texto)) pendientes.add(ruta);
    continue;
  }
  if (!COPY.has(ruta)) {
    sinClasificar.add(ruta);
    continue;
  }
  if (FUNCIONALES.test(texto)) fallosPayload.push({ ruta, texto: texto.slice(0, 90) });
}

console.log(`\nPayload: ${rutasDeTexto(payload).length} cadenas revisadas.`);
if (sinClasificar.size > 0) {
  console.log(`\n${sinClasificar.size} rutas de texto SIN CLASIFICAR (declárelas en COPY o en DATOS):`);
  for (const ruta of [...sinClasificar].sort()) console.log(`  ${ruta}`);
}
if (fallosPayload.length > 0) {
  console.log(`\n${fallosPayload.length} cadenas en español en copy que SÍ se pinta:`);
  for (const f of fallosPayload) console.log(`  ${f.ruta}\n     ${f.texto}`);
}
if (pendientes.size > 0) {
  console.log(`\nAVISO — ${pendientes.size} rutas del registro de capacidades siguen en español.`);
  console.log("  No las pinta ninguna página hoy. El bloque D de V2 tiene que");
  console.log("  traducirlas ANTES de sacarlas a pantalla.");
  for (const ruta of [...pendientes].sort()) console.log(`    ${ruta}`);
}
if (fallosPayload.length === 0 && sinClasificar.size === 0) {
  console.log("\nPayload: sin español en el copy que se pinta.");
}

const total = hallazgos.length + fallosPayload.length + sinClasificar.size;
process.exit(total === 0 ? 0 : 1);
