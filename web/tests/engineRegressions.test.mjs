/**
 * LAS REGRESIONES DEL MOTOR CON CONTEXTO DE PLANTILLA, en CI y no en la tortura.
 *
 *     LO QUE SÓLO SE COMPRUEBA DE MADRUGADA NO PROTEGE EL DRAFT DE MAÑANA.
 *
 * La matriz de 780 drafts (`tools/lab/draft-torture.mjs`) es la que encuentra
 * fallos nuevos, y por tamaño no entra en `ci.yml`. Este fichero es la otra
 * mitad: las conductas CONCRETAS que ya se han pedido por escrito, escritas
 * como propiedades rápidas y deterministas, para que un refactor no pueda
 * deshacerlas en silencio entre dos noches.
 *
 * Cada bloque está escrito contra un escenario del encargo, y cada uno se ha
 * probado INYECTANDO su fallo: si al romper el motor el bloque no se pone
 * rojo, el bloque no vale (`tools/lab/engine-injection.mjs`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { bestForMe } from "../app/fantasy/candidates.js";
import { POSITION_STATE, replacementPoints, starterState } from "../app/fantasy/rosterFit.js";

/* Niveles de reemplazo del orden de los del board real: el QB es el más alto,
   que es lo que hace que ordenar por PUNTOS BRUTOS ponga a los quarterbacks
   arriba — el error que este motor existe para no cometer. */
const REP = { QB: 233, RB: 131, WR: 132, TE: 113, K: 100, DST: 90 };
let n = 0;
const p = (position, proj, extra = {}) => ({
  player_id: `${position}${(n += 1)}`, player_name: `${position} ${n}`,
  position, projected_points: proj, vor: proj - (REP[position] ?? 100),
  tier: 1, wg: 16, rostered: true, ...extra,
});

const UN_QB = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DST", "K", "BN", "BN"];
const SUPERFLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"];
const DOS_QB = ["QB", "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"];
const DOS_TE = ["QB", "RB", "RB", "WR", "WR", "TE", "TE", "FLEX", "BN"];
const SIN_FLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "BN"];
const TREINTA_Y_DOS = ["RB", "WR", "FLEX", "FLEX", "FLEX", "SUPER_FLEX", "BN"];

/** Un pool con lo mejor de cada posición, y el QB el más alto en bruto. */
const poolNormal = () => {
  n = 0;
  return [
    p("QB", 330), p("QB", 320),
    p("RB", 200), p("RB", 185),
    p("WR", 195), p("WR", 190),
    p("TE", 150), p("TE", 145),
  ];
};

const nombres = (out) => [out.primary, ...out.alternates]
  .filter(Boolean).map((e) => `${e.row.player_name} (${e.row.position})`);
const posiciones = (out) => [out.primary, ...out.alternates]
  .filter(Boolean).map((e) => e.row.position);

/* ── §2 / §192 · 1QB: después del QB1 ────────────────────────────────────── */

test("1QB · con QB1 puesto y titulares abiertos, NINGÚN QB entra en la lista corta", () => {
  n = 0;
  const miQB = p("QB", 340);
  const out = bestForMe(poolNormal(), {
    roster: [miQB], rosterPositions: UN_QB, replacement: REP, picksLeftForMe: 10,
  });
  assert.ok(out.primary, "tiene que haber un candidato");
  assert.ok(!posiciones(out).includes("QB"),
    `el QB de 330 no puede encabezar con RB/WR/TE abiertos: ${nombres(out).join(", ")}`);
  assert.equal(out.state.byPosition.QB, POSITION_STATE.STARTER_FILLED);
  assert.ok(out.primary.reasons.some((r) => r.kind === "FILLED" && /QB/.test(r.text)),
    "y la pantalla tiene que poder decir POR QUÉ no está");
});

test("1QB · el QB no desaparece del universo: sigue valiendo su VOR", () => {
  // §0: no se muta el valor base. Sólo cambia quién encabeza la lista corta.
  n = 0;
  const pool = poolNormal();
  const qb = pool.find((r) => r.position === "QB");
  const antes = qb.vor;
  bestForMe(pool, { roster: [p("QB", 340)], rosterPositions: UN_QB, replacement: REP });
  assert.equal(qb.vor, antes, "el motor no puede tocar el valor de nadie");
});

/* ── §32 · 2QB: exactamente lo contrario ─────────────────────────────────── */

