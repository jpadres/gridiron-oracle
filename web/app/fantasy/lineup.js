/**
 * La alineación de la semana: la que tienes puesta, la que más proyecta, y el
 * enfrentamiento hueco por hueco.
 *
 *     ESTO ORDENA POR PROYECCIÓN. NO PROMETE QUE GANES.
 *
 * «Generar la mejor alineación» es un optimizador sobre números ya publicados:
 * reparte tus jugadores en los huecos que tu liga declara y se queda con el
 * reparto de mayor suma. Eso es aritmética y se puede comprobar. Lo que NO es,
 * y la pantalla lo dice donde se pulsa:
 *
 *   - No es «la mejor»: es la de mayor proyección, y la proyección semanal de
 *     este proyecto es una mezcla que gana al promedio de seis partidos por
 *     poco. Una diferencia de un punto entre dos opciones está DENTRO del ruido.
 *   - No sabe de lesiones de última hora, de que alguien salga del banquillo ni
 *     de tu estrategia. Si vas último y necesitas varianza, la alineación de
 *     mayor media es justo la que no quieres.
 *
 * Por eso el resultado se enseña como una PROPUESTA con su diferencia al lado,
 * y quien decide sigue siendo quien juega.
 *
 * ## Por qué el mismo repartidor de siempre
 *
 * Los huecos los llena `assignSlots`, el mismo del board, el Draft Room y el
 * analizador — espejo de `league.assign_slots` de Python. Un cuarto modelo de
 * flex en este proyecto ya costó una iteración; no va a haber un quinto.
 */

import { assignSlots } from "./leagueValue.js";
import { hasStarted } from "../gameClock.js";

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/** Huecos que no se alinean. Sleeper publica `starters` SIN ellos. */
const BENCH = new Set(["BN", "BE", "BENCH", "IR", "TAXI"]);

/**
 * Los huecos titulares de la liga, en el orden en que Sleeper publica
 * `starters`: `roster_positions` sin los de banquillo.
 *
 * Vive aquí, en la capa baja, porque lo necesitan los DOS motores de
 * alineación y `lockedSlots` cruza la posición del hueco con la del titular:
 * si uno de los dos contara el banquillo, los índices se desplazarían y el
 * candado caería en el hueco de otro.
 */
export function starterSlots(rosterPositions) {
  return (rosterPositions ?? [])
    .map((raw) => String(raw ?? "").toUpperCase().trim())
    .filter((slot) => slot && !BENCH.has(slot));
}

/** Las filas de una lista de ids, resueltas contra el índice semanal. */
export function rowsOf(ids, index) {
  const rows = [];
  const missing = [];
  for (const raw of ids ?? []) {
    const id = String(raw ?? "");
    if (!id || id === "0") continue;
    const row = index?.get(id);
    if (row) rows.push({ ...row, sid: id });
    else missing.push(id);
  }
  return { rows, missing };
}

/**
 * QUÉ HUECOS ESTÁN CONGELADOS PORQUE SU PARTIDO YA TERMINÓ.
 *
 *     A MEDIA JORNADA, QUIEN YA JUGÓ NI ENTRA NI SALE.
 *
 * Devuelve `índice de hueco -> sid`. Vive aquí y no en cada pantalla porque el
 * analizador y `/fantasy/lineups` son DOS motores distintos para la misma
 * decisión —`lineupFrom` y `bestLineup`— y la regla tiene que ser una: cablear
 * el candado sólo en el segundo habría dejado «Generate best lineup»
 * proponiendo sacar a un titular que ya jugó, que es el fallo de los dos
 * traductores del mismo formato por undécima vez.
 *
 * Sin `starters` no se congela nada: la pantalla que no sabe qué tienes puesto
 * no puede saber qué está bloqueado, y suponer que el hueco N lo ocupa el
 * jugador N sería inventarse una alineación.
 */
export function lockedSlots({ starters, slots, index, now = null }) {
  const congelados = new Map();
  if (!Array.isArray(starters) || !Array.isArray(slots)) return congelados;
  for (let i = 0; i < slots.length; i += 1) {
    const sid = String(starters[i] ?? "");
    if (!sid || sid === "0") continue;
    // `isOpen` es la MISMA regla que cierra un mercado en /betting: sin ella,
    // un partido en marcha cerraba la apuesta y dejaba el hueco suelto — el
    // mismo hecho con dos respuestas según la pantalla, que es el fallo que
    // este repositorio ha cometido once veces.
    const row = index?.get?.(sid);
    if (row && hasStarted(row, now)) congelados.set(i, sid);
  }
  return congelados;
}

