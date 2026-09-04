import { model, num, pct } from "../../data/model.js";
import { Callout, NoDataYet, Note, Table } from "../ui.jsx";
import { MatchupCard, StatHero, TeamMark } from "../sports.jsx";

export const metadata = {
  title: "Gridiron Oracle — Predictions",
  description: "This week's predictions and the bets that clear the value threshold.",
};


const RATING_COLUMNS = [
  { key: "team", label: "Team", format: (v) => <TeamMark abbr={v} solid /> },
  { key: "elo", label: "Elo", format: (v) => num(v, 0) },
  { key: "off_epa", label: "Offense", format: (v) => num(v, 3) },
  { key: "def_epa", label: "Defense", format: (v) => num(v, 3) },
  { key: "net_epa", label: "Net", format: (v) => num(v, 3) },
];

export default function Predicciones() {
  const week = model.week;
  const predictions = model.predictions ?? [];

  if (!week || predictions.length === 0) {
    return (
      <>
        <h1>Predictions</h1>
        <NoDataYet />
      </>
    );
  }


  // El partido con más desacuerdo entre el modelo y la línea. Es el que se
  // destaca arriba — y el copy dice explícitamente que destacarlo NO es una
  // recomendación, porque medido sobre 3.736 apuestas el acierto no crece con
  // la discrepancia. Es el partido más interesante de mirar, no el mejor.
  const widest = [...predictions].sort(
    (a, b) => Math.abs(b.edge_vs_line ?? 0) - Math.abs(a.edge_vs_line ?? 0)
  )[0];

  return (
    <>
      <p className="eyebrow">Week {week.week} · {week.season}</p>
      <h1>The slate</h1>
      <p className="lede">
        Sixteen games, the model&rsquo;s number against the market&rsquo;s — each labeled,
        never merged. The bar under each matchup is the model&rsquo;s win probability:
        calibrated out of sample (a team shown at 74% has won 77% of the time across
        fourteen seasons), <strong>not</strong> the market&rsquo;s, and not a recommendation
        &mdash; the market&rsquo;s own probabilities remain slightly sharper.
      </p>

      {widest ? (
        <section className="band spotlight" aria-label="Widest disagreement">
          <div className="spotlight-head">
            <p className="eyebrow">Widest disagreement this week</p>
            <p className="caption">
              Furthest the model sits from the line. That makes it the most interesting game
              to look at — <strong>not the best bet</strong>. Accuracy does not rise with
              disagreement.
            </p>
          </div>
          <div className="spotlight-body">
            <MatchupCard game={widest} detailed />
            <div className="spotlight-stats">
              <StatHero
                label="Model margin"
                value={num(widest.pred_margin)}
                note={`Line ${num(widest.spread_line, 1)}`}
              />
              <StatHero
                label="Gap"
                value={`${num(Math.abs(widest.edge_vs_line ?? 0), 1)} pts`}
                note="Model minus line"
              />
            </div>
          </div>
        </section>
      ) : null}

      <h2>Every game</h2>
      <div className="matchups deal">
        {predictions.map((game) => (
          <MatchupCard key={game.game_id} game={game} detailed />
        ))}
      </div>

      {/* LAS APUESTAS DE VALOR VIVEN EN BETTING, Y SÓLO ALLÍ.
          Esta página tenía su propia sección con la misma tabla y tres bloques
          de aviso, mientras Betting evalúa TODOS los mercados con más columnas
          —probabilidad del modelo, la casa sin vig, EV, stake y la ficha
          histórica de esa clase de apuesta—. Dos superficies con la misma
          respuesta y distinta cobertura es como divergen, y ya costó una
          iteración con los traductores de Sleeper. Aquí queda el enlace y la
          frase que hay que leer antes de pulsarlo. */}
      <h2>Value bets</h2>
      <p>
        They live on <a href="/betting">Betting</a>, evaluated against every market with the
        house price de-vigged, the expected value and the stake at your bankroll.
      </p>
      <Note title="Read that table alongside this page, not instead of it">
        <p>
          This site says the model <strong>does not beat the closing line</strong>, and that
          page lists bets. It is not a contradiction: those are the games where the model
          departs most from the market, and out of sample{" "}
          <strong>accuracy does not rise with disagreement</strong> — 49.3%, 50.9% and 48.8%
          by bucket, none of them reaching the 52.4% breakeven at −110. A lean is where the
          model stands, never a promise, and the full measurement is on that page.
        </p>
      </Note>

      <h2>Current ratings</h2>
      <p className="caption">
        As they stood after the last game played. Under <strong>Defense</strong>, a high
        number means a permissive defense: expected offense against it is{" "}
        <code>offense + opponent defense</code>, added.
      </p>
      <Table columns={RATING_COLUMNS} rows={model.ratings ?? []} />
    </>
  );
}
