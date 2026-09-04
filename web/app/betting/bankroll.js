/**
 * Bankroll mensual y ciclo de vida de apuestas. Todo local, todo del usuario.
 *
 * ## El modelo
 *
 * UN MES = UN CONTEXTO. Cada mes tiene su banca inicial declarada por el
 * usuario, su libro de apuestas y su historial, bajo su propia clave — la
 * misma disciplina de aislamiento que E14 impone a las ligas: cambiar de mes
 * jamás toca el anterior, y NUNCA se arrastra la banca automáticamente. Si
 * octubre quiere empezar con lo que acabó septiembre, lo elige el usuario.
 *
 * ## La apuesta
 *
 * Estados: CONSIDERING → PLACED → WON | LOST | PUSH | VOID.
 *
 * Al pasar a PLACED se congela un SNAPSHOT (línea, cuota, stake, salida del
 * modelo, versión) que no se vuelve a tocar: si el modelo o la línea cambian
 * mañana, la apuesta registrada sigue diciendo lo que se sabía al apostarla.
 * «Place» significa REGISTRAR EN GRIDIRON: aquí no se transmite dinero a
 * ningún sitio y ninguna pantalla debe insinuar lo contrario.
 *
 * ## El dinero
 *
 * disponible  = inicial + P/L liquidado − expuesto en abiertas
 * banca ahora = inicial + P/L liquidado
 * WON  liquida stake × (decimal − 1); LOST liquida −stake; PUSH y VOID, 0.
 */

export const MONTHS_KEY = "gridiron-bank-months-v1";
export const BANK_PREFIX = "gridiron-bank-v1";

export const BET_STATUS = Object.freeze({
  CONSIDERING: "CONSIDERING", PLACED: "PLACED",
  WON: "WON", LOST: "LOST", PUSH: "PUSH", VOID: "VOID",
});
const OPEN = new Set([BET_STATUS.PLACED]);
const SETTLED = new Set([BET_STATUS.WON, BET_STATUS.LOST, BET_STATUS.PUSH, BET_STATUS.VOID]);

/** Cuota americana -> decimal. `null` si no es interpretable: no se inventa. */
export function decimalFromAmerican(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

export function monthKey(month) {
  return /^\d{4}-\d{2}$/.test(month ?? "") ? `${BANK_PREFIX}:${month}` : null;
}

export function loadMonths(storage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(MONTHS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((m) => /^\d{4}-\d{2}$/.test(m)).sort() : [];
  } catch { return []; }
}

export function loadMonth(month, storage) {
  const key = monthKey(month);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") return null;
    return {
      month,
      starting: Number(data.starting) || 0,
      unitIsPercent: data.unitIsPercent !== false,   // 1u = 1% de la inicial, salvo que se cambie
      unitValue: Number(data.unitValue) || 1.0,      // en % de la inicial o en $ según el modo
      limits: data.limits && typeof data.limits === "object" ? data.limits : {},
      bets: Array.isArray(data.bets) ? data.bets : [],
    };
  } catch { return null; }
}

export function saveMonth(record, storage) {
  const key = monthKey(record?.month);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify(record));
    const months = loadMonths(storage);
    if (!months.includes(record.month)) {
      storage.setItem(MONTHS_KEY, JSON.stringify([...months, record.month].sort()));
    }
    return true;
  } catch { return false; }
}

/** Crea un mes NUEVO. Se niega a pisar uno existente: la historia es inmutable. */
export function createMonth(month, starting, storage) {
  if (!monthKey(month) || !(Number(starting) > 0)) return null;
  if (loadMonth(month, storage)) return null;
  const record = { month, starting: Number(starting), unitIsPercent: true, unitValue: 1.0, limits: {}, bets: [] };
  return saveMonth(record, storage) ? record : null;
}

/**
 * Un entero, o `null`. NO vale `Number.isFinite(Number(x))`: `Number(null)` y
 * `Number("")` valen CERO, que es finito, así que una apuesta sin jornada se
 * habría guardado como «jornada 0» — un valor inventado colado como dato real,
 * el mismo fallo que el `counts[pos] || DEFAULT` de las ligas de Sleeper.
 */
function intOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

let seq = 0;
function betId() {
  seq += 1;
  return `bet-${Date.now().toString(36)}-${seq}`;
}