test("2QB · con QB1 puesto, el segundo QB SIGUE siendo un titular por llenar", () => {
  n = 0;
  const out = bestForMe(poolNormal(), {
    roster: [p("QB", 340)], rosterPositions: DOS_QB, replacement: REP,
  });
  assert.equal(out.state.byPosition.QB, POSITION_STATE.OPEN_STARTER);
  assert.ok(posiciones(out).includes("QB"),
    `con dos huecos de QB el segundo tiene que estar: ${nombres(out).join(", ")}`);
});

/* ── §33 / §195 · SUPERFLEX ──────────────────────────────────────────────── */

test("superflex · con QB1 puesto el segundo QB encabeza, y el motivo nombra el HUECO", () => {
  n = 0;
  const out = bestForMe(poolNormal(), {
    roster: [p("QB", 340)], rosterPositions: SUPERFLEX, replacement: REP,
  });
  assert.equal(out.primary.row.position, "QB",
    `en superflex el QB de 330 sí mejora la alineación: ${nombres(out).join(", ")}`);
  const motivo = out.primary.reasons.find((r) => r.kind === "FLEX");
  assert.ok(motivo, "el motivo tiene que ser el hueco, no «necesitas QB»");
  assert.match(motivo.text, /SUPER_FLEX/);
});

test("superflex · la MISMA regla, sin una excepción escrita para cada liga", () => {
  // El estado sale de la elegibilidad de los huecos declarados, no de un `if`
  // por tipo de liga: con SUPER_FLEX el QB es FLEX_ELIGIBLE, sin él STARTER_FILLED.
  n = 0;
  const conSF = starterState({ roster: [p("QB", 340)], rosterPositions: SUPERFLEX });
  n = 0;
  const sinSF = starterState({ roster: [p("QB", 340)], rosterPositions: UN_QB });
  assert.equal(conSF.byPosition.QB, POSITION_STATE.FLEX_ELIGIBLE);
  assert.equal(sinSF.byPosition.QB, POSITION_STATE.STARTER_FILLED);
});

/* ── §3 / §38 / §39 / §193 · TE y el FLEX ────────────────────────────────── */

test("TE · con el TE puesto y un FLEX que NO admite TE, el segundo TE es banquillo", () => {
  n = 0;
  const out = bestForMe(poolNormal(), {
    roster: [p("TE", 240)], rosterPositions: SIN_FLEX, replacement: REP,
  });
  assert.equal(out.state.byPosition.TE, POSITION_STATE.STARTER_FILLED);
  assert.ok(!posiciones(out).includes("TE"),
    `sin FLEX que lo admita, el TE2 no puede encabezar: ${nombres(out).join(", ")}`);
});

test("TE · con un FLEX que SÍ admite TE, el segundo TE compite — no gana por ser TE", () => {
  n = 0;
  const out = bestForMe(poolNormal(), {
    roster: [p("TE", 240)], rosterPositions: UN_QB, replacement: REP,
  });
  assert.equal(out.state.byPosition.TE, POSITION_STATE.FLEX_ELIGIBLE);
  // Compite por el FLEX contra RB y WR, y con estos números pierde: el TE de
  // 150 aporta menos que el RB de 200. Que PUEDA entrar no es que entre.
  assert.notEqual(out.primary.row.position, "TE");
});

test("dos TE titulares · el segundo TE es un hueco por llenar", () => {
  n = 0;
  const out = bestForMe(poolNormal(), {
    roster: [p("TE", 240)], rosterPositions: DOS_TE, replacement: REP,
  });
  assert.equal(out.state.byPosition.TE, POSITION_STATE.OPEN_STARTER);
});

/* ── §7 / §144 · el cupo NO puede esconder una mejora real ───────────────── */

test("un cuarto RB que mejora la alineación NO se filtra por «ya tienes tres»", () => {
  /* Medido cuando esto estaba mal: con tres RB de ~135, un RB de 228 (marginal
     +93) se caía de la lista y encabezaba un WR de +79. El cupo ordena el
     banquillo; no decide quién mejora tu alineación. */
  n = 0;
  const mios = [p("RB", 135), p("RB", 134), p("RB", 133), p("WR", 200), p("WR", 199)];
  n = 100;
  const out = bestForMe([p("RB", 228), p("WR", 190)], {
    roster: mios, rosterPositions: UN_QB, replacement: REP,
  });
  assert.equal(out.primary.row.position, "RB",
    `el RB de 228 mejora la alineación sentando al de 133: ${nombres(out).join(", ")}`);
});

