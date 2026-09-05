/**
 * INTEGRIDAD DE LAS HOJAS DE ESTILO.
 *
 * El fallo que existe para cazar ocurrió de verdad: una pegada duplicó 95
 * líneas de la sección de REPLAY de `system.css` justo EN MEDIO de una regla, y
 * el comentario de la copia se tragó el selector. Lo que quedaba era
 *
 *     .room-feed .is-mine  .room-state--replay { … }    ← no casa con nada
 *     .feed-pick { color: var(--live); }                ← cola SIN cualificar
 *
 * o sea que en el ticker del Draft Room se pintaban del color de «mío» TODOS
 * los picks. La única marca que distinguía los tuyos no distinguía nada, y no
 * fallaba nada: es el fallo de los 72 raíles de equipo grises, otra vez.
 *
 * `next build` compila el CSS sin rechistar y ningún test de contenido lo ve.
 * Aquí se comprueban las dos propiedades que lo habrían cazado, y son
 * propiedades del fichero, no de esa regla concreta:
 *
 *   1. Ningún bloque de diez líneas o más aparece dos veces. Es la CAUSA.
 *   2. Ningún comentario se cuela entre un selector y su llave. Es el MECANISMO
 *      por el que la pegada dejó una regla mutilada en vez de sólo repetida.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const RAIZ = new URL("../", import.meta.url);
const HOJAS = ["app/globals.css", "app/system.css"];
const leer = (ruta) => readFileSync(new URL(ruta, RAIZ), "utf8");

/** El bloque idéntico más largo del fichero, en líneas. */
function mayorBloqueRepetido(css) {
  const L = css.split("\n").map((l) => l.trimEnd());
  // Las líneas triviales («}», vacías, un cierre de comentario) se repiten por
  // todas partes y no son señal de nada: sólo cuentan como ANCLA las que
  // tienen contenido de verdad.
  const posiciones = new Map();
  L.forEach((l, i) => {
    if (l.trim().length < 8) return;
    if (!posiciones.has(l)) posiciones.set(l, []);
    posiciones.get(l).push(i);
  });
  let mejor = { largo: 0, a: 0, b: 0 };
  for (const pos of posiciones.values()) {
    if (pos.length < 2) continue;
    for (let x = 0; x < pos.length; x += 1) {
      for (let y = x + 1; y < pos.length; y += 1) {
        const i = pos[x], j = pos[y];
        let k = 0;
        while (j + k < L.length && i + k < j && L[i + k] === L[j + k]) k += 1;
        if (k > mejor.largo) mejor = { largo: k, a: i + 1, b: j + 1 };
      }
    }
  }
  return mejor;
}

/** Selectores con un comentario metido entre el propio selector y su `{`. */
function selectoresMutilados(css) {
  const out = [];
  let desde = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "}") { desde = i + 1; continue; }
    if (css[i] !== "{") continue;
    const tramo = css.slice(desde, i);
    const abre = tramo.indexOf("/*");
    // Un comentario ANTES del selector es lo normal y es como está escrito todo
    // este proyecto. Lo que no puede pasar es que haya texto de selector y
    // DESPUÉS un comentario: ahí el comentario se comió el final de una regla.
    if (abre > 0 && tramo.slice(0, abre).trim().length > 0) {
      const linea = css.slice(0, desde + abre).split("\n").length;
      out.push(`línea ${linea}: ${tramo.slice(0, abre).trim().slice(0, 60)}…`);
    }
    desde = i + 1;
  }
  return out;
}

for (const hoja of HOJAS) {
  test(`${hoja}: ningún bloque de 10+ líneas está duplicado`, () => {
    const { largo, a, b } = mayorBloqueRepetido(leer(hoja));
    assert.ok(largo < 10,
      `${largo} líneas idénticas en ${a} y ${b}: una pegada duplicada. `
      + "La copia posterior gana en la cascada, así que editar la primera no hace nada.");
  });

  test(`${hoja}: ningún comentario parte un selector de su llave`, () => {
    const rotos = selectoresMutilados(leer(hoja));
    assert.deepEqual(rotos, [],
      "un comentario entre el selector y su { deja la regla anterior sin bloque "
      + "y fusiona dos selectores en uno que no casa con nada");
  });
}

test("la marca de MI pick en el ticker sigue cualificada", () => {
  /* La reparación concreta, además de las dos propiedades de arriba. Si alguien
     vuelve a dejar `.feed-pick { color: … }` a secas, el feed pinta de «mío»
     los picks de los doce equipos. */
  const css = leer("app/system.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const encontradas = [...css.matchAll(/([^{}]*\.feed-pick[^{}]*)\{([^}]*)\}/g)]
    .filter(([, , cuerpo]) => /color\s*:/.test(cuerpo) && /--live/.test(cuerpo))
    .map(([, selector]) => selector.trim());
  assert.ok(encontradas.length > 0, "la marca desapareció del todo");
  for (const sel of encontradas) {
    assert.match(sel, /\.is-mine/,
      `«${sel}» pinta el color de identidad sin exigir que el pick sea MÍO`);
  }
});
