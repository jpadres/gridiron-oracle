import { model, num, pct } from "../../data/model.js";
import { CalibrationPlot } from "../charts.jsx";
import { Callout, NoDataYet, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — validación",
  description:
    "Métricas fuera de muestra frente al mercado, calibración y registro contra el spread con su intervalo de confianza.",
};

const SEASON_COLUMNS = [
  { key: "season", label: "Temporada" },
  { key: "games", label: "Partidos" },
  { key: "brier", label: "Brier", format: (v) => num(v, 4) },
  { key: "market_brier", label: "Brier mercado", format: (v) => num(v, 4) },
  { key: "margin_mae", label: "MAE margen", format: (v) => num(v) },
  { key: "market_margin_mae", label: "MAE mercado", format: (v) => num(v) },
  { key: "ece", label: "ECE", format: (v) => num(v, 4) },
  { key: "accuracy", label: "Acierto", format: (v) => pct(v) },
];

const CALIBRATION_COLUMNS = [
  { key: "bin", label: "Rango de probabilidad" },
  { key: "predicted", label: "Predicha", format: (v) => pct(v) },
  { key: "observed", label: "Observada", format: (v) => pct(v) },
  { key: "games", label: "Partidos" },
];

export default function Validacion() {
  const validation = model.validation;

  if (!validation) {
    return (
      <>
        <h1>Validación</h1>
        <NoDataYet />
      </>
    );
  }

  const { overall, ats, seasons, calibration } = validation;

  return (
    <>
      <h1>Validación</h1>
      <p className="lede">
        Walk-forward estricto: para predecir la temporada S sólo se usan temporadas anteriores.
        Todo se reajusta en cada paso — modelo, distribución de márgenes, calibración y pesos de
        ensamblado.
      </p>

      <h2>Fuera de muestra ({overall.games.toLocaleString("es-ES")} partidos)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Métrica</th>
              <th>Modelo</th>
              <th>Mercado (cierre)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Brier</td><td>{num(overall.brier, 4)}</td>
                <td>{num(overall.market_brier, 4)}</td></tr>
            <tr><td>Log-loss</td><td>{num(overall.log_loss, 4)}</td><td>—</td></tr>
            <tr><td>Error de calibración (ECE)</td><td>{num(overall.ece, 4)}</td><td>—</td></tr>
            <tr><td>MAE del margen</td><td>{num(overall.margin_mae)}</td>
                <td>{num(overall.market_margin_mae)}</td></tr>
            <tr><td>MAE del total</td><td>{num(overall.total_mae)}</td><td>—</td></tr>
            <tr><td>Acierto directo</td><td>{pct(overall.accuracy)}</td><td>—</td></tr>
          </tbody>
        </table>
      </div>

      <Callout title="Cómo leer esto">
        <p>
          Las dos columnas están pegadas a propósito. Reportar el Brier del modelo sin el del
          mercado al lado no dice nada: la pregunta no es «¿es bueno?», es «¿es mejor que lo que
          ya existe gratis?».
        </p>
      </Callout>

      <h2>Contra el spread</h2>
      <p>
        {ats.wins}-{ats.losses}-{ats.pushes} ({pct(ats.win_rate)}), IC 95%{" "}
        [{pct(ats.ci_low)}, {pct(ats.ci_high)}]. El punto de equilibrio a -110 es 52,4%.{" "}
        <strong>{ats.significant ? "Significativo." : "No significativo."}</strong>
      </p>
      <p className="caption">
        Un porcentaje contra el spread sin intervalo de confianza no significa nada. Con unos
        cientos de apuestas el error estándar es de varios puntos porcentuales, y presentar el
        número pelado es la forma más común de vender ruido como edge.
      </p>

      <h2>Por temporada</h2>
      <p className="caption">
        <strong>Ojo con la columna ECE aquí.</strong> Sale entre 0,04 y 0,10 cada temporada, y
        el ECE global de arriba es {num(overall.ece, 4)} — mucho mejor que cualquiera de sus
        partes, que suena a truco. No lo es: el ECE es un estadístico{" "}
        <strong>sesgado al alza en muestras pequeñas</strong>. Con 267 partidos repartidos en
        diez tramos quedan unos 27 por tramo, y sólo el ruido de muestreo ya mueve la
        frecuencia observada unos 9 puntos. Eso es lo que miden esos números: casi todo ruido.
        Con los {overall.games.toLocaleString("es-ES")} partidos juntos, el ruido baja y queda
        la miscalibración de verdad.
      </p>
      <Table columns={SEASON_COLUMNS} rows={seasons} />

      <h2>Calibración</h2>
      <p className="caption">
        Probabilidad predicha frente a frecuencia observada. Si las dos se separan, el modelo
        miente aunque su Brier sea bueno — y para poner precio a una apuesta, la probabilidad
        importa más que el ranking.
      </p>
      <CalibrationPlot rows={calibration} />
      <Table columns={CALIBRATION_COLUMNS} rows={calibration} />
    </>
  );
}