test("§8 · con RB1 y RB2 puestos y el FLEX abierto, un RB3 sigue pudiendo ser titular", () => {
  n = 0;
  const mios = [p("RB", 200), p("RB", 190)];
  n = 100;
  const out = bestForMe([p("RB", 185), p("WR", 140)], {
    roster: mios, rosterPositions: UN_QB, replacement: REP,
  });
  assert.equal(out.state.byPosition.RB, POSITION_STATE.FLEX_ELIGIBLE);
  assert.equal(out.primary.row.position, "RB");
});

/* ── §10 / §11 / §196 · «saturado POR AHORA», no prohibido ───────────────── */

test("con todos los titulares puestos, el QB2 vuelve a ser una opción de banquillo", () => {
  /* La saturación es dinámica. Con la alineación hecha nadie mejora nada, la
     lista pasa a ser de BANQUILLO y ahí el valor bruto manda otra vez: un QB
     que ha caído no queda prohibido para siempre. */
  n = 0;
  const titulares = [
    p("QB", 300), p("RB", 200), p("RB", 190), p("WR", 195), p("WR", 185),
    p("TE", 150), p("RB", 180), p("DST", 95), p("K", 105),
  ];
  n = 200;
  const out = bestForMe([p("QB", 330), p("WR", 120)], {
    roster: titulares, rosterPositions: UN_QB, replacement: REP,
  });
  assert.equal(out.startersComplete, true,
    "con los nueve huecos llenos esto tiene que decir la verdad, no `false` cableado");
  // Y el QB de 330 no queda prohibido: MEJORA el titular de 300, así que
  // encabeza — que es la respuesta correcta a «saturado POR AHORA», no
  // «saturado para siempre». La lista de banquillo es para cuando nadie mejora.
  assert.equal(out.primary.row.position, "QB",
    "un QB que ha caído y mejora tu titular sigue siendo un pick legítimo");
});

/* ── §43 / §44 / §197 · pateador y defensa al final ──────────────────────── */

test("K/DST · el aviso salta cuando quedan tantos picks como huecos, no en la ronda 3", () => {
  n = 0;
  const mios = [p("QB", 300), p("RB", 200), p("RB", 190), p("WR", 195), p("WR", 185),
                p("TE", 150), p("RB", 180)];
  n = 200;
  const pool = [p("WR", 140), p("K", 105), p("DST", 95)];
  const pronto = bestForMe(pool, {
    roster: mios, rosterPositions: UN_QB, replacement: REP, picksLeftForMe: 9,
  });
  assert.equal(pronto.mustFillSpecialist, false, "con nueve picks por delante no urge");
  const tarde = bestForMe(pool, {
    roster: mios, rosterPositions: UN_QB, replacement: REP, picksLeftForMe: 2,
  });
  assert.equal(tarde.mustFillSpecialist, true, "con dos picks y dos huecos, sí");
});

test("K/DST · «no sé cuántos picks quedan» NUNCA es «quedan cero»", () => {
  n = 0;
  const out = bestForMe(poolNormal(), {
    roster: [], rosterPositions: UN_QB, replacement: REP, picksLeftForMe: null,
  });
  assert.equal(out.mustFillSpecialist, false);
});

/* ── §61 / §63 / §198 · estado de plantilla y recomendación ──────────────── */

test("sin equipo NFL · no encabeza mientras exista alguien con equipo", () => {
  n = 0;
  const out = bestForMe([p("RB", 300, { rostered: false }), p("RB", 150)], {
    roster: [], rosterPositions: UN_QB, replacement: REP,
  });
  assert.equal(out.primary.row.rostered, true,
    "el de 300 sin equipo no puede presentarse como una recomendación normal");
});

test("apartado (OUT) · no encabeza ni siendo el mejor del pool", () => {
  n = 0;
  const out = bestForMe(
    [p("RB", 300, { status_severity: "OUT", status_label: "SUSPENDED" }), p("RB", 150)],
    { roster: [], rosterPositions: UN_QB, replacement: REP },
  );
  assert.notEqual(out.primary.row.status_severity, "OUT");
});

/* ── §35 / §78 · la liga de 32 sin hueco dedicado de QB ──────────────────── */

