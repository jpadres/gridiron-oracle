/**
 * ¿ES ESPAÑOL? La regla, sola y sin efectos, para poder probarla.
 *
 * La usa `audit-spanish.mjs` (la puerta de CI) y tiene un gemelo en Python,
 * `oracle.narrative.sweep.looks_spanish`, que decide qué titulares de prensa se
 * publican. Dos traductores de la misma regla en dos lenguajes: hace falta —la
 * puerta corre en Node y el barrido en Python— y por eso los dos se prueban
 * contra los MISMOS casos (`tests/fixtures/spanish_cases.json`). Compartir la
 * lista de palabras no bastaba: coincidían en la lista y discrepaban en la
 * tilde, así que el barrido publicaba lo que la puerta rechazaba.
 */

// Palabras que sólo aparecen en prosa española. No sirven «no», «error» ni
// «total», que son idénticas en inglés.
export const FUNCIONALES = /\b(el|la|los|las|un|una|unos|unas|del|de|al|que|con|para|en|por|como|pero|sin|sobre|entre|cuando|donde|porque|más|menos|muy|todo|toda|todos|cada|otro|otra|este|esta|estos|estas|ese|esa|aquí|allí|hay|son|está|están|fue|ser|tiene|tienen|puede|pueden|hace|hacen|desde|hasta|aunque|también|sólo|solo|así|ya|no se|se ha|lo que)\b/gi;

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
/**
 * Frases sueltas que en una etiqueta de interfaz sólo pueden ser un fallo.
 *
 * El detector de arriba pide DOS palabras funcionales distintas, que es lo que
 * lo hace fiable en prosa y CIEGO en una etiqueta de dos palabras: «SIN EQUIPO»
 * tiene una sola («sin»), así que convivió meses con «5 LEFT», «on board» y
 * «picks until you» — la única palabra en español de la pantalla, y encima en
 * la marca que invalida el número de al lado. Lo vio un crítico mirando una
 * CAPTURA; ninguna comprobación lo miraba.
 *
 * La lista es literal y corta a propósito: cada entrada es una frase que no
 * existe en inglés. Estrecho y cierto antes que amplio y ruidoso.
 */
const FRASES_SUELTAS = [
  "SIN EQUIPO", "SIN DATOS", "SIN FECHA", "NO DISPONIBLE", "PENDIENTE",
  "JORNADA", "PLANTILLA", "LESIONADO", "TITULAR", "BANQUILLO", "PATEADOR",
];

/**
 * Una tilde es concluyente… salvo en un NOMBRE PROPIO.
 *
 * «El inglés no usa tildes» es cierto de las palabras y falso de las personas:
 * «RB Audric Estimé» es una frase en inglés. Con la tilde como prueba
 * suficiente, UNA nota de prensa con ese corredor dentro dejó esta puerta en
 * rojo en CI — y el paso de idioma va delante de los tests de JavaScript, de la
 * simulación de draft y de las cabeceras de seguridad, así que se saltaban
 * todos. Un falso positivo que apagaba seis controles.
 *
 * La palabra con tilde cuenta si NO empieza por mayúscula. Un nombre propio va
 * con mayúscula en inglés y en español; «más», «está» y «también» no. La frase
 * española de verdad sigue cayendo por las dos palabras funcionales, y la
 * etiqueta suelta por la lista literal.
 */
const PALABRA = /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]+/g;
function tildeDePalabraComun(texto) {
  for (const palabra of texto.match(PALABRA) ?? []) {
    if (!/[áéíóúñ]/.test(palabra)) continue;
    const inicial = palabra[0];
    if (inicial === inicial.toLowerCase()) return true;
  }
  return false;
}

export function esEspanol(texto) {
  let limpio = texto;
  for (const nombre of NOMBRES_PROPIOS) limpio = limpio.split(nombre).join(" ");
  // La puntuación sí es concluyente: el inglés no abre una pregunta con «¿».
  if (/[¿¡«»]/.test(limpio)) return true;
  if (tildeDePalabraComun(limpio)) return true;
  // Con FRONTERA DE PALABRA. La primera versión usaba `includes` y sacó
  // `[alineaciones, misTitulares]` —un array de variables— porque
  // «misTitulares» contiene «TITULAR». Un guardián con falsos positivos acaba
  // desactivado, y entonces no guarda nada: es la lección de `no-undef.mjs`.
  const mayus = limpio.toUpperCase();
  if (FRASES_SUELTAS.some((f) => new RegExp(`(?<![A-ZÁÉÍÓÚÑ])${f}(?![A-ZÁÉÍÓÚÑ])`).test(mayus))) {
    return true;
  }
  const aciertos = new Set((limpio.match(FUNCIONALES) ?? []).map((w) => w.toLowerCase()));
  return aciertos.size >= 2;
}
