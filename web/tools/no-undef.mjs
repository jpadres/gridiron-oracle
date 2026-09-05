/**
 * IDENTIFICADORES QUE NO EXISTEN, cazados antes de desplegar.
 *
 *     `next build` COMPILA UN `no-undef` SIN RECHISTAR.
 *
 * Y eso no es teoría: un refactor se llevó el `const SLEEPER` de `DraftMode.jsx`
 * y dejó cuatro `fetch` usándolo. La página de `/fantasy` se caía en render para
 * cualquiera con liga configurada y estuvo CUATRO DÍAS así, con el CI en verde,
 * porque no hay linter de JavaScript y los laboratorios entraban a esa pantalla
 * sin liga — donde el efecto no llega a ejecutarse.
 *
 * Esto no es un linter: es la comprobación concreta que faltaba, sin dependencias
 * nuevas. Mira SÓLO las interpolaciones de plantilla —`${ALGO}`— porque ahí un
 * identificador es código sin discusión, y es donde ocurrió el fallo real.
 *
 * Es deliberadamente estrecho: ante la duda NO falla. Un guardián con falsos
 * positivos acaba desactivado, y entonces no guarda nada — la lección del
 * validador de cifras, aplicada aquí antes de repetirla.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** Globales del navegador, de Node y del lenguaje que damos por existentes. */
const GLOBALES = new Set([
  "window", "document", "navigator", "location", "history", "localStorage",
  "sessionStorage", "fetch", "console", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
  "queueMicrotask", "structuredClone", "URL", "URLSearchParams", "Blob", "File",
  "FileReader", "FormData", "Headers", "Request", "Response", "AbortController",
  "Image", "Event", "CustomEvent", "MutationObserver", "IntersectionObserver",
  "ResizeObserver", "TextEncoder", "TextDecoder", "atob", "btoa", "crypto",
  "performance", "process", "globalThis", "Buffer", "__dirname", "__filename",
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math",
  "JSON", "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect", "Intl",
  "NaN", "Infinity", "undefined", "isNaN", "isFinite", "parseInt", "parseFloat",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  "ArrayBuffer", "Uint8Array", "DataView", "Function", "eval", "arguments",
  "this", "super", "React", "JSX",
]);

/** Palabras clave y nombres que aparecen en posición de identificador sin serlo. */
const PALABRAS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "function", "const", "let", "var", "class", "extends",
  "new", "delete", "typeof", "instanceof", "in", "of", "void", "throw", "try",
  "catch", "finally", "async", "await", "yield", "import", "export", "from",
  "as", "static", "get", "set", "true", "false", "null", "then", "catch",
]);

function ficheros(dir, out = []) {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre.startsWith(".")) continue;
    const completo = path.join(dir, nombre);
    if (statSync(completo).isDirectory()) ficheros(completo, out);
    else if (/\.(js|jsx|mjs)$/.test(nombre)) out.push(completo);
  }
  return out;
}

/** Quita comentarios y cadenas literales. Las plantillas se quedan: su interior
    es lo que se mira. */
function limpiar(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ");
}

const fallos = [];
for (const fichero of ficheros(path.join(RAIZ, "app")).concat(ficheros(path.join(RAIZ, "data")))) {
  const src = limpiar(readFileSync(fichero, "utf8"));
  const declarados = new Set();
  // Importados, declarados, parámetros con nombre y desestructuraciones.
  for (const m of src.matchAll(/\bimport\s+([\s\S]*?)\s+from\b/g)) {
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declarados.add(n[0]);
  }
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    declarados.add(m[1]);
  }
  // Todo lo que aparece dentro de `{...}` o `[...]` a la izquierda de un `=`,
  // más los parámetros: se recogen en bruto, que aquí sobre-declarar es seguro.
  for (const m of src.matchAll(/(?:const|let|var)\s*[[{]([^;]*?)[\]}]\s*=/g)) {
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declarados.add(n[0]);
  }
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declarados.add(n[0]);
  }
  for (const m of src.matchAll(/\bfunction\s*\w*\s*\(([^)]*)\)/g)) {
    for (const n of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) declarados.add(n[0]);
  }
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declarados.add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    declarados.add(m[1]);
  }

  /* SÓLO DENTRO DE `${...}`, y ése es todo el alcance de este guardián.
   *
   * La primera versión miraba cualquier identificador en mayúsculas del fichero
   * y sacaba CINCUENTA Y SEIS falsos positivos: `NFL`, `MAE`, `PPR`, `VOR`…
   * palabras del TEXTO JSX, que no es código. Un validador con falsos positivos
   * acaba desactivado y entonces no guarda nada — la lección del validador de
   * cifras, aplicada aquí antes de repetirla.
   *
   * Una interpolación de plantilla, en cambio, es código sin discusión: el
   * texto JSX no vive entre acentos graves. Y es exactamente donde ocurrió el
   * fallo real — `fetch(`${SLEEPER}/league/...`)` con `SLEEPER` borrado.
   *
   * No pretende ser un linter. Es una comprobación estrecha y CIERTA, que es
   * más útil que una amplia y ruidosa. */
  for (const plantilla of src.matchAll(/`(?:\\.|\$\{[^{}]*\}|[^`\\])*`/g)) {
    for (const interp of plantilla[0].matchAll(/\$\{([^{}]*)\}/g)) {
      for (const m of interp[1].matchAll(/(?<![.\w$])([A-Z][A-Z0-9_]{2,})(?![\w$]*\s*:)/g)) {
        const nombre = m[1];
        if (declarados.has(nombre) || GLOBALES.has(nombre) || PALABRAS.has(nombre)) continue;
        fallos.push(`${path.relative(RAIZ, fichero)}: ${nombre}`);
      }
    }
  }
}

const unicos = [...new Set(fallos)];
if (unicos.length > 0) {
  console.error("Identificadores usados y NO declarados ni importados:\n");
  for (const f of unicos) console.error(`  ${f}`);
  console.error("\nSi alguno es legítimo, decláralo o impórtalo — no relajes el control.");
  process.exit(1);
}
console.log("Sin identificadores huérfanos.");
