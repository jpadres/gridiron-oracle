// La capa de menciones de prensa dentro de `briefsByPlayer`.
//
// Lo que caza: que una MENCIÓN —la evidencia más débil que publica el sitio,
// sin clasificar y sin juzgar— se cuele por encima de un parte médico o de un
// cambio de depth chart, que sí son juicios con fuente. Y que salga sin su
// fecha, que es la regla 5 aplicada a la capa nueva.
import assert from "node:assert/strict";
import test from "node:test";
import { briefsByPlayer } from "../data/model.js";

const PRENSA = {
  press: {
    by_player: {
      x: [
        { title: "Rams name their starter", outlet: "LAR official",
          published_at: "2026-09-06T17:00:00Z" },
        { title: "Something older", outlet: "PFF", published_at: "2026-09-05T00:00:00Z" },
      ],
    },
  },
};

test("una mención se publica con su fecha de PUBLICACIÓN y su medio", () => {
  const out = briefsByPlayer(null, PRENSA);
  assert.match(out.x, /^2026-09-06 · LAR official — /);
  assert.match(out.x, /Rams name their starter/);
});

test("y dice cuántas más hay, sin escribirlas todas", () => {
  assert.match(briefsByPlayer(null, PRENSA).x, /\(\+1\)$/);
});

test("el parte médico PISA a la mención: un juicio con fuente manda sobre un titular", () => {
  const dossier = { medical: [{ player_id: "x", level: "OUT", situation: "Knee", status: "Out" }] };
  assert.equal(briefsByPlayer(dossier, PRENSA).x, "Knee. Out");
});

test("una ficha de research enlazada también la pisa", () => {
  const research = { ...PRENSA, items: [{ headline: "Traded to DEN", player_ids: ["x"] }] };
  assert.equal(briefsByPlayer(null, research).x, "Traded to DEN");
});

test("una mención SIN fecha no se publica: no hay mención sin cuándo", () => {
  const sinFecha = { press: { by_player: { x: [{ title: "t", outlet: "o" }] } } };
  assert.equal(briefsByPlayer(null, sinFecha).x, undefined);
});

test("sin sección de prensa no lanza y no inventa nada", () => {
  assert.deepEqual(briefsByPlayer(null, null), {});
  assert.deepEqual(briefsByPlayer(null, { press: {} }), {});
});