/** Añade al slip (CONSIDERING). El snapshot del modelo viaja YA, congelado. */
export function addBet(record, bet) {
  const entry = {
    id: betId(),
    status: BET_STATUS.CONSIDERING,
    market: String(bet.market ?? ""),          // SPREAD | TOTAL | PROP_<STAT>
    label: String(bet.label ?? ""),            // «BUF −2.5», «J.Allen O267.5 pass yds»
    selection: String(bet.selection ?? ""),
    line: bet.line ?? null,
    odds: bet.odds ?? null,
    stake: Number(bet.stake) || 0,
    gameId: bet.gameId ?? null,
    playerId: bet.playerId ?? null,
    team: bet.team ?? null,
    // Temporada y jornada se CONGELAN al registrar. Sin esto el libro no se
    // puede leer por semana, y repartir después las apuestas por su fecha
    // sería inventarles una jornada — el fallo de la regla 5 aplicado al
    // dinero. Un libro anterior a este campo se queda en `null` y se agrupa
    // aparte como UNKNOWN, que es lo que es.
    season: intOrNull(bet.season),
    week: intOrNull(bet.week),
    snapshot: bet.snapshot && typeof bet.snapshot === "object" ? bet.snapshot : {},
    createdAt: bet.at ?? Date.now(),
    placedAt: null,
    settledAt: null,
  };
  return { ...record, bets: [...record.bets, entry] };
}

export function updateBet(record, id, patch) {
  return {
    ...record,
    bets: record.bets.map((bet) => {
      if (bet.id !== id) return bet;
      if (bet.status !== BET_STATUS.CONSIDERING) return bet;  // lo colocado no se edita
      // Lo congelado no se parchea: estado, snapshot, horas, y el CUÁNDO
      // (temporada y jornada), que es lo que hace legible el libro por semana.
      const { status, snapshot, placedAt, settledAt, season, week, ...safe } = patch;
      void status; void snapshot; void placedAt; void settledAt; void season; void week;
      return { ...bet, ...safe };
    }),
  };
}

export function removeBet(record, id) {
  return {
    ...record,
    bets: record.bets.filter((bet) => !(bet.id === id && bet.status === BET_STATUS.CONSIDERING)),
  };
}

/**
 * CONSIDERING -> PLACED. Exige stake > 0 y cuota interpretable; congela la hora.
 * Devuelve el registro sin tocar si algo falta: colocar a medias no existe.
 */
export function placeBets(record, ids, { at = Date.now() } = {}) {
  const wanted = new Set(ids);
  let changed = false;
  const bets = record.bets.map((bet) => {
    if (!wanted.has(bet.id) || bet.status !== BET_STATUS.CONSIDERING) return bet;
    if (!(bet.stake > 0) || decimalFromAmerican(bet.odds) === null) return bet;
    changed = true;
    return { ...bet, status: BET_STATUS.PLACED, placedAt: at };
  });
  return changed ? { ...record, bets } : record;
}

/** PLACED -> WON/LOST/PUSH/VOID. La liquidación también es de una sola vía. */
export function settleBet(record, id, result, { at = Date.now() } = {}) {
  if (!SETTLED.has(result)) return record;
  return {
    ...record,
    bets: record.bets.map((bet) =>
      bet.id === id && bet.status === BET_STATUS.PLACED
        ? { ...bet, status: result, settledAt: at }
        : bet
    ),
  };
}

function profit(bet) {
  if (bet.status === BET_STATUS.WON) {
    const decimal = decimalFromAmerican(bet.odds);
    return decimal === null ? 0 : bet.stake * (decimal - 1);
  }
  if (bet.status === BET_STATUS.LOST) return -bet.stake;
  return 0; // PUSH y VOID devuelven el stake: P/L cero
}

/** Todas las cuentas del mes, derivadas del libro. Una sola fuente de verdad. */
export function summary(record) {
  const placedLike = record.bets.filter((b) => OPEN.has(b.status) || SETTLED.has(b.status));
  const open = record.bets.filter((b) => OPEN.has(b.status));
  const settled = record.bets.filter((b) => SETTLED.has(b.status));
  const openExposure = open.reduce((sum, b) => sum + b.stake, 0);
  const settledPL = settled.reduce((sum, b) => sum + profit(b), 0);
  const unitDollars = record.unitIsPercent
    ? (record.starting * record.unitValue) / 100
    : record.unitValue;
  return {
    starting: record.starting,
    current: record.starting + settledPL,
    available: record.starting + settledPL - openExposure,
    openExposure,
    settledPL,
    roi: record.starting > 0 ? settledPL / record.starting : 0,
    totalStaked: placedLike.reduce((sum, b) => sum + b.stake, 0),
    bets: placedLike.length,
    openCount: open.length,
    wins: settled.filter((b) => b.status === BET_STATUS.WON).length,
    losses: settled.filter((b) => b.status === BET_STATUS.LOST).length,
    pushes: settled.filter((b) => b.status === BET_STATUS.PUSH).length,
    voids: settled.filter((b) => b.status === BET_STATUS.VOID).length,
    unitDollars,
  };
}

