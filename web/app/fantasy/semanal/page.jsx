import { availabilityByPlayer, model, capabilityStatus } from "../../../data/model.js";
import { DeltaBars } from "../../charts.jsx";
import { Callout, ImpactTag, MachineWritten, NoDataYet, Note, Sources } from "../../ui.jsx";
import WeeklyExplorer from "./WeeklyExplorer.jsx";

export const metadata = {
  title: "Gridiron Oracle — Weekly Rankings",
  description:
    "Overall and per-position fantasy rankings, built on the game script projected by the game model.",
};

/**
 * Los N más favorecidos y los N más penalizados, en un solo orden descendente.
 *
 * Ordenar por valor absoluto sería un error de lectura: enseñaría sólo el lado
 * que más se mueva y daría la impresión de que el modelo tira siempre en la
 * misma dirección.
 */
function extremes(rows, n) {
  const sorted = [...rows].sort((a, b) => b.delta - a.delta);
  return [...sorted.slice(0, n), ...sorted.slice(-n)];
}

/** Jugadores con prensa reciente, para marcar su fila en la tabla. */
function playersWithNews(research) {
  const flagged = {};
  for (const item of research?.items ?? []) {
    for (const id of item.player_ids ?? []) flagged[id] = true;
  }
  return flagged;
}

/**
 * Por qué el modelo pone a cada jugador donde lo pone.
 *
 * Va debajo de la tabla y no dentro: la explicación es una frase, y una frase
 * dentro de una celda convierte una tabla que se lee de un vistazo en un muro.
 */
function WhyBlock({ rows, notes }) {
  const explained = rows.filter((row) => notes[row.player_id]);
  if (explained.length === 0) return null;
  return (
    <MachineWritten>
      {explained.map((row) => (
        <p className="why" key={row.player_id}>
          <strong>{row.player_name}</strong> — {notes[row.player_id]}
        </p>
      ))}
    </MachineWritten>
  );
}

/**
 * Noticias de la semana sobre jugadores de esta posición.
 *
 * **El modelo no las ha visto.** Aparecen aquí para que el ajuste lo haga quien
 * alinea: si un titular está lesionado, la proyección de arriba sigue contando
 * con él porque su única fuente es el historial de partidos jugados.
 */
function NewsBlock({ rows, research }) {
  const names = new Map(rows.map((row) => [row.player_id, row.player_name]));
  const related = (research?.items ?? [])
    .map((item) => ({
      ...item,
      // Quién de ESTA lista aparece en la noticia. Se resuelve con el nombre del
      // ranking y no con el de la fuente: si el titular dice «Ja'Marr Chase» y
      // la tabla de arriba dice «J.Chase», el lector tiene que poder unirlos.
      affected: (item.player_ids ?? []).map((id) => names.get(id)).filter(Boolean),
    }))
    .filter((item) => item.affected.length > 0);
  if (related.length === 0) return null;
  return (
    <div className="callout">
      <h3>What the model does not know</h3>
      <p className="caption">
        Recent reporting on players in this list. It does not feed the projection: the
        ranking comes from game history, and yesterday&rsquo;s news is not in it.
      </p>
      {related.slice(0, 6).map((item, index) => (
        <div className="why" key={`${item.headline}-${index}`}>
          <p>
            <ImpactTag impact={item.impact} /> <strong>{item.affected.join(", ")}</strong> —{" "}
            {item.headline}
          </p>
          <Sources sources={item.sources} />
        </div>
      ))}
      <p className="caption">
        Every brief, with its date and reliability, on <a href="/research">Research</a>.
      </p>
    </div>
  );
}

