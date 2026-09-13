/**
 * LA FICHA DE PRENSA NO AFIRMA LO QUE NADIE COMPROBÓ.
 *
 * El fallo que existe para cazar estaba en producción y no fallaba nada:
 *
 *     const confidence = CONFIDENCE[item.confidence] ?? CONFIDENCE.rumor;
 *     <span>{IMPACT[impact] ?? IMPACT.neutro}</span>
 *
 * Un valor que el traductor no conoce —o AUSENTE— se leía «Rumor» y
 * «= Neutral». El comentario del propio fichero cuenta que ya pasó una vez con
 * los anuncios oficiales: se añadió la fila `oficial` al mapa y el respaldo se
 * quedó, así que el siguiente valor desconocido volvía a caer en «Rumor».
 *
 * Dejó de ser teórico con el barrido determinista (`narrative/sweep.py`), que
 * publica fichas SIN esos campos a propósito: sesenta noticias reales del día
 * se habrían publicado las sesenta como «Rumor · = Neutral».
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* SIN COMENTARIOS. La primera versión de este guardián salió ROJA sobre el
   código ya arreglado: el comentario que explica el fallo CITA el fallo
   —`CONFIDENCE[...] ?? CONFIDENCE.rumor`— y el patrón lo encontraba ahí. Es
   «la palabra aparece cerca» al revés: un falso POSITIVO en vez de un falso
   negativo, y un guardián con falsos positivos acaba desactivado igual. */
const leer = (f) =>
  readFileSync(new URL(`../${f}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

test("una confianza desconocida NO cae en «rumor»", () => {
  const src = leer("app/research/Briefs.jsx");
  assert.ok(!/CONFIDENCE\[[^\]]+\]\s*\?\?\s*CONFIDENCE\./.test(src),
    "el respaldo silencioso a la clasificación más floja ha vuelto: "
    + "una ficha sin juicio se publicaría afirmando uno");
  assert.match(src, /CONFIDENCE\[[^\]]+\]\s*\?\?\s*null/,
    "sin confianza declarada la ficha tiene que quedarse SIN etiqueta");
});

test("un impacto ausente no se pinta como «neutro»", () => {
  const src = leer("app/ui.jsx");
  const i = src.indexOf("export function ImpactTag(");
  assert.ok(i > 0, "ImpactTag cambió de forma: revisa este guardián");
  const cuerpo = src.slice(i, src.indexOf("\n}", i));
  assert.ok(!/IMPACT\[impact\]\s*\?\?\s*IMPACT\./.test(cuerpo),
    "«no clasificado» se está publicando como «= Neutral», que es una afirmación");
  assert.match(cuerpo, /if\s*\(!IMPACT\[impact\]\)\s*return null/,
    "sin impacto declarado no se pinta marca de impacto");
});

test("la ficha sin juicio lo DICE, en vez de callar y parecer normal", () => {
  /* No basta con quitar las etiquetas: una ficha sin ninguna marca se lee
     como una ficha corriente a la que le faltan datos. Se marca una vez. */
  const src = leer("app/research/Briefs.jsx");
  assert.match(src, /not classified/,
    "una ficha sin clasificar no se distingue de una clasificada");
  assert.match(src, /clasificada\s*\?\s*null\s*:/,
    "la marca de «no clasificada» no depende de que falte la clasificación");
});

test("la clase del artículo no se construye con un impacto que no existe", () => {
  const src = leer("app/research/Briefs.jsx");
  assert.ok(!/className=\{`note note--\$\{item\.impact\}`\}/.test(src),
    "`note--undefined` es una clase que no existe: el estilo se cae en silencio");
});
