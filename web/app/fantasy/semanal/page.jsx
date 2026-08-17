import { model, num } from "../../../data/model.js";
import { DeltaBars, POSITIONS, PositionChip } from "../../charts.jsx";
import { Callout, NoDataYet, Table } from "../../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — ranking semanal",
  description:
    "Ranking de fantasy global y por posición, construido sobre el guion de juego proyectado por el modelo de partidos.",
};

const GLOBAL_COLUMNS = [
  { key: "overall_rank", label: "#" },
  { key: "player_name", label: "Jugador" },
  { key: "position", label: "Pos", format: (v) => <PositionChip position={v} /> },
  { key: "position_rank", label: "Pos #" },
  { key: "team", label: "Equipo" },
  { key: "opponent", label: "Rival" },
  { key: "projected_points", label: "Proyección", format: (v) => num(v, 1) },
  { key: "baseline_points", label: "Últimos 6", format: (v) => num(v, 1) },
  { key: "delta", label: "Dif.", format: (v) => (v > 0 ? `+${num(v, 1)}` : num(v, 1)) },
];

const POSITION_COLUMNS = GLOBAL_COLUMNS.filter(
  (column) => !["position", "overall_rank"].includes(column.key)
).concat({
  key: "matchup_multiplier",
  label: "Emparejamiento",
  format: (v) => num(v, 2),
});

/**
 * Los N más favorecidos y los N más penalizados, en un solo orden descendente.
 *
 * Ordenar por valor absoluto sería un error de lectura: enseñaría sólo el lado
 * que más se mueva y daría la impresión de que el modelo tira siempre en la
 * misma dirección.
 */
function extremes(rows, n) {
  const sorted = [...rows].sort((a, b) => b.delta - a.delta);
  return [...sorted.slice(0, n), ...sorted.slice(-n)];
}

export default function Semanal() {
  const weekly = model.fantasy_weekly;

  if (!weekly) {
    return (
      <>
        <h1>Ranking semanal</h1>
        <NoDataYet />
      </>
    );
  }

  // El ranking global se calcula aquí y no en el payload: es una ordenación de
  // los mismos datos, y guardarla aparte sería una copia que puede
  // desincronizarse de la de posición.
  const rankings = (weekly.rankings ?? [])
    .map((row) => ({ ...row, delta: row.projected_points - row.baseline_points }))
    .sort((a, b) => b.projected_points - a.projected_points)
    .map((row, index) => ({ ...row, overall_rank: index + 1 }));

  return (
    <>
      <h1>
        Ranking semanal — {weekly.season}, semana {weekly.week}
      </h1>
      <p className="lede">
        El puente con el modelo de partidos es el guion de juego: el margen y el total
        proyectados determinan cuántas jugadas tendrá cada equipo y de qué tipo. Un receptor
        con un 26% de target share en un partido que se proyecta 17-27 en contra vale más que
        en uno 28-17 a favor, porque el equipo que va perdiendo lanza más.
      </p>

      <ul className="jump">
        <li><a href="#global">Global</a></li>
        {POSITIONS.map((position) => (
          <li key={position}><a href={`#${position.toLowerCase()}`}>{position}</a></li>
        ))}
      </ul>

      <Callout title="Cómo leer el global">
        <p>
          La lista global ordena por puntos proyectados y sirve para el hueco flexible, donde
          sí compites un corredor contra un receptor. Para decidir a quién alineas en un
          puesto fijo, la lista de su posición es la que manda:{" "}
          <strong>un quarterback proyecta más puntos que cualquier receptor y eso no lo hace
          mejor elección</strong>, porque no compiten por la misma casilla.
        </p>
      </Callout>

      <h2>Dónde el modelo se separa de la forma reciente</h2>
      <p className="caption">
        El listón es la media ponderada de los seis últimos partidos del jugador, que
        cualquiera calcula en dos minutos. Arriba, los seis a los que el guion de juego y el
        emparejamiento favorecen más esta jornada; abajo, los seis a los que penalizan. Si
        esta gráfica no tuviera barras hacia los dos lados, el modelo no estaría aportando
        nada sobre el listón.
      </p>
      <DeltaBars rows={extremes(rankings, 6)} limit={12} />

      <section id="global">
        <h2>Global</h2>
        <Table columns={GLOBAL_COLUMNS} rows={rankings.slice(0, 60)} />
      </section>

      {POSITIONS.map((position) => {
        const group = rankings.filter((row) => row.position === position);
        if (group.length === 0) return null;
        return (
          <section key={position} id={position.toLowerCase()}>
            <h2>
              <PositionChip position={position} /> {position}
            </h2>
            <Table columns={POSITION_COLUMNS} rows={group.slice(0, 40)} />
          </section>
        );
      })}

      <Callout title="Sólo aparece el titular de cada equipo">
        <p>
          Sin esa restricción, cualquier suplente que arrancó dos partidos hereda el volumen
          completo del equipo y aparece entre los mejores de la jornada — que es exactamente
          lo que hace inútil a un ranking semanal.
        </p>
        <p className="caption">
          No hay parte de lesiones: la titularidad se deduce del volumen reciente, y sólo
          cuentan los jugadores activos la temporada pasada.
        </p>
      </Callout>

      <h2>Qué esperar de esto</h2>
      <p>
        El modelo bate al baseline en las cuatro posiciones, y lo hace por dos décimas de
        punto de error. El fantasy semanal es, en su mayor parte, ruido; quien prometa más que
        esto no lo ha medido. La columna <strong>Emparejamiento</strong> es el ajuste por la
        defensa rival, corregido por la calidad de los ataques que ha enfrentado y aplicado
        amortiguado al 45%: es una señal real, pero mucho más pequeña de lo que se cuenta.
      </p>
      <p className="caption">
        La corrección más grande del desarrollo fue el quarterback: los intentos de pase de un
        equipo no son los de su quarterback, y sin descontar capturas y escapadas la posición
        salía un 28% alta.
      </p>
    </>
  );
}
