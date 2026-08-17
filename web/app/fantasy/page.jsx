import { model, num } from "../../data/model.js";
import { POSITIONS, PositionChip, VorCurve } from "../charts.jsx";
import { Callout, NoDataYet, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — board de draft",
  description:
    "Board global por valor sobre reemplazo y rankings por posición, con la curva de VOR que enseña dónde está el acantilado de cada puesto.",
};

const GLOBAL_COLUMNS = [
  { key: "overall_rank", label: "#" },
  { key: "player_name", label: "Jugador" },
  { key: "position", label: "Pos", format: (v) => <PositionChip position={v} /> },
  { key: "position_rank", label: "Pos #" },
  { key: "tier", label: "Tier" },
  { key: "projected_points", label: "Proyección", format: (v) => num(v, 1) },
  { key: "vor", label: "VOR", format: (v) => num(v, 1) },
];

// Dentro de una posición, la columna de posición sobra: todos comparten valor.
const POSITION_COLUMNS = GLOBAL_COLUMNS.filter((c) => c.key !== "position");

const VALIDATION_COLUMNS = [
  { key: "position", label: "Posición", format: (v) => <PositionChip position={v} /> },
  { key: "pearson", label: "Correlación", format: (v) => num(v, 2) },
  { key: "spearman", label: "Spearman", format: (v) => num(v, 2) },
  { key: "mae", label: "MAE (pts)", format: (v) => num(v, 0) },
];

/**
 * Marca la primera fila de cada tier para que el corte se vea sin leer la
 * columna. El hueco entre tiers es la información que importa de un board.
 */
function withTierBreaks(rows) {
  let previous = null;
  return rows.map((row) => {
    const start = previous !== null && row.tier !== previous;
    previous = row.tier;
    return { ...row, _rowClass: start ? "tier-start" : undefined };
  });
}

export default function Fantasy() {
  const fantasy = model.fantasy;

  if (!fantasy) {
    return (
      <>
        <h1>Board de draft</h1>
        <NoDataYet />
      </>
    );
  }

  const board = fantasy.board ?? [];

  return (
    <>
      <h1>Board de draft {fantasy.season}</h1>
      <p className="lede">
        Proyección de temporada completa a partir del volumen y la eficiencia de las tres
        últimas temporadas (ponderadas 56/30/14), encogidas hacia la media posicional según
        el tamaño de muestra y corregidas por la curva de edad de cada posición.
      </p>

      <ul className="jump">
        <li><a href="#global">Global</a></li>
        {POSITIONS.map((position) => (
          <li key={position}><a href={`#${position.toLowerCase()}`}>{position}</a></li>
        ))}
        <li><a href="#validacion">Validación</a></li>
      </ul>

      <h2>Dónde se acaba el valor en cada posición</h2>
      <VorCurve board={board} />

      <Callout title="El orden global es por VOR, no por puntos totales">
        <p>
          Comparar un quarterback con un running back por puntos totales no significa nada:
          el QB siempre gana y aun así se elige en la ronda 8. Lo que importa no es cuántos
          puntos hace un jugador, sino <strong>cuántos más que el que puedes conseguir gratis
          en su posición</strong>. Eso es el valor sobre reemplazo.
        </p>
        <p>
          Los tiers salen de los huecos reales en VOR, no de cortar la lista en trozos de
          doce. En las tablas, la línea gruesa marca dónde empieza un tier nuevo: si el
          jugador que quieres está justo antes de una, no puedes esperar otra ronda.
        </p>
      </Callout>

      <section id="global">
        <h2>Global</h2>
        <p className="caption">
          Las cuatro posiciones en una sola lista, ordenadas por VOR. Puntuación{" "}
          {fantasy.scoring}, liga de {fantasy.teams} equipos.
        </p>
        <Table columns={GLOBAL_COLUMNS} rows={withTierBreaks(board)} />
      </section>

      {POSITIONS.map((position) => {
        const group = board.filter((row) => row.position === position);
        if (group.length === 0) return null;
        return (
          <section key={position} id={position.toLowerCase()}>
            <h2>
              <PositionChip position={position} /> {position}
            </h2>
            <Table columns={POSITION_COLUMNS} rows={withTierBreaks(group)} />
          </section>
        );
      })}

      <section id="validacion">
        <h2>Validación</h2>
        <p className="caption">
          Proyección de pretemporada frente al resultado real, con cada temporada proyectada
          usando sólo lo anterior.
        </p>
        <Table columns={VALIDATION_COLUMNS} rows={fantasy.validation ?? []} />
        <p>
          Un Spearman alto aquí no significa adivinar la temporada: el conjunto incluye
          jugadores de muy poco volumen, y separar a un titular de un suplente es fácil. La
          parte difícil —ordenar bien a los veinte primeros de una posición— es mucho más
          ruidosa, y los rankings sirven sobre todo para{" "}
          <strong>no cometer errores grandes</strong>.
        </p>
      </section>

      <h2>Limitaciones</h2>
      <ul>
        <li>Los rookies no aparecen: sin partidos NFL no hay historial que proyectar.</li>
        <li>No hay parte de lesiones; el titular se deduce del volumen reciente.</li>
        <li>El reparto interno de un backfield nuevo se hereda del año anterior.</li>
        <li>
          Se proyectan 15,5 partidos para todos: el riesgo de lesión individual no está
          diferenciado.
        </li>
        <li>
          La curva de edad está implementada pero <strong>inactiva</strong>: falta conectar
          las fechas de nacimiento de los jugadores.
        </li>
      </ul>
    </>
  );
}
