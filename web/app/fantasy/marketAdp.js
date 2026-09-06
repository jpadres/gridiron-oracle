/**
 * EL ADP DEL MERCADO, al lado del board y nunca dentro.
 *
 *     UN ADP ES CONDUCTA, NO CALIDAD. Y LA DIFERENCIA NO ES UNA VENTAJA.
 *
 * Contesta una sola pregunta —«¿puedo esperar a mi siguiente pick?»— y hay que
 * tener cuidado con lo que NO contesta:
 *
 *   · Que el board lo ponga 31 y el mercado 52 **no** significa que el board
 *     tenga razón. Significa que en esta liga sale más tarde de lo que su valor
 *     sugiere, y por eso quizá se pueda esperar.
 *   · «Quizá». Sin un modelo calibrado de disponibilidad, «seguro que llega»
 *     es una probabilidad inventada, y este proyecto ya tiene escrita la regla
 *     de que estar en desacuerdo con el mercado no es una ventaja.
 *
 * Por eso esto devuelve HECHOS —los dos números y su diferencia— y ninguna
 * palabra que suene a predicción.
 */

/** Cuánto tiene que separarse para que la diferencia se lea como diferencia.
 *
 * Media ronda de una liga de doce. Por debajo, dos números que se parecen
 * pintados uno al lado del otro invitan a leer una señal que no está: el ADP
 * es un promedio con varianza, no una posición fija. */
export const MEANINGFUL_GAP = 6;

export function marketGap(row) {
  const adp = Number(row?.adp);
  const rank = Number(row?.overall_rank);
  if (!Number.isFinite(adp) || !Number.isFinite(rank)) return null;
  const diff = adp - rank;
  return {
    adp,
    rank,
    diff,
    // POSITIVO = el mercado lo coge MÁS TARDE que su puesto en el board.
    direction: Math.abs(diff) < MEANINGFUL_GAP ? "SAME"
      : diff > 0 ? "MARKET_LATER" : "MARKET_EARLIER",
  };
}

/**
 * Una línea de texto, o `null`. Sin adjetivos y sin probabilidades.
 *
 * `source` es `fantasy.adp_source`, y va porque **un ADP sin su contexto no
 * significa nada**: «ADP 52,3» en presente, sin ventana ni muestra ni fuente,
 * es una afirmación de actualidad sin fecha — la regla 5 con otra ropa. El
 * agregado empieza el 29 de agosto, o sea ANTES de los cortes que la propia
 * pantalla marca al lado, y quien lee tiene que poder saberlo.
 *
 * Y va la VENTANA, no `fetched_at`: cuándo lo bajé no es de cuándo es el dato.
 */
export function marketNote(row, source = null) {
  const gap = marketGap(row);
  if (!gap) return null;
  const base = `Board ${gap.rank} · market ADP ${gap.adp.toFixed(1)}`;
  const dicho = gap.direction === "SAME" ? base
    : gap.direction === "MARKET_LATER"
      ? `${base} — drafted later than the board ranks him`
      : `${base} — drafted earlier than the board ranks him`;
  const ventana = source?.window_start;
  const muestra = Number(source?.sample_size);
  if (!ventana) return dicho;
  const cuantos = Number.isFinite(muestra) && muestra > 0
    ? `${muestra.toLocaleString("en-US")} drafts` : "drafts";
  return `${dicho} · ${cuantos} since ${ventana}`;
}