/**
 * Una alineación valorada con la proyección SEMANAL.
 *
 * `assignSlots` ordena por `vor ?? projected_points`, así que se le pasa
 * `vor` con la proyección de la semana: es el mismo repartidor midiendo otra
 * cosa, no otro repartidor.
 *
 * Lo que no tiene proyección (una defensa, un id que el mapa no conoce) ocupa
 * su hueco y **no suma**, y se cuenta aparte. Contarlo como cero hundiría a
 * quien tiene defensa titular, que es todo el mundo.
 */
export function lineupFrom({ ids, index, rosterPositions, starters = null, now = null }) {
  // SIN BANQUILLO: `starters` de Sleeper viene alineado con esta lista, así que
  // contar los BN aquí desplazaría el candado al hueco de otro.
  const huecos = starterSlots(rosterPositions);
  const { rows, missing } = rowsOf(ids, index);
  // Los huecos cuyo partido acabó no se reparten: se devuelven donde estaban.
  const congelados = lockedSlots({ starters, slots: huecos, index, now });
  const fijos = new Set(congelados.values());
  const paraRepartir = rows
    .filter((r) => !fijos.has(String(r.sid)))
    .map((r) => ({ ...r, vor: Number(r.projected_points) }));
  const libres = huecos.filter((_, i) => !congelados.has(i));
  const repartidos = assignSlots(paraRepartir, libres);
  const unassigned = repartidos.unassigned;
  const cola = [...repartidos.slots];
  const slots = huecos.map((slot, i) => {
    if (!congelados.has(i)) return cola.shift() ?? { slot, player: null };
    const sid = congelados.get(i);
    const row = index?.get?.(sid) ?? null;
    return { slot, player: row ? { ...row, sid } : null, locked: true };
  });
  let points = 0;
  let unknown = 0;
  for (const slot of slots) {
    const p = Number(slot.player?.projected_points);
    if (slot.player && Number.isFinite(p)) points += p;
    else if (slot.player) unknown += 1;
  }
  return {
    slots,
    bench: unassigned,
    points: round1(points),
    unknown,
    missing,
  };
}

/**
 * Lo que cambiaría entre la alineación que tienes puesta y la de mayor
 * proyección: a quién sentar, a quién sacar, y cuánto suma el cambio.
 *
 * Devuelve `null` cuando Sleeper no publica titulares: sin saber lo que tienes
 * puesto no se puede proponer un cambio, y proponerlo sobre una alineación
 * inventada es peor que no proponer nada.
 */
export function startSit({ currentIds, best }) {
  if (!Array.isArray(currentIds) || currentIds.length === 0) return null;
  const actuales = new Set(currentIds.map(String).filter((x) => x && x !== "0"));
  const propuestos = new Set(
    best.slots.filter((s) => s.player?.sid).map((s) => String(s.player.sid))
  );
  const entran = best.slots
    .filter((s) => s.player?.sid && !actuales.has(String(s.player.sid)))
    .map((s) => ({ slot: s.slot, player: s.player }));
  const salen = [...actuales].filter((sid) => !propuestos.has(sid));
  return { entran, salen, sinCambios: entran.length === 0 && salen.length === 0 };
}

/**
 * Los dos equipos, hueco por hueco, para leerlos en paralelo.
 *
 * El emparejamiento es POSICIONAL dentro de la lista de huecos de la liga: el
 * QB de uno frente al QB del otro. Es lo que se quiere comparar, y es exacto
 * porque las dos alineaciones se reparten con los MISMOS huecos.
 */
export function sideBySide(mine, theirs) {
  const n = Math.max(mine?.slots?.length ?? 0, theirs?.slots?.length ?? 0);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const a = mine?.slots?.[i] ?? null;
    const b = theirs?.slots?.[i] ?? null;
    const pa = Number(a?.player?.projected_points);
    const pb = Number(b?.player?.projected_points);
    rows.push({
      slot: a?.slot ?? b?.slot ?? "",
      mine: a?.player ?? null,
      theirs: b?.player ?? null,
      minePoints: Number.isFinite(pa) ? round1(pa) : null,
      theirsPoints: Number.isFinite(pb) ? round1(pb) : null,
      delta: Number.isFinite(pa) && Number.isFinite(pb) ? round1(pa - pb) : null,
    });
  }
  return {
    rows,
    minePoints: mine?.points ?? null,
    theirsPoints: theirs?.points ?? null,
    delta: round1((mine?.points ?? 0) - (theirs?.points ?? 0)),
  };
}
