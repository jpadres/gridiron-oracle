import { model, num, pct } from "../../data/model.js";
import { CalibrationPlot } from "../charts.jsx";
import { Callout, NoDataYet, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — Validation",
  description:
    "Out-of-sample metrics against the market, calibration, and the against-the-spread record with its confidence interval.",
};

const SEASON_COLUMNS = [
  { key: "season", label: "Season" },
  { key: "games", label: "Games" },
  { key: "brier", label: "Brier", format: (v) => num(v, 4) },
  { key: "market_brier", label: "Market Brier", format: (v) => num(v, 4) },
  { key: "margin_mae", label: "Margin MAE", format: (v) => num(v) },
  { key: "market_margin_mae", label: "Market MAE", format: (v) => num(v) },
  { key: "ece", label: "ECE", format: (v) => num(v, 4) },
  { key: "accuracy", label: "Accuracy", format: (v) => pct(v) },
];

const CALIBRATION_COLUMNS = [
  { key: "bin", label: "Probability range" },
  { key: "predicted", label: "Predicted", format: (v) => pct(v) },
  { key: "observed", label: "Observed", format: (v) => pct(v) },
  { key: "games", label: "Games" },
];

export default function Validacion() {
  const validation = model.validation;

  if (!validation) {
    return (
      <>
        <h1>Validation</h1>
        <NoDataYet />
      </>
    );
  }

  const { overall, ats, seasons, calibration } = validation;

  return (
    <>
      <h1>Validation</h1>
      <p className="lede">
        Strict walk-forward: to predict season S only earlier seasons are used. Everything is
        refit at every step — model, margin distribution, calibration and ensemble weights.
      </p>

      <h2>Out of sample ({overall.games.toLocaleString("en-US")} games)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Model</th>
              <th>Market (close)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Brier</td><td>{num(overall.brier, 4)}</td>
                <td>{num(overall.market_brier, 4)}</td></tr>
            <tr><td>Log-loss</td><td>{num(overall.log_loss, 4)}</td><td>—</td></tr>
            <tr><td>Calibration error (ECE)</td><td>{num(overall.ece, 4)}</td><td>—</td></tr>
            <tr><td>Margin MAE</td><td>{num(overall.margin_mae)}</td>
                <td>{num(overall.market_margin_mae)}</td></tr>
            <tr><td>Total MAE</td><td>{num(overall.total_mae)}</td><td>—</td></tr>
            <tr><td>Straight-up accuracy</td><td>{pct(overall.accuracy)}</td><td>—</td></tr>
          </tbody>
        </table>
      </div>

      <Callout title="How to read this">
        <p>
          The two columns sit side by side on purpose. Reporting the model&rsquo;s Brier
          without the market&rsquo;s next to it says nothing: the question is not &ldquo;is it
          good?&rdquo; but &ldquo;is it better than what already exists for free?&rdquo;
        </p>
      </Callout>

      <h2>Against the spread</h2>
      <p>
        {ats.wins}-{ats.losses}-{ats.pushes} ({pct(ats.win_rate)}), IC 95%{" "}
        [{pct(ats.ci_low)}, {pct(ats.ci_high)}]. Breakeven at -110 is 52.4%.{" "}
        <strong>{ats.significant ? "Significant." : "Not significant."}</strong>
      </p>
      <p className="caption">
        An against-the-spread percentage without a confidence interval means nothing. Over a
        few hundred bets the standard error is several percentage points, and presenting the
        bare number is the most common way of selling noise as edge.
      </p>

      <h2>By season</h2>
      <p className="caption">
        <strong>Careful with the ECE column here.</strong> It runs between 0.04 and 0.10 each
        season while the overall ECE above is {num(overall.ece, 4)} — far better than any of
        its parts, which sounds like a trick. It is not: ECE is{" "}
        <strong>biased upward on small samples</strong>. With 267 games split across ten bins
        that is about 27 per bin, and sampling noise alone moves the observed frequency by some
        9 points. That is mostly what those numbers measure. Pooled across{" "}
        {overall.games.toLocaleString("en-US")} games the noise drops and what is left is real
        miscalibration.
      </p>
      <Table columns={SEASON_COLUMNS} rows={seasons} />

      <h2>Calibration</h2>
      <p className="caption">
        Predicted probability against observed frequency. If the two diverge the model is
        lying even when its Brier looks good — and to price a bet, the probability matters more
        than the ranking.
      </p>
      <CalibrationPlot rows={calibration} />
      <Table columns={CALIBRATION_COLUMNS} rows={calibration} />
    </>
  );
}
