/**
 * La curva de la banca: una línea, la inicial de referencia, y el final al lado.
 *
 * Sigue las reglas de `charts.jsx` — SVG a mano, sin librería, rejilla fina de
 * un tono, etiqueta sólo en el extremo — con dos diferencias:
 *
 *  1. Se dibuja en el NAVEGADOR, porque los datos son del usuario y no viajan
 *     en el payload.
 *  2. **Todo el texto está fuera del SVG.** Con el texto dentro, el dibujo
 *     tenía que escalar de forma proporcional, y entonces en 390 px la curva
 *     quedaba de cuarenta píxeles de alto con una etiqueta de siete: legible en
 *     escritorio, ilegible en el teléfono, que es donde se mira. Fuera, el
 *     lienzo puede estirarse a lo ancho y conservar su altura.
 *
 * ## El eje NO se ajusta sólo a los datos
 *
 * Escalado al rango observado, un vaivén del 0,5% dibuja la misma cordillera
 * que uno del 40%: el eje truncado de manual, que en una curva de dinero se lee
 * como pánico o como euforia según el lado. El dominio se ancla en la banca
 * INICIAL y se abre como mínimo un ±5%, y el pie lo dice.
 *
 * El color no transporta el dato: repite lo que la posición de la línea
 * respecto a la referencia ya dice, y la tabla por jornada de debajo lo dice
 * otra vez en números — que es la lectura que vale para decidir.
 */

/** Mínimo que abarca el eje a cada lado de la inicial, en tanto por uno. */
const MIN_SPAN = 0.05;

export default function BankCurve({ path, starting, label = "Bankroll after each settled bet" }) {
  // Con un solo punto no hay curva: la banca no se ha movido y una línea plana
  // de un punto se lee como si algo hubiera pasado.
  if (!Array.isArray(path) || path.length < 2) return null;

  const width = 640;
  const height = 120;
  const pad = 10;

  const desvio = Math.max(
    ...path.map((p) => Math.abs(p.bank - starting)),
    Math.abs(starting) * MIN_SPAN
  );
  const lo = starting - desvio;
  const hi = starting + desvio;
  const x = (i) => (i / (path.length - 1)) * width;
  const y = (v) => height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2);

  const line = path
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.bank).toFixed(1)}`)
    .join(" ");
  const last = path[path.length - 1];
  const up = last.bank >= starting;
  const dinero = (v) => `$${Math.round(v).toLocaleString("en-US")}`;

  return (
    <figure className="bk-curve-fig">
      <div className="bk-curve-row">
        {/* `preserveAspectRatio="none"` estira el lienzo a lo ancho sin cambiar
            su altura; el trazo se mantiene fino con `vector-effect`. Sin texto
            dentro, deformar no deforma nada que se lea. */}
        <svg className="bk-curve" viewBox={`0 0 ${width} ${height}`}
             preserveAspectRatio="none" role="img"
             aria-label={`${label}. Started at ${Math.round(starting)}, now ${Math.round(last.bank)}.`}>
          <line x1="0" x2={width} y1={y(starting)} y2={y(starting)}
                stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                stroke={up ? "var(--pos-diff-up)" : "var(--pos-diff-down)"} />
        </svg>
        <b className={`bk-curve-end ${up ? "wk-up" : "wk-down"}`}>{dinero(last.bank)}</b>
      </div>
      <figcaption className="caption">
        The grey line is the month&rsquo;s starting bankroll, <b>{dinero(starting)}</b>; each
        step is one settled bet. The axis always spans at least &plusmn;5% of it, so a quiet
        month looks quiet &mdash; scaled to the data alone, a half-point wobble would draw the
        same mountain range as a blow-up.
      </figcaption>
    </figure>
  );
}
