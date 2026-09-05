/**
 * EL MOTOR DE SIMULACIÓN DE DRAFT, compartido.
 *
 * Estaba dentro de `draft-sim.mjs`. Al escribir la tortura ampliada —siete
 * tamaños de liga, formatos y bots rivales— la alternativa era copiarlo, y una
 * segunda copia del mismo bucle es exactamente el fallo que este repositorio ha
 * cometido siete veces: dos traductores del mismo formato que divergen. Uno
 * solo, y los dos laboratorios lo llaman.
 *
 * El motor NO decide nada: importa las funciones del PRODUCTO (`bestForMe`,
 * `candidates`, `starterState`) y las ejecuta. Si un día la simulación y la
 * pantalla difieren, es porque alguien cambió el producto, no el laboratorio.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { model } = await import(path.join(WEB, "data/model.js"));
const { bestForMe, candidates } = await import(path.join(WEB, "app/fantasy/candidates.js"));
const { POSITION_STATE, replacementPoints, starterState } =
  await import(path.join(WEB, "app/fantasy/rosterFit.js"));

export { POSITION_STATE, starterState, candidates, bestForMe };
export const BOARD = model.fantasy.board;
export const REP = replacementPoints(BOARD);

/* ── plantillas de liga ──────────────────────────────────────────────────── */
export const ROSTERS = {
  NORMAL: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K",
           "BN", "BN", "BN", "BN", "BN", "BN"],
  SUPERFLEX: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF", "K",
              "BN", "BN", "BN", "BN", "BN"],
  DOS_QB: ["QB", "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K",
           "BN", "BN", "BN", "BN", "BN"],
  SIN_FLEX: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DEF", "K",
             "BN", "BN", "BN", "BN", "BN", "BN"],
  TRES_FLEX: ["QB", "RB", "RB", "WR", "WR", "FLEX", "FLEX", "FLEX", "DEF", "K",
              "BN", "BN", "BN", "BN", "BN"],
  SIN_TE: ["QB", "RB", "RB", "WR", "WR", "WR", "FLEX", "DEF", "K",
           "BN", "BN", "BN", "BN", "BN", "BN"],
  SIN_K_NI_DEF: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX",
                 "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN"],
  TREINTAYDOS: ["RB", "WR", "FLEX", "FLEX", "FLEX", "SUPER_FLEX",
                "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN"],
};

/* ── rivales deterministas ───────────────────────────────────────────────
   Son TORTURA DE COMPORTAMIENTO, no validación predictiva: sirven para poner
   el pool en formas incómodas (una posición agotada, una corrida), no para
   decir si la recomendación es buena. */
function mejorDe(disponibles, positions) {
  const filtrados = disponibles.filter((r) => positions.includes(r.position));
  return candidates(filtrados.length ? filtrados : disponibles, { limit: 1 })[0]?.row
    ?? (filtrados.length ? filtrados : disponibles)[0];
}
/** PRNG determinista: mismo seed, mismo draft. Sin `Math.random`. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const BOTS = {
  bpa: () => (disp) => candidates(disp, { limit: 1 })[0]?.row ?? disp[0],
  rbHeavy: () => (disp, { ronda }) => (ronda <= 6 ? mejorDe(disp, ["RB"]) : mejorDe(disp, ["WR", "TE", "QB", "RB"])),
  wrHeavy: () => (disp, { ronda }) => (ronda <= 6 ? mejorDe(disp, ["WR"]) : mejorDe(disp, ["RB", "TE", "QB", "WR"])),
  qbEarly: () => (disp, { ronda }) => (ronda <= 3 ? mejorDe(disp, ["QB"]) : candidates(disp, { limit: 1 })[0]?.row ?? disp[0]),
  teHeavy: () => (disp, { ronda }) => (ronda <= 4 ? mejorDe(disp, ["TE"]) : candidates(disp, { limit: 1 })[0]?.row ?? disp[0]),
  // Corridas: todos los rivales van a la misma posición durante tramos.
  posRun: () => (disp, { overall }) => {
    const orden = ["WR", "RB", "TE", "QB"];
    return mejorDe(disp, [orden[Math.floor(overall / 7) % orden.length]]);
  },
  randomValid: (seed = 7) => { const r = rng(seed); return (disp) => disp[Math.floor(r() * Math.min(disp.length, 40))] ?? disp[0]; },
  // §40 — tres rivales más, cada uno una forma distinta de vaciar el pool:
  // ESCASEZ: va a la posición con MENOS jugadores por encima del reemplazo.
  // Es el rival que agota justo lo que a ti te falta, que es el escenario que
  // dejó un hueco titular vacío para siempre (candidates.js, 2026-09).
  scarcity: () => (disp) => {
    let peor = null;
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const quedan = disp.filter((r) => r.position === pos && (r.vor ?? 0) > 0).length;
      if (quedan > 0 && (peor === null || quedan < peor.quedan)) peor = { pos, quedan };
    }
    return peor ? mejorDe(disp, [peor.pos]) : (candidates(disp, { limit: 1 })[0]?.row ?? disp[0]);
  },
  // ZERO RB: ni un corredor hasta la ronda 5, después el mejor del board.
  zeroRb: () => (disp, { ronda }) => (ronda <= 4
    ? mejorDe(disp, ["WR", "TE", "QB"])
    : candidates(disp, { limit: 1 })[0]?.row ?? disp[0]),
  // ADP CON RUIDO: humano medio — coge uno de los tres primeros, el primero
  // el 60% de las veces. Es la varianza que un draft real tiene y bpa no.
  adpNoise: (seed = 11) => { const r = rng(seed); return (disp) => {
    const x = r(); const k = x < 0.6 ? 0 : x < 0.85 ? 1 : 2;
    return disp[Math.min(k, disp.length - 1)] ?? disp[0];
  }; },
};

/**
 * Un draft entero. Yo sigo la recomendación; los rivales, la estrategia dada.
 *
 * `snake` false = orden lineal (el mismo puesto elige en la misma posición de
 * cada ronda), que algunas ligas usan y cambia por completo el hueco entre mis
 * turnos — justo lo que hace fallar un cálculo de «cuántos picks me quedan».
 */
