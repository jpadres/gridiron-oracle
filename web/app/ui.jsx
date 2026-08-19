/**
 * Componentes compartidos. Todos son componentes de servidor: se renderizan en
 * build time y llegan al navegador como HTML. No hay estado ni interactividad,
 * así que no hay motivo para enviar JavaScript de estos.
 */

import { Fragment } from "react";

import { pct } from "../data/model.js";

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
 * Marca de que el texto lo escribió un modelo de lenguaje.
 *
 * Va en **todos** los bloques generados, sin excepción y sin letra pequeña. El
 * lector tiene que poder saber, de un vistazo y sin buscarlo, qué párrafos son
 * texto calculado y cuáles son texto redactado por una máquina sobre ese
 * cálculo. Es la misma razón por la que el proyecto publica que no bate al
 * mercado: si hay que esconderlo, no debería publicarse.
 */
export function MachineWritten({ children, at }) {
  return (
    <div className="machine">
      <p className="machine-tag">
        Texto redactado por Claude sobre los números del modelo. Cada cifra que aparece se
        verifica contra los datos antes de publicarse; si no cuadra, el texto se descarta y
        esta sección sale vacía.
        {at ? <> Generado el {new Date(at).toLocaleDateString("es-ES")}.</> : null}
      </p>
      {children}
    </div>
  );
}

/**
 * Etiqueta de dirección de una noticia.
 *
 * Vive aquí y no en la página de research porque la misma etiqueta aparece
 * debajo de las tablas del ranking semanal. Dos copias de este diccionario se
 * desincronizan a la primera, y el síntoma es que en una página pone «alza» y
 * en la otra «▲ Al alza».
 *
 * El triángulo no es decoración: es el segundo canal. Quien no distinga el azul
 * del rojo lee la flecha y el texto.
 */
export const IMPACT = { alza: "▲ Al alza", baja: "▼ A la baja", neutro: "= Neutro" };

export function ImpactTag({ impact }) {
  return <span className={`tag tag--${impact}`}>{IMPACT[impact] ?? IMPACT.neutro}</span>;
}

/**
 * Fila de fuentes de una nota de prensa.
 *
 * Cada ficha de research lleva su enlace obligatoriamente: sin fuente
 * comprobable no se publica. Que el enlace esté a la vista es lo que separa
 * «esto lo dice ESPN» de «esto lo dice el sitio».
 */
export function Sources({ sources }) {
  if (!sources || sources.length === 0) return null;
  return (
    <p className="sources">
      {sources.map((source, index) => (
        <a
          key={source.url ?? index}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={source.title}
        >
          {source.outlet}
        </a>
      ))}
    </p>
  );
}

/**
 * Tabla de ranking en el formato que usa la gente que juega a esto.
 *
 * La diferencia con `Table` no es estética. Una tabla genérica gasta una columna
 * por dato y obliga a barrer en horizontal para saber quién es un jugador;
 * aquí el nombre, su posición, su equipo y su rival van **en una sola celda**,
 * apilados, y las columnas que quedan son sólo números comparables. Es el
 * formato de FantasyPros y de cualquier board que se lea rápido, y el motivo es
 * que se consulta de arriba abajo buscando un nombre, no de izquierda a derecha
 * leyendo campos.
 *
 * Las bandas de tier son filas de verdad y no un borde más grueso: el hueco
 * entre tiers es la información que más importa de un board —dice si puedes
 * esperar otra ronda— y merece una línea propia con su nombre.
 *
 * `notes` y `news` son opcionales: marcan las filas que tienen explicación del
 * modelo o prensa reciente. El punto es un segundo canal, nunca el único: lleva
 * `title` y la sección de debajo repite el contenido en texto.
 */
