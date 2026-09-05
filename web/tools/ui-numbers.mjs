/**
 * LOS NÚMEROS ESCRITOS A MANO EN LA INTERFAZ, con su procedencia declarada.
 *
 * Extrae cada literal numérico con aspecto de cifra medida (decimales,
 * porcentajes, «N points») del TEXTO JSX —no del código— y lo cruza con el
 * libro `docs/evidence/ui_numbers.json`. Un número que no está en el libro es
 * ROJO: puede ser una medición que nadie vigila, que es como las cifras de
 * portada acabaron siendo las de otro proyecto. El libro no demuestra que la
 * cifra sea cierta; dice de dónde sale y qué la comprueba, o dice que nada.
 *
 *   node tools/ui-numbers.mjs          → lista lo que falta en el libro
 *   node tools/ui-numbers.mjs --write  → añade lo que falta como UNVERIFIED
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = path.join(WEB, "..", "docs", "evidence", "ui_numbers.json");
const NUMBER = /(?<![\w.$/-])(\d{1,3}[.,]\d{1,4}\s?%|\b0[.,]\d{2,4}\b|\b\d{1,3}[.,]\d{1,2}\s(?:points|pts|puntos|pp)\b)(?![\w-])/g;

function* jsxFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* jsxFiles(p);
    else if (p.endsWith(".jsx")) yield p;
  }
}

/** Sólo el texto: fuera comentarios, expresiones {…} y atributos. */
function proseOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<[^>]+>/g, " ");
}

export function found() {
  const out = [];
  for (const file of jsxFiles(path.join(WEB, "app"))) {
    const rel = path.relative(WEB, file);
    const text = proseOf(readFileSync(file, "utf8"));
    for (const m of text.matchAll(NUMBER)) out.push({ file: rel, value: m[1].replace(/\s+/g, " ").trim() });
  }
  const seen = new Set();
  return out.filter((e) => { const k = `${e.file}|${e.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function ledger() {
  try { return JSON.parse(readFileSync(LEDGER, "utf8")); } catch { return { entries: [] }; }
}

export function missing() {
  const known = new Set(ledger().entries.map((e) => `${e.file}|${e.value}`));
  return found().filter((e) => !known.has(`${e.file}|${e.value}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const gaps = missing();
  if (process.argv.includes("--write")) {
    const book = ledger();
    for (const g of gaps) book.entries.push({ ...g, source: "UNVERIFIED", verified_by: null });
    book.entries.sort((a, b) => a.file.localeCompare(b.file) || a.value.localeCompare(b.value));
    writeFileSync(LEDGER, JSON.stringify(book, null, 1) + "\n");
    console.log(`${gaps.length} añadidos como UNVERIFIED`);
  } else {
    for (const g of gaps) console.log(`${g.file}  ${g.value}`);
    console.log(gaps.length ? `${gaps.length} números sin libro` : "todos los números tienen libro");
    process.exit(gaps.length ? 1 : 0);
  }
}
