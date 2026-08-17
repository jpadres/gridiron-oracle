/**
 * Componentes compartidos. Todos son componentes de servidor: se renderizan en
 * build time y llegan al navegador como HTML. No hay estado ni interactividad,
 * así que no hay motivo para enviar JavaScript de estos.
 */

export function Callout({ title, children }) {
  return (
    <div className="callout">
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="caption">{hint}</div> : null}
    </div>
  );
}

/**
 * Tabla a partir de columnas declarativas.
 *
 * `columns` es [{ key, label, format }]. Nada se inyecta como HTML crudo: React
 * escapa el contenido, y CI rechaza el build si aparece cualquier inyección de
 * HTML sin escapar en `app/` o `data/`.
 */
export function Table({ columns, rows, empty = "Sin datos todavía." }) {
  if (!rows || rows.length === 0) {
    return <p className="caption">{empty}</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.game_id ?? row.player_id ?? index}
                className={row._rowClass}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.format ? column.format(row[column.key], row) : row[column.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Aviso de que aún no se han generado los datos.
 *
 * El repo se clona sin `data/` (son ~490 MB y van en .gitignore), así que la
 * primera build sale sin payload. Decirlo explícitamente es mejor que enseñar
 * tablas vacías que parecen un error.
 */
export function NoDataYet() {
  return (
    <Callout title="Todavía no hay datos generados">
      <p>
        Este despliegue se construyó sin payload. Los datos no viajan en el repo
        (~490&nbsp;MB, en <code>.gitignore</code>); se reconstruyen y se hornean en el
        build:
      </p>
      <p>
        <code>oracle refresh &amp;&amp; oracle features</code> y después{" "}
        <code>python scripts/export_web_data.py</code>, que regenera{" "}
        <code>web/data/model.b64.js</code>.
      </p>
      <p className="caption">
        Si regeneras los datos hay que recomprimir, o la web seguirá mostrando los
        anteriores sin dar ningún error.
      </p>
    </Callout>
  );
}
