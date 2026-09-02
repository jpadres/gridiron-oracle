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
const FUNCIONALES = /\b(el|la|los|las|un|una|unos|unas|del|de|al|que|con|para|en|por|como|pero|sin|sobre|entre|cuando|donde|porque|más|menos|muy|todo|toda|todos|cada|otro|otra|este|esta|estos|estas|ese|esa|aquí|allí|hay|son|está|están|fue|ser|tiene|tienen|puede|pueden|hace|hacen|desde|hasta|aunque|también|sólo|solo|así|ya|no se|se ha|lo que)\b/gi;

/**
 * Nombres propios que el detector confundiría con español.
 *
 * «Las Vegas is rebuilding…» dispara con «Las»; «Rams On SI» disparaba con «si»
 * —Sports Illustrated—, y por eso «si» salió de la lista de arriba. Un guardián
 * que da falsos positivos con nombres de equipo y de medio acaba desactivado, y
 * entonces no guarda nada. Se quitan por sustitución exacta, no por heurística.
 */
const NOMBRES_PROPIOS = [
  "Las Vegas", "Los Angeles", "Los Angeles Times", "La Crosse",
  "De La Cruz", "Von Miller", "Del Rio",
  // Apellidos y nombres con partícula que dispararían con «de»: se quitan por
  // nombre exacto, no relajando el detector.
  "De'Von", "DeVon", "De'Zhaun", "DeAndre", "D'Andre", "Deebo",
];

/**
 * Dos aciertos, o una tilde.
 *
 * Con un solo acierto, cualquier acrónimo o apellido dispara. Con dos palabras
 * funcionales distintas la frase es española de verdad — y una tilde ya es
 * concluyente por sí sola, porque el inglés no las usa.
 */
function esEspanol(texto) {
  let limpio = texto;
  for (const nombre of NOMBRES_PROPIOS) limpio = limpio.split(nombre).join(" ");
  if (/[áéíóúñ¿¡«»]/.test(limpio)) return true;
  const aciertos = new Set((limpio.match(FUNCIONALES) ?? []).map((w) => w.toLowerCase()));
  return aciertos.size >= 2;
}

// `model.b64.js` se salta aquí a propósito: es un bloque de base64 opaco, así
// que en esta pasada sólo puede dar falsos positivos. Lo audita de verdad la
// segunda pasada, que lo descomprime y clasifica ruta por ruta.
const ARCHIVOS = globSync("app/**/*.jsx", { cwd: WEB })
  .concat(globSync("data/*.js", { cwd: WEB }).filter((f) => !f.endsWith("model.b64.js")));
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
    // `{/*` además de `/*`: los comentarios JSX abren así, y sus líneas de
    // continuación no empiezan por `*`. Sin esto salían veinte falsos positivos
    // de prosa española que es exactamente lo que el proyecto quiere en los
    // comentarios — y un auditor que grita por lo correcto acaba desactivado.
    if (limpia.startsWith("/*") || limpia.startsWith("{/*")) enComentario = true;
    const eraComentario = enComentario;
    if (enComentario && (limpia.includes("*/}") || limpia.includes("*/"))) enComentario = false;
    if (eraComentario || limpia.startsWith("*") || limpia.startsWith("//")) return;
    if (limpia.startsWith("import ") || limpia.startsWith("export const metadata")) return;

    // Sólo el texto que puede acabar en pantalla: contenido entre etiquetas,
    // cadenas literales y atributos que se leen (title, aria-label, alt...).
    //
    // El tercer patrón cubre el caso que se escapó: texto JSX suelto, repartido
    // en varias líneas y con una expresión en medio —
    //
    //     Nadie disponible con «{query.trim()}». Si ya lo tachaste…
    //
    // El patrón `>…<` no lo ve porque la línea no empieza por `>` ni acaba en
    // `<`, y el de comillas tampoco porque no hay comillas. Dos cadenas en
    // español sobrevivieron así a la pasada de idioma, las dos en estados
    // condicionales. Quitando las expresiones y las etiquetas queda la prosa.
    const suelto = linea
      .replace(/\{[^{}]*\}/g, " ")
      .replace(/<[^<>]*>/g, " ")
      .replace(/^[^>]*>/, "")
      .trim();
    const candidatos = [
      ...linea.matchAll(/>([^<>{}]{4,})</g),
      ...linea.matchAll(/"([^"]{4,})"/g),
      ...linea.matchAll(/`([^`]{4,})`/g),
    ].map((m) => m[1]);
    // Una clave de objeto (`otro: "Other"`) no es prosa: la clave está en
    // español porque es dato del esquema, y el valor ya se auditó como cadena.
    const esClaveDeObjeto = /^[\w$]+:\s*["'`]/.test(suelto);
    if (suelto.length >= 8 && !/[=;(){}]/.test(suelto) && !esClaveDeObjeto) {
      candidatos.push(suelto);
    }

    for (const texto of candidatos) {
      if (!esEspanol(texto)) continue;
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
  // `.markets[]`: los mismos campos que `.bets[]`, del mismo motor, sin el filtro de stake.
  ".markets[].evidence_label", ".markets[].evidence_verdict", ".markets[].market",
  ".fantasy.board[].bust_label", ".fantasy.board[].risk_label",
  ".fantasy.board[].risk_reasons[]", ".dossier.gap[].risk_label",
  ".research.today[].label", ".separation_bands[].wording",
  ".separation_bands[].confidence", ".survivor.board[].advice",
  ".survivor.board[].advice_why", ".survivor.short_board[].advice",
  ".survivor.short_board[].advice_why", ".validation.calibration[].bin",
  ".fantasy.scoring", ".fantasy_weekly.scoring",
  // Prosa que se pinta y que antes viajaba en español. Estas cuatro rutas son
  // la regresión concreta que se vio en producción.
  ".research.items[].headline", ".research.items[].summary",
  ".research.items[].sources[].title",
  ".research.today[].headline", ".research.today[].summary",
  ".research.today[].sources[].title",
  ".dossier.medical[].status", ".dossier.medical[].situation",
  ".dossier.camp[].report",
  ".dossier.sources[].article", ".dossier.sources[].used_for",
  // Estado de disponibilidad: la etiqueta que se pinta en la fila («EXEMPT
  // LIST») y el motivo que va en el título. Lo escribimos nosotros a partir de
  // fuentes, así que es COPY y tiene que estar en inglés — es justo el sitio
  // donde una nota curada en español se colaría a la pantalla sin que nadie la
  // viera, porque sólo aparece al pasar el ratón.
  ".fantasy.board[].status_label", ".fantasy.board[].status_detail",
  ".fantasy.status_catalog.label",
  // La nota que dice de dónde sale el consenso y con qué fecha. Prosa nuestra.
  ".dossier.consensus_note",
]);

