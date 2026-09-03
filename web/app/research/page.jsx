import { model } from "../../data/model.js";
import { AVAILABILITY_LABEL } from "../availability.js";
import { Callout, ImpactTag, NoDataYet, Sources, Stat } from "../ui.jsx";
import { byDay as agruparPorDia, partition } from "./select.js";

export const metadata = {
  title: "Gridiron Oracle — Research",
  description:
    "Daily sweep of beat writers, insiders and camp reports across all 32 teams, each with its source. None of it touches the model.",
};

// Las claves son las que trae el payload y NO se traducen: son datos del
// esquema de research. Sólo se traduce lo que se pinta.
const KIND = {
  lesion: "Injury",
  transaccion: "Transaction",
  depth_chart: "Depth chart",
  campamento: "Camp",
  contrato: "Contract",
  disciplina: "Discipline",
  esquema: "Scheme",
  otro: "Other",
};

const CONFIDENCE = {
  confirmado: { label: "Confirmed", hint: "Official team or league announcement." },
  informado: { label: "Reported", hint: "A named insider is reporting it." },
  rumor: { label: "Rumor", hint: "Speculation, or unnamed sources." },
};

/**
 * Procedencia: de dónde sale lo que afirma la ficha.
 *
 * Mide quién lo dice y cómo lo sabe, que es otro eje distinto de la certeza. Un
 * REPORTADO reciente puede ser más fiable que un HECHO de hace tres semanas.
 *
 * El caso importante es el que NO está en este diccionario: las fichas
 * anteriores a este esquema tienen `evidence_type: null`. No se traducen ni se
 * adivinan —el esquema viejo no distinguía entre reportado, observado y
 * opinión— y por eso salen marcadas como anteriores en vez de con una etiqueta
 * inventada. Un hueco visible es mejor que un dato falso.
 */
const EVIDENCE = {
  HECHO: { label: "Fact", hint: "Official announcement from the team, the league or an injury report." },
  REPORTADO: { label: "Reported", hint: "A named writer is reporting it as their own information." },
  OBSERVADO: { label: "Observed", hint: "A reporter describing what they saw: reps, who practiced." },
  OPINION: { label: "Opinion", hint: "A named analyst expects something. That is their read, not a fact." },
  MODELO: { label: "Model", hint: "This is us, from our own numbers." },
};

// Las fichas anteriores al esquema de fechas no traen día. La etiqueta se pinta,
// así que va en inglés; la clave del agrupamiento es la misma cadena.
const NO_DATE = "no date";

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

const longDate = (iso) =>
  formatDate(iso, { weekday: "long", month: "long", day: "numeric" });

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
      <Callout title="Nothing today changes a decision">
        <p>
          This is not a broken feed. The filter asks whether an item could move a lineup
          this week, and most days nothing does. Lowering the bar until something shows up
          would turn this into the news feed it exists not to be.
        </p>
      </Callout>
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

function Note({ item, showDate = false }) {
  const confidence = CONFIDENCE[item.confidence] ?? CONFIDENCE.rumor;
  return (
    <article className={`note note--${item.impact}`}>
      <h3>{item.headline}</h3>
      <p className="note-meta">
        {/* En el digest las fichas vienen de días distintos, y una noticia de
            campamento sin fecha al lado no se puede juzgar. En el archivo por
            día la fecha ya es el encabezado de la sección. */}
        {showDate && item.date ? (
          <span className="tag">{formatDate(item.date, { month: "short", day: "numeric" })}</span>
        ) : null}
        <span className="chip">{item.team}</span>
        <span className="tag">{KIND[item.kind] ?? KIND.otro}</span>
        <ImpactTag impact={item.impact} />
        <span className={`tag tag--${item.confidence}`} title={confidence.hint}>
          {confidence.label}
        </span>
        {/* La procedencia sólo se pinta si se conoce. En las fichas anteriores
            al esquema nuevo no se enseña nada: inventar una etiqueta para no
            dejar el hueco sería falsificar la evidencia hacia atrás. */}
        {EVIDENCE[item.evidence_type] ? (
          <span className="prov" title={EVIDENCE[item.evidence_type].hint}>
            {EVIDENCE[item.evidence_type].label}
          </span>
        ) : null}
        {item.players?.length ? <span className="note-players">{item.players.join(", ")}</span> : null}
      </p>
      <p>{item.summary}</p>
      <Sources sources={item.sources} />
    </article>
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
  const { destacadas, resto: rest } = partition(items, today);
  const destacadasPorDia = agruparPorDia(destacadas, NO_DATE);
  const byDay = agruparPorDia(rest, NO_DATE);

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

      <Callout title="How to read the confidence tag">
        <p>
          <strong>Confirmed</strong> is an official announcement. <strong>Reported</strong> is
          a named insider. <strong>Rumor</strong> is everything else, including
          &ldquo;expected to&rdquo; with a famous byline on it. The distinction matters more in
          August than at any other point in the year: camp produces far more conversation than
          information.
        </p>
      </Callout>

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

      {destacadasPorDia.size > 0 ? (
        <>
          {/* Lo que no cabe en los diez accionables SIGUE PUBLICÁNDOSE. Antes
              se calculaba esta lista y no se pintaba en ninguna parte: con 40
              fichas de relevancia alta, treinta desaparecían y la página se
              veía llena igual. Van por día y por delante del contexto. */}
          <h2>The rest of what matters</h2>
          <p className="caption">
            Relevance 4 and 5 that did not make the ten above — same bar, less immediate.
            Nothing the sweep flags as lineup-moving is dropped.
          </p>
          {[...destacadasPorDia.entries()].map(([day, dayItems]) => (
            <section key={`alta-${day}`} id={`alta-${day}`}>
              <h3 className="day">{day === NO_DATE ? day : longDate(day)}</h3>
              {dayItems.map((item, index) => (
                <Note key={`alta-${day}-${index}`} item={item} />
              ))}
            </section>
          ))}
        </>
      ) : null}

      {byDay.size > 0 ? (
        <>
          <h2>Everything else, by day</h2>
          <p className="caption">
            Context and moves at relevance 3 or below: they do not change a lineup, but they
            explain why the next one will.
          </p>
          {[...byDay.entries()].map(([day, dayItems]) => (
            <section key={day} id={day}>
              <h3 className="day">{day === NO_DATE ? day : longDate(day)}</h3>
              {dayItems.map((item, index) => (
                <Note key={`${day}-${index}`} item={item} />
              ))}
            </section>
          ))}
        </>
      ) : null}

      {medical.length > 0 ? (
        <section id="medico">
          <h2>Injury report</h2>
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
        </section>
      ) : null}

      {camp.length > 0 ? (
        <section id="campamento">
          <h2>Training camp</h2>
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
        </section>
      ) : null}

      {dossier?.reporters?.length ? (
        <section id="reporteros">
          <h2>Who to follow</h2>
          <p className="caption">
            {dossier.reporters.length} daily-coverage writers, by team. The local beat is
            usually ahead of the national one on what happens inside a practice: they are there
            every day. This list is also what steers the daily sweep — it does not search for
            &ldquo;NFL news&rdquo;, it searches for what these people publish.
          </p>
          <Beat reporters={dossier.reporters} />
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
