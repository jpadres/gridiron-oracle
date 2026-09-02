/**
 * Gráficas en SVG generado EN BUILD TIME.
 *
 * Sin librerías de charting, y no por austeridad: la CSP del sitio no permite
 * dominios externos, el proyecto se sostiene en tres dependencias npm, y todo
 * esto son componentes de servidor que se renderizan una vez y llegan al
 * navegador como HTML. Una librería de gráficas costaría más kilobytes que
 * todos los datos del modelo juntos.
 *
 * Reglas que se siguen en las tres gráficas de este fichero:
 *
 * - **Ninguna gráfica es la única forma de leer un dato.** Cada una tiene su
 *   tabla al lado. El color nunca transporta información en solitario: las
 *   series van etiquetadas directamente y cada marca lleva un `<title>`, que
 *   el navegador enseña al pasar por encima sin una línea de JavaScript.
 * - Rejilla y ejes en línea fina continua, un tono por encima del fondo. Nada
 *   de rayas discontinuas, que se leen como "umbral" cuando sólo son rejilla.
 * - Etiquetas selectivas: el extremo de cada serie, no un número por punto.
 */

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

import { num } from "../data/model.js";

export const POSITION_COLOR = {
  QB: "var(--pos-qb)",
  RB: "var(--pos-rb)",
  WR: "var(--pos-wr)",
  TE: "var(--pos-te)",
  // La fila global de la tabla de valor capturado. Neutra a propósito: no es
  // una posición, es la media ponderada de las cuatro.
  ALL: "var(--chalk-dim)",
};

export const POSITIONS = ["QB", "RB", "WR", "TE"];

/** Escala lineal de dominio a rango. */
function scale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * Ticks en números redondos que incluyen el cero si está en el rango.
 *
 * Repartir el rango en cinco trozos iguales produce ejes con «96, 64, 31, −2»:
 * legibles a duras penas y con un tick pegado al cero que duplica la línea de
 * referencia. Se elige un paso de la escala 1-2-5 y se cuentan múltiplos.
 */
function ticks(min, max, target = 5) {
  const span = max - min || 1;
  const magnitude = 10 ** Math.floor(Math.log10(span / target));

  const count = (step) => Math.floor(max / step) - Math.ceil(min / step) + 1;
  // Se elige el paso cuyo NÚMERO de ticks se acerca más al objetivo, no el
  // primero que baja de un umbral: con un umbral, un rango de 130 salta de
  // paso 25 a paso 50 y el eje se queda con dos líneas.
  const step = [0.5, 1, 2, 2.5, 5, 10, 20]
    .map((m) => m * magnitude)
    .filter((s) => count(s) >= 3)
    .sort((a, b) => Math.abs(count(a) - target) - Math.abs(count(b) - target))[0];

  if (!step) return [min, max];

  const out = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    out.push(Math.abs(value) < 1e-9 ? 0 : value);
  }
  return out;
}

/** Recorta un nombre largo para que no invada el área de la gráfica. */
function shorten(name, max = 17) {
  return name && name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Separa etiquetas que se solaparían en vertical.
 *
 * Con cuatro series, dos pueden acabar a la misma altura y las etiquetas se
 * pisan. Se empujan lo mínimo para que se lean, conservando el orden — mover
 * una etiqueta por encima de otra mentiría sobre qué serie está más arriba.
 */
function spread(items, minGap = 13) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap < minGap) sorted[i].y = sorted[i - 1].y + minGap;
  }
  return sorted;
}

/**
 * Curva de VOR por posición: dónde está el acantilado de cada una.
 *
 * Es LA gráfica de un draft, y responde a algo que la tabla no puede: no
 * "quién es mejor", sino **cuándo se acaba el valor** en cada posición. Una
 * curva que cae en picado dice "coge a uno de éstos ahora o te quedas sin";
 * una plana dice que puedes esperar tres rondas sin perder nada.
 *
 * El cruce por cero es el nivel de reemplazo: a partir de ahí, el jugador vale
 * lo mismo que el que encuentras libre en la lista de descartes.
 */
