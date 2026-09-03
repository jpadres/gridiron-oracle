/**
 * MODEL LEAN: la dirección que implica el modelo frente a una línea real.
 *
 * ## Qué es y qué no es
 *
 * Un lean es ARITMÉTICA sobre dos números validados por separado: si el modelo
 * proyecta margen −4,3 y el mercado pide −2,5, el modelo cae del lado del
 * favorito. Eso es un HECHO del modelo, y se enseña con su nombre — «model
 * lean» — porque E4 midió lo otro: el desacuerdo con la línea NO predice
 * acierto contra el spread (49,3% / 50,9% / 48,8%, plano). Un lean nunca se
 * asciende a edge, a confianza ni a «best bet» por grande que sea el hueco.
 *
 * ## El orden del board
 *
 * Familias distintas no se comparan en crudo: 20 yardas de pase no son 1,5
 * recepciones. Cada familia se normaliza por la DISPERSIÓN de sus propios
 * desacuerdos en la jornada (hueco / desviación típica de los huecos de esa
 * familia), y el número se enseña como lo que es: «cuánto más grande que el
 * desacuerdo típico de su familia», no una probabilidad.
 */

const round1 = (value) => Math.round(value * 10) / 10;

/** Los leans de partido (spread y total) de una jornada del payload. */
export function gameLeans(predictions) {
  const rows = [];
  for (const game of predictions ?? []) {
    const line = Number(game.spread_line);
    const margin = Number(game.pred_margin);
    if (Number.isFinite(line) && Number.isFinite(margin) && margin !== line) {
      // La línea se lee desde el lado que la lleva; el lean nombra a su equipo.
      const side = margin > line ? game.home_team : game.away_team;
      const sideLine = margin > line ? -line : line;
      rows.push({
        family: "SPREAD",
        gameId: game.game_id,
        label: `${game.away_team} @ ${game.home_team}`,
        team: side,
        market: `${line > 0 ? game.home_team : game.away_team} ${line > 0 ? "-" : "+"}${Math.abs(line).toFixed(1)}`,
        model: round1(margin),
        line,
        lean: `${side} ${sideLine > 0 ? "+" : ""}${sideLine.toFixed(1)}`,
        gap: round1(Math.abs(margin - line)),
      });
    }
    /* NO HAY LEAN DE TOTALES, y no es un olvido.
       El modelo de totales se retiró el 3 de septiembre de 2026 porque está
       MEDIDO que restaba: sobre 3.829 partidos fuera de muestra su MAE era
       10,574 contra 10,510 de la línea a secas (diferencia pareada +0,064 ±
       0,019, t = +3,42, peor en 12 de 14 temporadas), y su señal de over/under
       acertaba el 47,8% cuando se separaba más de un punto — por debajo del
       50% y muy por debajo del 52,4% que hace falta a -110.
       El total que publica el modelo ES la línea, así que aquí no puede haber
       discrepancia que enseñar. Si alguien vuelve a añadir un modelo de
       totales, este bloque vuelve CON su medición al lado. */
  }
  return rows;
}

/**
 * Lean de un prop con la línea que el usuario tecleó de su casa de apuestas.
 * Sin línea no hay lean: el mercado de props no viaja en el payload y no se
 * inventa (MARKET UNAVAILABLE es la respuesta honesta, no un número).
 */
export function propLean(projection, line) {
  // `Number(null)` es 0: una línea vacía se volvería «línea 0» y pariría un
  // lean gigante hacia el over. Vacío es vacío, y vacío no opina.
  if (projection === null || projection === undefined || projection === "") return null;
  if (line === null || line === undefined || line === "") return null;
  const proj = Number(projection);
  const mkt = Number(line);
  if (!Number.isFinite(proj) || !Number.isFinite(mkt)) return null;
  if (proj === mkt) return { side: "PUSH", gap: 0 };
  return { side: proj > mkt ? "OVER" : "UNDER", gap: round1(Math.abs(proj - mkt)) };
}

/**
 * El board ordenado: cada fila con su hueco normalizado por la dispersión de
 * su familia ESTA jornada. `sigmas` viaja en la fila para que la interfaz
 * pueda decir «2,1× el desacuerdo típico» en vez de un número pelado.
 */
export function rankedLeans(rows) {
  const byFamily = new Map();
  for (const row of rows) {
    if (!byFamily.has(row.family)) byFamily.set(row.family, []);
    byFamily.get(row.family).push(row.gap);
  }
  const sigma = new Map();
  for (const [family, gaps] of byFamily) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(gaps.length - 1, 1);
    // Suelo pequeño: una familia con todos los huecos iguales no divide por ~0.
    sigma.set(family, Math.max(Math.sqrt(variance), 0.25));
  }
  return rows
    .map((row) => ({ ...row, sigmas: Math.round((row.gap / sigma.get(row.family)) * 10) / 10 }))
    .sort((a, b) => b.sigmas - a.sigmas);
}
