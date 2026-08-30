/**
 * FASE 10 — matemática de turno, exhaustiva y CRUZADA.
 *
 * El board y el Draft Room calculan «cuándo me toca» con implementaciones
 * DISTINTAS: `draftSync.pickSchedule/picksUntilMe` y
 * `draftLog.slotForOverall/untilMyTurn`. Dos caminos para el mismo hecho es
 * exactamente donde vive un off-by-one que nadie ve, porque cada pantalla es
 * coherente consigo misma.
 *
 * Aquí se comparan puesto a puesto, ronda a ronda, en cinco tamaños de liga.
 */
import { slotForOverall, untilMyTurn, isMyTurn, pickLabel } from "../../app/fantasy/draftLog.js";
import { pickSchedule, picksUntilMe } from "../../app/fantasy/draftSync.js";

let fallos = 0;
const fail = (msg) => { fallos += 1; if (fallos <= 25) console.log(`  FALLA ${msg}`); };

const TAMANOS = [8, 10, 12, 14, 32];
const RONDAS = 10;
let comprobaciones = 0;

for (const teams of TAMANOS) {
  for (const type of ["snake", "linear"]) {
    for (let slot = 1; slot <= teams; slot += 1) {
      const schedule = pickSchedule({ slot, teams, rounds: RONDAS, type });

      // 1. El calendario de draftSync tiene que coincidir con slotForOverall.
      for (const entry of schedule) {
        const pos = slotForOverall(entry.overall, teams, type);
        comprobaciones += 1;
        if (!pos) { fail(`${teams}/${type}/slot${slot}: slotForOverall nulo en ${entry.overall}`); continue; }
        if (pos.round !== entry.round) fail(`${teams}/${type}/slot${slot} ov${entry.overall}: ronda ${pos.round} vs ${entry.round}`);
        if (pos.inRound !== entry.pick) fail(`${teams}/${type}/slot${slot} ov${entry.overall}: pick-en-ronda ${pos.inRound} vs ${entry.pick}`);
        if (pos.slot !== slot) fail(`${teams}/${type}/slot${slot} ov${entry.overall}: puesto ${pos.slot}`);
        if (pickLabel(entry.overall, teams, type) !== entry.label)
          fail(`${teams}/${type}/slot${slot} ov${entry.overall}: etiqueta ${pickLabel(entry.overall, teams, type)} vs ${entry.label}`);
      }

      // 2. Todo pick global cae en EXACTAMENTE un puesto, y la vuelta de ronda
      //    (último de una, primero de la siguiente) es donde falla el snake.
      for (let overall = 1; overall <= teams * RONDAS; overall += 1) {
        const pos = slotForOverall(overall, teams, type);
        comprobaciones += 1;
        if (!pos) { fail(`${teams}/${type}: slotForOverall nulo en ${overall}`); continue; }
        if (pos.slot < 1 || pos.slot > teams) fail(`${teams}/${type} ov${overall}: puesto fuera de rango ${pos.slot}`);
        const esperado = schedule.some((e) => e.overall === overall);
        const dice = pos.slot === slot;
        if (esperado !== dice) fail(`${teams}/${type}/slot${slot} ov${overall}: calendario dice ${esperado}, slotForOverall dice ${dice}`);
        // isMyTurn tiene que coincidir con lo mismo.
        const turno = isMyTurn({ overall, teams, type, mySlot: slot });
        if (turno !== dice) fail(`${teams}/${type}/slot${slot} ov${overall}: isMyTurn ${turno} vs ${dice}`);
      }

      // 3. «Cuántos faltan» desde CADA estado del draft, por los dos caminos.
      for (let hechos = 0; hechos < teams * RONDAS; hechos += 1) {
        const a = picksUntilMe({ schedule, picksMade: hechos });
        const b = untilMyTurn({ count: hechos, teams, type, mySlot: slot, rounds: RONDAS });
        comprobaciones += 1;
        if (!a && !b) continue;
        if (!a || !b) { fail(`${teams}/${type}/slot${slot} hechos=${hechos}: uno nulo (sync=${!!a} log=${!!b})`); continue; }
        if (a.overall !== b.overall) fail(`${teams}/${type}/slot${slot} hechos=${hechos}: overall ${a.overall} vs ${b.overall}`);
        if (a.away !== b.away) fail(`${teams}/${type}/slot${slot} hechos=${hechos}: away ${a.away} vs ${b.away}`);
        if (a.round !== b.round) fail(`${teams}/${type}/slot${slot} hechos=${hechos}: ronda ${a.round} vs ${b.round}`);
        // Propiedad dura: si away===0, el pick que viene AHORA es mío.
        const mio = isMyTurn({ overall: hechos + 1, teams, type, mySlot: slot });
        if ((a.away === 0) !== mio)
          fail(`${teams}/${type}/slot${slot} hechos=${hechos}: away=0 ${a.away === 0} pero isMyTurn ${mio}`);
      }
    }
  }
}

console.log(`\n  ${comprobaciones} comprobaciones cruzadas, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