export function RankTable({
  rows, columns, notes = {}, news = {}, availability = {}, briefs = {},
  risk = false, tiers = false,
}) {
  if (!rows || rows.length === 0) {
    return <p className="caption">Sin datos todavía.</p>;
  }
  let lastTier = null;
  return (
    <div className="table-wrap">
      <table className="rank-table">
        <thead>
          <tr>
            <th className="rk">#</th>
            <th>Jugador</th>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const band = tiers && row.tier !== lastTier ? row.tier : null;
            lastTier = row.tier;
            const hasNote = Boolean(notes[row.player_id]);
            const hasNews = Boolean(news[row.player_id]);
            const health = availability[row.player_id];
            const brief = briefs[row.player_id];
            return (
              <Fragment key={row.player_id ?? index}>
                {band !== null && band !== undefined ? (
                  <tr className="tier-band">
                    <td colSpan={columns.length + 2}>Tier {band}</td>
                  </tr>
                ) : null}
                <tr>
                  <td className="rk">{row.rank ?? index + 1}</td>
                  <td className="who">
                    <span className="nm">
                      {row.player_name}
                      {hasNote ? (
                        <span className="mark mark--why" title="El modelo explica esta posición más abajo">
                          ?
                        </span>
                      ) : null}
                      {hasNews ? (
                        <span className="mark mark--news" title="Hay prensa reciente sobre este jugador">
                          !
                        </span>
                      ) : null}
                      {health ? <AvailabilityTag entry={health} /> : null}
                      {risk && row.risk_label && row.risk_label !== "Normal" ? (
                        <RiskTag row={row} />
                      ) : null}
                    </span>
                    <span className="meta">
                      {row.position ? <PositionTag position={row.position} /> : null}
                      {row.team}
                      {row.position_rank ? ` · ${row.position}${row.position_rank}` : null}
                      {row.opponent ? ` · vs ${row.opponent}` : null}
                    </span>
                    {brief ? <span className="brief">{brief}</span> : null}
                  </td>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.format
                        ? column.format(row[column.key], row)
                        : row[column.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Etiqueta de disponibilidad al lado del nombre.
 *
 * Es lo único de esta tabla que el modelo **no sabe**: la proyección sale del
 * historial de partidos y cuenta con un jugador aunque esté descartado. Va
 * pegada al nombre y no en una columna aparte justamente por eso — un dato que
 * invalida la fila de al lado no puede estar a seis columnas de distancia.
 *
 * `title` lleva la situación, quién lo dijo y cuándo. La etiqueta mide
 * DISPONIBILIDAD, no gravedad.
 */
function AvailabilityTag({ entry }) {
  return (
    <span
      className={`avail avail--${entry.level.toLowerCase()}`}
      title={`${entry.situation} — ${entry.status} (${entry.source}, ${entry.date})`}
    >
      {entry.level}
    </span>
  );
}

/**
 * Etiqueta de riesgo, con su descomposición en el tooltip.
 *
 * La etiqueta sola sería un oráculo. Enseñando de qué está hecha —muestra,
 * cuánto encogió el modelo la tasa bruta, dependencia del touchdown— se puede
 * discrepar de un motivo concreto, que es la única forma de discutir un número.
 */
// Nombre de clase en ASCII y no derivado de la etiqueta: `"Volátil".toLowerCase()`
// da `.risk--volátil`, que funciona hasta que alguien le quita la tilde a la
// etiqueta y el estilo desaparece sin que falle nada.
const RISK_CLASS = { "Volátil": "high", "Estable": "low", Normal: "mid" };

function RiskTag({ row }) {
  const parts = [
    `muestra ${Math.round((row.risk_sample ?? 0) * 100)}`,
    `encogimiento ${Math.round((row.risk_shrink ?? 0) * 100)}`,
    `touchdown ${Math.round((row.risk_touchdown ?? 0) * 100)}`,
  ].join(" · ");
  const why = row.risk_reasons?.length ? `${row.risk_reasons.join("; ")}. ` : "";
  return (
    <span
      className={`risk risk--${RISK_CLASS[row.risk_label] ?? "mid"}`}
      title={`${why}Componentes sobre 100: ${parts}`}
    >
      {row.risk_label}
    </span>
  );
}

/**
 * Celda de probabilidad de bust.
 *
 * Va en una columna y no en una etiqueta pegada al nombre porque es un número
 * comparable, que es exactamente el criterio con el que está montada esta
 * tabla: el nombre, la posición y el equipo se apilan en la celda del jugador;
 * las columnas se reservan para lo que se lee de arriba abajo comparando.
 *
 * El color es el segundo canal, nunca el único: el número está siempre escrito.
 * Quien no distinga el verde del rojo lee «31%» igual de bien.
 */
export function BustCell({ row }) {
  if (row.p_bust === null || row.p_bust === undefined) return <>—</>;
  const tone = BUST_CLASS[row.bust_label] ?? "mid";
  return (
    <span
      className={`bust bust--${tone}`}
      title={`Probabilidad de terminar por debajo del 70% de su proyección. ${
        row.bust_label ?? ""
      }. Base histórica del board: 43%.`}
    >
      {pct(row.p_bust, 0)}
    </span>
  );
}

// Igual que en el riesgo de volatilidad: la clase se escribe en ASCII y no se
// deriva de la etiqueta. `"Sólido".toLowerCase()` da `.bust--sólido`, que
// funciona hasta que alguien le quita la tilde y el estilo desaparece sin que
// falle nada.
const BUST_CLASS = { "Sólido": "low", Normal: "mid", "Frágil": "high" };

/** Cuadrito de posición dentro de la línea de metadatos. */
function PositionTag({ position }) {
  return <span className={`ptag ptag--${position.toLowerCase()}`}>{position}</span>;
}

/**
 * Estado de cada conjunto de datos: qué hay, de cuándo, y adónde ir.
 *
 * Una herramienta personal que se consulta antes de un draft y cada semana
 * necesita responder primero a «¿esto está actualizado?». Sin eso la duda
 * contamina todo lo que hay debajo: un ranking que no dice cuándo se calculó no
 * sirve para decidir, porque no sabes si ya incluye la lesión del domingo.
 *
 * `stale` marca lo que lleva demasiado sin refrescarse. Es mejor que lo diga la
 * propia página a que lo descubras al ver un nombre imposible.
 */
export function DataCard({ href, label, value, detail, stale = false }) {
  return (
    <a className={`card ${stale ? "card--stale" : ""}`} href={href}>
      <span className="card-label">{label}</span>
      <span className="card-value">{value}</span>
      <span className="card-detail">{detail}</span>
    </a>
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
