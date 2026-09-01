import { availabilityByPlayer, briefsByPlayer, model, num } from "../../data/model.js";
import { PositionChip, VorCurve } from "../charts.jsx";
import { Callout, NoDataYet, Table } from "../ui.jsx";
import BoardShell from "./BoardShell.jsx";

export const metadata = {
  title: "Gridiron Oracle — Draft Board",
  description:
    "Value over replacement board with per-position rankings and the VOR curve that shows where each position falls off.",
};

// El tercer predictor es el modelo con partidos esperados POR JUGADOR en vez de
// la constante de liga. Se publica al lado porque el resultado es mixto y esa
// es la información: esconderlo detrás de una media daría una respuesta que los
// datos no dan.
const PREDICTOR_LABEL = {
  model: "This model",
  last_season: "Last season's points",
  model_availability: "This model + per-player games",
};

const VALUE_COLUMNS = [
  { key: "position", label: "Position", format: (v) => <PositionChip position={v} /> },
  {
    key: "predictor",
    label: "Predictor",
    format: (v) => PREDICTOR_LABEL[v] ?? v,
  },
  { key: "k", label: "Starters", format: (v) => num(v, 0) },
  {
    key: "value_captured",
    label: "Value captured",
    format: (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`),
  },
];

const VALIDATION_COLUMNS = [
  { key: "position", label: "Position", format: (v) => <PositionChip position={v} /> },
  {
    key: "predictor",
    label: "Predictor",
    format: (v) => PREDICTOR_LABEL[v] ?? v,
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
    format: (v) => PREDICTOR_LABEL[v] ?? v,
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
          {/* NOVATOS. Se dice aquí porque su número se lee distinto del de un
              veterano y la diferencia no se ve en la tabla: sale de la celda
              posición-ronda, no de partidos NFL. Y el sesgo medido va con él —
              publicar el ranking y callar que es conservador sería publicar
              media medición. */}
          <p>
            <strong>Rookies are ranked from draft capital</strong>, not from NFL games they
            have not played: the pick they went at, walk-forward against every rookie class
            since 2006 (Spearman 0.604 against 0.093 for a positional average). Each rookie
            row carries the observed 25th–median–75th range of past rookies from his exact
            position and round, because several of those cells split in two — the
            second-round quarterback averages 63 points with a median of 16.
          </p>
          <p className="caption">
            Measured and left uncorrected: at the same projection and position, rookies from
            2019&ndash;2025 went on to score <strong>127 points against 20</strong> for the
            veterans they were ranked beside (n=128 matched). The two scales differ — a
            veteran is projected as if he plays 15.5 games, a rookie prior is the observed
            season total with the zeros in it — so the board places rookies low. There is no
            validated correction for that gap, and inventing a multiplier would be worse
            than the bias, so the number stands and this note travels with it.
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
          {/* El consenso es el MULTI-FUENTE del 1 de septiembre —mediana del
              puesto overall PPR en PFN, SI, RotoWire, CBS/SportsLine,
              WalterFootball, PFF y Yahoo, fechados 29-31 de agosto— y no la
              hoja de cálculo del 17 de agosto, que sigue en `research/` como
              archivo. Sólo entran los jugadores que alguna fuente publicó con
              puesto overall: cuarenta. Un consenso de doscientos que mezclara
              fechas sería la regla 5 rota con nombre de consenso. */}
          <Callout title="Where the market and this board disagree, and why">
            <p>
              Consensus here is the <strong>median overall PPR rank across seven ranking
              sources dated 29–31 August</strong> — PFN, SI (Fabiano), RotoWire&rsquo;s
              five-expert consensus, CBS/SportsLine, WalterFootball, PFF and Yahoo&rsquo;s
              six-analyst consensus. Only players a source ranked overall are compared, so the
              list is short and current rather than long and stale. The disagreements cluster
              where the model is documented to be blind:
            </p>
            <ul>
              <li>
                <strong>Short histories the model shrinks toward the average.</strong> Omarion
                Hampton (market 12, here 55), Ashton Jeanty, Colston Loveland, Emeka Egbuka:
                half or more of each number is the positional prior, and the market is pricing
                a role these data cannot see. You will not get them at this board&rsquo;s
                price.
              </li>
              <li>
                <strong>Age at the far end of the curve.</strong> Derrick Henry (market 14,
                here 136) carries an age factor of 0.61 at 32; Saquon Barkley 0.78 at 29. The
                curve is validated and improved running-back error most of all — but 32 is an
                extrapolation, and the market disagrees.
              </li>
              <li>
                <strong>Where this board is higher.</strong> Puka Nacua first overall, Trey
                McBride 7th on tight-end scarcity, De&rsquo;Von Achane 6th, and Josh Allen
                15th where the market waits on quarterbacks until the 40s. Those are the
                players you can let come to you.
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
          <h3>Value captured</h3>
          <p className="caption">
            Of the value that was actually there to be had at each position, how much does
            drafting off this order get you? Replacement level comes from the same starter
            count, applied to the season that happened.
          </p>
          <Table columns={VALUE_COLUMNS} rows={fantasy.validation_value ?? []} />
          <p>
            This is the primary measure, and it replaced rank correlation for a reason.{" "}
            <strong>Spearman is blind to who you end up with.</strong> Two boards can have
            identical rank correlation and hand you different rosters: one that misorders two
            players inside your starters costs nothing, one that misorders across the starter
            boundary costs a real player. In a constructed case with{" "}
            <em>identical</em> Spearman to twelve decimal places, value captured separates
            them by <strong>5.1 points</strong>.
          </p>
          <p>
            It is also invariant to level — adding or scaling every projection leaves it
            unchanged — so it cannot be moved by calibration, only by ordering.
          </p>

          <Callout title="At quarterback this board adds nothing over last season's points">
            <p>
              63.2% against 62.3%. That gap is not a result. Whatever the model knows about
              quarterbacks, ordering them by what they scored last year knows about as much.
            </p>
            <p>
              The likely cause is measurable: <strong>38%</strong> of the weeks a drafted
              quarterback records no statistics are weeks he was on the active roster — he
              lost the job, or never had it. Neither this model nor the baseline predicts
              that, and the feature set contains nothing that could.
            </p>
            <p>
              At running back the same comparison is <strong>81.0% against 73.0%</strong>. Use
              the board where it earns its keep.
            </p>
          </Callout>

          <h3>Rank correlation</h3>
          <p className="caption">
            Kept visible because it is what earlier versions of this page published, and it is
            the only way to compare against those numbers.
          </p>
          <Table columns={VALIDATION_COLUMNS} rows={fantasy.validation ?? []} />

          <Callout title="Three measurement bugs, and what each one hid">
            <p>
              An earlier version of this table reported Spearman around{" "}
              <strong>0.61 to 0.69</strong>. Three separate faults in the harness produced
              that number, and they did not all point the same way.
            </p>
            <p>
              <strong>Survivorship.</strong> Only players who actually appeared that season
              were scored; anyone who missed the year was dropped instead of counting as what
              he was — <em>a burned pick</em>. That inflated everything, and it made the cost
              of injury invisible. A projected player who never played now scores a real{" "}
              <strong>0</strong>.
            </p>
            <p>
              <strong>An unbounded pool.</strong> Measuring all 353 projected receivers
              answered &ldquo;is this an NFL player?&rdquo; rather than &ldquo;is this a good
              pick?&rdquo; The sample is now <strong>180 players</strong> — twelve teams by
              fifteen rounds.
            </p>
            <p>
              <strong>A sample the model chose.</strong> The pool used to be the top of{" "}
              <em>this board</em>, so every change to the model changed who was being graded,
              and the comparison ran against players the model itself had selected. The pool
              is now frozen before the model runs: the top 180 by{" "}
              <strong>last season&rsquo;s points</strong>, which is the baseline&rsquo;s own
              order. That fault ran <em>against</em> us — correcting it moved the verdict in
              the model&rsquo;s favour.
            </p>
            <p>The numbers here are the measurement, not the projections.</p>
            <p>
              One caveat that came out of the same work:{" "}
              <strong>the availability signal is not comparable across positions</strong>.
              It counts weeks a player recorded no statistics, and at quarterback{" "}
              <strong>38%</strong> of those weeks are players on the active roster — so there
              it partly measures <em>losing the job</em> rather than durability. At running
              back the same figure is 7%.
            </p>
          </Callout>

          <p>
            The second row of each position is the comparison that matters:{" "}
            <strong>ordering players by what they scored last season</strong>. That is the bar
            a projection has to clear to be worth anything. On the frozen pool the model leads
            at <strong>three of four positions</strong> — quarterback, running back and
            receiver — and trails at tight end.
          </p>
          <p>
            That lead is real but not comfortable. Season by season it is{" "}
            <strong>8 of 16</strong> position-seasons: the model wins less often than it
            leads, and leads because it wins by wider margins than it loses by. Four seasons
            and roughly two hundred draftable players is not enough to call a small edge, and
            we do not.
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
            <li>
              <strong>Some numbers are the positional average wearing a name.</strong> A
              projection is shrunk toward the positional mean by sample size, so a player with
              almost no NFL history gets almost all of it from that mean: at 0.3 weighted games,
              97% of the number is &ldquo;the average running back,&rdquo; not him. Those rows
              carry a <span className="mark mark--prior">% PRIOR</span> mark, and below three
              weighted games they are kept off the shortlist — they stay on the board, ranked
              and draftable, but they will not be offered as the best available.
            </li>
            <li>
              <strong>A rookie&rsquo;s number knows his draft round and nothing else.</strong>
              Two rookies taken in the same round at the same position get the same
              projection, because that is all the prior can tell them apart. Within a round
              they are ordered by pick, which is a fact, not a claim about the gap.
            </li>
            <li>
              <strong>Projections do not discount injuries.</strong> They come from games
              played and count on a player even when he is ruled out. Two parallel facts sit
              beside the name instead of inside the number: the availability tag from the
              dossier, and the red mark for anyone suspended, on the exempt list, on IR or on
              season PUP &mdash; that one is reported, dated and sourced, because roster data
              says <code>ACT</code> for a player the league has set aside.
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
