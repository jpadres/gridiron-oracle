/**
 * EL RELOJ DEL PARTIDO.
 *
 * Cada test lleva el fallo que existe para cazar: un partido en marcha ofrecido
 * como apuesta, un saque sin zona leído como hora local, y «no sé cuándo
 * empieza» degradado a «no ha empezado».
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GAME, gameState, hasStarted, isOpen, kickoffMs, stateLabel } from "../app/gameClock.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAQUE = "2026-09-13T13:00:00-04:00";       // 17:00 UTC
const ANTES = Date.parse("2026-09-13T16:00:00Z");
const DESPUES = Date.parse("2026-09-13T18:00:00Z");

test("un partido que ya empezó NO está abierto", () => {
  const fila = { kickoff_at: SAQUE, final: false };
  assert.equal(gameState(fila, ANTES), GAME.SCHEDULED);
  assert.equal(isOpen(fila, ANTES), true);
  assert.equal(gameState(fila, DESPUES), GAME.IN_PROGRESS);
  assert.equal(isOpen(fila, DESPUES), false, "se ofrece un partido en marcha");
  assert.equal(stateLabel(fila, DESPUES), "IN PROGRESS");
});

test("FINAL gana al reloj: el navegador no REABRE lo que Python cerró", () => {
  /* Python decide «hay marcador» —un hecho del fichero— y el navegador decide
     «ha pasado la hora» —un hecho del reloj—. Si el segundo pudiera anular al
     primero, un partido terminado volvería a ofrecerse en cuanto alguien
     tuviera el reloj mal puesto. */
  const acabado = { kickoff_at: SAQUE, final: true };
  assert.equal(gameState(acabado, ANTES), GAME.FINAL);
  assert.equal(gameState(acabado, DESPUES), GAME.FINAL);
  assert.equal(isOpen(acabado, ANTES), false);
});

test("el saque se lee con SU zona, no con la del que mira", () => {
  /* Sin zona, «2026-09-13 13:00» lo interpreta el navegador como hora LOCAL:
     desde Madrid el partido habría empezado seis horas antes y la pantalla
     cerraría un mercado abierto. Sólo `kickoff_at` sirve. */
  assert.equal(kickoffMs({ kickoff_at: SAQUE }), Date.parse("2026-09-13T17:00:00Z"));
  assert.equal(kickoffMs({ kickoff: "2026-09-13 13:00" }), null,
    "la cadena sin zona no puede situar el partido");
});

test("«no sé cuándo empieza» NO es «no ha empezado»", () => {
  const sinHora = { kickoff_at: null, final: false };
  assert.equal(gameState(sinHora, DESPUES), GAME.UNKNOWN);
  assert.equal(isOpen(sinHora, DESPUES), false,
    "un partido sin hora no se puede afirmar abierto");
  assert.equal(stateLabel(sinHora, DESPUES), "KICKOFF UNKNOWN");
});

test("sin reloj no se afirma que nada haya empezado", () => {
  /* Es lo que se pinta en el servidor, donde «ahora» sería la hora del BUILD —
     la falsa actualidad de este proyecto, aplicada al reloj. */
  const fila = { kickoff_at: SAQUE, final: false };
  assert.equal(gameState(fila, null), GAME.SCHEDULED);
  assert.equal(gameState(fila, undefined), GAME.SCHEDULED);
  assert.equal(stateLabel(fila, null), null);
});

test("el caso normal no produce marca", () => {
  assert.equal(stateLabel({ kickoff_at: SAQUE, final: false }, ANTES), null,
    "una marca que sale siempre no informa");
});

test("lee también los nombres del semanal", () => {
  /* Las filas del ranking llevan `game_kickoff_at` y `game_final`; las de
     predicciones, `kickoff_at` y `final`. Un solo lector para las dos, o
     vuelven a ser dos traductores del mismo hecho. */
  const semanal = { game_kickoff_at: SAQUE, game_final: false };
  assert.equal(gameState(semanal, DESPUES), GAME.IN_PROGRESS);
  assert.equal(gameState({ game_final: true }, ANTES), GAME.FINAL);
});

test("«no sé» cae a lados OPUESTOS según la pregunta", () => {
  /* Para apostar, lo que no se puede confirmar abierto se cierra: cuesta un
     mercado que se deja de enseñar. Para una alineación es al revés: congelar
     un hueco por no saber la hora congelaría la plantilla entera y la pantalla
     diría que no hay nada que cambiar. Un solo predicado para las dos parecía
     economía y era un fallo — lo destaparon siete tests en rojo. */
  const sinHora = { kickoff_at: null, final: false };
  assert.equal(isOpen(sinHora, DESPUES), false, "no se ofrece lo que no se confirma abierto");
  assert.equal(hasStarted(sinHora, DESPUES), false, "no se congela lo que no se confirma empezado");
  // Y donde sí se sabe, las dos coinciden.
  const empezado = { kickoff_at: SAQUE, final: false };
  assert.equal(isOpen(empezado, DESPUES), false);
  assert.equal(hasStarted(empezado, DESPUES), true);
  const porJugar = { kickoff_at: SAQUE, final: false };
  assert.equal(isOpen(porJugar, ANTES), true);
  assert.equal(hasStarted(porJugar, ANTES), false);
});

test("nadie vuelve a comparar el saque por su cuenta", () => {
  /* EL FALLO QUE ESCRIBIÓ ESTE GUARDIÁN, Y QUE ESTABA EN EL GUARDIÁN.
     `apuestas.mjs` salió VERDE por la mañana y ROJO en CI seis horas después,
     sobre el mismo commit: contaba los mercados abiertos con `!game_final` —lo
     que cerró Python— mientras la pantalla usa `gameState` con el reloj del
     navegador, que a la una ya había cerrado el slate de la una. Ninguno de los
     dos estaba mal; medían momentos distintos. Y `reloj.mjs` —el laboratorio
     del reloj— rehacía la comparación a mano, así que si las dos definiciones
     se equivocaran igual saldría verde sobre el fallo.

     La propiedad es estrecha a propósito (la lección de `no-undef.mjs`: estrecho
     y cierto vale más que amplio y ruidoso): fuera de este módulo, nadie parsea
     un campo de saque. Quien necesite el instante llama a `kickoffMs`; quien
     necesite el estado, a `gameState` / `isOpen` / `hasStarted`.

     Los comentarios se quitan ANTES de mirar: un guardián que casa con la prosa
     que describe el fallo vigila la prosa, no el código — ya pasó una vez. */
  const raiz = path.resolve(AQUI, "..");
  const ficheros = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "data") continue;
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(js|jsx|mjs)$/.test(e.name)) ficheros.push(ruta);
    }
  };
  for (const d of ["app", "tools", "tests"]) recorrer(path.join(raiz, d));

  const culpables = [];
  for (const ruta of ficheros) {
    if (ruta.endsWith(path.join("app", "gameClock.js"))) continue;   // la definición
    const codigo = readFileSync(ruta, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    if (/Date\.parse\([^)]*kickoff/.test(codigo)) culpables.push(path.relative(raiz, ruta));
  }
  assert.deepEqual(culpables, [],
    `parsean el saque a mano en vez de llamar a kickoffMs: ${culpables.join(", ")}`);
});
