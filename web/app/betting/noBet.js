/**
 * NO BET, con su MOTIVO. Espejo exacto de `betting/kelly.py::stake_fraction`.
 *
 * Un tamaño de cero no es un dato que falte: es la decisión más frecuente del
 * motor (30 de 32 lados en la jornada 1 de 2026), y hasta 2026-09-05 la tabla
 * lo pintaba como «0», que se lee como una celda vacía. Los frenos que lo
 * producen están escritos en Python; aquí se repite la aritmética para poder
 * DECIR cuál de los dos paró la apuesta, y un test cruza los dos resultados
 * sobre el payload entero: si Python dice cero, esto tiene que tener motivo,
 * y si Python apuesta, esto no puede tener ninguno.
 */
import { numberOrNull } from "../numbers.js";

export const MIN_EDGE = 0.015;      // kelly.py: min_edge
export const EDGE_SHRINK = 0.5;     // kelly.py: edge_shrink

export const NO_BET = {
  UNDER_MINIMUM: "edge under the 1.5-point minimum",
  BELOW_PRICE: "halved edge does not beat the price",
};

/**
 * `null` cuando el motor apuesta; si no, el freno que lo paró.
 * `side` trae `edge`, `market_prob` y `decimal_odds` tal como los publica el payload.
 */
export function noBetReason(side) {
  // `numberOrNull`, no `Number()`: `Number(null)` es CERO, y un edge nulo
  // habría salido «por debajo del mínimo» — un motivo inventado sobre un hueco.
  const edge = numberOrNull(side?.edge);
  const market = numberOrNull(side?.market_prob);
  const decimal = numberOrNull(side?.decimal_odds);
  if (edge === null || market === null || decimal === null) return null;
  if (edge < MIN_EDGE) return NO_BET.UNDER_MINIMUM;
  const shrunk = market + (1 - EDGE_SHRINK) * edge;
  // full_kelly: (p·d − 1) / (d − 1); es cero o negativo cuando p·d ≤ 1.
  if (shrunk * decimal <= 1) return NO_BET.BELOW_PRICE;
  return null;
}
