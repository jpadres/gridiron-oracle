/**
 * EL PLAN DE LA SEMANA: cuánto poner, calculado sobre la banca DE HOY.
 *
 *     TODO ES UN PORCENTAJE DE LA BANCA ACTUAL.
 *     POR ESO BAJA SOLO CUANDO VAS ABAJO — Y POR ESO NO SUBE PARA RECUPERAR.
 *
 * ## Lo único que hace este fichero
 *
 * Aritmética sobre dos cosas que ya existen: la banca declarada del mes y el
 * libro de apuestas liquidadas. Nada de esto es una predicción, ni una ventaja,
 * ni una recomendación de qué apostar. Es el tamaño del billete, no la elección
 * del billete: QUÉ apostar sigue saliendo de `leans.js` y del motor de mercados,
 * con su etiqueta de siempre («el modelo IGUALA a la línea de cierre»).
 *
 * ## Por qué el porcentaje va sobre la banca actual y no sobre la inicial
 *
 * `summary().unitDollars` se calcula sobre la INICIAL del mes, que es lo
 * correcto para leer el libro: una unidad tiene que significar lo mismo en la
 * primera apuesta del mes y en la última, o el historial deja de ser
 * comparable consigo mismo. Para DECIDIR el tamaño de la siguiente, la
 * referencia es la otra: la banca que hay ahora.
 *
 * La diferencia entre las dos no es un detalle contable, es la respuesta a la
 * pregunta que hizo nacer esta pantalla — «dime qué meter según voy arriba o
 * abajo». Con la unidad sobre la banca actual la respuesta sale sola, sin
 * ninguna regla nueva:
 *
 *     banca 10.000, unidad 1%  ->  100 $
 *     pierdes hasta 8.000      ->   80 $        (−20%, automático)
 *     ganas hasta 12.000       ->  120 $        (+20%, automático)
 *
 * Eso es una propiedad de la aritmética, no una previsión: apostar una fracción
 * fija de lo que tienes hace que el tamaño siga a la banca en las dos
 * direcciones. Y las dos cifras se enseñan juntas (`unitAtStart`, `unitNow`)
 * para que el movimiento se VEA, que es lo que se pidió.
 *
 * ## Lo que este plan NO va a hacer nunca: perseguir
 *
 * La petición decía «según voy arriba o abajo». La mitad de arriba es fácil.
 * La mitad de abajo tiene una versión popular —subir el tamaño para recuperar
 * lo perdido— que este fichero no implementa y no va a implementar:
 *
 *   - Subir la FRACCIÓN después de perder es exactamente el movimiento que
 *     convierte una racha mala en una banca a cero, y no depende de la opinión
 *     de nadie: con la misma ventaja, apostar una fracción mayor sube la
 *     probabilidad de ruina.
 *   - Y aquí no hay ventaja demostrada que justificara siquiera la fracción de
 *     partida. El modelo de este proyecto IGUALA a la línea de cierre; el
 *     registro contra el spread no es significativo. Un plan de recuperación
 *     encima de una ventaja no demostrada es dos errores, no uno.
 *
 * Así que la fracción es constante y el dólar sigue a la banca. Cuando la caída
 * pasa del umbral declarado, lo que aparece es un FRENO (menos tamaño, no más)
 * y un aviso de que la caída podría no ser mala suerte.
 *
 * ## El freno es una convención declarada, no una medición
 *
 * `DRAWDOWN_BRAKE` recorta a la mitad a partir de −20% del mes. No sale de
 * ningún experimento de este repositorio y la interfaz lo dice con esas
 * palabras: es una regla de banca corriente, editable, y su única virtud es que
 * empuja hacia el lado seguro. Un número inventado que se presentara como
 * medido sería el fallo que este proyecto tiene escrito en la regla 3.
 */

import { BET_STATUS, decimalFromAmerican, summary } from "./bankroll.js";

/** Tope semanal por defecto, en % de la banca ACTUAL. Convención, no medición. */
export const DEFAULT_WEEK_PCT = 5;
/** Umbral de caída (en % de la inicial del mes) a partir del cual se frena. */
export const DRAWDOWN_BRAKE_PCT = 20;
/** Cuánto se recorta el tamaño por debajo de ese umbral. */
export const DRAWDOWN_BRAKE = 0.5;

const OPEN = BET_STATUS.PLACED;
const CONSIDERING = BET_STATUS.CONSIDERING;
const round2 = (x) => Math.round(x * 100) / 100;

