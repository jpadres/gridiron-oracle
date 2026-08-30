import { model, num, pct } from "../../data/model.js";
import { Callout, NoDataYet, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — Predictions",
  description: "This week's predictions and the bets that clear the value threshold.",
};

const GAME_COLUMNS = [
  { key: "away_team", label: "Away" },
  { key: "home_team", label: "Home" },
  { key: "spread_line", label: "Line", format: (v) => num(v, 1) },
  { key: "pred_margin", label: "Margin", format: (v) => num(v) },
  { key: "pred_total", label: "Total", format: (v) => num(v, 1) },
  { key: "home_win_prob", label: "P(home)", format: (v) => pct(v) },
  { key: "edge_vs_line", label: "Diff", format: (v) => num(v) },
];

const BET_COLUMNS = [
  { key: "matchup", label: "Game" },
  { key: "market", label: "Market" },
  { key: "selection", label: "Pick" },
  { key: "model_prob", label: "P(model)", format: (v) => pct(v) },
  // Fuera «P(mercado)». En un spread a −110 por los dos lados, quitar el vig da
  // exactamente 50,0% siempre: la columna ocupaba sitio para repetir el mismo
  // número en todas las filas, y de paso invitaba a leer el edge como si el
  // mercado hubiese opinado algo. Lo que va en su lugar es lo que de verdad
  // distingue una apuesta de otra: cuánto se separa el modelo de la línea.
  { key: "disagreement", label: "Disagreement", format: (v) => `${num(v, 1)} pts` },
  { key: "edge", label: "Edge", format: (v) => pct(v) },
  { key: "ev", label: "EV", format: (v) => pct(v) },
  { key: "stake", label: "Stake", format: (v) => num(v) },
  {
    key: "evidence_win_rate",
    label: "This class, historically",
    format: (v, row) =>
      v === null || v === undefined ? (
        <span className="ev-none">no evidence</span>
      ) : (
        <span className={row.evidence_beats_breakeven ? "ev-ok" : "ev-bad"}
              title={`Bets disagreeing by ${row.evidence_label} won ${(v * 100).toFixed(1)}% across ${row.evidence_bets} out-of-sample cases. Breakeven at −110 is 52.4%.`}>
          {pct(v)} of {row.evidence_bets}
        </span>
      ),
  },
];

const RATING_COLUMNS = [
  { key: "team", label: "Team" },
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

  const bets = model.bets ?? [];

  return (
    <>
      <h1>
        Predictions — {week.season}, week {week.week}
      </h1>
      <p className="lede">
        <strong>Margin</strong> is the production prediction, anchored to the market.{" "}
        <strong>Free margin</strong> is the standalone model, which never looks at the line.
        Comparing them shows how far the on-field signal is drifting from consensus.
      </p>

      <Table columns={GAME_COLUMNS} rows={predictions} />

      <h2>Value bets</h2>
      <Callout title="Read this table alongside the overview, not instead of it">
        <p>
          The overview says the model <strong>does not beat the closing line</strong>, and
          this table lists bets. That is not a contradiction: these are the games where the
          model departs most from the market, and that disagreement has a standard deviation of
          0.86 points, so a two-point gap happens about a hundred times in fourteen seasons.
          Within that group the historical record is positive{" "}
          <strong>and does not reach statistical significance</strong> (p≈0.18). It is a
          hypothesis, not a proven strategy.
        </p>
        <p className="caption">
          If you see a stake of pennies next to a 4% edge, nothing is broken: after the 50%
          shrink that bet sits right on the -110 breakeven (52.4%), and Kelly calls for almost
          nothing. That is the risk machinery working.
        </p>
      </Callout>
      {bets.length === 0 ? (
        <Callout title="No bet clears the threshold">
          <p>
            This is the normal result most weeks, and it is not a failure. The model matches
            the market: if it found value in ten games a week, the thing to check would be the
            model.
          </p>
          <p className="caption">
            Lowering the threshold does not create edge. It only hides its absence.
          </p>
        </Callout>
      ) : (
        <>
          <Table columns={BET_COLUMNS} rows={bets} />
          <p className="caption">
            Stakes on a 1,000 bankroll, quarter Kelly, a 50% shrink of the estimated edge and
            a hard 2% cap per bet. Bets under a stake of 1 are not published: a &ldquo;bet
            $0.01&rdquo; row is &ldquo;do not bet&rdquo; dressed up as a recommendation.
          </p>

          <Callout title="What the record says about bets like this one">
            <p>
              The last column is not an opinion or an invented confidence scale. It is the{" "}
              <strong>real, out-of-sample</strong> win rate of bets where the model disagreed
              with the line by that same amount, across fourteen seasons. The threshold was
              fixed before measuring, in <code>docs/PREREGISTRO_confianza.md</code>.
            </p>
            <p>The full result, which is uncomfortable and therefore published in full:</p>
            <ul>
              <li>Disagreement of <strong>0 to 1 points</strong>: won <strong>49.3%</strong> (2,189 cases).</li>
              <li><strong>1 to 2 points</strong>: <strong>50.9%</strong> (1,173 cases).</li>
              <li><strong>2 to 3.5 points</strong>: <strong>48.8%</strong> (346 cases).</li>
            </ul>
            <p>
              Breakeven at −110 odds is <strong>52.4%</strong>.{" "}
              <strong>No bucket clears it</strong>, not on the mean and not — which is what the
              pre-registration required — on the lower bound of its interval.
            </p>
            <p>
              And the most informative fact of all: <strong>accuracy does not rise with
              disagreement</strong>. The model departing further from the line does not predict
              being right more often. That directly refutes building &ldquo;confidence&rdquo;
              out of edge, which was the obvious path and is why it was tested.
            </p>
            <p className="caption">
              That is why there are no &ldquo;Best Bets&rdquo; or confidence stars here.
              Building them would mean claiming a profitability these data do not support, and
              would be exactly the kind of invented number the rest of this site exists not to
              publish.
            </p>
          </Callout>
        </>
      )}

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
