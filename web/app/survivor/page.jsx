import { model, num, pct } from "../../data/model.js";
import { Callout, NoDataYet, Stat, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — survivor",
  description:
    "Plan de survivor calculado sobre las probabilidades del modelo: el mejor pick de la jornada y cuánto cuesta quemar cada equipo.",
};

const BOARD_COLUMNS = [
  { key: "rank", label: "#" },
  { key: "team", label: "Equipo" },
  { key: "opponent", label: "Rival", format: (v, row) => (row.home ? `vs ${v}` : `en ${v}`) },
  { key: "win_prob", label: "Gana", format: (v) => pct(v) },
  { key: "survival_if_used", label: "Plan si lo usas", format: (v) => pct(v) },
  {
    key: "advice",
    label: "Consejo",
    format: (v, row) => (
      <span className={`adv adv--${{ USAR: "go", GUARDAR: "hold", EVITAR: "no" }[v] ?? "hold"}`}
            title={row.advice_why}>
        {v}
      </span>
    ),
  },
  {
    key: "cost_relative",
    // «Coste relativo» y no «coste», porque la escala es lo que lo hacía
    // ilegible: 0,0008 de probabilidad absoluta se pintaba como «−0,1%» y se
    // leía como «da igual», cuando sobre un plan que sobrevive al 0,81% son
    // **el 10% de todo lo que tienes**.
    label: "Cuánto te cuesta",
    format: (v) => (v < 0.005 ? "—" : `−${pct(v, 0)}`),
  },
  {
    key: "cost",
    label: "En absoluto",
    // El coste del mejor pick es cero por construcción: es el plan de
    // referencia. Escribirlo como «0,0%» invita a leerlo como un empate.
    format: (v) => (v < 1e-9 ? "—" : `−${pct(v)}`),
  },
];

/** Plan completo en una línea: la secuencia es más legible que una tabla. */
function PlanRow({ picks }) {
  return (
    <p className="plan">
      {picks.map((pick) => (
        <span className="step" key={pick.week}>
          <span className="wk">J{pick.week}</span>
          <span className="tm">{pick.team}</span>
          <span className="pb">{pct(pick.win_prob, 0)}</span>
        </span>
      ))}
    </p>
  );
}

