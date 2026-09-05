// UNA partición de «disponible» para las dos pantallas de draft.
//
// El fallo que caza: el Draft Room apartaba a quien no va a jugar y el board
// de `/fantasy` no miraba el estado — Josh Jacobs, exento, el 38 de «Best
// available» sin marca. Séptima vez de los dos traductores. La propiedad es
// doble: la función parte bien, y LAS DOS pantallas la usan en vez de tener
// su propio filtro. Lo segundo se comprueba leyendo el código, que es estrecho
// y cierto: si alguien vuelve a escribir `status_severity !== "OUT"` dentro de
// un filtro de `byPlayer`, es que ha vuelto a inventarse la definición.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { splitAvailable } from "../app/fantasy/availablePool.js";

const rows = [
  { player_id: "1", position: "RB", status_severity: null },
  { player_id: "2", position: "RB", status_severity: "OUT", status_label: "EXEMPT" },
  { player_id: "3", position: "WR", status_severity: "RISK" },
  { player_id: "4", position: "WR" },
];

test("quien se ha ido no está en ninguna de las tres listas", () => {
  const { untaken, available, unavailable } = splitAvailable(rows, new Set(["1", "2"]));
  assert.deepEqual(untaken.map((r) => r.player_id), ["3", "4"]);
  assert.deepEqual(available.map((r) => r.player_id), ["3", "4"]);
  assert.deepEqual(unavailable, []);
});

test("OUT va a unavailable y sigue en untaken; RISK sigue disponible", () => {
  const { untaken, available, unavailable } = splitAvailable(rows, new Set());
  assert.deepEqual(unavailable.map((r) => r.player_id), ["2"]);
  assert.deepEqual(available.map((r) => r.player_id), ["1", "3", "4"]);
  assert.deepEqual(untaken.map((r) => r.player_id), ["1", "2", "3", "4"]);
});

test("available ∪ unavailable = untaken, disjuntos y en el orden del board", () => {
  const { untaken, available, unavailable } = splitAvailable(rows, new Set(["4"]));
  const union = [...available, ...unavailable].map((r) => r.player_id).sort();
  assert.deepEqual(union, untaken.map((r) => r.player_id).sort());
  assert.equal(available.length + unavailable.length, untaken.length);
});

test("sin índice de tachados y con filas raras no lanza", () => {
  assert.deepEqual(splitAvailable(null, null), { untaken: [], available: [], unavailable: [] });
  assert.equal(splitAvailable([null, rows[0]], undefined).available.length, 1);
});

test("las DOS pantallas derivan «disponible» de splitAvailable, no de un filtro propio", () => {
  for (const file of ["app/fantasy/DraftMode.jsx", "app/fantasy/DraftRoom.jsx"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(src, /splitAvailable\(/, `${file} no llama a splitAvailable`);
    // Un filtro sobre byPlayer que además decida por estado es la definición
    // duplicada; y uno que NO decida por estado es la versión ciega de /fantasy.
    const own = src.match(/const available = useMemo\([^;]*byPlayer\.has[^;]*;/s);
    assert.equal(own, null, `${file} define su propio «available»: ${own?.[0]?.slice(0, 80)}`);
  }
});
