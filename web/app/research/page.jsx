import { model } from "../../data/model.js";
import { AVAILABILITY_LABEL } from "../availability.js";
import { Callout, ImpactTag, NoDataYet, Note as Aside, Sources, Stat } from "../ui.jsx";
import { partition } from "./select.js";
import Briefs from "./Briefs.jsx";

export const metadata = {
  title: "Gridiron Oracle — Research",
  description:
    "Daily sweep of beat writers, insiders and camp reports across all 32 teams, each with its source. None of it touches the model.",
};

/**
 * Fecha a partir de un YYYY-MM-DD, sin depender del huso del servidor.
 *
 * `new Date("2026-08-17")` se interpreta como medianoche UTC y, al formatear en
 * un huso al oeste, retrocede un día. Construyéndola con `Date.UTC` y
 * formateando en UTC, la fecha del archivo y la que se lee son la misma.
 */
function formatDate(iso, options) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...options,
  });
}

/**
 * Today's Intelligence: lo que puede cambiar una decisión hoy.
 *
 * No es un feed. Un feed enseña todo lo que pasó y cuanto más completo, mejor
 * cumple; esto enseña sólo lo que harías distinto, y cuanto más completo, peor.
 * Por eso puede salir vacío, y eso es correcto.
 */
function TodaysIntelligence({ items }) {
  if (!items || items.length === 0) {
    return (
      <Aside title="Nothing today changes a decision">
        <p>
          This is not a broken feed. The filter asks whether an item could move a lineup
          this week, and most days nothing does. Lowering the bar until something shows up
          would turn this into the news feed it exists not to be.
        </p>
      </Aside>
    );
  }
  return (
    <ol className="intel">
      {items.map((item, index) => (
        <li key={item.headline ?? index} className={`intel--${item.impact}`}>
          <span className="intel-cat" title={item.label}>
            <span aria-hidden="true">{item.icon}</span> {item.label}
          </span>
          <span className="intel-body">
            <strong>{item.headline}</strong>
            <span className="intel-meta">
              {item.team}
              {item.players?.length ? ` · ${item.players.join(", ")}` : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Parte médico, campamento y directorio de reporteros.
 *
 * Van en secciones propias y no mezclados con las fichas de prensa porque **la
 * fiabilidad no es la misma**: estas entradas están atribuidas a un periodista
 * con nombre, medio y fecha, pero no llevan enlace. Las fichas de arriba sí lo
 * llevan, y esa diferencia importa lo suficiente como para que no compartan
 * caja.
 */
function Medical({ entries }) {
  return (
    <>
      {entries.map((entry, index) => (
        <article className="dossier" key={`${entry.player}-${index}`}>
          <h4>
            <span className={`avail avail--${entry.level.toLowerCase()}`}>
              {AVAILABILITY_LABEL[entry.level] ?? entry.level}
            </span>{" "}
            {entry.player} <span className="attrib">{entry.position} · {entry.team}</span>
          </h4>
          <p>{entry.situation}. {entry.status}</p>
          <p className="attrib">
            {entry.source}
            {entry.date ? ` · ${entry.date}` : null}
          </p>
        </article>
      ))}
    </>
  );
}

function Camp({ entries }) {
  return (
    <>
      {entries.map((entry, index) => (
        <article className="dossier" key={`${entry.player}-${index}`}>
          <h4>
            {entry.player} <span className="attrib">{entry.position} · {entry.team}</span>{" "}
            <span className={`tag tag--${entry.substance === "alta" ? "confirmado" : "rumor"}`}>
              {entry.substance === "alta" ? "high substance" : "low substance"}
            </span>
          </h4>
          <p>{entry.report}</p>
          <p className="attrib">
            {entry.source}
            {entry.date ? ` · ${entry.date}` : null}
          </p>
        </article>
      ))}
    </>
  );
}

/** Directorio del beat: a quién seguir para enterarse antes que el modelo. */
function Beat({ reporters }) {
  const byTeam = new Map();
  for (const reporter of reporters) {
    if (!byTeam.has(reporter.team)) byTeam.set(reporter.team, []);
    byTeam.get(reporter.team).push(reporter);
  }
  return (
    <div className="beat">
      {[...byTeam.entries()].map(([team, people]) => (
        <div className="team" key={team}>
          <h4>{team}</h4>
          <ul>
            {people.map((person, index) => (
              <li key={index}>
                {person.name} <span className="outlet">— {person.outlet}</span>
                {person.handle ? <span className="outlet"> {person.handle}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function Research() {
  const research = model.research;
  const items = research?.items ?? [];
  const dossier = model.dossier;
  const medical = dossier?.medical ?? [];
  const camp = dossier?.camp ?? [];
  const out = medical.filter((entry) => entry.level === "FUERA");
  const doubt = medical.filter((entry) => entry.level === "DUDA");
  const campHigh = camp.filter((entry) => entry.substance === "alta");

  if (items.length === 0 && medical.length === 0) {
    return (
      <>
        <h1>Research</h1>
        <p className="lede">
          Daily sweep of beat writers, insiders and camp reports across all 32 teams.
        </p>
        <NoDataYet />
        <p className="caption">
          This section is generated by <code>scripts/research_build.py</code>, which needs{" "}
          <code>ANTHROPIC_API_KEY</code>. Without a key the rest of the site builds exactly
          the same.
        </p>
      </>
    );
  }

  // El digest de arriba y el archivo por día son la misma lista partida en dos,
  // no dos vistas de lo mismo: repetir una ficha a media página de distancia
  // hace pensar que son dos noticias distintas.
  // El subconjunto ya viene calculado del payload: el filtro vive en Python,
  // junto al resto de las reglas del modelo y con tests. El respaldo cubre un
  // payload viejo, que en un sitio con datos horneados pasa en cada despliegue
  // hasta que se regenera.
  const today = research?.today ?? [];
  // El reparto vive en `select.js` y no aquí: es lógica con un fallo real
  // detrás —30 de las 40 fichas importantes no se pintaban en ninguna caja— y
  // eso pide un test, que un componente no puede tener.
  // El archivo es TODO lo que no está ya en los diez accionables de arriba:
  // antes iba en dos listas apiladas por día, ahora en una sola acotable. El
  // reparto sigue saliendo del mismo `partition`, así que no cambia qué se
  // publica — cambia cómo se recorre.
  const { destacadas, resto: rest } = partition(items, today);
  const archivo = [...destacadas, ...rest];

  const linked = items.filter((item) => item.player_ids?.length).length;
  const lastSweep = items[0]?.date;

  return (
    <>
      <h1>Research</h1>
      <p className="lede">
        Every day this sweeps what gets published about all 32 teams — national and local
        beats, ESPN, team blogs and insiders — and summarizes it here with the source link
        alongside. Anything without a checkable source does not get published.
      </p>

      <Callout title="None of this touches the model. On purpose.">
        <p>
          The rankings and the predictions come out of a single chronological pass over
          nflverse data, and their guarantee is that <strong>no row ever sees the
          future</strong>. The moment a headline from today moved a projection, that
          guarantee could no longer be demonstrated — and every validation number on this
          site goes with it.
        </p>
        <p>
          So the news sits <em>next to</em> the numbers, never inside them. You make the
          adjustment: the model does not know that back is hurt, and this page exists so
          that you do.
        </p>
      </Callout>

      <div className="grid">
        <Stat label="Items" value={items.length} hint={`${research.window_days}-day window`} />
        <Stat label="Move a lineup" value={today.length + destacadas.length}
              hint="Relevance 4 or 5" />
        <Stat label="Linked to a player" value={linked} hint="From the weekly rankings" />
        <Stat
          label="Last sweep"
          value={lastSweep ? formatDate(lastSweep, { month: "short", day: "numeric" }) : "—"}
          hint="Daily, 12:00 UTC"
        />
      </div>

      <Aside title="How to read the confidence tag">
        <p>
          <strong>Confirmed</strong> is an official announcement. <strong>Reported</strong> is
          a named insider. <strong>Rumor</strong> is everything else, including
          &ldquo;expected to&rdquo; with a famous byline on it. The distinction matters more in
          August than at any other point in the year: camp produces far more conversation than
          information.
        </p>
      </Aside>

      {/* Esta sección ya filtraba por relevancia 4-5. En vez de añadir una
          «Today's Intelligence» al lado —que habría enseñado casi lo mismo con
          otro título— se le cambia el cuerpo: mismo filtro, ahora con categoría,
          orden por accionabilidad y sitio reservado para el impacto personal
          cuando exista la sincronización multi-liga. */}
      <section id="destacado">
        <h2>What moves a lineup</h2>
        <p className="caption">
          Ordered by what you can do about it, not by when it was published. Once your leagues
          are synced, what affects your roster will rise above everything else.
        </p>
        <TodaysIntelligence items={today} />
      </section>

      {/* TODO EL ARCHIVO, EN UNA LISTA ACOTABLE.
          Eran dos secciones apiladas —«el resto de lo que importa» y «todo lo
          demás, por día»— con el mismo tipo de ficha, la misma forma y ninguna
          manera de decir «enséñame lo de mi equipo». Sesenta fichas seguidas no
          son un archivo, son un muro: 24.061 px de página.

          No se quita ni una ficha ni se reordena nada (la relevancia la trae el
          barrido con su fuente, regla 8): se filtra por equipo, por relevancia y
          por texto, y el conteo dice siempre cuántas hay de cuántas. */}
      {archivo.length > 0 ? (
        <section id="archivo">
          <h2>The whole sweep</h2>
          <p className="caption">
            Everything the sweep published in this window, newest first. Relevance 4 and 5
            move a lineup; 3 and below explain why the next one will. Nothing is dropped —
            filter it down to what you need.
          </p>
          <Briefs items={archivo} />
        </section>
      ) : null}

      {medical.length > 0 ? (
        <section id="medico">
          <details className="ref-block">
            <summary>{`Injury report · ${medical.length} situations`}</summary>
          <p className="caption">
            {medical.length} situations across the 32 teams, each with who said it and when.
            The tag measures <strong>availability, not severity</strong>: what decides a lineup
            is not how bad the injury sounds, it is whether he plays. And it was set by whoever
            compiled the dossier reading the quote, not by a medical diagnosis.
          </p>
          <p className="caption">
            These entries are <strong>attributed and dated, but carry no link</strong>, unlike
            the items above. That is why they get their own section: forcing them into the same
            format would mean relaxing the link rule, and a guarantee that gets relaxed to make
            room for new data stops being a guarantee.
          </p>
          <h3>Out ({out.length})</h3>
          <Medical entries={out} />
          <h3>Questionable ({doubt.length})</h3>
          <Medical entries={doubt.slice(0, 30)} />
          {doubt.length > 30 ? (
            <p className="caption">
              And {doubt.length - 30} more. The full list is in{" "}
              <code>research/dossier.json</code>.
            </p>
          ) : null}
          </details>
        </section>
      ) : null}

      {camp.length > 0 ? (
        <section id="campamento">
          <details className="ref-block">
            <summary>{`Training camp · ${camp.length} reports`}</summary>
          <p className="caption">
            Camp reports are among the <strong>least predictive</strong> data in this sport,
            which is why the substance level goes in front instead of buried: <em>high</em> is a
            coach quote or a confirmed change of role; <em>low</em> is loose praise in August.
            Of {camp.length} reports, only {campHigh.length} are high substance — that ratio is
            the real finding.
          </p>
          <Camp entries={campHigh} />
          <p className="caption">
            Medium and low substance stay in <code>research/dossier.json</code>. They are not
            published here because showing them beside the others makes them look equal, and
            they are not.
          </p>
          </details>
        </section>
      ) : null}

      {dossier?.reporters?.length ? (
        <section id="reporteros">
          <details className="ref-block">
            <summary>{`Who to follow · the beat, team by team`}</summary>
          <p className="caption">
            {dossier.reporters.length} daily-coverage writers, by team. The local beat is
            usually ahead of the national one on what happens inside a practice: they are there
            every day. This list is also what steers the daily sweep — it does not search for
            &ldquo;NFL news&rdquo;, it searches for what these people publish.
          </p>
          <Beat reporters={dossier.reporters} />
          </details>
        </section>
      ) : null}

      {dossier?.sources?.length ? (
        <section id="fuentes">
          <h2>Sources</h2>
          <p className="caption">
            The {dossier.sources.length} publications the dossier draws on, with what was used
            from each. The ones marked <strong>unverified</strong> are forum threads: they are
            kept because sometimes they land first, and they are marked because mixing them in
            with an insider report without saying so is what makes a bibliography worthless.
          </p>
          <ul className="sources-list">
            {dossier.sources.map((source, index) => (
              <li key={index} className={source.verified ? "" : "unverified"}>
                <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
                  {source.publisher}
                </a>{" "}
                — {source.article}
                <span className="used"> · {source.used_for}</span>
                {source.verified ? null : <span className="tag tag--rumor">unverified</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2>What to expect from this</h2>
      <p>
        It is a press reader, not a data source. It summarizes what other people published and
        links to it; it does not verify that any of it is true, and has no way to. A wrong
        insider report gets summarized here just as well as a right one — that is what the
        confidence tag is for, and why the link is mandatory.
      </p>
      <p className="caption">
        The sweep is run by Claude with web search, once a day. Items without a valid link are
        discarded before they reach this page, and the full history stays in{" "}
        <code>research/</code> inside the repository: if the link dies tomorrow, what was
        published today still exists.
      </p>
    </>
  );
}