export default function Survivor() {
  const survivor = model.survivor;

  if (!survivor) {
    return (
      <>
        <h1>Survivor</h1>
        <p className="lede">
          Un ganador por jornada, sin repetir equipo. Quien falla, queda fuera.
        </p>
        <NoDataYet />
        <p className="caption">
          Esta sección la genera <code>python scripts/survivor_build.py</code>.
        </p>
      </>
    );
  }

  const best = survivor.short_board?.[0];
  const weeks = survivor.through - survivor.from_week + 1;

  return (
    <>
      <h1>
        Survivor — jornada {survivor.from_week} de {survivor.season}
      </h1>
      <p className="lede">
        Un ganador por jornada y sin repetir equipo. La decisión difícil no es quién gana el
        domingo: es cuánto te cuesta gastar hoy al equipo que te salvaría la jornada once.
      </p>

      <Callout title="Aquí el modelo sí aporta, y por una razón concreta">
        <p>
          Contra la línea de cierre el modelo empata y por eso la página de apuestas sale
          vacía. En un survivor <strong>no compites contra un mercado eficiente</strong>:
          compites contra el calendario y contra tu propio bote de equipos. Lo que hace falta
          no es una probabilidad mejor que la del mercado, es una <strong>bien calibrada</strong>
          {" "}—medida, ECE {num(model.validation?.overall?.ece ?? 0, 4)}— y mirar todas las
          jornadas a la vez, que es donde una persona no llega.
        </p>
      </Callout>

      <div className="grid">
        <Stat
          label="Mejor pick"
          value={best ? best.team : "—"}
          hint={best ? `${best.home ? "vs" : "en"} ${best.opponent} · gana ${pct(best.win_prob)}` : null}
        />
        <Stat
          label={`Sobrevivir ${survivor.short_horizon} jornadas`}
          value={pct(survivor.short_survival)}
          hint="Con el plan óptimo"
        />
        <Stat
          label={`Sobrevivir las ${weeks}`}
          value={pct(survivor.plan_survival, 2)}
          hint="El número que nadie enseña"
        />
        <Stat
          label="Equipos gastados"
          value={survivor.used.length}
          hint={survivor.used.length ? survivor.used.join(", ") : "Ninguno todavía"}
        />
      </div>

      <Callout title="Sobrevivir la temporada entera es casi imposible, y conviene saberlo">
        <p>
          El plan <em>óptimo</em> —el mejor camino que existe con estas probabilidades— llega
          al final el <strong>{pct(survivor.plan_survival, 2)}</strong> de las veces. No es un
          fallo del modelo: es la aritmética de multiplicar {weeks} probabilidades de un 70%.
          Un survivor no se gana sobreviviendo, se gana durando más que los demás.
        </p>
      </Callout>

      <h2>La jornada {survivor.from_week}, mirando {survivor.short_horizon} jornadas adelante</h2>
      <p className="caption">
        Ordenado por la supervivencia del mejor plan que <em>empieza</em> con ese equipo, no por
        quién gana más claro el domingo. La última columna es la diferencia: lo que pierdes por
        gastarlo hoy en vez de en su mejor momento.
      </p>
      <Table columns={BOARD_COLUMNS} rows={survivor.short_board ?? []} />
      <p className="caption">
        El plan corto que sale de aquí:
      </p>
      <PlanRow picks={survivor.short_plan ?? []} />

      <h2>El mismo cálculo a temporada completa</h2>
      <p className="caption">
        A {weeks} jornadas el producto de probabilidades se aplana y las opciones dejan de
        distinguirse: todo sale «menos del uno por ciento». Sirve para ver el camino, no para
        decidir el domingo.
      </p>
      <Table columns={BOARD_COLUMNS} rows={survivor.board ?? []} />
      <PlanRow picks={survivor.plan ?? []} />

      <h2>Qué no hace este cálculo</h2>
      <ul>
        <li>
          <strong>No modela al resto del bote.</strong> En un survivor grande a veces interesa
          separarse del favorito público aunque cueste probabilidad: compartir la eliminación
          con todos no te elimina, y compartir la supervivencia con todos no te hace ganar.
          Eso necesita saber qué está eligiendo la gente, y no lo tenemos.
        </li>
        <li>
          <strong>Las jornadas lejanas no son pronósticos.</strong> Para una jornada futura no
          hay línea de mercado publicada, así que el modelo usa su variante autónoma, que es
          peor (Brier 0,2187 frente a 0,2117 en el backtest). La jornada 15 calculada hoy es un
          prior de fuerza de equipos.
        </li>
        <li>
          <strong>No sabe de lesiones.</strong> Como el resto del proyecto. El{" "}
          <a href="/research">parte médico</a> va al lado, no dentro.
        </li>
        <li>
          <strong>La última jornada es un caso aparte.</strong> Los equipos ya clasificados
          descansan titulares y el modelo no lo sabe.
        </li>
      </ul>

      <h2>Cómo se calcula</h2>
      <p>
        Maximizar la probabilidad de sobrevivir todas las jornadas es maximizar el producto de
        las probabilidades de acierto, y eso es maximizar la <strong>suma de sus
        logaritmos</strong> con la restricción de un equipo por jornada y ninguno repetido. Es
        un problema de asignación lineal: tiene solución exacta con el algoritmo húngaro y sale
        en milisegundos. No hay que simular nada.
      </p>
      <p className="caption">
        El coste de quemar un equipo sale de resolverlo dos veces: el óptimo libre y el óptimo
        obligando a usar ese equipo esta jornada. La diferencia <em>es</em> lo que cuesta.
      </p>
    </>
  );
}