test("32 equipos sin QB dedicado · el estado sale de los huecos, no del tipo de liga", () => {
  /* Esta liga no tiene hueco de QB: el único que lo admite es SUPER_FLEX. Con
     él ABIERTO el QB entra por ahí; con él LLENO no hay dónde ponerlo y es
     banquillo — pero nunca `STARTER_FILLED`, que sería afirmar que se llenó un
     hueco dedicado de QB que esta liga no declara. */
  n = 0;
  const vacia = starterState({ roster: [], rosterPositions: TREINTA_Y_DOS });
  assert.equal(vacia.byPosition.QB, POSITION_STATE.FLEX_ELIGIBLE);
  n = 0;
  const conQB = starterState({ roster: [p("QB", 340)], rosterPositions: TREINTA_Y_DOS });
  assert.equal(conQB.byPosition.QB, POSITION_STATE.BENCH_DEPTH);
  assert.notEqual(conQB.byPosition.QB, POSITION_STATE.STARTER_FILLED);
});

/* ── §149 · un novato con previa NO vale cero ────────────────────────────── */

test("un novato con previa entra como cualquiera; sin número propio, no", () => {
  n = 0;
  const novato = p("RB", 190, { rookie: true, wg: 0, rookie_round: 1, rookie_sample: 40 });
  const out = bestForMe([novato, p("RB", 150)], {
    roster: [], rosterPositions: UN_QB, replacement: REP,
  });
  assert.equal(out.primary.row.rookie, true,
    "un novato tiene su propio número: `wg` cero no puede leerse como «sin muestra»");
});

/* ── §28 / §29 / §148 · lo drafteado desaparece ──────────────────────────── */

test("quien ya no está en el pool no puede seguir recomendado", () => {
  n = 0;
  const pool = poolNormal();
  const primero = bestForMe(pool, {
    roster: [], rosterPositions: UN_QB, replacement: REP,
  }).primary.row;
  const despues = bestForMe(pool.filter((r) => r.player_id !== primero.player_id), {
    roster: [], rosterPositions: UN_QB, replacement: REP,
  });
  assert.ok(![despues.primary, ...despues.alternates]
    .some((e) => e.row.player_id === primero.player_id));
});

/* ── §169 / §170 · determinismo ──────────────────────────────────────────── */

test("el mismo estado da la MISMA lista corta, siempre", () => {
  n = 0;
  const pool = poolNormal();
  const mio = [p("QB", 340)];
  const a = bestForMe(pool, { roster: mio, rosterPositions: UN_QB, replacement: REP });
  const b = bestForMe(pool, { roster: mio, rosterPositions: UN_QB, replacement: REP });
  assert.deepEqual(nombres(a), nombres(b));
  assert.deepEqual(a.primary.reasons, b.primary.reasons);
});

/* ── §133 · la alineación titular se completa ────────────────────────────── */

test("siguiendo la recomendación se llenan TODOS los huecos titulares", () => {
  /* La versión rápida de lo que la tortura mide en 780 drafts: se draftea uno
     a uno siguiendo al motor y al final no puede quedar un hueco abierto
     habiendo candidatos — un hueco vacío rinde CERO, que es el 47% de la
     ventaja que E23 midió contra el baseline. */
  n = 0;
  const pool = [];
  for (const [pos, base] of [["QB", 300], ["RB", 210], ["WR", 205], ["TE", 160],
                             ["K", 110], ["DST", 100]]) {
    for (let i = 0; i < 6; i += 1) pool.push(p(pos, base - i * 5));
  }
  let disponibles = [...pool];
  let mios = [];
  for (let turno = 0; turno < 9; turno += 1) {
    const out = bestForMe(disponibles, {
      roster: mios, rosterPositions: UN_QB, replacement: REP,
      picksLeftForMe: 9 - turno,
    });
    const elegido = out.primary?.row ?? out.bench?.[0]?.row;
    assert.ok(elegido, `turno ${turno}: el motor no ofreció nada`);
    mios = [...mios, elegido];
    disponibles = disponibles.filter((r) => r.player_id !== elegido.player_id);
  }
  const fin = starterState({ roster: mios, rosterPositions: UN_QB });
  assert.equal(fin.open.length, 0,
    `quedaron huecos titulares vacíos: ${fin.open.map((s) => s.slot).join(", ")}`);
});
