/**
 * EL CICLO DE REVISIÓN DE CUATRO JORNADAS.
 *
 *     LO QUE GANA EL LIBRO Y LO QUE METE EL DUEÑO SON DOS COSAS.
 *     UNA CURVA QUE LAS SUMA NO MIDE NADA.
 *
 * Esto NO es el dimensionado. El tamaño de cada apuesta lo decide `plan.js` y
 * sigue a la banca de hoy (regla 6c); aquí se mira hacia atrás cuatro jornadas
 * y se contesta una pregunta distinta: cuánto había, cuánto hay, cuánto de la
 * diferencia lo puso el libro y cuánto lo puso la cartera.
 *
 * ------------------------------------------------------------------------
 * POR QUÉ EL PERIODO SE MIDE EN JORNADAS Y NO EN DÍAS
 *
 * Veintiocho días es un periodo que este libro no sabe calcular: las apuestas
 * llevan `season` y `week` congelados y NO llevan una fecha con la que se
 * pueda repartir un calendario — precisamente porque repartirlas después por
 * la fecha del fichero sería inventarles una jornada, que es la regla 5
 * aplicada al dinero y ya está escrita en `bankroll.js`. Cuatro JORNADAS es el
 * mismo tramo de tiempo expresado en la unidad que el dato sí tiene.
 *
 * Una apuesta sin jornada (las de antes de que existiera el campo) no se
 * reparte a ojo: sale aparte como `sinJornada`. UNKNOWN antes que inventado.
 *
 * ------------------------------------------------------------------------
 * POR QUÉ LA CAÍDA MÁXIMA NO VE EL DINERO QUE ENTRA
 *
 * Si un ingreso levantara la curva, un mes malo con una recarga encima se
 * leería como un mes plano. La caída se mide SÓLO sobre resultados
 * liquidados, en orden de liquidación. El dinero que entra y sale es otra
 * serie y se enseña al lado.
 */

/** Cuatro jornadas. Es una CONVENCIÓN declarada, no un resultado. */
export const PERIOD_WEEKS = 4;

export const CASH = Object.freeze({ DEPOSIT: "DEPOSIT", WITHDRAWAL: "WITHDRAWAL" });

/** Los estados que ya movieron dinero de verdad. Los abiertos no cuentan. */
const LIQUIDADAS = new Set(["WON", "LOST", "PUSH", "VOID"]);

function beneficio(bet) {
  if (bet.status === "WON") {
    const dec = Number(bet.odds?.decimal ?? bet.decimalOdds ?? 0);
    return dec > 0 ? bet.stake * (dec - 1) : 0;
  }
  if (bet.status === "LOST") return -bet.stake;
  return 0; // PUSH y VOID devuelven la apuesta.
}

/**
 * El tramo [desde, hasta] de una temporada, dado el punto en el que estamos.
 * `week` es la jornada EN CURSO: el periodo son las cuatro que la incluyen.
 */
export function periodBounds(season, week, weeks = PERIOD_WEEKS) {
  const w = Number(week);
  if (!Number.isInteger(w) || w < 1) return null;
  return { season: Number(season), from: Math.max(1, w - weeks + 1), to: w, weeks };
}

/** ¿Cae esta apuesta dentro del periodo? Sin jornada, NO — ni dentro ni fuera. */
function enPeriodo(bet, bounds) {
  if (bet.season === null || bet.week === null) return false;
  return Number(bet.season) === bounds.season
    && Number(bet.week) >= bounds.from && Number(bet.week) <= bounds.to;
}

function movimientosEn(cash, bounds) {
  return (cash ?? []).filter((m) => Number(m.season) === bounds.season
    && Number(m.week) >= bounds.from && Number(m.week) <= bounds.to);
}

/**
 * LA CAÍDA MÁXIMA sobre la curva de resultados, en orden de liquidación.
 *
 * Devuelve el importe (positivo) y la fracción del pico. Sin apuestas
 * liquidadas es cero: no hay curva de la que caer, y eso no es «cero riesgo».
 */
