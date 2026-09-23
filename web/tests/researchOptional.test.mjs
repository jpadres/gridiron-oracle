/**
 * UNA SECCIÓN QUE PUEDE FALTAR NO SE DESREFERENCIA A PELO.
 *
 * `archive.consolidate` devuelve null cuando NINGUNA ficha cae dentro de la
 * ventana de 10 días, y eso es lo correcto: publicar prensa de hace dos semanas
 * como la de hoy es la regla 5 exacta. El 23 de septiembre de 2026 pasó por
 * primera vez —la ficha más nueva era del 13 y los dominios de prensa están
 * bloqueados desde este contenedor— y `/research` hacía
 * `research.window_days` sobre un null: TypeError en el PRERENDER, y con él
 * `next build` ENTERO a rojo.
 *
 * Sólo se disparaba con el archivo caducado Y el dossier lleno, porque la rama
 * de vacío pide las dos listas vacías. O sea: latente desde siempre, invisible
 * mientras hubiera prensa reciente.
 *
 * Estrecho a propósito, como `no-undef.mjs`: la expresión concreta que rompió,
 * en el fichero que rompió. Un validador con falsos positivos acaba desactivado
 * y entonces no guarda nada.
 */
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const PAGINA = "app/research/page.jsx";
const fuente = () => readFileSync(new URL(`../${PAGINA}`, import.meta.url), "utf8")
  // Los comentarios describen el fallo con sus mismas palabras y lo casarían.
  // Ya costó una versión en `Briefs.jsx` y otra en `reloj.mjs`.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

test("/research no lee window_days sobre un research que puede ser null", () => {
  const src = fuente();
  const usos = src.match(/research\.window_days/g) || [];
  if (usos.length === 0) return; // ya no se usa: nada que vigilar
  // Cada uso tiene que ir guardado en su MISMA expresión: `research ? ... : ...`
  // o encadenamiento opcional. Se mira la línea, que es donde está la condición.
  for (const linea of src.split("\n")) {
    if (!linea.includes("research.window_days")) continue;
    assert.match(
      linea,
      /research\s*\?|research\?\./,
      `«${linea.trim()}» desreferencia research sin guarda: con la ventana vacía, `
      + "esto tumba el prerender de /research y con él next build entero",
    );
  }
});

test("la rama de vacío no exige que el dossier también esté vacío para proteger", () => {
  const src = fuente();
  // El fallo latente venía de que el único camino seguro era
  // `items.length === 0 && medical.length === 0`: con dossier lleno se pasaba
  // de largo. Lo que se exige es que exista una guarda de `research` DESPUÉS de
  // esa rama, no que la rama cubra los dos casos.
  const corte = src.indexOf("medical.length === 0");
  assert.ok(corte > 0, "cambió la forma de la rama de vacío: reescribe esta prueba");
  const despues = src.slice(corte);
  assert.match(despues, /research\s*\?|research\?\./,
    "después de la rama de vacío no queda ninguna guarda sobre research");
});