export default function Semanal() {
  const weekly = model.fantasy_weekly;
  const notes = model.narrative?.player_notes ?? {};
  const research = model.research;
  const newsByPlayer = playersWithNews(research);
  const availability = availabilityByPlayer(model.dossier);

  if (!weekly) {
    return (
      <>
        <h1>Weekly Rankings</h1>
        <NoDataYet />
      </>
    );
  }

  // El ranking global se calcula aquí y no en el payload: es una ordenación de
  // los mismos datos, y guardarla aparte sería una copia que puede
  // desincronizarse de la de posición.
  const rankings = (weekly.rankings ?? [])
    .map((row) => ({ ...row, delta: row.projected_points - row.baseline_points }))
    .sort((a, b) => b.projected_points - a.projected_points)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return (
    <>
      <h1>
        Weekly Rankings — {weekly.season}, week {weekly.week}
      </h1>
      <p className="lede">
        The bridge to the game model is game script: projected margin and total decide how
        many plays each team gets and of what kind. A receiver on a 26% target share in a game
        projected 17&ndash;27 down is worth more than in one projected 28&ndash;17 up, because
        the trailing team throws more.
      </p>

      <Note title="How to read the combined list">
        <p>
          A combined list sorts by projected points and is for the flex decision, where a
          back really does compete with a receiver. To decide a fixed slot, filter to that
          position: <strong>a quarterback projects more points than any receiver and that
          does not make him the better start</strong>, because they are not competing for
          the same slot.
        </p>
      </Note>

      {/* Filtros multi-posición: RB+WR responde la pregunta del flex, K y DST
          entran con su autoridad real — proyección sin rank y hechos sin
          proyección. El estado vive en el cliente; los datos van horneados.

          Y LA AUTORIDAD SALE DEL REGISTRO, no de la prosa: se exportaba al
          payload y la web no lo leía nunca, así que la frase que explica por qué
          el pateador no lleva rank estaba escrita a mano y podía desviarse sin
          que fallara nada. `null` si el registro no lo declara — y entonces la
          pantalla no afirma ninguna de las dos cosas. */}
      <WeeklyExplorer
        rankings={weekly.rankings ?? []}
        kickers={weekly.kickers ?? []}
        defenses={weekly.defenses ?? []}
        kickerRankStatus={capabilityStatus("KICKER_ORDINAL_RANKING")}
        kickerProjStatus={capabilityStatus("KICKER_PROJECTION")}
        startSitStatus={{
          QB: capabilityStatus("START_SIT_QB"),
          RB: capabilityStatus("START_SIT_RB"),
          WR: capabilityStatus("START_SIT_WR"),
          TE: capabilityStatus("START_SIT_TE"),
        }}
        notes={notes}
        news={newsByPlayer}
        availability={availability}
        board={model.fantasy?.board ?? []}
        byes={model.fantasy?.byes ?? {}}
        week={weekly.week}
        season={weekly.season}
      />

      <h2>Where the model departs from recent form</h2>
      <p className="caption">
        The bar is the weighted average of a player&rsquo;s last six games, which anyone can
        compute in two minutes. Above, the six that game script and matchup favor most this
        week; below, the six they penalize. If this chart had bars in only one direction, the
        model would be adding nothing over the baseline.
      </p>
      <DeltaBars rows={extremes(rankings, 6)} limit={12} />

      <section id="why">
        <WhyBlock rows={rankings.slice(0, 80)} notes={notes} />
        <NewsBlock rows={rankings} research={research} />
      </section>

      <Callout title="Only each team&rsquo;s starter appears">
        <p>
          Without that restriction, any backup who started twice inherits the team&rsquo;s
          full volume and shows up among the week&rsquo;s best — which is exactly what makes a
          weekly ranking useless.
        </p>
        <p className="caption">
          There is no injury report: starter status is inferred from recent volume, and only
          players active last season count.
        </p>
      </Callout>

      <h2>What to expect from this</h2>
      <p>
        What is published is a <strong>blend</strong> of the model and the player&rsquo;s
        recent form, and that is deliberate: measured out of sample, the model{" "}
        <strong>on its own does not beat</strong> a weighted average of the last six games at
        any position. The blend does — on error at all four, and on rank correlation at three
        of the four. Quarterback is the exception and it is stated plainly: the blend lowers
        the error but orders slightly worse than the simple average. Weekly fantasy is mostly
        noise; anyone promising more than this has not measured it. The{" "}
        <strong>Matchup</strong> column is the opponent-defense adjustment, corrected for the
        quality of offenses it has faced and damped to 45%: a real signal, far smaller than it
        is usually sold as.
      </p>
      <p className="caption">
        The largest correction in development was the quarterback: a team&rsquo;s pass
        attempts are not its quarterback&rsquo;s, and without discounting sacks and scrambles
        the position came out 28% high.
      </p>
    </>
  );
}