/** El P/L de una apuesta liquidada. PUSH y VOID devuelven el stake: cero. */
export function betProfit(bet) {
  if (bet?.status === BET_STATUS.WON) {
    const decimal = decimalFromAmerican(bet.odds);
    return decimal === null ? 0 : bet.stake * (decimal - 1);
  }
  if (bet?.status === BET_STATUS.LOST) return -bet.stake;
  return 0;
}

const isSettled = (b) =>
  b.status === BET_STATUS.WON || b.status === BET_STATUS.LOST ||
  b.status === BET_STATUS.PUSH || b.status === BET_STATUS.VOID;

/**
 * El libro entero en orden, con la banca corriente después de cada liquidación.
 *
 * Es lo que se dibuja como curva y lo que hace que «voy arriba» o «voy abajo»
 * sea una lectura y no una sensación. El orden es el de LIQUIDACIÓN, no el de
 * registro: la banca cambia cuando la apuesta se resuelve.
 *
 * Una apuesta sin `settledAt` (libros viejos, o liquidada a mano antes de que
 * existiera el campo) conserva su sitio relativo por `placedAt` y luego por su
 * orden en el libro. Nunca se descarta: es dinero real del historial.
 */
export function bankPath(record) {
  if (!record) return [];
  const settled = record.bets
    .map((bet, index) => ({ bet, index }))
    .filter(({ bet }) => isSettled(bet))
    .sort((a, b) => {
      const ta = Number(a.bet.settledAt ?? a.bet.placedAt ?? 0);
      const tb = Number(b.bet.settledAt ?? b.bet.placedAt ?? 0);
      return ta === tb ? a.index - b.index : ta - tb;
    });
  let bank = record.starting;
  const path = [{ at: null, bank: round2(bank), profit: 0, bet: null }];
  for (const { bet } of settled) {
    const pl = betProfit(bet);
    bank += pl;
    path.push({ at: bet.settledAt ?? null, bank: round2(bank), profit: round2(pl), bet });
  }
  return path;
}

/**
 * El libro agrupado POR JORNADA: qué se puso, qué salió y con qué banca se
 * cerró la semana.
 *
 * La jornada sale del campo `week` que la apuesta congela al registrarse. Las
 * apuestas de libros anteriores a ese campo caen en `null` y se agrupan aparte
 * como `UNKNOWN`: repartirlas por fecha sería inventarles una semana, y una
 * semana inventada es exactamente lo que la regla 5 prohíbe.
 */
export function weekLedger(record) {
  if (!record) return [];
  const byWeek = new Map();
  for (const bet of record.bets) {
    if (bet.status === CONSIDERING) continue;      // el slip aún no es historia
    // Otra vez `== null` y no `Number(...)`: la jornada desconocida es null,
    // y `Number(null)` es 0 — que agruparía todo el libro viejo en «jornada 0».
    const key = bet.week === null || bet.week === undefined || !Number.isFinite(Number(bet.week))
      ? null : Number(bet.week);
    if (!byWeek.has(key)) {
      byWeek.set(key, {
        week: key, season: bet.season ?? null, staked: 0, profit: 0,
        bets: 0, open: 0, wins: 0, losses: 0, pushes: 0, voids: 0,
      });
    }
    const row = byWeek.get(key);
    row.bets += 1;
    row.staked += Number(bet.stake) || 0;
    if (bet.status === OPEN) row.open += 1;
    else {
      row.profit += betProfit(bet);
      if (bet.status === BET_STATUS.WON) row.wins += 1;
      else if (bet.status === BET_STATUS.LOST) row.losses += 1;
      else if (bet.status === BET_STATUS.PUSH) row.pushes += 1;
      else row.voids += 1;
    }
  }
  const rows = [...byWeek.values()].sort((a, b) => {
    if (a.week === null) return 1;                 // lo que no tiene jornada, al final
    if (b.week === null) return -1;
    return a.week - b.week;
  });
  // La banca corriente se acumula en el orden en que se leen las semanas, que
  // es el orden en que ocurrieron. Lo de jornada desconocida no la mueve: no
  // se sabe dónde va, así que no se coloca.
  let bank = record.starting;
  for (const row of rows) {
    row.staked = round2(row.staked);
    row.profit = round2(row.profit);
    row.roi = row.staked > 0 ? row.profit / row.staked : 0;
    if (row.week !== null) {
      bank += row.profit;
      row.bankAfter = round2(bank);
    } else {
      row.bankAfter = null;
    }
  }
  return rows;
}

/**
 * El plan de una jornada, calculado sobre la banca de hoy.
 *
 * Devuelve tamaños, no selecciones. Cada cifra es un porcentaje declarado de
 * una banca declarada; ninguna sale de un modelo.
 */