// Datos: nombres propios, códigos, fechas, y la prosa ajena que se cita con su
// fuente. No se traduce porque no es nuestra: el dossier está curado a mano y
// las fichas de research resumen lo que publicó otro. El barrido diario ya
// genera en inglés (`narrative/research.py`), así que esto se vacía solo según
// vayan entrando fichas nuevas; reescribir las viejas sería inventar una cita.
const DATOS = new Set([
  ".bets[].game_id", ".bets[].matchup", ".bets[].selection",
  ".markets[].game_id", ".markets[].matchup", ".markets[].selection",
  ".dossier.ambiguous[][]", ".dossier.generated", ".dossier.sources_books[]",
  ".fantasy.board[].player_full_name", ".fantasy.board[].player_id",
  ".fantasy.board[].player_name", ".fantasy.board[].position",
  ".fantasy.board[].previous_team", ".fantasy.board[].team",
  // Códigos de hueco de plantilla ("QB", "FLEX", "BN") y la etiqueta del modelo
  // de reemplazo ("greedy"): tokens de máquina que la interfaz traduce al pintar.
  ".fantasy.replacement_model", ".fantasy.roster[]",
  ".fantasy.validation[].position", ".predictions[].away_team",
  ".predictions[].game_id", ".predictions[].home_team", ".ratings[].team",
]);
// Los prefijos que son datos enteros, para no listar campo por campo.
const DATOS_PREFIJOS = [
  // Lo que queda exento es NOMBRE PROPIO o CÓDIGO, no prosa. La prosa del
  // dossier y del archivo de research se tradujo con `scripts/i18n_migrate.py`
  // y desde entonces se audita como copy: era la vía por la que el español
  // llegaba a la pantalla con la auditoría en verde.
  ".dossier.camp[].player", ".dossier.camp[].team", ".dossier.camp[].position",
  ".dossier.camp[].date", ".dossier.camp[].source", ".dossier.camp[].player_id",
  ".dossier.camp[].substance",
  ".dossier.gap[].analysis", ".dossier.gap[].consensus_risk",
  ".dossier.gap[].player", ".dossier.gap[].position", ".dossier.gap[].team",
  ".dossier.medical[].player", ".dossier.medical[].team", ".dossier.medical[].date",
  ".dossier.medical[].position", ".dossier.medical[].level",
  ".dossier.medical[].player_id", ".dossier.medical[].source",
  ".dossier.reporters[]", ".dossier.sleepers[]",
  // Fecha ISO del consenso multi-fuente.
  ".dossier.consensus_generated",
  ".dossier.sources[].url", ".dossier.sources[].publisher",
  ".dossier.strategy[]", ".dossier.teams[]",
  ".fantasy_weekly.rankings[]",
  // El mapa `sleeper_id` -> jugador. Son IDENTIFICADORES de dos catálogos
  // (Sleeper y nflverse) y códigos de equipo para las defensas: ni una
  // palabra que nadie lea. Se declara entero por prefijo porque las claves
  // son los propios ids y cambian con el board.
  ".fantasy.sleeper_ids",
  // Novatos: nombre propio, posición, equipo e identificadores. No es prosa.
  ".fantasy.rookies[]",
  // Estado del jugador: el CÓDIGO («EXEMPT»), la severidad («OUT»), las dos
  // fechas ISO y la fuente. Tokens de máquina y datos ajenos; la etiqueta y el
  // motivo, que sí se pintan, van declarados arriba como COPY.
  ".fantasy.board[].status", ".fantasy.board[].status_severity",
  ".fantasy.board[].status_freshness", ".fantasy.board[].status_effective_at",
  ".fantasy.board[].status_verified_at", ".fantasy.board[].status_sources[]",
  ".fantasy.status_catalog.",
  // Claves de la validación: "model" / "last_season", las bandas y la posición.
  // Son ETIQUETAS de serie, y el texto que se pinta lo pone la página en inglés.
  ".fantasy.validation[].predictor",
  ".fantasy.validation_bands[]",
  ".fantasy.validation_top_n[]",
  ".fantasy.validation_value[]",
  // Marcas de tiempo ISO de las fichas de hoy: fechas, no prosa.
  ".research.today[].published_at",
  // Pateadores y defensas del semanal, y los fichables del draft: ids GSIS o
  // sintéticos (DST_KC), nombres propios y códigos de equipo — datos, no prosa.
  ".fantasy_weekly.kickers[]", ".fantasy_weekly.defenses[]",
  ".fantasy.specialists.kickers[]", ".fantasy.specialists.defenses[]",
  // Nombres de feature del modelo («elo_diff»): identificadores del esquema
  // que la tarjeta traduce al pintar (DRIVER_LABEL en sports.jsx).
  ".predictions[].drivers[].f",
  ".research.items[].team", ".research.items[].players[]",
  ".research.items[].player_ids[]", ".research.items[].date",
  ".research.items[].published", ".research.items[].beat",
  ".research.items[].kind", ".research.items[].impact",
  ".research.items[].confidence", ".research.items[].source_type",
  // Marca de cuándo se CONFIRMÓ el hecho y con qué clase de evidencia
  // (OFFICIAL / REPORTED / OBSERVED). Fecha ISO y token de la jerarquía de la
  // regla 5, no prosa. Aparecen al reconsolidar desde `research/`, que es la
  // ruta que corre CI; la caché de `out/` no los traía — dos caminos que
  // publicaban campos distintos, que es la versión suave del fallo de los dos
  // traductores.
  ".research.items[].confirmed_at", ".research.items[].evidence_type",
  // Firma del artículo: nombre propio.
  ".research.items[].sources[].author",
  ".research.items[].sources[].url", ".research.items[].sources[].outlet",
  ".survivor.board[].opponent",
  ".survivor.board[].plan[]", ".survivor.board[].team", ".survivor.plan[]",
  ".survivor.short_board[].opponent", ".survivor.short_board[].plan[]",
  ".survivor.short_board[].team", ".survivor.short_plan[]",
  // Identidad de equipo: nombres propios, códigos de tres letras y hexadecimales.
  // «New Orleans Saints» no se traduce, y #69BE28 tampoco.
  ".teams.",
  // Nombres de los componentes canónicos: identificadores del esquema
  // (`passing_yards`), no texto que se pinte.
  ".fantasy.components[]",
];
// Las fichas de research repiten los campos de datos en `today`; el único que
// escribimos nosotros (`label`) ya está declarado arriba como COPY.
const DATOS_RESEARCH_TODAY = [
  "beat", "category", "confidence", "date", "icon", "impact", "kind",
  "player_ids[]", "players[]", "published", "source_type", "team",
  "sources[].outlet", "sources[].url", "sources[].author",
  "confirmed_at", "evidence_type",
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
    if (esEspanol(texto)) pendientes.add(ruta);
    continue;
  }
  if (!COPY.has(ruta)) {
    sinClasificar.add(ruta);
    continue;
  }
  if (esEspanol(texto)) fallosPayload.push({ ruta, texto: texto.slice(0, 90) });
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