export function maxDrawdown(settled, base) {
  const orden = [...settled].sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
  let equity = base, pico = base, peor = 0, peorFrac = 0;
  for (const b of orden) {
    equity += beneficio(b);
    if (equity > pico) pico = equity;
    const caida = pico - equity;
    if (caida > peor) { peor = caida; peorFrac = pico > 0 ? caida / pico : 0; }
  }
  return { amount: peor, fraction: peorFrac };
}

/**
 * La revisión del periodo. Todo lo que §225 pide, y la IDENTIDAD que separa
 * lo que ganó el libro de lo que metió el dueño:
 *
 *     FINAL = INICIAL + CAJA NETA + RESULTADO LIQUIDADO
 *
 * Los tres sumandos se publican por separado a propósito. Un `+$500` sin esa
 * descomposición puede ser una buena racha o una transferencia, y el que lo
 * lee no puede distinguirlo.
 */
export function review(record, bounds) {
  if (!record || !bounds) return null;
  const todas = record.bets ?? [];
  const dentro = todas.filter((b) => enPeriodo(b, bounds));
  const liquidadas = dentro.filter((b) => LIQUIDADAS.has(b.status));
  const jugadas = dentro.filter((b) => b.status !== "CONSIDERING");
  const movimientos = movimientosEn(record.cash, bounds);

  const depositado = movimientos.filter((m) => m.kind === CASH.DEPOSIT)
    .reduce((s, m) => s + Number(m.amount || 0), 0);
  const retirado = movimientos.filter((m) => m.kind === CASH.WITHDRAWAL)
    .reduce((s, m) => s + Number(m.amount || 0), 0);
  const resultado = liquidadas.reduce((s, b) => s + beneficio(b), 0);
  const apostado = jugadas.reduce((s, b) => s + b.stake, 0);

  /* La banca al EMPEZAR el periodo: lo que había antes de la primera de sus
     jornadas. Se reconstruye hacia atrás desde la inicial del mes, que es la
     única cifra que el libro declara sin derivar. */
  const previas = todas.filter((b) => b.season !== null && b.week !== null
    && (Number(b.season) < bounds.season
      || (Number(b.season) === bounds.season && Number(b.week) < bounds.from)));
  const cajaPrevia = (record.cash ?? []).filter((m) => Number(m.season) < bounds.season
    || (Number(m.season) === bounds.season && Number(m.week) < bounds.from))
    .reduce((s, m) => s + (m.kind === CASH.DEPOSIT ? 1 : -1) * Number(m.amount || 0), 0);
  const inicial = record.starting
    + cajaPrevia
    + previas.filter((b) => LIQUIDADAS.has(b.status)).reduce((s, b) => s + beneficio(b), 0);

  const cajaNeta = depositado - retirado;
  return {
    bounds,
    startingBankroll: inicial,
    netCash: cajaNeta,
    deposited: depositado,
    withdrawn: retirado,
    realizedPL: resultado,
    // FINAL = INICIAL + CAJA + RESULTADO. Un test comprueba la identidad.
    endingBankroll: inicial + cajaNeta + resultado,
    // Dos denominadores distintos con dos nombres distintos: sobre la banca
    // dice cuánto se movió el capital; sobre lo apostado dice cómo de bien
    // apostó. Llamar «ROI» a los dos es como acaban comparándose cosas que no
    // son comparables.
    roiOnBank: inicial > 0 ? resultado / inicial : null,
    yieldOnStaked: apostado > 0 ? resultado / apostado : null,
    maxDrawdown: maxDrawdown(liquidadas, inicial),
    totalWagered: apostado,
    bets: jugadas.length,
    settledBets: liquidadas.length,
    averageStake: jugadas.length > 0 ? apostado / jugadas.length : 0,
    // Ni dentro ni fuera: se DICE. Agruparlas por la fecha del fichero sería
    // inventarles una jornada.
    sinJornada: todas.filter((b) => b.status !== "CONSIDERING"
      && (b.season === null || b.week === null)).length,
  };
}

