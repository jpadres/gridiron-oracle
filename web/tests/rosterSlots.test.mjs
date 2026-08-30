/**
 * Asignación de huecos de plantilla: paridad con Python y casos adversarios.
 *
 * El riesgo no es que `assignSlots` esté mal: es que esté UN POCO distinta de
 * `league.assign_slots`. Dos reparto que discrepan en un hueco pintan dos
 * plantillas distintas para el mismo draft, cada una coherente consigo misma.
 * El fixture lo genera Python y aquí se exige igualdad, no parecido.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assignSlots, rosterFromCounts } from "../app/fantasy/leagueValue.js";

const PARITY = JSON.parse(
  readFileSync(new URL("./fixtures/assign_slots_parity.json", import.meta.url))
);

test("paridad exacta con Python en los ocho casos", () => {
  for (const [name, expected] of Object.entries(PARITY)) {
    const { slots, unassigned } = assignSlots(expected.players, expected.roster);
    assert.deepEqual(
      slots.map((h) => ({ index: h.index, slot: h.slot, player: h.player?.player_id ?? null })),
      expected.slots,
      name
    );
    assert.deepEqual(unassigned.map((p) => p.player_id), expected.unassigned, name);
  }
});

const j = (pid, pos, vor) => ({ player_id: pid, position: pos, vor });
const NORMAL = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"];

test("dedicados antes que flex: el orden que evita dejar a alguien fuera", () => {
  // Un QB y un SUPER_FLEX: empezar por el permisivo metería al QB en el
  // superflex y dejaría su hueco dedicado abierto.
  const { slots, unassigned } = assignSlots(
    [j("qb", "QB", 200), j("rb", "RB", 100)], ["SUPER_FLEX", "QB"]
  );
  const byName = Object.fromEntries(slots.map((h) => [h.slot, h.player?.player_id ?? null]));
  assert.equal(byName.QB, "qb");
  assert.equal(byName.SUPER_FLEX, "rb");
  assert.deepEqual(unassigned, []);
});

test("ningún jugador se duplica ni desaparece", () => {
  const players = Array.from({ length: 14 }, (_, i) =>
    j(`p${i}`, ["QB", "RB", "WR", "TE", "K", "DST"][i % 6], 100 - i));
  const { slots, unassigned } = assignSlots(players, NORMAL);
  const placed = slots.filter((h) => h.player).map((h) => h.player.player_id);
  const all = [...placed, ...unassigned.map((p) => p.player_id)];
  assert.equal(new Set(all).size, players.length, "todos exactamente una vez");
});

test("orden de llegada irrelevante: el reparto es determinista", () => {
  const players = [j("a", "RB", 50), j("b", "WR", 60), j("c", "TE", 40), j("d", "RB", 70)];
  const first = assignSlots([...players], NORMAL);
  const second = assignSlots([...players].reverse(), NORMAL);
  assert.deepEqual(
    first.slots.map((h) => h.player?.player_id ?? null),
    second.slots.map((h) => h.player?.player_id ?? null)
  );
});

test("sin TE dedicado, el ala cerrada sólo entra por el flex", () => {
  const { slots, unassigned } = assignSlots(
    [j("te1", "TE", 90), j("te2", "TE", 80)],
    ["RB", "WR", "FLEX"]
  );
  const byName = Object.fromEntries(slots.map((h) => [h.slot, h.player?.player_id ?? null]));
  assert.equal(byName.FLEX, "te1");
  assert.deepEqual(unassigned.map((p) => p.player_id), ["te2"]);
});

test("un hueco es {index, slot, player} y nada más: sin consejo", () => {
  const { slots } = assignSlots([j("a", "RB", 10)], NORMAL);
  for (const h of slots) assert.deepEqual(Object.keys(h).sort(), ["index", "player", "slot"]);
});

test("rosterFromCounts produce el preset estándar del dueño", () => {
  assert.deepEqual(
    rosterFromCounts({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1 }),
    NORMAL
  );
});

test("rosterFromCounts: cero es cero, no un valor por defecto", () => {
  const out = rosterFromCounts({ QB: 0, RB: 2, WR: 2, TE: 0, FLEX: 3, SUPER_FLEX: 1 });
  assert.ok(!out.includes("QB") && !out.includes("TE"));
  assert.equal(out.filter((s) => s === "FLEX").length, 3);
  assert.deepEqual(rosterFromCounts({}), []);
});

test("rosterFromCounts añade el banquillo al final", () => {
  const out = rosterFromCounts({ QB: 1, BN: 3 });
  assert.deepEqual(out, ["QB", "BN", "BN", "BN"]);
});
