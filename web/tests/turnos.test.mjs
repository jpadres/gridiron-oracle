/**
 * EL TURNO, contrastado entre dos implementaciones que no se conocen.
 *
 * `draftLog.slotForOverall`/`isMyTurn`/`untilMyTurn` y `draftSync.pickSchedule`
 * responden la misma pregunta —¿qué puesto elige en el pick N?— desde dos
 * ficheros distintos. Dos traductores del mismo formato es el fallo que este
 * repositorio ha cometido ocho veces, así que aquí se exige que coincidan en
 * TODOS los picks de TODAS las ligas de 8 a 32, snake y lineal, para el primer
 * puesto, uno del medio y el último. Un desfase de uno en cualquiera de las
 * dos respuestas sale rojo en una celda concreta.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isMyTurn, slotForOverall, untilMyTurn } from "../app/fantasy/draftLog.js";
import { pickSchedule } from "../app/fantasy/draftSync.js";

const TEAMS = [8, 10, 12, 14, 16, 20, 32];
const ROUNDS = 15;

for (const teams of TEAMS) {
  for (const type of ["snake", "linear"]) {
    const slots = [1, Math.ceil(teams / 2), teams];
    for (const slot of slots) {
      test(`${teams} equipos · ${type} · puesto ${slot}: las dos implementaciones coinciden pick a pick`, () => {
        const mios = new Set(pickSchedule({ slot, teams, rounds: ROUNDS, type }).map((p) => p.overall));
        assert.equal(mios.size, ROUNDS, "un pick por ronda");
        for (let overall = 1; overall <= teams * ROUNDS; overall += 1) {
          const dicho = isMyTurn({ overall, teams, type, mySlot: slot });
          assert.equal(dicho, mios.has(overall),
            `pick ${overall}: isMyTurn=${dicho}, pickSchedule=${mios.has(overall)}`);
          // Y la ronda/puesto derivados cuadran con la aritmética del snake.
          const pos = slotForOverall(overall, teams, type);
          const round = Math.floor((overall - 1) / teams) + 1;
          assert.equal(pos.round, round);
          const esperado = type === "snake" && round % 2 === 0
            ? teams - ((overall - 1) % teams) : ((overall - 1) % teams) + 1;
          assert.equal(pos.slot, esperado, `pick ${overall} ronda ${round}`);
        }
      });

      test(`${teams} · ${type} · puesto ${slot}: «faltan N picks» es la distancia real al siguiente mío`, () => {
        const agenda = pickSchedule({ slot, teams, rounds: ROUNDS, type }).map((p) => p.overall);
        for (let count = 0; count < teams * ROUNDS; count += 1) {
          const siguiente = agenda.find((o) => o > count);
          const dicho = untilMyTurn({ count, teams, type, mySlot: slot, rounds: ROUNDS });
          if (siguiente === undefined) { assert.equal(dicho, null); continue; }
          assert.equal(dicho.overall, siguiente, `con ${count} picks hechos`);
          assert.equal(dicho.away, siguiente - count - 1);
        }
      });
    }
  }
}

test("sin puesto, sin tipo o sin tamaño, la respuesta es null y no false", () => {
  assert.equal(isMyTurn({ overall: 1, teams: 12, type: "snake", mySlot: null }), null);
  assert.equal(isMyTurn({ overall: 1, teams: 12, type: null, mySlot: 3 }), null);
  assert.equal(isMyTurn({ overall: 1, teams: null, type: "snake", mySlot: 3 }), null);
  assert.equal(slotForOverall(5, 12, "auction"), null, "un tipo desconocido no se supone snake");
});
