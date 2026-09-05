/**
 * NO BET, con su MOTIVO — LEÍDO del payload, no recalculado.
 *
 * La decisión la toma `betting/kelly.py::decide` con precisión completa y
 * viaja con cada mercado como `decision` («BET» | «NO_BET») y
 * `no_bet_reason` (código). La primera versión de este fichero repetía la
 * aritmética sobre valores redondeados a cuatro decimales y en el borde
 * exacto del umbral podía decir otra cosa que Python. Ahora aquí no hay ni
 * una resta: sólo se traduce el código a texto, y un código desconocido se
 * dice como desconocido en vez de inventarle un motivo.
 */
export const NO_BET = {
  UNDER_MINIMUM: "edge under the 1.5-point minimum",
  BELOW_PRICE: "halved edge does not beat the price",
};

/** `null` cuando el motor apuesta; si no, el motivo que Python publicó. */
export function noBetReason(side) {
  if (!side || side.decision === "BET") return null;
  const code = side.no_bet_reason;
  if (code == null) return side.decision === "NO_BET" ? "reason not published" : null;
  return NO_BET[code] ?? `not sized (${String(code)})`;
}
