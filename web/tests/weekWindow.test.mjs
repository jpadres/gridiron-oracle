/**
 * LA JORNADA, DICHA DE FORMA COMPROBABLE.
 *
 * El 13 de septiembre de 2026 el dueño leyó «WEEK 1» con dos partidos ya
 * terminados y concluyó que la web se había quedado una semana atrás. La
 * etiqueta era CORRECTA. Lo que faltaba era poder comprobarla desde la pantalla.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { progressLabel, weekWindow, windowLabel } from "../app/weekWindow.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (p) => readFileSync(path.join(AQUI, "..", p), "utf8");

const JORNADA = [
  { kickoff_at: "2026-09-09T20:20:00-04:00", final: true },
  { kickoff_at: "2026-09-10T20:35:00-04:00", final: true },
  { kickoff_at: "2026-09-13T13:00:00-04:00", final: false },
  { kickoff_at: "2026-09-14T20:15:00-04:00", final: false },
];

test("la fecha es la de la ZONA DEL PARTIDO, no la del que mira ni UTC", () => {
  /* Las 20:20 del Este ya son del día siguiente en UTC, así que convertir movía
     los tres partidos de noche un día: la primera versión de este fichero
     publicaba «Sep 10–15» sobre una jornada que va del 9 al 14. Plausible y
     falsa. El prefijo de la cadena ES la respuesta.

     Se elige el 9 a propósito: con la conversión puesta da 10, así que las dos
     respuestas caen en días distintos — un fixture de mediodía habría pasado con
     el fallo. */
  assert.equal(windowLabel(weekWindow(JORNADA)), "Sep 9–14");
});

test("el progreso contesta la pregunta que se hizo el dueño", () => {
  assert.equal(progressLabel(weekWindow(JORNADA)), "2 of 4 played");
  const sinJugar = JORNADA.map((g) => ({ ...g, final: false }));
  assert.equal(progressLabel(weekWindow(sinJugar)), "4 games, none played yet");
  const todos = JORNADA.map((g) => ({ ...g, final: true }));
  assert.equal(progressLabel(weekWindow(todos)), "all 4 played");
});

test("sin saques publicados NO se inventa un rango", () => {
  // UNKNOWN antes que inventado: un rango a ojo sobre la pantalla que fecha los
  // datos sería exactamente lo que `data_dates` existe para impedir.
  assert.equal(weekWindow([]), null);
  assert.equal(weekWindow([{}, { kickoff_at: "" }]), null);
  assert.equal(windowLabel(null), null);
  assert.equal(progressLabel(null), null);
});

test("una jornada que cruza de mes lo dice con los dos meses", () => {
  const cruce = [{ kickoff_at: "2026-09-28T20:15:00-04:00" },
                 { kickoff_at: "2026-10-02T13:00:00-04:00" }];
  assert.equal(windowLabel(weekWindow(cruce)), "Sep 28 – Oct 2");
});

test("las pantallas que ANUNCIAN la jornada la PINTAN con su ventana", () => {
  /* «Cada sección fecha lo suyo» se prometió en doce páginas y lo cumplía una:
     una promesa que ninguna pantalla cumple es peor que no prometer nada. Aquí
     la propiedad es que quien escribe el número de jornada llame también a la
     derivación — no que el módulo exista, que es lo que un guardián flojo
     comprobaría. */
  for (const fichero of ["app/page.jsx", "app/predicciones/page.jsx",
                         "app/betting/BettingShell.jsx"]) {
    const src = leer(fichero);
    assert.match(src, /weekWindow\(/, `${fichero} anuncia la jornada sin derivar su ventana`);
    assert.match(src, /windowLabel\(/, `${fichero} deriva la ventana y no la pinta`);
    assert.match(src, /progressLabel\(/, `${fichero} no dice cuántos van jugados`);
  }
});
