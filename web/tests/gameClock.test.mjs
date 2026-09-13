/**
 * EL RELOJ DEL PARTIDO.
 *
 * Cada test lleva el fallo que existe para cazar: un partido en marcha ofrecido
 * como apuesta, un saque sin zona leído como hora local, y «no sé cuándo
 * empieza» degradado a «no ha empezado».
 */
import assert from "node:assert/strict";
import test from "node:test";

import { GAME, gameState, hasStarted, isOpen, kickoffMs, stateLabel } from "../app/gameClock.js";

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
