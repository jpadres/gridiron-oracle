/**
 * Ninguna ficha se cae de /research.
 *
 * El fallo que esto vigila: la página calculaba las de relevancia alta, no las
 * pintaba, y las de relevancia baja sí. Con 40 fichas importantes en el
 * barrido, 30 no aparecían en ninguna sección — y la página se veía llena.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HEADLINE_RELEVANCE, byDay, partition } from "../app/research/select.js";

const ficha = (headline, relevance, date = "2026-09-01") => ({
  headline, fantasy_relevance: relevance, date,
});

test("lo que ya está en «today» no se repite abajo", () => {
  const items = [ficha("a", 5), ficha("b", 5), ficha("c", 2)];
  const { destacadas, resto } = partition(items, [{ ...items[0], category: "INJURY" }]);
  assert.deepEqual(destacadas.map((i) => i.headline), ["b"]);
  assert.deepEqual(resto.map((i) => i.headline), ["c"]);
});

test("NINGUNA ficha se queda sin caja", () => {
  const items = [];
  for (let i = 0; i < 40; i += 1) items.push(ficha(`alta-${i}`, 4));
  for (let i = 0; i < 20; i += 1) items.push(ficha(`baja-${i}`, 2));
  const today = items.slice(0, 10);
  const { destacadas, resto } = partition(items, today);
  assert.equal(today.length + destacadas.length + resto.length, items.length);
  assert.equal(destacadas.length, 30, "las 30 importantes que antes desaparecían");
});

test("dos fichas con el mismo titular en días distintos no se confunden", () => {
  const items = [ficha("misma", 5, "2026-08-31"), ficha("misma", 5, "2026-09-01")];
  const { destacadas } = partition(items, [items[1]]);
  assert.deepEqual(destacadas.map((i) => i.date), ["2026-08-31"]);
});

test("el umbral es el declarado y el agrupado conserva el orden", () => {
  assert.equal(HEADLINE_RELEVANCE, 4);
  const grupos = byDay([ficha("x", 4, "2026-09-01"), ficha("y", 4, "2026-08-31"),
                        ficha("z", 4, "2026-09-01")]);
  assert.deepEqual([...grupos.keys()], ["2026-09-01", "2026-08-31"]);
  assert.deepEqual(grupos.get("2026-09-01").map((i) => i.headline), ["x", "z"]);
});

test("contra el payload real: la cuenta cuadra", () => {
  const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const payload = JSON.parse(readFileSync(path.join(WEB, "data/model.json"), "utf8"));
  const research = payload.research ?? {};
  const items = research.items ?? [];
  if (items.length === 0) return;
  const { destacadas, resto } = partition(items, research.today ?? []);
  assert.equal((research.today ?? []).length + destacadas.length + resto.length, items.length);
});