export function weekPlan({ record, week, weekPct = DEFAULT_WEEK_PCT, unitPct = null }) {
  if (!record) return null;
  const s = summary(record);
  const starting = record.starting;
  const bank = s.current;                          // inicial + P/L liquidado
  const swing = round2(bank - starting);
  const swingPct = starting > 0 ? (swing / starting) * 100 : 0;
  const state = Math.abs(swing) < 0.005 ? "EVEN" : swing > 0 ? "UP" : "DOWN";

  // La unidad: el % declarado del mes, medido sobre las dos bancas.
  // `unitPct == null` y no `Number.isFinite(Number(unitPct))`: `Number(null)`
  // es CERO, que es finito, y la unidad habría salido a cero sin decirlo.
  const asked = unitPct === null || unitPct === undefined ? NaN : Number(unitPct);
  const pct = Number.isFinite(asked)
    ? asked
    : (record.unitIsPercent ? record.unitValue : (starting > 0 ? (record.unitValue / starting) * 100 : 0));
  const unitAtStart = round2((starting * pct) / 100);
  const unitNow = round2((bank * pct) / 100);

  // El freno: por debajo del umbral se recorta, NUNCA se amplía. Y se dice.
  const braking = swingPct <= -DRAWDOWN_BRAKE_PCT;
  const brake = braking ? DRAWDOWN_BRAKE : 1;

  const budget = round2((bank * weekPct * brake) / 100);
  const wanted = Number(week);
  const sameWeek = (bet) =>
    Number.isFinite(wanted) && Number(bet.week) === wanted;
  // Comprometido esta jornada: lo abierto y lo ya liquidado de la semana, más
  // lo que está en el slip. El slip cuenta porque la pregunta es «cuánto me
  // queda por poner», y lo que ya está escrito ahí va a salir de esta semana.
  const committed = round2(record.bets
    .filter((b) => sameWeek(b) && b.status !== CONSIDERING)
    .reduce((sum, b) => sum + (Number(b.stake) || 0), 0));
  const inSlip = round2(record.bets
    .filter((b) => b.status === CONSIDERING)
    .reduce((sum, b) => sum + (Number(b.stake) || 0), 0));
  const remaining = round2(Math.max(0, budget - committed - inSlip));

  return {
    week: Number.isFinite(wanted) ? wanted : null,
    state, starting, bank, swing, swingPct: round2(swingPct),
    unitPct: pct, unitAtStart, unitNow, unitDelta: round2(unitNow - unitAtStart),
    weekPct, budget, committed, inSlip, remaining,
    over: committed + inSlip > budget,
    // Tamaño sugerido por apuesta: una unidad, y nunca más de lo que queda.
    perBet: round2(Math.min(unitNow * brake, remaining)),
    braking, brakeFactor: brake, drawdownAt: DRAWDOWN_BRAKE_PCT,
    openExposure: s.openExposure,
    available: s.available,
  };
}

/**
 * El registro de TODOS los meses, no sólo el abierto.
 *
 * «Que todo quede grabado» incluye poder leerlo después: sin esto, cerrar
 * septiembre y abrir octubre borra de la vista lo que pasó en septiembre
 * aunque siga guardado. La banca no se acumula entre meses a propósito — cada
 * mes declara la suya (E-mes) — así que lo que se suma aquí es el P/L y lo
 * apostado, que sí son comparables.
 */
export function careerSummary(records) {
  const months = (records ?? []).filter(Boolean);
  const out = {
    months: months.length, bets: 0, staked: 0, profit: 0,
    wins: 0, losses: 0, pushes: 0, voids: 0, open: 0, roi: 0,
  };
  for (const record of months) {
    for (const bet of record.bets ?? []) {
      if (bet.status === CONSIDERING) continue;
      out.bets += 1;
      out.staked += Number(bet.stake) || 0;
      if (bet.status === OPEN) { out.open += 1; continue; }
      out.profit += betProfit(bet);
      if (bet.status === BET_STATUS.WON) out.wins += 1;
      else if (bet.status === BET_STATUS.LOST) out.losses += 1;
      else if (bet.status === BET_STATUS.PUSH) out.pushes += 1;
      else out.voids += 1;
    }
  }
  out.staked = round2(out.staked);
  out.profit = round2(out.profit);
  // ROI sobre lo APOSTADO, no sobre la banca: es lo único comparable entre
  // meses que empezaron con bancas distintas.
  out.roi = out.staked > 0 ? out.profit / out.staked : 0;
  return out;
}
