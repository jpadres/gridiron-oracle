import { model, num, pct } from "../../data/model.js";
import { CalibrationPlot } from "../charts.jsx";
import { Callout, NoDataYet, Note, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — The Model",
  description:
    "How the model works and how well it works: the methodology decisions and the walk-forward numbers, on one page.",
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

/**
 * CÓMO FUNCIONA Y CÓMO DE BIEN FUNCIONA, EN UNA PÁGINA.
 *
 * Eran dos: `/modelo` explicaba las decisiones y `/validacion` publicaba los
 * números que las juzgan. Ninguna de las dos es una herramienta —se leen una
 * vez— y separadas obligaban a saltar de una a otra para contrastar cada
 * afirmación con su medición, que es justo lo que este proyecto quiere que se
 * haga. Ahora la metodología va primero y su veredicto detrás, sin salir.
 *
 * No se ha recortado nada: las cuatro tablas, la gráfica de calibración y el
 * bloque del modelo de totales retirado están enteros.
 */
export default function Modelo() {
  const validation = model.validation;
  const { overall, ats, seasons, calibration } = validation ?? {};

  return (
    <>
      <h1>The Model</h1>
      <p className="lede">
        Seven decisions that separate this from a dressed-up Elo. None came free: each was
        chosen by measuring, and several made things worse before they made them better.
      </p>

      <h2>1. A discrete distribution with key numbers, not a normal</h2>
      <p>
        NFL margins are not continuous. They pile up hard on 3 and 7, because that is how
        scoring works. Turning &ldquo;expected margin 2.8&rdquo; into a probability with a
        normal makes large and <em>systematic</em> errors at exactly the lines where the money
        is.
      </p>
      <p>
        The density factors as <code>P(margin = k) ∝ w(k) · N(k; pred, σ)</code>, where{" "}
        <code>w(k)</code> is the ratio of each margin&rsquo;s observed frequency to its
        kernel-smoothed version. It comes out ~1.9 at k=3, ~1.5 at k=7 and ~0.55 at k=2 and
        k=5, <strong>with nobody telling it to</strong>. That it shows up unasked is the check
        that it measures something real, and it is where correct <em>push</em> probabilities
        come from.
      </p>

      <h2>2. Parameterized on the market residual</h2>
      <p>
        The production model does not predict the margin with the line as just another
        feature. It predicts <code>margin − line</code>: where the market is wrong. The target
        has near-zero mean, so regularization defaults toward &ldquo;the market is right&rdquo;
        and only departs from it on evidence. That is the difference between a model that
        respects the market and one that fights it over noise.
      </p>

      <h2>3. Opponent-adjusted efficiency ratings, computed online</h2>
      <p>
        Raw EPA measures outcome, not quality: an offense at 0.15 EPA/play may be good, or may
        have played the league&rsquo;s three worst defenses. The adjustment is iterative and
        online, never looking forward, shrunk by games played (week 1 is not entitled to strong
        opinions) and partially carried across seasons.
      </p>

      <h2>4. The quarterback as an explicit correction</h2>
      <p>
        No team rating captures that the starter changed.{" "}
        <code>qb_vs_offense</code> measures the gap between the announced QB&rsquo;s rating and
        the offense&rsquo;s recent level: it catches backups and injuries without paying for an
        injury feed. In the NFL that is worth 2 to 7 points of spread.
      </p>

      <h2>5. Adaptive home-field advantage</h2>
      <p>
        Home-field advantage fell from ~2.7 points in the mid-2000s to ~1.5 in 2020&ndash;22,
        and has climbed back. Fixing it at a constant is a systematic half-point error across
        entire seasons, so it is estimated recursively from the residuals of home games.
      </p>

      <h2>6. Real travel, time zones and altitude</h2>
      <p>
        Coordinates for every venue in the data, including international sites (Wembley,
        Tottenham, Azteca, Munich, São Paulo, Madrid, Melbourne). Haversine distance, a{" "}
        <em>signed</em> time-zone shift — flying east costs more than flying west — and altitude
        relative to a team&rsquo;s own home: Denver&rsquo;s edge is not playing high, it is
        playing higher than the opponent.
      </p>

      <h2>7. Walk-forward validation, no exceptions</h2>
      <p>
        There is no random cross-validation in this project. Shuffling 2015 and 2023 games
        into the same fold leaks the future through team ratings and massively overstates
        performance. To predict season S only earlier seasons are used: model, distribution,
        calibration and ensemble weights are all refit at every step.
      </p>

      <Note title="The mistake already made here, and how it is fixed">
        <p>
          During development the ensemble weights were fit on component predictions{" "}
          <em>in sample</em>: the classic stacking leak. It cost 0.6 points of MAE and made the
          combined model <strong>worse than any of its parts</strong> — which is the clearest
          alarm bell there is.
        </p>
        <p>
          Fixed with temporal cross-fitting: the predictions used to fit the weights are
          generated in disjoint time blocks on an expanding window. Never in sample, and never
          with the future.
        </p>
      </Note>

      <h2>Risk management</h2>
      <p>
        The betting module uses fractional Kelly (0.25) <strong>plus</strong> an explicit 50%
        shrink of the estimated edge, a hard 2% cap of bankroll per bet, and a 1.5% minimum
        edge threshold. Full Kelly on estimated probabilities produces 60&ndash;80% drawdowns:
        it is not a defensible option.
      </p>
      <p>
        De-vigging uses Shin&rsquo;s method, not proportional normalization. Longshot odds
        overstate their true probability, and on lopsided moneylines the difference between the
        two methods is 1&ndash;2 percentage points — exactly the size of the edge being looked
        for.
      </p>

      <hr className="rule" />

      <h2 id="validacion">Validation</h2>
      <p className="lede">
        Strict walk-forward: to predict season S only earlier seasons are used. Everything is
        refit at every step — model, margin distribution, calibration and ensemble weights.
      </p>
      {validation ? (
        <>
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
              {/* El total que publica el modelo ES la línea desde el 3 de
                  septiembre de 2026, así que las dos columnas son la misma cifra
                  a propósito — y eso es lo que hay que ver. */}
              <tr><td>Total MAE</td><td>{num(overall.total_mae)}</td>
                  <td>{num(overall.total_mae)}</td></tr>
              <tr><td>Straight-up accuracy</td><td>{pct(overall.accuracy)}</td><td>—</td></tr>
            </tbody>
          </table>
        </div>

        <Callout title="The totals model was retired, and here is the measurement">
          <p>
            Until 3 September 2026 the model fitted a residual on top of the closing total
            the same way it does for the spread. Over the full walk-forward — 3,829 games —
            it was <strong>worse than the line on its own</strong>: MAE 10.574 against
            10.510, a paired difference of <strong>+0.064 ± 0.019</strong> (t = +3.42),
            worse in 12 of 14 seasons.
          </p>
          <p>
            The direction was no better. When the model disagreed with the total by more
            than a point it picked the right side <strong>47.8%</strong> of the time; at
            two points, 47.5%. Break-even at &minus;110 is 52.4%. A component that is worse
            than its own input is not kept &ldquo;just in case&rdquo;:{" "}
            <strong>the total this model publishes is the line</strong>, and there is no
            over/under lean anywhere on the site.
          </p>
          <p className="caption">
            Reproduce it with <code>python scripts/totals_vs_line.py --from 2012</code>.
          </p>
        </Callout>

        <Note title="How to read this">
          <p>
            The two columns sit side by side on purpose. Reporting the model&rsquo;s Brier
            without the market&rsquo;s next to it says nothing: the question is not &ldquo;is it
            good?&rdquo; but &ldquo;is it better than what already exists for free?&rdquo;
          </p>
        </Note>

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
      ) : (
        <NoDataYet />
      )}
    </>
  );
}
