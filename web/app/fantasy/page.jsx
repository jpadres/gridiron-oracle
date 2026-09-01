import { availabilityByPlayer, briefsByPlayer, model, num } from "../../data/model.js";
import { PositionChip, VorCurve } from "../charts.jsx";
import { Callout, NoDataYet, Table } from "../ui.jsx";
import BoardShell from "./BoardShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — Draft Board",
  description:
    "Value over replacement board with per-position rankings and the VOR curve that shows where each position falls off.",
};

const VALIDATION_COLUMNS = [
  { key: "position", label: "Position", format: (v) => <PositionChip position={v} /> },
  {
    key: "predictor",
    label: "Predictor",
    format: (v) => (v === "model" ? "This model" : "Last season's points"),
  },
  { key: "pearson", label: "Correlation", format: (v) => num(v, 2) },
  { key: "spearman", label: "Spearman", format: (v) => num(v, 2) },
  { key: "mae", label: "MAE (pts)", format: (v) => num(v, 0) },
];

const BAND_COLUMNS = [
  { key: "band", label: "Board rank" },
  {
    key: "predictor",
    label: "Predictor",
    format: (v) => (v === "model" ? "This model" : "Last season's points"),
  },
  { key: "spearman", label: "Spearman", format: (v) => num(v, 2) },
  { key: "mae", label: "MAE (pts)", format: (v) => num(v, 0) },
];

