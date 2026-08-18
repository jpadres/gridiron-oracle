import { availabilityByPlayer, model, num } from "../../data/model.js";
import { POSITIONS, PositionChip, VorCurve } from "../charts.jsx";
import { Callout, NoDataYet, RankTable, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — board de draft",
  description:
    "Board global por valor sobre reemplazo y rankings por posición, con la curva de VOR que enseña dónde está el acantilado de cada puesto.",
};

// Sólo números comparables: el nombre, la posición y el equipo van apilados en
// la celda del jugador, que es donde se leen juntos.
const BOARD_COLUMNS = [
  { key: "projected_points", label: "Proyección", format: (v) => num(v, 1) },
  { key: "vor", label: "VOR", format: (v) => num(v, 1) },
];

const VALIDATION_COLUMNS = [
  { key: "position", label: "Posición", format: (v) => <PositionChip position={v} /> },
  { key: "pearson", label: "Correlación", format: (v) => num(v, 2) },
  { key: "spearman", label: "Spearman", format: (v) => num(v, 2) },
  { key: "mae", label: "MAE (pts)", format: (v) => num(v, 0) },
];

/**
 * Numera dentro de la lista que se está enseñando.
 *
 * En el global el número es el orden global; dentro de una posición es el
 * orden de esa posición. Reusar `overall_rank` en la lista de receptores daría
 * un «#47» en la primera fila, que es exactamente la clase de detalle que hace
 * dudar de todo lo demás.
 */
function numbered(rows) {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
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
  const availability = availabilityByPlayer(model.dossier);

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
          doce. En las tablas, cada tier abre con su propia banda: si el jugador que quieres
          es el último de un tier, no puedes esperar otra ronda.
        </p>
      </Callout>

      <section id="global">
        <h2>Global</h2>
        <p className="caption">
          Las cuatro posiciones en una sola lista, ordenadas por VOR. Puntuación{" "}
          {fantasy.scoring}, liga de {fantasy.teams} equipos.
        </p>
        <RankTable rows={numbered(board)} columns={BOARD_COLUMNS} availability={availability} tiers />
      </section>

      {POSITIONS.map((position) => {
        const group = board.filter((row) => row.position === position);
        if (group.length === 0) return null;
        return (
          <section key={position} id={position.toLowerCase()}>
            <h2>
              <PositionChip position={position} /> {position}
            </h2>
            <RankTable rows={numbered(group)} columns={BOARD_COLUMNS} availability={availability} tiers />
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
        <li>
          <strong>La proyección no descuenta lesiones.</strong> Sale del historial de
          partidos y cuenta con el jugador aunque esté descartado. La etiqueta de
          disponibilidad al lado del nombre viene del dossier y es un dato{" "}
          <em>paralelo</em>: no toca el número de la derecha, lo contradice cuando toca.
        </li>
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
