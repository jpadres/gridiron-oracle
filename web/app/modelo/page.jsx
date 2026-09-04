import { Callout, Note } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — The Model",
  description: "What makes this model different, and the methodology decisions holding it up.",
};

export default function Modelo() {
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
    </>
  );
}
