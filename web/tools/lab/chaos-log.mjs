/**
 * FASE 5 — caos sobre el registro canónico.
 *
 * El simulador genera secuencias razonables. Aquí se construyen las que NO son
 * razonables: mismo instante, misma secuencia, UNDO de alguien nunca tomado,
 * eventos que llegan al revés, y el proveedor repitiendo su lista entera.
 */
import { ROSTER, SOURCE, fold, providerEvents } from "../../app/fantasy/draftLog.js";
import { rng } from "./bots.mjs";

let fallos = 0;
const check = (nombre, ok, detalle = "") => {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const T = 1_800_000_000_000;
// Eventos construidos A MANO: `takeEvent` protege el seq y aquí hace falta
// poder colisionarlo a propósito.
const take = (playerId, { at = T, seq = 1, roster = ROSTER.OPPONENT, source = SOURCE.MANUAL } = {}) =>
  ({ kind: "TAKE", playerId, roster, rosterSource: "DECLARED", overall: null, source, providerId: null, at, seq });
const undo = (playerId, { at = T, seq = 1, source = SOURCE.MANUAL } = {}) =>
  ({ kind: "UNDO", playerId, source, at, seq });

console.log("=== secuencias adversarias ===");

// 1. TAKE, TAKE del mismo, UNDO, TAKE otra vez — todo en el MISMO instante.
{
  const s = fold([
    take("a", { at: T, seq: 1 }), take("a", { at: T, seq: 2 }),
    undo("a", { at: T, seq: 3 }), take("a", { at: T, seq: 4 }),
  ]);
  check("mismo instante: gana el último TAKE", s.count === 1 && s.byPlayer.has("a"), `count=${s.count}`);
}

// 2. UNDO con el mismo at y seq MENOR que el TAKE: el orden lo decide seq.
{
  const s = fold([take("a", { at: T, seq: 5 }), undo("a", { at: T, seq: 2 })]);
  check("UNDO anterior por seq NO borra un TAKE posterior", s.byPlayer.has("a"), `count=${s.count}`);
}

// 3. Colisión total: mismo at, mismo seq, fuentes distintas. MANUAL manda.
{
  const s = fold([
    take("a", { at: T, seq: 1, source: SOURCE.SLEEPER, roster: ROSTER.OPPONENT }),
    take("a", { at: T, seq: 1, source: SOURCE.MANUAL, roster: ROSTER.MINE }),
  ]);
  check("at y seq idénticos: MANUAL gana la atribución",
        s.count === 1 && s.mine.has("a"), `mine=${[...s.mine]}`);
}

// 4. El fallo de los quince segundos, con la lista entera reenviada 5 veces.
{
  const picks = Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i}`, roster: ROSTER.OPPONENT, pickNo: i + 1 }));
  const persistido = [undo("p3", { at: T, seq: 1 })];
  let anterior = null, estable = true;
  for (let vuelta = 0; vuelta < 5; vuelta += 1) {
    const s = fold([...persistido, ...providerEvents(picks)]);
    if (s.byPlayer.has("p3")) estable = false;
    const firma = s.picks.map((p) => p.playerId).join();
    if (anterior !== null && firma !== anterior) estable = false;
    anterior = firma;
  }
  check("el proveedor reenvía 5 veces y el UNDO manual aguanta", estable);
  check("y el resto de su lista sí entra", fold([...persistido, ...providerEvents(picks)]).count === 11);
}

// 5. UNDO de alguien que nunca se tomó: no puede romper ni inventar estado.
{
  const s = fold([undo("fantasma"), take("a", { at: T + 1, seq: 2 })]);
  check("UNDO de un jugador nunca tomado es inocuo", s.count === 1 && !s.byPlayer.has("fantasma"));
}

// 6. Eventos que llegan al REVÉS (UNDO antes que su TAKE en el array).
{
  const s = fold([undo("a", { at: T + 10, seq: 9 }), take("a", { at: T, seq: 1 })]);
  check("orden de llegada invertido: manda el reloj, no el array",
        !s.byPlayer.has("a"), `count=${s.count}`);
}

// 7. Eventos idénticos duplicados N veces.
{
  const e = take("a");
  const s = fold([e, e, e, e, e]);
  check("el mismo evento cinco veces cuenta una", s.count === 1);
}

// 8. Proveedor sin pickNo: cae al final conservando su orden de llegada.
{
  const s = fold(providerEvents([
    { playerId: "x" }, { playerId: "y" }, { playerId: "z" },
  ]));
  check("picks de proveedor sin ordinal conservan su orden",
        s.picks.map((p) => p.playerId).join() === "x,y,z");
}

// 9. Proveedor con ordinales DUPLICADOS.
{
  const s = fold(providerEvents([
    { playerId: "x", pickNo: 1 }, { playerId: "y", pickNo: 1 }, { playerId: "z", pickNo: 1 },
  ]));
  check("ordinales duplicados no pierden picks", s.count === 3, `count=${s.count}`);
}

// 10. Barajado masivo: 400 eventos, 200 permutaciones, mismo resultado.
{
  const rand = rng(7);
  const base = [];
  for (let i = 0; i < 200; i += 1) base.push(take(`p${i}`, { at: T + i, seq: i + 1 }));
  for (let i = 0; i < 60; i += 1) base.push(undo(`p${i * 3}`, { at: T + 300 + i, seq: 300 + i }));
  for (let i = 0; i < 40; i += 1) base.push(take(`p${i * 3}`, { at: T + 600 + i, seq: 600 + i, roster: ROSTER.MINE }));
  const referencia = fold(base);
  let estable = true;
  for (let n = 0; n < 200; n += 1) {
    const copia = [...base];
    for (let i = copia.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    const s = fold(copia);
    if (s.count !== referencia.count) { estable = false; break; }
    if (s.picks.map((p) => p.playerId).join() !== referencia.picks.map((p) => p.playerId).join()) { estable = false; break; }
    if ([...s.mine].sort().join() !== [...referencia.mine].sort().join()) { estable = false; break; }
  }
  check("200 permutaciones de 300 eventos dan el mismo estado", estable,
        `count=${referencia.count} mine=${referencia.mine.size}`);
}

// 11. Numeración: tras deshacer del medio, los siguientes se renumeran solos.
{
  const s = fold([
    take("a", { at: T, seq: 1 }), take("b", { at: T + 1, seq: 2 }),
    take("c", { at: T + 2, seq: 3 }), undo("b", { at: T + 3, seq: 4 }),
  ]);
  check("renumeración tras deshacer del medio",
        s.picks.map((p) => `${p.playerId}${p.overall}`).join() === "a1,c2",
        s.picks.map((p) => `${p.playerId}:${p.overall}`).join());
}

// 12. Sin NaN, sin negativos, sin campos perdidos en ningún pick.
{
  const s = fold([...providerEvents([{ playerId: "x", pickNo: 2 }]), take("y", { at: T, seq: 1 })]);
  const sano = s.picks.every((p) =>
    Number.isFinite(p.at) && Number.isFinite(p.seq) && p.overall > 0 && typeof p.playerId === "string");
  check("ningún pick con NaN, negativo o campo perdido", sano, JSON.stringify(s.picks));
}

console.log(`\n${fallos === 0 ? "SIN FALLOS" : fallos + " FALLOS"}`);
process.exit(fallos === 0 ? 0 : 1);
