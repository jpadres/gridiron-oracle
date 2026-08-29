import { model, num, pct } from "../../data/model.js";
import { Callout, NoDataYet, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — predicciones",
  description: "Predicciones de la jornada y apuestas que superan el umbral de valor.",
};

const GAME_COLUMNS = [
  { key: "away_team", label: "Visitante" },
  { key: "home_team", label: "Local" },
  { key: "spread_line", label: "Línea", format: (v) => num(v, 1) },
  { key: "pred_margin", label: "Margen", format: (v) => num(v) },
  { key: "pred_total", label: "Total", format: (v) => num(v, 1) },
  { key: "home_win_prob", label: "P(local)", format: (v) => pct(v) },
  { key: "edge_vs_line", label: "Diferencia", format: (v) => num(v) },
];

const BET_COLUMNS = [
  { key: "matchup", label: "Partido" },
  { key: "market", label: "Mercado" },
  { key: "selection", label: "Selección" },
  { key: "model_prob", label: "P(modelo)", format: (v) => pct(v) },
  // Fuera «P(mercado)». En un spread a −110 por los dos lados, quitar el vig da
  // exactamente 50,0% siempre: la columna ocupaba sitio para repetir el mismo
  // número en todas las filas, y de paso invitaba a leer el edge como si el
  // mercado hubiese opinado algo. Lo que va en su lugar es lo que de verdad
  // distingue una apuesta de otra: cuánto se separa el modelo de la línea.
  { key: "disagreement", label: "Discrepa", format: (v) => `${num(v, 1)} pts` },
  { key: "edge", label: "Edge", format: (v) => pct(v) },
  { key: "ev", label: "EV", format: (v) => pct(v) },
  { key: "stake", label: "Importe", format: (v) => num(v) },
  {
    key: "evidence_win_rate",
    label: "Su clase, históricamente",
    format: (v, row) =>
      v === null || v === undefined ? (
        <span className="ev-none">sin evidencia</span>
      ) : (
        <span className={row.evidence_beats_breakeven ? "ev-ok" : "ev-bad"}
              title={`Apuestas con una discrepancia de ${row.evidence_label} acertaron el ${(v * 100).toFixed(1)}% en ${row.evidence_bets} casos fuera de muestra. El equilibrio a −110 es 52,4%.`}>
          {pct(v)} en {row.evidence_bets}
        </span>
      ),
  },
];

const RATING_COLUMNS = [
  { key: "team", label: "Equipo" },
  { key: "elo", label: "Elo", format: (v) => num(v, 0) },
  { key: "off_epa", label: "Ataque", format: (v) => num(v, 3) },
  { key: "def_epa", label: "Defensa", format: (v) => num(v, 3) },
  { key: "net_epa", label: "Neto", format: (v) => num(v, 3) },
];

export default function Predicciones() {
  const week = model.week;
  const predictions = model.predictions ?? [];

  if (!week || predictions.length === 0) {
    return (
      <>
        <h1>Predicciones</h1>
        <NoDataYet />
      </>
    );
  }

  const bets = model.bets ?? [];

  return (
    <>
      <h1>
        Predicciones — {week.season}, semana {week.week}
      </h1>
      <p className="lede">
        <strong>Margen</strong> es la predicción de producción, anclada al mercado.{" "}
        <strong>Margen (libre)</strong> es el modelo autónomo, que no mira la línea en absoluto.
        Compararlos es la forma de ver cuánto se está separando la señal deportiva del consenso.
      </p>

      <Table columns={GAME_COLUMNS} rows={predictions} />

      <h2>Apuestas con valor</h2>
      <Callout title="Leer esta tabla junto a la portada, no en vez de ella">
        <p>
          La portada dice que el modelo <strong>no bate a la línea de cierre</strong>, y esta
          tabla lista apuestas. No es una contradicción: son los partidos donde el modelo se
          separa más del mercado, y esa discrepancia tiene una desviación típica de
          0,86 puntos, así que separarse dos puntos pasa unas cien veces en catorce
          temporadas. En ese grupo el registro histórico es positivo{" "}
          <strong>y no alcanza significación estadística</strong> (p≈0,18). Es una hipótesis,
          no una estrategia probada.
        </p>
        <p className="caption">
          Si ves un importe de céntimos junto a un edge del 4%, no está roto: tras el
          encogimiento del 50% esa apuesta queda pegada al punto de equilibrio de -110
          (52,4%), y Kelly manda casi cero. Es la maquinaria de riesgo funcionando.
        </p>
      </Callout>
      {bets.length === 0 ? (
        <Callout title="Ninguna apuesta supera el umbral">
          <p>
            Este es el resultado normal de la mayoría de las jornadas, y no es un fallo. El
            modelo iguala al mercado: si encontrase valor en diez partidos por semana, lo que
            habría que revisar sería el modelo.
          </p>
          <p className="caption">
            Bajar el umbral no crea edge. Sólo lo esconde.
          </p>
        </Callout>
      ) : (
        <>
          <Table columns={BET_COLUMNS} rows={bets} />
          <p className="caption">
            Importes sobre un bankroll de 1.000, con Kelly a un cuarto, encogimiento del 50% del
            edge estimado y tope duro del 2% por apuesta. No se publican apuestas cuyo importe
            baje de 1: un «apuesta 0,01 €» es una fila que dice «no apuestes» disfrazada de
            recomendación.
          </p>

          <Callout title="Qué dice el historial de las apuestas que se parecen a ésta">
            <p>
              La última columna no es una opinión ni una escala de confianza inventada. Es la
              tasa de acierto <strong>real y fuera de muestra</strong> de las apuestas en las que
              el modelo discrepaba de la línea en esa misma magnitud, sobre catorce temporadas.
              El umbral se fijó antes de medir, en <code>docs/PREREGISTRO_confianza.md</code>.
            </p>
            <p>El resultado completo, que es incómodo y por eso se publica entero:</p>
            <ul>
              <li>Discrepancia de <strong>0 a 1 puntos</strong>: acertaron el <strong>49,3%</strong> (2.189 casos).</li>
              <li>De <strong>1 a 2 puntos</strong>: el <strong>50,9%</strong> (1.173 casos).</li>
              <li>De <strong>2 a 3,5 puntos</strong>: el <strong>48,8%</strong> (346 casos).</li>
            </ul>
            <p>
              El equilibrio a cuota −110 es <strong>52,4%</strong>.{" "}
              <strong>Ningún tramo lo supera</strong>, ni por la media ni —que es lo que exigía el
              preregistro— por el límite inferior de su intervalo.
            </p>
            <p>
              Y el dato que más informa de todos: <strong>el acierto no sube con la
              discrepancia</strong>. Que el modelo se separe más de la línea no predice acertar
              más. Eso refuta directamente la idea de construir «confianza» a partir del edge,
              que era el camino evidente y por eso se probó.
            </p>
            <p className="caption">
              Por eso aquí no hay «Best Bets» ni estrellas de confianza. Construirlas exigiría
              afirmar una rentabilidad que estos datos no sostienen, y sería exactamente el tipo
              de número inventado que el resto del sitio se dedica a no publicar.
            </p>
          </Callout>
        </>
      )}

      <h2>Ratings actuales</h2>
      <p className="caption">
        Tal como quedaron tras el último partido jugado. En <strong>Defensa</strong>, un número
        alto significa defensa permisiva: el ataque esperado contra ella es{" "}
        <code>ataque + defensa rival</code>, sumando.
      </p>
      <Table columns={RATING_COLUMNS} rows={model.ratings ?? []} />
    </>
  );
}