/* ========================================================================
   EL CALENDARIO DE CUATRO JORNADAS, HACIA ADELANTE
   ======================================================================== */

/** Qué mercados puede DIMENSIONAR el modelo, y cuáles no.
 *
 *     SIN PRECIO NO HAY PROBABILIDAD DE MERCADO, Y SIN ELLA NO HAY TAMAÑO.
 *
 * El spread y la moneyline llegan con su cuota por lado, así que el de-vig de
 * Shin da una probabilidad de mercado, `decide` calcula EV y sale una fracción
 * de Kelly. Los PROPS no: las líneas de props no viajan en los datos de este
 * sitio —la pantalla te pide que teclees la de tu casa— y sin cuota no hay
 * nada que descontar. Se puede enseñar la media del modelo al lado de tu
 * línea, que es un LEAN, y no se puede convertir en un tamaño.
 *
 * Por eso el reparto entre juegos y props no es una preferencia: es que uno de
 * los dos no tiene con qué calcularse. Inventarle una fracción fija sería
 * exactamente la convención de medición disfrazada que este proyecto persigue.
 */
export const SIZEABLE = Object.freeze({
  spread: true, moneyline: true, total: false, prop: false,
});

/**
 * EL MES ENTERO, en porcentajes de la banca que tengas ESE domingo.
 *
 *     ES UNA REGLA, NO UN PRONÓSTICO.
 *
 * No se proyecta cuánto tendrás en la jornada 3, porque eso exige suponer un
 * resultado y aquí no hay ventaja demostrada que lo justifique (`BETTING_EDGE`
 * REJECTED, E4). Lo que se publica es la aritmética que se aplicará el día que
 * llegues: el tope de la semana y el tamaño por apuesta, los dos como
 * fracción de la banca de ESE momento.
 *
 * De ahí sale la propiedad que hace que esto no necesite disciplina: si vas
 * abajo, el 5% es de menos dinero y el tamaño baja solo; si vas arriba, sube
 * solo. Nadie tiene que acordarse de nada, y no hay ninguna regla que suba la
 * FRACCIÓN después de perder — eso es perseguir, y con la misma ventaja sube
 * la probabilidad de ruina.
 *
 * `scenarios` existe para poder MIRAR eso mismo sin creerse una predicción:
 * son la misma regla evaluada sobre tres bancas distintas, etiquetadas como lo
 * que son.
 */
export function monthPlan({
  startingBank,
  weeks = PERIOD_WEEKS,
  weekPct = 5,
  unitPct = 1,
  drawdownAt = 20,
  brakeFactor = 0.5,
} = {}) {
  const banca = Number(startingBank);
  if (!Number.isFinite(banca) || banca <= 0) return null;
  const semana = Math.max(0, Number(weekPct) || 0);
  const unidad = Math.max(0, Number(unitPct) || 0);

  const deBanca = (b, frenado) => {
    const f = frenado ? brakeFactor : 1;
    const tope = (b * semana * f) / 100;
    const porApuesta = (b * unidad * f) / 100;
    return {
      bank: b,
      braking: frenado,
      weekBudget: tope,
      perBet: porApuesta,
      // Cuántas apuestas del tamaño de una unidad caben en el tope. No es un
      // objetivo: es el techo. Menos siempre está bien; más no cabe.
      maxBets: porApuesta > 0 ? Math.floor(tope / porApuesta) : 0,
    };
  };

  return {
    weeks,
    weekPct: semana,
    unitPct: unidad,
    startingBank: banca,
    // La misma regla, semana a semana. El `bank` de cada una es el que
    // TENDRÁS, y por eso sólo la primera trae número: las demás son la regla.
    schedule: Array.from({ length: weeks }, (_, i) => ({
      week: i + 1,
      rule: `${semana}% of your bank that Sunday, in bets of ${unidad}%`,
      known: i === 0,
      ...(i === 0 ? deBanca(banca, false) : {}),
    })),
    // El techo del MES si se gastara entero el tope todas las semanas y la
    // banca no se moviera. Es una cota superior, no un plan de gasto.
    monthCeilingPct: semana * weeks,
    drawdownAt,
    brakeFactor,
    scenarios: [
      { label: "flat", bank: banca, ...deBanca(banca, false) },
      { label: `down ${drawdownAt}%`, bank: banca * (1 - drawdownAt / 100),
        ...deBanca(banca * (1 - drawdownAt / 100), true) },
      { label: "up 20%", bank: banca * 1.2, ...deBanca(banca * 1.2, false) },
    ],
  };
}

