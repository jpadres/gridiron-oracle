/**
 * LIQUIDAR UNA APUESTA CONTRA EL MARCADOR FINAL.
 *
 *     EL MARCADOR ES UN HECHO DEL FICHERO. LA REGLA DE LIQUIDACIÓN ES UNA.
 *
 * El libro vive sólo en este navegador (no hay cuentas ni servidor, regla 4),
 * así que Python nunca ve una apuesta y no puede liquidarla. Lo que publica es
 * el hecho —`payload.results`: qué partido terminó y en qué marcador— y aquí se
 * aplica la regla sobre la línea que el dueño APUNTÓ, que puede no ser la
 * publicada porque la pantalla le pide la de SU libro.
 *
 * Esto NO es el caso de `noBet.js`, donde la aritmética de la decisión se
 * repetía en los dos lados sobre valores redondeados y podían discrepar en el
 * borde: aquí hay UNA sola implementación y Python no tiene la otra mitad.
 *
 * ## Lo que no decide
 *
 * `UNDECIDED` no es «perdida»: es que el partido no ha terminado, o que no se
 * puede emparejar, o que la apuesta no lleva la línea con la que se liquida.
 * Una apuesta sin resolver se queda ABIERTA — convertir un «no sé» en un
 * resultado es inventarse dinero.
 *
 * Y un prop NO se liquida aquí. El marcador no dice cuántas yardas de pase hizo
 * nadie, así que afirmar su resultado desde el marcador sería fabricarlo:
 * devuelve `UNDECIDED` con motivo `NO_SETTLEMENT_SOURCE` y la pantalla lo dice.
 */

import { numberOrNull } from "../numbers.js";

export const GRADE = {
  WON: "WON",
  LOST: "LOST",
  PUSH: "PUSH",
  UNDECIDED: "UNDECIDED",
};

export const UNDECIDED_REASON = {
  NOT_FINAL: "NOT_FINAL",
  NO_RESULT: "NO_RESULT",
  NO_LINE: "NO_LINE",
  NO_SELECTION: "NO_SELECTION",
  NO_SETTLEMENT_SOURCE: "NO_SETTLEMENT_SOURCE",
  UNKNOWN_MARKET: "UNKNOWN_MARKET",
};

/** Índice por `game_id` de lo que publica Python. */
export function resultsIndex(results) {
  const index = new Map();
  for (const r of results ?? []) {
    if (r?.game_id) index.set(String(r.game_id), r);
  }
  return index;
}

function undecided(reason) {
  return { grade: GRADE.UNDECIDED, reason, basis: null };
}

function decided(grade, basis) {
  return { grade, reason: null, basis };
}

/**
 * El resultado de UNA apuesta, o por qué no se puede decidir.
 *
 * `bet.market` es `SPREAD`, `TOTAL`, `MONEYLINE` o `PROP_<STAT>`, y
 * `bet.selection` el lado: un código de equipo para spread y moneyline, `OVER`
 * o `UNDER` para el total.
 */
export function gradeBet(bet, index) {
  if (!bet?.gameId) return undecided(UNDECIDED_REASON.NO_RESULT);
  const game = index?.get?.(String(bet.gameId));
  if (!game) return undecided(UNDECIDED_REASON.NO_RESULT);

  const casa = numberOrNull(game.home_score);
  const fuera = numberOrNull(game.away_score);
  // `numberOrNull` y no `Number(x)`: `Number(null)` vale CERO y es finito, así que un
  // partido sin marcador se habría liquidado como un 0-0 — un empate falso que
  // declararía PUSH en cada spread de 0. Cuarta forma del mismo fallo.
  if (casa === null || fuera === null) return undecided(UNDECIDED_REASON.NOT_FINAL);

  const mercado = String(bet.market ?? "").toUpperCase();
  if (mercado.startsWith("PROP")) {
    // El marcador no sabe las yardas de nadie.
    return undecided(UNDECIDED_REASON.NO_SETTLEMENT_SOURCE);
  }

  const marcador = `${game.away_team} ${fuera} @ ${game.home_team} ${casa}`;

  if (mercado === "MONEYLINE") {
    const lado = String(bet.selection ?? bet.team ?? "").toUpperCase();
    if (!lado) return undecided(UNDECIDED_REASON.NO_SELECTION);
    if (lado !== String(game.home_team).toUpperCase()
        && lado !== String(game.away_team).toUpperCase()) {
      return undecided(UNDECIDED_REASON.NO_SELECTION);
    }
    if (casa === fuera) return decided(GRADE.PUSH, marcador);
    const ganador = casa > fuera ? String(game.home_team) : String(game.away_team);
    return decided(
      lado === ganador.toUpperCase() ? GRADE.WON : GRADE.LOST,
      marcador,
    );
  }

  const linea = numberOrNull(bet.line);
  if (linea === null) return undecided(UNDECIDED_REASON.NO_LINE);

  if (mercado === "TOTAL") {
    const lado = String(bet.selection ?? "").toUpperCase();
    if (lado !== "OVER" && lado !== "UNDER") {
      return undecided(UNDECIDED_REASON.NO_SELECTION);
    }
    const total = casa + fuera;
    if (total === linea) return decided(GRADE.PUSH, `${marcador} · total ${total}`);
    const paso = total > linea;
    return decided(
      (lado === "OVER") === paso ? GRADE.WON : GRADE.LOST,
      `${marcador} · total ${total}`,
    );
  }

  if (mercado === "SPREAD") {
    const lado = String(bet.selection ?? bet.team ?? "").toUpperCase();
    const esCasa = lado === String(game.home_team).toUpperCase();
    const esFuera = lado === String(game.away_team).toUpperCase();
    if (!esCasa && !esFuera) return undecided(UNDECIDED_REASON.NO_SELECTION);
    // EL HANDICAP LLEVA EL SIGNO CONTRARIO AL MARGEN, y esa confusión ya costó
    // una iteración («MIA -3.5» para un MIA que recibía 3,5): `bet.line` es el
    // handicap tal y como se apuesta, así que un favorito de 3,5 se guarda
    // como -3.5 y se le SUMA a su margen.
    const margen = esCasa ? casa - fuera : fuera - casa;
    const ajustado = margen + linea;
    if (ajustado === 0) return decided(GRADE.PUSH, `${marcador} · margin ${margen}`);
    return decided(
      ajustado > 0 ? GRADE.WON : GRADE.LOST,
      `${marcador} · margin ${margen}`,
    );
  }

  return undecided(UNDECIDED_REASON.UNKNOWN_MARKET);
}