export function simular({
  nombre, roster, teams, rounds, mySlot, opponent = BOTS.bpa(), snake = true, log = false,
}) {
  const tomados = new Set();
  const mio = [];
  const turnos = [];
  const total = teams * rounds;

  for (let overall = 1; overall <= total; overall += 1) {
    const ronda = Math.floor((overall - 1) / teams) + 1;
    const enRonda = ((overall - 1) % teams) + 1;
    const puesto = snake && ronda % 2 === 0 ? teams - enRonda + 1 : enRonda;
    const disponibles = BOARD.filter((r) => !tomados.has(r.player_id));
    if (!disponibles.length) break;

    if (puesto !== mySlot) {
      const suyo = opponent(disponibles, { ronda, overall });
      if (suyo) tomados.add(suyo.player_id);
      continue;
    }

    const picksRestantes = rounds - ronda + 1;
    const board = candidates(disponibles, { limit: 4 });
    const para = bestForMe(disponibles, {
      roster: mio, rosterPositions: roster, replacement: REP, picksLeftForMe: picksRestantes,
    });
    const elegido = para?.primary?.row ?? para?.bench?.[0]?.row ?? board[0]?.row ?? disponibles[0];
    const estado = starterState({ roster: mio, rosterPositions: roster });
    turnos.push({
      overall, ronda, picksRestantes,
      abiertos: estado.open.map((s) => s.slot),
      mejorBoard: board[0] ? `${board[0].row.position} ${board[0].row.player_name}` : "—",
      // `fit` puede ser null a propósito: en la rama de «llenar un hueco vacío»
      // nadie supera el reemplazo, así que no hay marginal que enseñar y no se
      // inventa uno. Se marca con «(hueco)».
      paraMi: para?.primary
        ? `${para.primary.row.position} ${para.primary.row.player_name} `
          + (para.primary.fit ? `(+${para.primary.fit.marginal.toFixed(0)})` : "(hueco)")
        : "— banquillo",
      llenaHuecoVacio: Boolean(para?.fillingEmptySlot),
      muestraCorta: Boolean(para?.shortSampleOnly),
      // Los partidos ponderados del recomendado, para poder comprobar que la
      // etiqueta «muestra corta» sea CIERTA y no sólo esté puesta.
      wgRecomendado: para?.primary?.row
        ? (para.primary.row.weighted_games ?? para.primary.row.wg ?? null) : null,
      rookieRecomendado: Boolean(para?.primary?.row?.rookie),
      porque: para?.primary?.reasons.map((r) => r.text).join(" · ") ?? "",
      urgeEspecialista: Boolean(para?.mustFillSpecialist),
      benchPrimero: para?.bench?.length ? Boolean(para.bench[0].canStart) : null,
      benchTodosLlenos: Boolean(para?.bench?.length) && para.bench.every((b) => !b.canStart),
      elegido: elegido ? `${elegido.position} ${elegido.player_name}` : "—",
      elegidoPos: elegido?.position ?? null,
      estadoPos: { ...estado.byPosition },
    });
    if (elegido) { tomados.add(elegido.player_id); mio.push(elegido); }
  }
  if (log) {
    console.log(`\n=== ${nombre} · ${teams} equipos × ${rounds} rondas, puesto ${mySlot} ===`);
    for (const t of turnos) {
      console.log(`   R${String(t.ronda).padStart(2)} board:${t.mejorBoard.padEnd(26)} `
        + `para mí:${t.paraMi.padEnd(30)} elijo:${t.elegido.padEnd(22)} ${t.porque.slice(0, 40)}`);
    }
  }
  return { turnos, mio, tomados };
}
