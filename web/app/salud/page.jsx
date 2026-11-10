import { model } from "../../data/model.js";
import { Callout, Note, NoDataYet } from "../ui.jsx";
import HealthBoard from "./HealthBoard.jsx";

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

  return (
    <>
      <p className="eyebrow">
        {h.season} · week {h.week}
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

      {/* Todo lo que depende de CUÁNDO SE MIRA —las etiquetas, el recuento, la
          edad— vive en un componente de cliente, porque necesita el reloj. El
          texto fijo de esta página sigue saliendo del servidor. */}
      <HealthBoard health={h} />

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
