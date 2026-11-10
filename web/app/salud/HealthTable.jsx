/**
 * LA TABLA DE SALUD.
 *
 * Cada fila dice con qué se puede discutir su etiqueta: de cuándo es el dato,
 * qué jornada cubre, y el motivo cuando no está al día. Recibe las fuentes con
 * su etiqueta YA resuelta (`source.now`, de `healthClock.js`): aquí no se
 * calcula ni se compara nada, sólo se pinta.
 *
 * ## Por qué tiene esta forma
 *
 * La primera versión eran siete columnas con la alineación de las tablas de
 * números: el texto pegado a la derecha, sin partir línea, 1.877 px de tabla en
 * un marco de 944. Se veían tres columnas de siete, y la que faltaba era la del
 * MOTIVO. Ahora las columnas de prosa se declaran (`cell-text`), el origen va
 * debajo del nombre y la frescura precisa, el umbral y el motivo viven juntos
 * en la celda de estado — que es como se leen: «STALE — porque…». En el
 * teléfono las filas se apilan (`rank-table--stack`).
 */
import { instantLabel } from "../instant.js";
import { ageLabel } from "./healthClock.js";

export default function HealthTable({ sources }) {
  return (
    <section aria-label="Source by source">
      <h2 className="bk-h">
        Source by source <small>each row carries the reason for its label</small>
      </h2>
      <div className="table-wrap">
        <table className="rank-table rank-table--stack">
          <thead>
            <tr>
              <th>Source</th>
              <th className="cell-text">Status</th>
              <th className="cell-text">Feeds</th>
              <th className="cell-text">Covers</th>
              <th className="cell-text">Data as of</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const v = s.now ?? { label: s.label, aged: false, ageMs: null };
              const edad = ageLabel(v.ageMs);
              return (
                <tr key={s.name}>
                  <td className="who">
                    <span className="nm">{s.name}</span>
                    <span className="meta">{s.origin}</span>
                  </td>
                  <td className="cell-text cell-key cell-key--word" data-label="Status">
                    {/* FRESH va SIN insignia: es el caso normal y una marca que
                        sale siempre no informa — la misma razón por la que
                        `rosterMark` se calla con ACTIVE. */}
                    {v.label === "FRESH" ? (
                      <span>FRESH</span>
                    ) : (
                      <span className={`mark mark--${v.label === "STALE" ? "risk" : "out"}`}>
                        {v.label}
                      </span>
                    )}
                  </td>
                  <td className="cell-text cell-lead">
                    {s.feeds}
                    {/* EL MOTIVO, rotulado y de quién es. Va DEBAJO de lo que
                        alimenta, con su «Why» delante: suelto bajo la cabecera
                        «Feeds» se leía como si fuera lo que la fuente alimenta.
                        Y si la etiqueta la bajó el reloj de quien mira, se dice
                        con esas palabras — no es algo que Python midiera. */}
                    {v.aged ? (
                      <small className="meta">
                        <b>Why {v.label}:</b> published {edad} ago, and this kind of data
                        can be stated as current for {s.fresh_for_hours} h.
                      </small>
                    ) : s.reason ? (
                      <small className="meta">
                        <b>{v.label === "FRESH" ? "Note" : `Why ${v.label}`}:</b> {s.reason}
                      </small>
                    ) : null}
                  </td>
                  <td className="cell-text" data-label="Covers">
                    {s.covers_week != null
                      ? `week ${s.covers_week}`
                      : s.covers_season != null
                        ? `${s.covers_season} season`
                        : "—"}
                    {/* BEHIND es la otra mitad de la frescura: el fichero puede
                        ser de hace diez minutos y la jornada que cubre ser la
                        pasada. Se marca porque la edad no lo puede decir. */}
                    {s.coverage === "BEHIND" ? (
                      <> <span className="mark mark--risk">BEHIND</span></>
                    ) : null}
                    {s.extra?.stats_through_week != null ? (
                      <small className="meta">stats through week {s.extra.stats_through_week}</small>
                    ) : null}
                    {s.extra?.teams_covered != null ? (
                      <small className="meta">
                        {s.extra.teams_covered} of {s.extra.teams_in_window ?? "?"} clubs
                      </small>
                    ) : null}
                  </td>
                  <td className="cell-text" data-label="Data as of">
                    <span className="nowrap">{instantLabel(s.as_of) ?? "UNKNOWN"}</span>
                    {edad ? <small className="meta">{edad} ago</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="caption">
        <strong>Covers</strong> answers a different question from <strong>Data as of</strong>:
        a file refreshed ten minutes ago can still be about last week. A row marked{" "}
        <em>BEHIND</em> has a date no one can fault and coverage that has not advanced — the
        exact shape of a stale answer that does not look stale.
      </p>
      <p className="caption">
        <strong>Data as of</strong> is the date of the data, never the moment it was
        downloaded: fetching a March file today does not make it from today. How long each
        kind of data stays current is declared once, in <code>freshness.py</code> — a betting
        line for minutes, an injury report for a day, a career stat forever.
      </p>
    </section>
  );
}