export default function Fantasy() {
  const fantasy = model.fantasy;

  if (!fantasy) {
    return (
      <>
        <h1>Draft Board</h1>
        <NoDataYet />
      </>
    );
  }

  const board = fantasy.board ?? [];
  const gap = model.dossier?.gap ?? [];
  const ambiguous = model.dossier?.ambiguous ?? [];

  return (
    <BoardShell
      board={board}
      gap={gap}
      availability={availabilityByPlayer(model.dossier)}
      briefs={briefsByPlayer(model.dossier, model.research)}
      context={{
        season: fantasy.season,
        scoring: fantasy.scoring,
        teams: fantasy.teams,
        league: fantasy.league,
        // Lo que hace falta para RECOMPILAR el board en la liga del usuario. Son
        // los mismos números con los que se calculó el publicado, así que el
        // navegador reproduce la cadena entera y no una aproximación suya.
        componentOrder: fantasy.components ?? null,
        positionPriors: fantasy.position_priors ?? null,
        shrinkPriorGames: fantasy.shrink_prior_games ?? 10,
        tdPersistence: fantasy.td_persistence ?? 0.55,
        projectedGames: fantasy.projected_games ?? 15.5,
        // `sleeper_id` -> jugador, horneado en el build desde los rosters de
        // nflverse. Es lo que permite resolver un pick en vivo POR
        // IDENTIFICADOR en vez de por nombre. Sin él, el adaptador marca
        // UNMAPPED en lugar de adivinar.
        sleeperIds: fantasy.sleeper_ids ?? null,
        // Semanas de descanso: un HECHO derivado del calendario publicado, no
        // una proyección. Se publica entero o no se publica.
        byes: fantasy.byes ?? null,
      }}
      methodology={
        <>
          <p>
            Full-season projections built from three years of volume and efficiency
            (weighted 56/30/14), shrunk toward the positional mean by sample size, and
            adjusted by each position&rsquo;s <strong>age curve</strong> — live since August
            2026 and validated: it improves projections at all four positions, most of all
            at the running back cliff.
          </p>
          <p>
            The overall order is <strong>VOR, not total points</strong>. Comparing a
            quarterback to a running back on total points means nothing: the QB always wins
            and still goes in round 8. What matters is not how many points a player scores
            but <strong>how many more than whoever you can get for free at his
            position</strong>.
          </p>
          <p>
            Tiers come from real gaps in VOR, not from slicing the list into twelves. If the
            player you want is the last of his tier, you cannot wait another round.
          </p>
          {fantasy.league ? null : (
            <p className="caption">
              Scoring is <strong>assumed</strong>, not synced. If your league scores
              differently this order is not yours — scoring changes the ranking, not just the
              points.
            </p>
          )}
        </>
      }
      draftNote={
        <>
          <p className="caption">
            The suggestion is <strong>best available by VOR</strong> — one explicit
            definition, unadjusted. What you already hold at each position is shown
            beside it as a count, not folded into the number: how much a third
            receiver is worth <em>to you</em> is a judgment no experiment here has
            validated, so the board states the facts and leaves that call to you.
          </p>
        </>
      }
      boardFooter={
        <>
          <h2>Where value runs out at each position</h2>
          <VorCurve board={board} />
        </>
      }
      consensusNotes={
        <>
          <Callout title="The disagreements land exactly where the model is blind">
            <p>
              These are not random errors, and that is why they matter:{" "}
              <strong>each cluster of disagreement points at a limitation that is already
              documented</strong>.
            </p>
            <ul>
              <li>
                <strong>Injured players the model ranks up.</strong> Consensus has already
                marked them down because it knows the injury report; the model projects off
                games played and knows nothing. Trust consensus here — check the availability
                tag.
              </li>
              <li>
                <strong>Veterans the model ranks up.</strong> This was the largest source of
                disagreement until the age curve went live, and it{" "}
                <strong>shrank sharply</strong>: Kelce went from +75 to +13 against consensus,
                Kamara from +106 to +8. What is left is real disagreement, not a hole in the
                model.
              </li>
              <li>
                <strong>Young players the model ranks down.</strong> No history means no
                projection, and a second-year player in a new role is exactly what the model
                cannot see. Consensus has information these data do not contain.
              </li>
            </ul>
          </Callout>
          <p className="caption">
            {gap.length} of the {model.dossier?.consensus_size ?? 0} consensus players match
            this board.
            {ambiguous.length > 0 ? (
              <>
                {" "}
                Not compared: {ambiguous.map((names) => names.join(" and ")).join("; ")} —
                same first initial, surname and team, and nflverse&rsquo;s abbreviated format
                cannot tell them apart. Guessing would attach a striking disagreement to the
                wrong player.
              </>
            ) : null}
          </p>
        </>
      }
      riskNotes={
        <>
          <h2>The two risk columns: Bust and Missed</h2>
          <p>
            <strong>Bust</strong> is the probability a player finishes the season{" "}
            <strong>below 70% of his projection</strong>. It is not &ldquo;how much he might
            vary&rdquo;: a projection can miss upward and that is good news, not risk. This
            measures only the downside, which is the question you actually ask in a draft.
          </p>
          <p>
            The 70% cut and the acceptance thresholds were fixed{" "}
            <strong>before anything was measured</strong>, written down in{" "}
            <code>docs/PREREGISTRO_riesgo.md</code>. Across 1,865 player-seasons from 2016 to
            2025, each estimated using only prior years: calibration error is{" "}
            <strong>0.043</strong> and the riskiest decile busts{" "}
            <strong>5.5× more often</strong> than the safest — 91% against 17%. The board&rsquo;s
            base rate is <strong>43%</strong>, which is already the most useful number here:{" "}
            <strong>four in ten draft picks fall short</strong>, and that includes the good
            ones.
          </p>
          <p>
            <strong>Missed</strong> is expected games missed out of 17, from his absence
            history weighted 56/30/14 and shrunk by sample size.
          </p>

          <Callout title="&ldquo;Missed&rdquo; is not an injury report, and the difference matters">
            <p>
              It measures how many of his team&rsquo;s games a player{" "}
              <strong>does not appear in the data for</strong>. That can be an injury, but it
              can equally be a backup role, an inactive, or a suspension, and these data{" "}
              <strong>cannot tell them apart</strong>. The availability tag next to the name
              does come from a real report — from the dossier, with its source and date — and
              it wins when the two disagree.
            </p>
            <p>
              Across every player with history the signal looks enormous, Spearman{" "}
              <strong>+0.48</strong>. Almost all of it is a mirage:{" "}
              <strong>it measures that backups stay backups</strong>. Restricted to starters
              with 16+ games the prior year it falls to <strong>+0.09</strong>.
            </p>
            <p>
              The honest number is the one for the population where it is published — the 250
              on this board: <strong>+0.24</strong>, with the top third missing{" "}
              <strong>32.9%</strong> of games against <strong>18.1%</strong> for the bottom.
              That is about 5.6 games against 3. It is real, it is useful as a tiebreaker, and
              it is not a crystal ball.
            </p>
          </Callout>

          <h2>The volatility tag, and what it is worth</h2>
          <p>
            <strong>Stable</strong> and <strong>Volatile</strong> are two very easy words to
            invent, so here they come from three measured quantities and{" "}
            <strong>are validated against realized error</strong>: the sample behind the
            projection, how far the model had to shrink the player&rsquo;s raw rate — shrinkage
            is proportional to distrust — and what share of his points come from touchdowns,
            the noisiest statistic in fantasy.
          </p>
          <p>
            Across 1,914 player-seasons from 2022 to 2025, each projected using only prior
            years: the correlation between risk and absolute error is <strong>+0.20</strong>,
            and the most volatile third misses by <strong>21% more</strong> than the stable
            third. Positive at all four positions, strongest at quarterback (+0.45).
          </p>
          <p className="caption">
            It is a real and <strong>small</strong> signal. It orders who to look at twice; it
            does not decide a draft. A &ldquo;Volatile&rdquo; player with a hundred more
            projected points is still the better pick. The tag is compared{" "}
            <em>within a position</em>, because the error scales of the four differ by a factor
            of three.
          </p>
        </>
      }
      validationPanel={
        <section aria-label="Validation">
          <h2>Validation</h2>
          <p className="caption">
            Preseason projection against actual result, with every season projected using only
            what came before it.
          </p>
          <Table columns={VALIDATION_COLUMNS} rows={fantasy.validation ?? []} />

          <Callout title="These numbers went down, and the old ones were wrong">
            <p>
              An earlier version of this table reported Spearman around{" "}
              <strong>0.61 to 0.69</strong>. It measured only players who actually appeared
              that season — anyone who missed the year was dropped from the sample instead of
              counting as what he was: <strong>a burned pick</strong>. That is survivorship,
              and it inflates every figure.
            </p>
            <p>
              Now a projected player who never played scores a real <strong>0</strong>, and
              the sample is capped at the <strong>top 180 of the board</strong> — twelve teams
              by fifteen rounds. Measuring the full projected pool answered &ldquo;is this an
              NFL player?&rdquo; rather than &ldquo;is this a good pick?&rdquo;
            </p>
            <p>
              The lower numbers are the honest ones. The change was to the measurement, not to
              the projections.
            </p>
          </Callout>

          <p>
            The second row of each position is the comparison that matters:{" "}
            <strong>ordering players by what they scored last season</strong>. That is the bar
            a projection has to clear to be worth anything, and on this sample{" "}
            <strong>it is not cleared</strong> — the model wins in{" "}
            <strong>8 of 16</strong> season-by-position cells, which is a coin flip. It is
            ahead where picks are expensive (board ranks 1&ndash;50) and behind deep in the
            board.
          </p>

          <h3>By board rank</h3>
          <p className="caption">
            One correlation over the whole pool is dominated by easy calls. These bands are cut
            on VOR — the order the board is actually sorted in.
          </p>
          <Table columns={BAND_COLUMNS} rows={fantasy.validation_bands ?? []} />

          <p>
            A high Spearman here does not mean the season is predictable: the hard part —
            ordering the top twenty at a position — is far noisier, and rankings are mostly
            good for <strong>not making large mistakes</strong>.
          </p>

          <Callout title="35 players on this board changed teams, and their projection is the old one">
            <p>
              The board labels every player with his <strong>2026</strong> roster, but{" "}
              <strong>his projection was computed from the usage split of the team he
              left</strong>. A.J. Brown projects as Philadelphia&rsquo;s number one receiver and
              plays in New England; Mike Evans as Tampa&rsquo;s while in San Francisco.
            </p>
            <p>
              That is why they carry the amber <span className="moved">← TEAM</span> mark next
              to the new team. It is not decoration:{" "}
              <strong>it marks exactly the rows whose number on the right is less
              trustworthy</strong>. 35 of the board&rsquo;s 250 — 14% — and 146 of the 861
              players projected.
            </p>
          </Callout>

          <h2>Limitations</h2>
          <ul>
            <li>Rookies do not appear: with no NFL games there is no history to project.</li>
            <li>
              <strong>Projections do not discount injuries.</strong> They come from games
              played and count on a player even when he is ruled out. The availability tag next
              to the name comes from the dossier and is a <em>parallel</em> fact: it does not
              touch the number on the right, it contradicts it when it should.
            </li>
            <li>The internal split of a new backfield is inherited from last year.</li>
            <li>
              Everyone is projected for 15.5 games: individual injury risk is not
              differentiated.
            </li>
            <li>
              The age curve <strong>is live</strong>: connected on 29 August 2026 after
              validation, improving projections at all four positions — most at running back
              (+4.0 points of MAE), which is where it had to show.
            </li>
          </ul>
        </section>
      }
    />
  );
}
