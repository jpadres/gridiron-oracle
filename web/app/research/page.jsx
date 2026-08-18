import { model } from "../../data/model.js";
import { Callout, ImpactTag, NoDataYet, Sources, Stat } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — research",
  description:
    "Barrido diario de prensa, insiders y campamentos de los 32 equipos, con la fuente al lado. No entra en el modelo.",
};

const KIND = {
  lesion: "Lesión",
  transaccion: "Transacción",
  depth_chart: "Depth chart",
  campamento: "Campamento",
  contrato: "Contrato",
  disciplina: "Disciplina",
  esquema: "Esquema",
  otro: "Otro",
};

const CONFIDENCE = {
  confirmado: { label: "Confirmado", hint: "Anuncio oficial del equipo o de la liga." },
  informado: { label: "Informado", hint: "Un insider con nombre lo reporta." },
  rumor: { label: "Rumor", hint: "Especulación o fuentes sin identificar." },
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
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("es-ES", {
    timeZone: "UTC",
    ...options,
  });
}

const longDate = (iso) =>
  formatDate(iso, { weekday: "long", day: "numeric", month: "long" });

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
          <span className="tag">{formatDate(item.date, { day: "numeric", month: "short" })}</span>
        ) : null}
        <span className="chip">{item.team}</span>
        <span className="tag">{KIND[item.kind] ?? KIND.otro}</span>
        <ImpactTag impact={item.impact} />
        <span className={`tag tag--${item.confidence}`} title={confidence.hint}>
          {confidence.label}
        </span>
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
            <span className={`avail avail--${entry.level.toLowerCase()}`}>{entry.level}</span>{" "}
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
              sustancia {entry.substance}
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
          Barrido diario de prensa, insiders y crónicas de campamento de los 32 equipos.
        </p>
        <NoDataYet />
        <p className="caption">
          Esta sección la genera <code>scripts/research_build.py</code>, que necesita{" "}
          <code>ANTHROPIC_API_KEY</code>. Sin clave el resto del sitio se construye igual.
        </p>
      </>
    );
  }

  // El digest de arriba y el archivo por día son la misma lista partida en dos,
  // no dos vistas de lo mismo: repetir una ficha a media página de distancia
  // hace pensar que son dos noticias distintas.
  const headline = items.filter((item) => (item.fantasy_relevance ?? 1) >= 4);
  const rest = items.filter((item) => (item.fantasy_relevance ?? 1) < 4);

  const byDay = new Map();
  for (const item of rest) {
    const day = item.date ?? "sin fecha";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }

  const linked = items.filter((item) => item.player_ids?.length).length;
  const lastSweep = items[0]?.date;

  return (
    <>
      <h1>Research</h1>
      <p className="lede">
        Cada día se barre lo que se publica sobre los 32 equipos — prensa nacional y local,
        ESPN, los blogs de equipo y los insiders — y se resume aquí con el enlace a la fuente
        al lado. Lo que no tiene fuente comprobable no se publica.
      </p>

      <Callout title="Esto no entra en el modelo. A propósito.">
        <p>
          Los rankings y las predicciones salen de una pasada cronológica sobre datos de
          nflverse, y su garantía es que <strong>ninguna fila ve el futuro</strong>. En el
          momento en que un titular de hoy moviera una proyección, esa garantía dejaría de
          poder demostrarse — y con ella, todas las métricas de validación.
        </p>
        <p>
          Así que las noticias van <em>al lado</em> de los números, nunca dentro. El ajuste lo
          haces tú: el modelo no sabe que ese corredor está lesionado, y esta página está
          precisamente para que tú sí lo sepas.
        </p>
      </Callout>

      <div className="grid">
        <Stat label="Fichas" value={items.length} hint={`Ventana de ${research.window_days} días`} />
        <Stat label="Mueven una alineación" value={headline.length} hint="Relevancia 4 o 5" />
        <Stat label="Enlazadas a un jugador" value={linked} hint="Del ranking semanal" />
        <Stat
          label="Último barrido"
          value={lastSweep ? formatDate(lastSweep, { day: "numeric", month: "short" }) : "—"}
          hint="Diario, 12:00 UTC"
        />
      </div>

      <Callout title="Cómo leer la etiqueta de fiabilidad">
        <p>
          <strong>Confirmado</strong> es un anuncio oficial. <strong>Informado</strong> es un
          insider con nombre y apellidos. <strong>Rumor</strong> es todo lo demás, incluido «se
          espera que» firmado por alguien famoso. La distinción importa en agosto más que en
          ningún otro momento del año: el campamento produce mucha más conversación que
          información.
        </p>
      </Callout>

      {headline.length > 0 ? (
        <section id="destacado">
          <h2>Lo que mueve una alineación</h2>
          <p className="caption">
            Relevancia 4 o 5 sobre 5 en toda la ventana: lo que cambiaría a quién alineas esta
            semana, no lo que llena una columna.
          </p>
          {headline.map((item, index) => (
            <Note key={`${item.headline}-${index}`} item={item} showDate />
          ))}
        </section>
      ) : null}

      {byDay.size > 0 ? (
        <>
          <h2>El resto, por día</h2>
          <p className="caption">
            Contexto y movimientos de relevancia 3 o menos: no cambian una alineación, pero
            explican por qué cambiará la siguiente.
          </p>
          {[...byDay.entries()].map(([day, dayItems]) => (
            <section key={day} id={day}>
              <h3 className="day">{day === "sin fecha" ? day : longDate(day)}</h3>
              {dayItems.map((item, index) => (
                <Note key={`${day}-${index}`} item={item} />
              ))}
            </section>
          ))}
        </>
      ) : null}

      {medical.length > 0 ? (
        <section id="medico">
          <h2>Parte médico</h2>
          <p className="caption">
            {medical.length} situaciones de los 32 equipos, cada una con quién lo dijo y
            cuándo. La etiqueta mide <strong>disponibilidad, no gravedad</strong>: lo que
            decide una alineación no es lo fea que suene la lesión, es si juega. Y la pone
            quien compiló el dossier leyendo la cita, no un diagnóstico médico.
          </p>
          <p className="caption">
            Estas entradas van <strong>atribuidas y fechadas, pero sin enlace</strong>, al
            revés que las fichas de arriba. Por eso están en su propia sección: forzarlas al
            mismo formato obligaría a relajar la regla del enlace, y una garantía que se
            relaja para que quepa el dato nuevo deja de ser una garantía.
          </p>
          <h3>Fuera ({out.length})</h3>
          <Medical entries={out} />
          <h3>En duda ({doubt.length})</h3>
          <Medical entries={doubt.slice(0, 30)} />
          {doubt.length > 30 ? (
            <p className="caption">
              Y {doubt.length - 30} más. El listado completo va en{" "}
              <code>research/dossier.json</code>.
            </p>
          ) : null}
        </section>
      ) : null}

      {camp.length > 0 ? (
        <section id="campamento">
          <h2>Campamento</h2>
          <p className="caption">
            Los reportes de campamento son de los datos <strong>menos predictivos</strong> que
            existen en este deporte, y por eso el nivel de sustancia va delante y no
            escondido: <em>alta</em> es una cita de un entrenador o un cambio confirmado de
            papel; <em>baja</em> es un elogio suelto en agosto. De {camp.length} reportes,
            sólo {campHigh.length} son de sustancia alta — esa proporción es el dato.
          </p>
          <Camp entries={campHigh} />
          <p className="caption">
            Los de sustancia media y baja quedan en <code>research/dossier.json</code>. No se
            publican aquí porque enseñarlos al lado de los otros los iguala, y no son iguales.
          </p>
        </section>
      ) : null}

      {dossier?.reporters?.length ? (
        <section id="reporteros">
          <h2>A quién seguir</h2>
          <p className="caption">
            {dossier.reporters.length} periodistas de cobertura diaria, por equipo. El beat
            local suele ir por delante del nacional en lo que pasa dentro de un entrenamiento:
            está allí todos los días. Esta lista también es la que orienta el barrido diario —
            no se busca «noticias de la NFL», se busca lo que publican estos.
          </p>
          <Beat reporters={dossier.reporters} />
        </section>
      ) : null}

      <h2>Qué esperar de esto</h2>
      <p>
        Es un lector de prensa, no una fuente de datos. Resume lo que otros publicaron y enlaza
        a ello; no verifica que sea cierto, ni tiene forma de hacerlo. Un reporte de insider
        equivocado se resume aquí igual de bien que uno acertado — por eso está la etiqueta de
        fiabilidad, y por eso el enlace es obligatorio.
      </p>
      <p className="caption">
        El barrido lo hace Claude con búsqueda web, una vez al día. Las fichas sin enlace válido
        se descartan antes de llegar aquí, y el histórico completo queda en{" "}
        <code>research/</code> dentro del repositorio: si mañana se cae el enlace, lo que se
        publicó hoy sigue existiendo.
      </p>
    </>
  );
}