export function VorCurve({ board, maxRank = 36 }) {
  const width = 720;
  const height = 300;
  const pad = { top: 16, right: 62, bottom: 38, left: 46 };

  const series = POSITIONS.map((position) => ({
    position,
    points: board
      .filter((row) => row.position === position && row.position_rank <= maxRank)
      .sort((a, b) => a.position_rank - b.position_rank)
      .map((row) => ({ x: row.position_rank, y: row.vor, name: row.player_name })),
  })).filter((s) => s.points.length > 1);

  if (series.length === 0) return null;

  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const yMin = Math.min(0, Math.min(...allY));
  const yMax = Math.max(...allY);

  const x = scale([1, maxRank], [pad.left, width - pad.right]);
  const y = scale([yMin, yMax], [height - pad.bottom, pad.top]);

  const labels = spread(
    series.map((s) => ({
      position: s.position,
      y: y(s.points[s.points.length - 1].y),
      x: x(s.points[s.points.length - 1].x),
    }))
  );

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="Value over replacement by rank within each position">
        {/* Rejilla horizontal + eje Y */}
        {ticks(yMin, yMax).map((value) => (
          <g key={value}>
            <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)}
                  stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(value) + 4} textAnchor="end"
                  fill="var(--muted)" fontSize="11" fontFamily={FONT}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
              {Math.round(value)}
            </text>
          </g>
        ))}

        {/* Nivel de reemplazo. Es el único trazo con significado propio, así
            que va más marcado que la rejilla y rotulado.
            La etiqueta va a la IZQUIERDA: por la derecha las cuatro curvas
            convergen justo sobre el cero y el texto se monta encima de ellas. */}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)}
              stroke="var(--axis)" strokeWidth="1.5" />
        <text x={pad.left + 4} y={y(0) + 14} textAnchor="start"
              fill="var(--muted)" fontSize="10" fontFamily={FONT}>
          nivel de reemplazo
        </text>

        {/* Eje X */}
        {[1, 6, 12, 18, 24, 30, 36].filter((t) => t <= maxRank).map((tick) => (
          <text key={tick} x={x(tick)} y={height - pad.bottom + 18} textAnchor="middle"
                fill="var(--muted)" fontSize="11" fontFamily={FONT}
                style={{ fontVariantNumeric: "tabular-nums" }}>
            {tick}
          </text>
        ))}
        <text x={(pad.left + width - pad.right) / 2} y={height - 6} textAnchor="middle"
              fill="var(--muted)" fontSize="11" fontFamily={FONT}>
          rank within position
        </text>

        {/* Series */}
        {series.map((s) => (
          <path key={s.position}
                d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.x)} ${y(p.y)}`).join(" ")}
                fill="none" stroke={POSITION_COLOR[s.position]} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round">
            <title>{`${s.position}: from ${Math.round(s.points[0].y)} to ${Math.round(
              s.points[s.points.length - 1].y
            )} VOR between rank 1 and rank ${s.points[s.points.length - 1].x}`}</title>
          </path>
        ))}

        {/* Etiqueta directa por serie: la identidad no depende del color. */}
        {labels.map((label) => (
          <text key={label.position} x={label.x + 8} y={label.y + 4}
                fill={POSITION_COLOR[label.position]} fontSize="12" fontWeight="650"
                fontFamily={FONT}>
            {label.position}
          </text>
        ))}
      </svg>
      <figcaption className="caption">
        The steeper a curve falls, the more expensive waiting is at that position. Where
        it crosses replacement level, the next player adds nothing over what is already
        free.
      </figcaption>
    </figure>
  );
}

/**
 * Calibración: probabilidad predicha frente a frecuencia observada.
 *
 * La diagonal es la calibración perfecta. Lo que importa no es que los puntos
 * estén cerca de ella por casualidad, sino que no se desvíen **de forma
 * sistemática**: si todos caen por debajo, el modelo es optimista, y ese sesgo
 * se traduce en dinero perdido apostando aunque el Brier parezca bueno.
 *
 * El tamaño del punto es el número de partidos del bin. Sin él, un bin con
 * cinco partidos parece decir tanto como uno con ochocientos.
 */
export function CalibrationPlot({ rows }) {
  const width = 420;
  const height = 360;
  const pad = { top: 16, right: 16, bottom: 44, left: 48 };

  const data = (rows ?? []).filter(
    (row) => Number.isFinite(row.predicted) && Number.isFinite(row.observed) && row.games > 0
  );
  if (data.length === 0) return null;

  const x = scale([0, 1], [pad.left, width - pad.right]);
  const y = scale([0, 1], [height - pad.bottom, pad.top]);
  const maxGames = Math.max(...data.map((row) => row.games));
  // Área proporcional al número de partidos, no el radio: si se escala el
  // radio, un bin con el cuádruple de partidos parece dieciséis veces mayor.
  const radius = (games) => 4 + 9 * Math.sqrt(games / maxGames);

  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="chart chart--square">
      <svg viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="Predicted probability against observed frequency">
        {grid.map((value) => (
          <g key={value}>
            <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)}
                  stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(value) + 4} textAnchor="end"
                  fill="var(--muted)" fontSize="11" fontFamily={FONT}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
              {Math.round(value * 100)}%
            </text>
            <text x={x(value)} y={height - pad.bottom + 18} textAnchor="middle"
                  fill="var(--muted)" fontSize="11" fontFamily={FONT}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
              {Math.round(value * 100)}%
            </text>
          </g>
        ))}

        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)}
              stroke="var(--axis)" strokeWidth="1.5" />

        {data.map((row) => (
          <circle key={row.bin} cx={x(row.predicted)} cy={y(row.observed)}
                  r={radius(row.games)} fill="var(--pos-qb)" fillOpacity="0.55"
                  stroke="var(--bg)" strokeWidth="2">
            <title>{`Predicted ${num(row.predicted * 100, 1)}% · observed ${num(
              row.observed * 100, 1
            )}% · ${row.games} games`}</title>
          </circle>
        ))}

        <text x={(pad.left + width - pad.right) / 2} y={height - 8} textAnchor="middle"
              fill="var(--muted)" fontSize="11" fontFamily={FONT}>
          predicted probability
        </text>
        <text transform={`rotate(-90 12 ${(pad.top + height - pad.bottom) / 2})`}
              x={12} y={(pad.top + height - pad.bottom) / 2} textAnchor="middle"
              fill="var(--muted)" fontSize="11" fontFamily={FONT}>
          observed frequency
        </text>
      </svg>
      <figcaption className="caption">
        Cada punto es un bin; su tamaño, cuántos partidos lo sostienen. Sobre la diagonal
        el modelo se queda corto; por debajo, se pasa de confiado.
      </figcaption>
    </figure>
  );
}

/**
 * Diferencia entre la proyección y la forma reciente del jugador.
 *
 * Es lo único que el modelo aporta de verdad sobre el listón: si la proyección
 * fuese siempre igual a la media de los últimos seis partidos, no haría falta
 * modelo. Las barras hacia la derecha son jugadores a los que el guion de juego
 * y el emparejamiento favorecen esta jornada; hacia la izquierda, al revés.
 *
 * Escala divergente centrada en cero, con dos tonos que se leen como opuestos.
 */
export function DeltaBars({ rows, limit = 12 }) {
  const data = (rows ?? [])
    .filter((row) => Number.isFinite(row.projected_points) && Number.isFinite(row.baseline_points))
    .slice(0, limit)
    .map((row) => ({ ...row, delta: row.projected_points - row.baseline_points }));

  if (data.length === 0) return null;

  const rowHeight = 22;
  const width = 720;
  const pad = { top: 10, right: 20, bottom: 30, left: 150 };
  const height = pad.top + data.length * rowHeight + pad.bottom;

  const bound = Math.max(1.5, ...data.map((row) => Math.abs(row.delta)));
  const x = scale([-bound, bound], [pad.left, width - pad.right]);
  const zero = x(0);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="Difference between the projection and the last six games average">
        {data.map((row, index) => {
          const top = pad.top + index * rowHeight;
          const value = x(row.delta);
          const positive = row.delta >= 0;
          return (
            <g key={row.player_id ?? `${row.player_name}-${index}`}>
              <text x={pad.left - 12} y={top + 15} textAnchor="end"
                    fill="var(--fg)" fontSize="12" fontFamily={FONT}>
                {shorten(row.player_name)}
              </text>
              <rect x={positive ? zero + 1 : value} y={top + 5}
                    width={Math.max(Math.abs(value - zero) - 1, 1)} height={12} rx={3}
                    fill={positive ? "var(--pos-diff-up)" : "var(--pos-diff-down)"}>
                <title>{`${row.player_name}: projection ${num(row.projected_points,
                  1
                )}, last 6 ${num(row.baseline_points, 1)} (${
                  positive ? "+" : ""
                }${num(row.delta, 1)})`}</title>
              </rect>
              {/* La cifra va DENTRO de la barra cuando cabe con holgura. Fuera,
                  el extremo de las barras largas invade la columna de nombres. */}
              {(() => {
                const long = Math.abs(value - zero) > 40;
                const inset = positive ? value - 6 : value + 6;
                return (
                  <text x={long ? inset : positive ? value + 6 : value - 6} y={top + 15}
                        textAnchor={long === positive ? "end" : "start"}
                        fill={long ? "#ffffff" : "var(--muted)"}
                        fontSize="11" fontFamily={FONT}
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                    {positive ? "+" : ""}{num(row.delta, 1)}
                  </text>
                );
              })()}
            </g>
          );
        })}
        <line x1={zero} x2={zero} y1={pad.top} y2={height - pad.bottom}
              stroke="var(--axis)" strokeWidth="1.5" />
        <text x={zero} y={height - 10} textAnchor="middle"
              fill="var(--muted)" fontSize="11" fontFamily={FONT}>
          points vs. his last-6 average
        </text>
      </svg>
    </figure>
  );
}

/** Chip de posición: color + texto, nunca sólo color. */
export function PositionChip({ position }) {
  return (
    <span className="chip" style={{ "--chip": POSITION_COLOR[position] }}>
      {position}
    </span>
  );
}
