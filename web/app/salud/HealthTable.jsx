/**
 * LA TABLA DE SALUD. Componente propio para que la página siga siendo de
 * servidor y no mande JavaScript: aquí no hay estado ni interacción, sólo
 * lectura del payload horneado.
 *
 * Cada fila dice las cinco cosas con las que se puede discutir una etiqueta: de
 * cuándo es el dato, qué jornada cubre, la frescura PRECISA (que es la
 * autoridad), el umbral que la decidió y en qué marca se apoya. Sin la marca,
 * «hace 2 h» no se puede auditar — y confundir la hora de descarga con la del
 * dato es exactamente cómo se fabrica una afirmación falsamente actual.
 */
export default function HealthTable({ sources }) {
  return (
    <section aria-label="Source by source">
      <h2 className="bk-h">
        Source by source <small>each row carries the threshold that labelled it</small>
      </h2>
      <div className="table-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Feeds</th>
              <th>Label</th>
              <th>Freshness</th>
              <th>Covers</th>
              <th>As of</th>
              <th>Window</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.name}>
                <th scope="row" className="who">
                  {s.name}
                  <span className="meta">{s.origin}</span>
                </th>
                <td>{s.feeds}</td>
                <td>
                  {/* FRESH va SIN insignia: es el caso normal y una marca que
                      sale siempre no informa — la misma razón por la que
                      `rosterMark` se calla con ACTIVE. Se marca lo que reclama
                      atención, y así la columna se lee de un barrido. */}
                  {s.label === "FRESH" ? (
                    s.label
                  ) : (
                    <span className={`mark mark--${s.label === "STALE" ? "risk" : "out"}`}>
                      {s.label}
                    </span>
                  )}
                </td>
                <td>
                  {s.freshness}
                  {/* La frescura precisa es la autoridad; la etiqueta corta es el
                      vistazo. Se enseñan las dos porque RECENT y STALE no son lo
                      mismo aunque las dos caigan en STALE: la primera se puede
                      usar de contexto y la segunda ya no. */}
                  {s.reason ? <span className="meta">{s.reason}</span> : null}
                </td>
                <td>
                  {s.covers_week != null
                    ? `week ${s.covers_week}`
                    : s.covers_season != null
                      ? `${s.covers_season}`
                      : "—"}
                  {/* BEHIND es la otra mitad de la frescura: el fichero puede
                      ser de hace diez minutos y la jornada que cubre ser la
                      pasada. Se marca porque la edad no lo puede decir. */}
                  {s.coverage === "BEHIND" ? (
                    <span className="mark mark--risk">BEHIND</span>
                  ) : null}
                  {s.extra?.stats_through_week != null ? (
                    <span className="meta">
                      stats through week {s.extra.stats_through_week}
                    </span>
                  ) : null}
                </td>
                <td>{s.as_of ?? "UNKNOWN"}</td>
                <td>{s.window_hours != null ? `${s.window_hours} h` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        <strong>Covers</strong> answers a different question from <strong>As of</strong>: a
        file refreshed ten minutes ago can still be about last week. A row marked{" "}
        <em>BEHIND</em> has a date no one can fault and coverage that has not advanced — the
        exact shape of a stale answer that does not look stale.
      </p>
      <p className="caption">
        <strong>As of</strong> is the date of the data, never the moment it was downloaded:
        fetching a March file today does not make it from today. For the nflverse files the
        two coincide on purpose — the download preserves the upstream date, and where the
        server sends none it is replaced by the date of the commit that last touched the
        file.
      </p>
    </section>
  );
}