export const FUNDING = Object.freeze({
  NO_VALIDATED_EDGE: "NO_VALIDATED_EDGE",
  NO_BUDGET_SET: "NO_BUDGET_SET",
  AT_TARGET: "AT_TARGET",
  ABOVE_TARGET: "ABOVE_TARGET",
  CAPPED_BY_BUDGET: "CAPPED_BY_BUDGET",
  BELOW_TARGET: "BELOW_TARGET",
});

/**
 * CUÁNTO DINERO NUEVO RECOMENDAR PARA LAS PRÓXIMAS CUATRO JORNADAS.
 *
 *     LA RECOMENDACIÓN NO MIRA SI EL PERIODO FUE BUENO O MALO.
 *
 * Esa es la propiedad entera, y está escrita como firma: esta función NO
 * recibe el resultado del periodo. No puede subir tras una racha mala porque
 * no sabe que la hubo, y no puede subir tras una buena por lo mismo. Un plan
 * de recuperación encima de una ventaja no demostrada son dos errores; aquí
 * ni siquiera hay dónde escribir el primero.
 *
 * Y el techo del dueño es DURO: nada de lo que salga de aquí lo supera.
 *
 * `edgeStatus` es el estado del registro de capacidades, no una opinión de
 * este fichero. Hoy `BETTING_EDGE` está REJECTED (E4: 49,81% ATS contra un
 * equilibrio de 52,4%), así que la respuesta es CERO por mucho que la banca
 * esté por debajo del objetivo — que es exactamente lo que pide no fabricar
 * apuestas porque haya capital disponible. El día que un experimento lo
 * valide, esta función cambia sola.
 */
export function fundingAdvice({ currentBankroll, target = null, budgetCeiling = null, edgeStatus = null }) {
  const banca = Number(currentBankroll);
  const techo = Number.isFinite(Number(budgetCeiling)) && budgetCeiling !== null
    && budgetCeiling !== "" ? Math.max(0, Number(budgetCeiling)) : null;

  if (edgeStatus !== "VALIDATED") {
    return {
      addMoney: 0, withdraw: 0, reason: FUNDING.NO_VALIDATED_EDGE, ceiling: techo,
      detail: "no validated betting edge in the capability registry",
    };
  }
  if (techo === null) {
    return {
      addMoney: 0, withdraw: 0, reason: FUNDING.NO_BUDGET_SET, ceiling: null,
      detail: "no maximum new money per period configured",
    };
  }
  const min = Number(target?.min);
  const max = Number(target?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { addMoney: 0, withdraw: 0, reason: FUNDING.NO_BUDGET_SET, ceiling: techo,
      detail: "no target bankroll range configured" };
  }
  if (banca > max) {
    // Retirar el exceso NUNCA sube el riesgo, así que sí se puede sugerir.
    return { addMoney: 0, withdraw: banca - max, reason: FUNDING.ABOVE_TARGET, ceiling: techo,
      detail: "bankroll is above the top of the target range" };
  }
  if (banca >= min) {
    return { addMoney: 0, withdraw: 0, reason: FUNDING.AT_TARGET, ceiling: techo,
      detail: "bankroll is inside the target range" };
  }
  const hueco = min - banca;
  const pedido = Math.min(hueco, techo);
  return {
    addMoney: pedido, withdraw: 0, ceiling: techo,
    reason: pedido < hueco ? FUNDING.CAPPED_BY_BUDGET : FUNDING.BELOW_TARGET,
    detail: pedido < hueco
      ? "the gap to the target is larger than the configured ceiling"
      : "bankroll is below the bottom of the target range",
  };
}
