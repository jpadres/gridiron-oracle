/**
 * FASE 2 — políticas de simulación de draft. NO son consejo de fantasy.
 *
 * Existen para generar estados de draft VÁLIDOS Y DIVERSOS con los que atacar
 * el motor. Ninguna afirma ser buena estrategia y ninguna entra en el producto.
 * Son deterministas: misma semilla, mismo draft, o el laboratorio no sirve para
 * reproducir un fallo.
 */

/** PRNG determinista (mulberry32). `Math.random` haría irreproducible un fallo. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cuenta = (roster, position) => roster.filter((p) => p.position === position).length;
const primero = (pool, filtro) => pool.find(filtro) ?? null;

/** Cada política recibe (pool disponible ordenado por valor, su roster, rand). */
export const POLICIES = {
  // Coge el mejor del board genérico. Es la referencia.
  ADP: (pool) => pool[0] ?? null,

  // Reacciona a rachas: si en los últimos 6 picks hubo 3+ de una posición, la
  // persigue. Modela el efecto rebaño, no lo recomienda.
  RUN: (pool, roster, rand, ctx) => {
    const recientes = ctx.recent.slice(-6);
    for (const pos of ["RB", "WR", "TE", "QB"]) {
      if (recientes.filter((p) => p === pos).length >= 3) {
        const hit = primero(pool, (p) => p.position === pos);
        if (hit) return hit;
      }
    }
    return pool[0] ?? null;
  },

  // Retrasa el corredor hasta la ronda 5.
  ZERO_RB: (pool, roster, rand, ctx) =>
    (ctx.round <= 4 ? primero(pool, (p) => p.position !== "RB") : null) ?? pool[0] ?? null,

  // Corredores primero, hasta tres.
  RB_HEAVY: (pool, roster) =>
    (cuenta(roster, "RB") < 3 ? primero(pool, (p) => p.position === "RB") : null) ?? pool[0] ?? null,

  QB_EARLY: (pool, roster) =>
    (cuenta(roster, "QB") < 1 ? primero(pool, (p) => p.position === "QB") : null) ?? pool[0] ?? null,

  TE_EARLY: (pool, roster) =>
    (cuenta(roster, "TE") < 1 ? primero(pool, (p) => p.position === "TE") : null) ?? pool[0] ?? null,

  // Necesidad sintética: rellena mínimos declarados antes de ir a por valor.
  NEED: (pool, roster, rand, ctx) => {
    for (const [pos, min] of Object.entries(ctx.needs)) {
      if (cuenta(roster, pos) < min) {
        const hit = primero(pool, (p) => p.position === pos);
        if (hit) return hit;
      }
    }
    return pool[0] ?? null;
  },

  // Cualquier jugador válido, con azar sembrado. Es el que encuentra los bugs.
  CHAOS: (pool, roster, rand) =>
    pool.length ? pool[Math.floor(rand() * Math.min(pool.length, 40))] : null,
};

export const POLICY_NAMES = Object.keys(POLICIES);
