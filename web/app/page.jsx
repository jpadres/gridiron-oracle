import { model, num } from "../data/model.js";
import { Callout, MachineWritten, Stat } from "./ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — resumen",
  description: "El modelo iguala a la línea de cierre del mercado. No la bate.",
};

export default function Home() {
  const overall = model.validation?.overall;
  const summary = model.narrative?.summary;
  const week = model.week;

  return (
    <>
      <h1>Gridiron Oracle</h1>
      <p className="lede">
        Modelo de pronóstico para la NFL — margen, total, probabilidad de victoria y
        detección de valor frente al mercado — más rankings de fantasy football. Datos
        100% públicos, validación walk-forward estricta y resultados reportados sin
        maquillaje.
      </p>

      <Callout title="El resultado honesto, en una línea">
        <p>
          <strong>El modelo iguala a la línea de cierre del mercado. No la bate.</strong>{" "}
          {overall ? (
            <>
              En {overall.games.toLocaleString("es-ES")} partidos fuera de muestra obtiene un
              Brier de <strong>{num(overall.brier, 4)}</strong> frente al{" "}
              <strong>{num(overall.market_brier, 4)}</strong> de las casas, y un MAE de margen
              de <strong>{num(overall.margin_mae)}</strong> frente a{" "}
              <strong>{num(overall.market_margin_mae)}</strong>.
            </>
          ) : (
            <>Las cifras concretas aparecen en cuanto se genera el payload de validación.</>
          )}
        </p>
        <p>
          Esto es exactamente lo que debe pasar, y es la mejor noticia posible: la línea de
          cierre de la NFL es uno de los estimadores más eficientes que existen en cualquier
          mercado del mundo. Cualquier proyecto que afirme batirla de forma consistente por un
          margen amplio, con datos públicos, está sobreajustando o midiendo mal.
        </p>
      </Callout>

      {overall ? (
        <div className="grid">
          <Stat label="Brier" value={num(overall.brier, 4)}
                hint={`Mercado: ${num(overall.market_brier, 4)}`} />
          <Stat label="MAE del margen" value={num(overall.margin_mae)}
                hint={`Mercado: ${num(overall.market_margin_mae)}`} />
          <Stat label="Error de calibración" value={num(overall.ece, 4)}
                hint="Cuánto miente la probabilidad" />
          <Stat label="Acierto directo" value={`${num(overall.accuracy * 100, 1)}%`}
                hint="Ganador del partido" />
        </div>
      ) : null}

      {summary ? (
        <section id="jornada">
          <h2>
            {week ? `La jornada ${week.week} de ${week.season}` : "La jornada"} — {summary.headline}
          </h2>
          <MachineWritten at={model.narrative?.generated_at}>
            {summary.paragraphs?.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
            {summary.watch?.length ? (
              <ul>
                {summary.watch.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
          </MachineWritten>
        </section>
      ) : null}

      <h2>Dónde está el edge real, y por qué no está aquí todavía</h2>
      <p>
        Este backtest se valida contra la línea de <em>cierre</em>. Nadie apuesta al cierre. El
        dinero se hace contra la línea de apertura, contra libros lentos y con noticias de
        lesiones antes de que el mercado las digiera. Eso es trabajo del roadmap, no una
        promesa de que el modelo ya lo haga.
      </p>

      <h2>Qué sí aporta</h2>
      <ul>
        <li>
          <strong>Distribución discreta con números clave.</strong> El margen en la NFL se
          acumula en 3 y en 7; una normal comete errores sistemáticos justo en las líneas donde
          se juega el dinero.
        </li>
        <li>
          <strong>Parametrización sobre el residuo del mercado.</strong> El modelo predice en
          qué se equivoca la línea, no el margen con la línea como una feature más.
        </li>
        <li>
          <strong>Calibración medida y publicada.</strong> Para apostar, la probabilidad
          importa más que el ranking.
        </li>
        <li>
          <strong>Un modelo autónomo</strong> que no mira la línea en absoluto, para poder
          responder si la señal deportiva aporta algo por sí sola.
        </li>
      </ul>

      <h2>Limitaciones conocidas</h2>
      <ul>
        <li>Se valida contra líneas de cierre, las más difíciles de batir.</li>
        <li>Sin datos de lesiones en tiempo real; el efecto QB se infiere del titular anunciado.</li>
        <li>Clima histórico observado, no pronosticado.</li>
        <li>Sin líneas de varias casas, así que no hay <em>line shopping</em>.</li>
        <li>Sin mercados de props ni alternativos.</li>
      </ul>
    </>
  );
}
