/**
 * EL REGISTRO DE CAPACIDADES TIENE QUE SER PORTANTE, no decorativo.
 *
 * Las 34 capacidades se exportaban al payload y `app/` tenía CERO referencias a
 * ellas: cada frontera de autoridad de la interfaz era prosa escrita a mano,
 * capaz de desviarse del registro sin que fallara nada. Es la misma deriva que
 * tuvieron las cifras de portada —el sitio y sus documentos diciendo cosas
 * distintas— aplicada a lo que el producto AFIRMA PODER HACER.
 *
 * Este guardián es estrecho a propósito: no intenta adivinar qué prosa es una
 * afirmación de autoridad. Comprueba (1) que el registro llega íntegro a la web,
 * (2) que la pantalla semanal LEE de él en vez de tenerlo escrito, y (3) que
 * `capabilityStatus` no se inventa un estado para lo que no está declarado.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { capabilityOf, capabilityStatus, model } from "../data/model.js";

const leer = (r) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");

test("el registro llega entero al payload", () => {
  const lista = model?.capabilities?.capabilities;
  assert.ok(Array.isArray(lista) && lista.length >= 30, "el registro tiene que viajar en el payload");
  for (const cap of lista) {
    assert.ok(typeof cap.id === "string" && cap.id, "toda capacidad lleva id");
    assert.ok(typeof cap.status === "string" && cap.status, `${cap.id} sin estado`);
  }
});

test("una capacidad que el registro no declara NO tiene estado inventado", () => {
  assert.equal(capabilityStatus("CAPACIDAD_QUE_NO_EXISTE"), null);
  assert.equal(capabilityOf("CAPACIDAD_QUE_NO_EXISTE"), null);
});

test("el ranking ordinal del pateador sigue RECHAZADO y la proyección VALIDADA", () => {
  // Si un experimento nuevo mueve esto, que sea una decisión consciente: este
  // test se pone rojo y obliga a mirar la pantalla que lo afirma.
  assert.equal(capabilityStatus("KICKER_ORDINAL_RANKING"), "REJECTED");
  assert.equal(capabilityStatus("KICKER_PROJECTION"), "VALIDATED");
});

test("la pantalla semanal LEE la autoridad del registro, no la tiene escrita", () => {
  const page = leer("app/fantasy/semanal/page.jsx");
  assert.match(page, /capabilityStatus\("KICKER_ORDINAL_RANKING"\)/,
    "la página tiene que consultar el registro");
  const shell = leer("app/fantasy/semanal/WeeklyExplorer.jsx");
  assert.match(shell, /kickerRankStatus === "REJECTED"/,
    "y la frase tiene que depender de ese estado");
  // La otra mitad: sin estado declarado NO se afirma ninguna de las dos cosas.
  assert.match(shell, /registry backs|not currently backed/,
    "sin registro que lo respalde, la pantalla tiene que decir eso y no afirmar");
});

test("el start/sit del QB sigue sin validar, y RB/WR/TE validados", () => {
  // Si un experimento mueve cualquiera de los cuatro, esto se pone rojo y
  // obliga a mirar la pantalla que los presenta.
  assert.equal(capabilityStatus("START_SIT_QB"), "NOT_READY");
  for (const pos of ["RB", "WR", "TE"]) {
    assert.equal(capabilityStatus(`START_SIT_${pos}`), "VALIDATED", `${pos} debería estar validado`);
  }
});

test("la pantalla semanal avisa de la posición cuya autoridad NO es RECOMEND", () => {
  const page = leer("app/fantasy/semanal/page.jsx");
  assert.match(page, /START_SIT_QB/, "la página tiene que consultar el registro por posición");
  const shell = leer("app/fantasy/semanal/WeeklyExplorer.jsx");
  // GENERAL, no un caso especial del QB: si estuviera cableado a "QB" el aviso
  // no aparecería el día que otra posición perdiera su validación.
  assert.match(shell, /startSitStatus\[pos\] !== "VALIDATED"/,
    "el aviso tiene que derivarse del estado, no de la posición");
  assert.ok(!/pos === "QB"/.test(shell), "y no puede estar cableado al QB");
});

test("ninguna pantalla enseña un rank ordinal de pateador", () => {
  // La afirmación que el registro RECHAZA, comprobada en el sitio donde se
  // rompería: la tabla de pateadores no puede pintar una columna de orden.
  const shell = leer("app/fantasy/semanal/WeeklyExplorer.jsx");
  // Se acota a LA TABLA del pateador y no al hueco entre dos paneles: la
  // primera versión rebanaba de `id="k"` a `id="dst"` y ahí dentro cae la tabla
  // de resto de temporada, cuyo `ros_position_rank` casaba con el regex. Un
  // guardián con falsos positivos acaba desactivado — estrecho y cierto.
  const desde = shell.indexOf('id="k"');
  const tabla = shell.slice(desde, shell.indexOf("</table>", desde));
  assert.ok(desde > 0 && tabla.length > 0, "no encuentro la tabla de pateadores");
  assert.ok(!/\bposition_rank\b/.test(tabla),
    "la tabla de pateadores no puede pintar K1…K12");
  assert.ok(!/<th[^>]*>\s*#\s*<\/th>/.test(tabla),
    "ni una columna de orden");
});
