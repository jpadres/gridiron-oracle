import { model, num } from "../data/model.js";
import { Callout, DataCard, MachineWritten, Stat } from "./ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — Overview",
  description: "The model matches the closing line. It does not beat it.",
};

/**
 * Los cuatro conjuntos de datos, con su frescura.
 *
 * El research es el único que caduca de verdad: se barre a diario y una ficha de
 * hace una semana ya no cambia una alineación. Por eso es el único que se marca
 * como caducado, y a los tres días — que es cuando un parte médico deja de ser
 * el último.
 */
const STALE_DAYS = 3;

function dataState(payload) {
  const cards = [];

  if (payload.week) {
    cards.push({
      href: "/predicciones",
      label: "Predictions",
      value: `Week ${payload.week.week}`,
      detail: `${payload.predictions?.length ?? 0} games · ${payload.week.season}`,
    });
  }
  if (payload.fantasy) {
    cards.push({
      href: "/fantasy",
      label: "Draft Board",
      value: `${payload.fantasy.board?.length ?? 0} players`,
      detail: `${payload.fantasy.scoring?.toUpperCase() ?? ""} · ${payload.fantasy.teams}-team league`,
    });
  }
  if (payload.survivor) {
    cards.push({
      href: "/survivor",
      label: "Survivor",
      value: payload.survivor.short_board?.[0]?.team ?? "—",
      detail: `best pick for week ${payload.survivor.from_week}`,
    });
  }

  const last = payload.research?.items?.[0]?.date;
  if (last) {
    // La antigüedad se calcula en build time y se congelaría si el sitio deja
    // de reconstruirse — diría «hace 2 días» para siempre. Por eso lo que se
    // enseña es la **fecha**, que no puede caducar.
    const days = Math.round((Date.now() - Date.parse(`${last}T12:00:00Z`)) / 86400000);
    const [, month, day] = last.split("-");
    const stamp = `${Number(month)}/${Number(day)}`;
    cards.push({
      href: "/research",
      label: "Research",
      value: `${payload.research.total ?? 0} briefs`,
      detail: days > STALE_DAYS
        ? `last sweep ${stamp} — not refreshed`
        : `last sweep ${stamp}`,
      stale: days > STALE_DAYS,
    });
  }
  return cards;
}

export default function Home() {
  const overall = model.validation?.overall;
  const summary = model.narrative?.summary;
  const week = model.week;
  const state = dataState(model);

  return (
    <>
      <h1>Gridiron Oracle</h1>
      <p className="lede">
        An NFL forecasting model — margin, total, win probability and value against the
        market — plus fantasy football rankings. Fully public data, strict walk-forward
        validation, and results reported without spin.
      </p>

      <nav className="cards" aria-label="Data status">
        {state.map((card) => (
          <DataCard key={card.href} {...card} />
        ))}
      </nav>

      <Callout title="The honest result, in one line">
        <p>
          <strong>The model matches the market&rsquo;s closing line. It does not beat it.</strong>{" "}
          {overall ? (
            <>
              Across {overall.games.toLocaleString("en-US")} out-of-sample games it posts a
              Brier of <strong>{num(overall.brier, 4)}</strong> against the books&rsquo;{" "}
              <strong>{num(overall.market_brier, 4)}</strong>, and a margin MAE of{" "}
              <strong>{num(overall.margin_mae)}</strong> against{" "}
              <strong>{num(overall.market_margin_mae)}</strong>.
            </>
          ) : (
            <>The exact figures appear as soon as the validation payload is generated.</>
          )}
        </p>
        <p>
          This is exactly what should happen, and it is the best possible news: the NFL
          closing line is one of the most efficient estimators in any market anywhere. Any
          project claiming to beat it consistently by a wide margin, on public data, is
          overfitting or measuring wrong.
        </p>
      </Callout>

      {overall ? (
        <div className="grid">
          <Stat label="Brier" value={num(overall.brier, 4)}
                hint={`Market: ${num(overall.market_brier, 4)}`} />
          <Stat label="Margin MAE" value={num(overall.margin_mae)}
                hint={`Market: ${num(overall.market_margin_mae)}`} />
          <Stat label="Calibration error" value={num(overall.ece, 4)}
                hint="How far the probability lies" />
          <Stat label="Straight-up accuracy" value={`${num(overall.accuracy * 100, 1)}%`}
                hint="Game winner" />
        </div>
      ) : null}

      {summary ? (
        <section id="jornada">
          <h2>
            {week ? `Week ${week.week}, ${week.season}` : "This week"} — {summary.headline}
          </h2>
          <MachineWritten at={model.narrative?.generated_at}>
            {summary.paragraphs?.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
            {summary.watch?.length ? (
              <ul>
                {summary.watch.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
          </MachineWritten>
        </section>
      ) : null}

      <h2>Where the real edge is, and why it is not here yet</h2>
      <p>
        This backtest is validated against the <em>closing</em> line. Nobody bets the close.
        Money is made against the opening line, against slow books, and on injury news before
        the market digests it. That is roadmap work, not a promise that the model already does
        it.
      </p>

      <h2>What it does add</h2>
      <ul>
        <li>
          <strong>A discrete distribution with key numbers.</strong> NFL margins pile up on 3
          and 7; a normal distribution makes systematic errors at exactly the lines where the
          money is.
        </li>
        <li>
          <strong>Parameterized on the market residual.</strong> The model predicts where the
          line is wrong, rather than predicting the margin with the line as just another
          feature.
        </li>
        <li>
          <strong>Calibration measured and published.</strong> For betting, the probability
          matters more than the ranking.
        </li>
        <li>
          <strong>A standalone model</strong> that never looks at the line, so we can answer
          whether the on-field signal is worth anything on its own.
        </li>
      </ul>

      <h2>Known limitations</h2>
      <ul>
        <li>Validated against closing lines, the hardest to beat.</li>
        <li>No live injury data; the QB effect is inferred from the announced starter.</li>
        <li>Weather is historical and observed, never forecast.</li>
        <li>No multi-book lines, so no <em>line shopping</em>.</li>
        <li>No player props or alternate markets.</li>
      </ul>
    </>
  );
}
