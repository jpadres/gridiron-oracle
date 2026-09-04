/**
 * La curva de la banca: una línea, la inicial de referencia, y el final rotulado.
 *
 * Sigue las reglas de `charts.jsx` — SVG a mano, sin librería, rejilla fina de
 * un tono, etiqueta sólo en el extremo — con una diferencia: ésta se dibuja en
 * el navegador, porque los datos son del usuario y no viajan en el payload.
 *
 * El color NO transporta el dato. Verde o rojo repite lo que la posición de la
 * línea respecto a la referencia ya dice, y la tabla por jornada de debajo lo
 * dice otra vez en números — que es la lectura que vale para decidir.
 */

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

export default function BankCurve({ path, starting, label = "Bankroll after each settled bet" }) {
  // Con un solo punto no hay curva: la banca no se ha movido y una línea plana
  // de un punto se lee como si algo hubiera pasado.
  if (!Array.isArray(path) || path.length < 2) return null;

  const width = 640;
  const height = 132;
  const pad = { top: 12, right: 56, bottom: 12, left: 8 };

  const banks = path.map((p) => p.bank);
  const lo = Math.min(...banks, starting);
  const hi = Math.max(...banks, starting);
  const span = hi - lo || Math.max(1, starting * 0.02);
  const x = (i) => pad.left + (i / (path.length - 1)) * (width - pad.left - pad.right);
  const y = (v) => height - pad.bottom - ((v - lo + (hi - lo === 0 ? span / 2 : 0)) / span)
    * (height - pad.top - pad.bottom);

  const line = path.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.bank).toFixed(1)}`).join(" ");
  const last = path[path.length - 1];
  const up = last.bank >= starting;

  return (
    <svg className="bk-curve" viewBox={`0 0 ${width} ${height}`} role="img"
         aria-label={`${label}. Started at ${Math.round(starting)}, now ${Math.round(last.bank)}.`}>
      {/* La referencia es la banca inicial del mes: por encima vas arriba. */}
      <line x1={pad.left} x2={width - pad.right} y1={y(starting)} y2={y(starting)}
            stroke="var(--grid)" strokeWidth="1" />
      <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            stroke={up ? "var(--pos-diff-up)" : "var(--pos-diff-down)"} />
      <circle cx={x(path.length - 1)} cy={y(last.bank)} r="3.5"
              fill={up ? "var(--pos-diff-up)" : "var(--pos-diff-down)"}
              stroke="var(--bg)" strokeWidth="2" />
      <text x={width - pad.right + 8} y={y(last.bank) + 4} fill="var(--fg)"
            fontSize="12" fontFamily={FONT} style={{ fontVariantNumeric: "tabular-nums" }}>
        ${Math.round(last.bank).toLocaleString("en-US")}
      </text>
    </svg>
  );
}
