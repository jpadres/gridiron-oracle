import { model } from "../../data/model.js";
import { Callout, Note, NoDataYet } from "../ui.jsx";
import HealthTable from "./HealthTable.jsx";

export const metadata = {
  title: "Gridiron Oracle — Source health",
  description:
    "Source by source: when it last published, which NFL week it covers, and whether "
    + "that can be asserted today — with the threshold that decided the label.",
};

/**
 * SALUD DE LAS FUENTES.
 *
 *     UNA PANTALLA QUE NO DICE LA EDAD DE SUS DATOS NO SE PUEDE AUDITAR.
 *
 * El 7 de octubre de 2026 producción servía la jornada 4 estando en la 5, con el
 * modelo y las líneas del 29 de septiembre — ocho días—. La causa no fue que la
 * ingesta se hubiera parado: `weekly-predictions.yml` había fallado sus CUATRO
 * ejecuciones programadas, todas en el push y ninguna calculando, y el payload
 * sólo se movía cuando alguien lo corría a mano. Nadie lo vio porque ninguna
 * pantalla decía de cuándo era lo que enseñaba.
 *
 * Los umbrales NO se escriben aquí ni en el módulo de salud: salen de
 * `freshness.WINDOWS`, que ya los declara por dominio y con su razón. La
 * etiqueta de un vistazo se deriva de `USABLE_AS_CURRENT`, así que si algún día
 * se cambia una ventana, esta página cambia sola.
 */
export default function SaludPage() {
  const h = model.health;
  if (!h?.sources?.length) {
    return (
      <>
        <h1>Source health</h1>
        <NoDataYet />
        <p className="caption">
          The payload carries no <code>health</code> section. It is written by{" "}
          <code>scripts/export_web_data.py</code>; a payload from before this page existed
          will not have it.
        </p>
      </>
    );
  }
  const c = h.counts ?? {};
  const w = h.week_agreement ?? {};
  const roto = (h.sources ?? []).filter((s) => s.label === "BROKEN");
  const viejo = (h.sources ?? []).filter((s) => s.label === "STALE");

  return (
    <>
      <p className="eyebrow">
        {h.season} · week {h.week} · built {h.generated_at}
      </p>
      <h1>Source health</h1>
      <p className="lede">
        Every source this site depends on, with the moment it was last published, the NFL
        week it covers, and whether it can be asserted as current <strong>today</strong>.
        The threshold that decided each label is shown beside it.
      </p>

      <Callout title="What a label means here">
        <p>
          <strong>FRESH</strong> is inside the window where the data can be stated as
          current. <strong>STALE</strong> means it was read fine but is past that window —
          usable as context, not as today&rsquo;s state. <strong>BROKEN</strong> means it
          could not be read or could not be dated at all, and that is <em>not</em> the same
          as being fine: a check that did not happen never counts as a check that passed.
        </p>
        <p>
          The windows are per source type, because the shelf life is not the same: a betting
          line moves in minutes, an injury report lasts a day, a career stat never expires.
          They are declared once in <code>freshness.py</code> and this page reads them — it
          does not keep a second copy.
        </p>
      </Callout>

      {/* EL CONTRASTE DE LA JORNADA. La autoridad sigue siendo el calendario
          (`schedule.py::current_point`, el primer partido sin jugar); Sleeper es
          un segundo testigo para cazar el caso que duele — el sitio en la 4
          mientras el mundo va por la 5. Si no se pudo leer, se dice: «no pude
          comprobar» no es «coinciden». */}
      <section aria-label="Week agreement" className="bk-plan">
        <h2 className="bk-h">
          Which week is it <small>two witnesses, and the disagreement if any</small>
        </h2>
        <div className="bk-plan-nums">
          <div className="stat">
            <span className="stat-label">From the schedule</span>
            <strong>{w.derived_week ?? "UNKNOWN"}</strong>
            <span className="caption">first unplayed game · this is what the site publishes</span>
          </div>
          <div className="stat">
            <span className="stat-label">From Sleeper</span>
            <strong>{w.sleeper_week ?? "—"}</strong>
            <span className="caption">
              {w.status === "UNREACHABLE" ? "could not be read" : `api.sleeper.app · ${w.retrieved_at ?? ""}`}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Agreement</span>
            <strong>{w.status ?? "UNKNOWN"}</strong>
            <span className="caption">
              {w.status === "AGREE" ? "both witnesses say the same week" : "see the note below"}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Sources</span>
            <strong>
              {c.FRESH ?? 0} / {(c.FRESH ?? 0) + (c.STALE ?? 0) + (c.BROKEN ?? 0)}
            </strong>
            <span className="caption">fresh · {c.STALE ?? 0} stale · {c.BROKEN ?? 0} broken</span>
          </div>
        </div>
        {w.note ? <p className="caption">{w.note}</p> : null}
      </section>

      {roto.length || viejo.length ? (
        <Callout title={`${roto.length} broken, ${viejo.length} stale right now`}>
          <ul>
            {[...roto, ...viejo].map((s) => (
              <li key={s.name}>
                <strong>{s.name}</strong> — {s.label}: {s.reason}
              </li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Note title="Every source is inside its window">
          <p>Nothing here is being presented as more current than it is.</p>
        </Note>
      )}

      <HealthTable sources={h.sources} />

      <Note title="What this page cannot tell you">
        <p>
          It dates the data, not the <em>ingestion run</em>. A source can be FRESH because
          someone refreshed it by hand while the scheduled job is still failing — which is
          exactly what had been happening here for four weeks. The run history lives in
          GitHub Actions; this page is the half that the site itself can prove.
        </p>
        <p>
          It also dates what was <strong>published</strong>, not what sits on a disk
          somewhere. Refreshing a source without regenerating the payload does not make the
          site newer, and saying otherwise is the failure this whole section exists to
          prevent.
        </p>
      </Note>
    </>
  );
}