/**
 * Exposición ABIERTA agrupada: por partido, por equipo, por jugador y por tipo
 * de mercado. Es agrupación DESCRIPTIVA — cinco apuestas del mismo partido no
 * son cinco ideas independientes, y esto lo hace visible sin inventarse
 * ningún coeficiente de correlación.
 */
export function exposure(record) {
  const open = record.bets.filter((b) => OPEN.has(b.status));
  const roll = (keyOf) => {
    const out = new Map();
    for (const bet of open) {
      const key = keyOf(bet);
      if (!key) continue;
      out.set(key, (out.get(key) ?? 0) + bet.stake);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([key, amount]) => ({ key, amount }));
  };
  return {
    byGame: roll((b) => b.gameId),
    byTeam: roll((b) => b.team),
    byPlayer: roll((b) => b.playerId),
    byMarket: roll((b) => b.market),
  };
}

/**
 * Avisos de límites definidos POR EL USUARIO (maxStakePct, maxOpenPct,
 * maxGamePct, en % de la banca inicial). Son sus reglas de banca, no una
 * afirmación de Gridiron sobre el riesgo óptimo. Devuelve avisos, no bloqueos.
 */
export function limitWarnings(record, candidate = null) {
  const warnings = [];
  const { starting, openExposure } = summary(record);
  const limits = record.limits ?? {};
  const pct = (amount) => (starting > 0 ? (amount / starting) * 100 : 0);
  if (candidate && limits.maxStakePct > 0 && pct(candidate.stake) > limits.maxStakePct) {
    warnings.push(`Stake ${pct(candidate.stake).toFixed(1)}% exceeds your ${limits.maxStakePct}% per-bet rule`);
  }
  const nextOpen = openExposure + (candidate?.stake ?? 0);
  if (limits.maxOpenPct > 0 && pct(nextOpen) > limits.maxOpenPct) {
    warnings.push(`Open exposure ${pct(nextOpen).toFixed(1)}% exceeds your ${limits.maxOpenPct}% rule`);
  }
  if (candidate?.gameId && limits.maxGamePct > 0) {
    const inGame = exposure(record).byGame.find((g) => g.key === candidate.gameId)?.amount ?? 0;
    if (pct(inGame + candidate.stake) > limits.maxGamePct) {
      warnings.push(`Exposure on this game would exceed your ${limits.maxGamePct}% per-game rule`);
    }
  }
  return warnings;
}

/**
 * TODO EL LIBRO, EN UN TEXTO. Y de vuelta.
 *
 *     LO QUE VIVE EN UN SOLO NAVEGADOR NO ESTÁ GUARDADO, ESTÁ ALOJADO.
 *
 * El registro es local por diseño —sin cuentas, sin servidor, sin base de
 * datos— y eso tiene una consecuencia que la pantalla no puede callar: vaciar
 * los datos del sitio, cambiar de teléfono o abrir en otro navegador y el libro
 * no está. Exportar es la única copia de seguridad posible sin traicionar la
 * regla 4, y no cuesta un destino de red: es texto que se copia.
 */
export function exportBook(storage) {
  const months = loadMonths(storage);
  return JSON.stringify({
    kind: "gridiron-bankroll", version: 1, exportedAt: new Date().toISOString(),
    months: months.map((m) => loadMonth(m, storage)).filter(Boolean),
  }, null, 1);
}

/**
 * Restaura meses desde un texto exportado.
 *
 * **No pisa nada.** Un mes que ya existe se salta y se cuenta aparte: la
 * historia es inmutable en `createMonth` por la misma razón, y una importación
 * que machacara septiembre porque el fichero es más viejo sería la peor forma
 * de perder el libro — la que parece que funcionó.
 */
export function importBook(text, storage) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: "That is not the exported text." }; }
  if (!data || data.kind !== "gridiron-bankroll" || !Array.isArray(data.months)) {
    return { error: "That text is not a Gridiron bankroll export." };
  }
  const added = [];
  const skipped = [];
  for (const record of data.months) {
    if (!monthKey(record?.month)) continue;
    if (loadMonth(record.month, storage)) { skipped.push(record.month); continue; }
    if (saveMonth({
      month: record.month,
      starting: Number(record.starting) || 0,
      unitIsPercent: record.unitIsPercent !== false,
      unitValue: Number(record.unitValue) || 1,
      limits: record.limits && typeof record.limits === "object" ? record.limits : {},
      bets: Array.isArray(record.bets) ? record.bets : [],
    }, storage)) added.push(record.month);
  }
  return { added, skipped };
}
