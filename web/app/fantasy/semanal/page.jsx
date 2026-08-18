import { availabilityByPlayer, model, num } from "../../../data/model.js";
import { DeltaBars, POSITIONS, PositionChip } from "../../charts.jsx";
import {
  Callout, ImpactTag, MachineWritten, NoDataYet, RankTable, Sources,
} from "../../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — ranking semanal",
  description:
    "Ranking de fantasy global y por posición, construido sobre el guion de juego proyectado por el modelo de partidos.",
};

const COLUMNS = [
  { key: "projected_points", label: "Proyección", format: (v) => num(v, 1) },
  { key: "baseline_points", label: "Últimos 6", format: (v) => num(v, 1) },
  { key: "delta", label: "Dif.", format: (v) => (v > 0 ? `+${num(v, 1)}` : num(v, 1)) },
];

const POSITION_COLUMNS = COLUMNS.concat({
  key: "matchup_multiplier",
  label: "Empar.",
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

/** Renumera dentro de la lista que se enseña, para que la de WR empiece en 1. */
function numbered(rows) {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Jugadores con prensa reciente, para marcar su fila en la tabla. */
function playersWithNews(research) {
  const flagged = {};
  for (const item of research?.items ?? []) {
    for (const id of item.player_ids ?? []) flagged[id] = true;
  }
  return flagged;
}

/**
 * Por qué el modelo pone a cada jugador donde lo pone.
 *
 * Va debajo de la tabla y no dentro: la explicación es una frase, y una frase
 * dentro de una celda convierte una tabla que se lee de un vistazo en un muro.
 */
function WhyBlock({ rows, notes }) {
  const explained = rows.filter((row) => notes[row.player_id]);
  if (explained.length === 0) return null;
  return (
    <MachineWritten>
      {explained.map((row) => (
        <p className="why" key={row.player_id}>
          <strong>{row.player_name}</strong> — {notes[row.player_id]}
        </p>
      ))}
    </MachineWritten>
  );
}

/**
 * Noticias de la semana sobre jugadores de esta posición.
 *
 * **El modelo no las ha visto.** Aparecen aquí para que el ajuste lo haga quien
 * alinea: si un titular está lesionado, la proyección de arriba sigue contando
 * con él porque su única fuente es el historial de partidos jugados.
 */
function NewsBlock({ rows, research }) {
  const names = new Map(rows.map((row) => [row.player_id, row.player_name]));
  const related = (research?.items ?? [])
    .map((item) => ({
      ...item,
      // Quién de ESTA lista aparece en la noticia. Se resuelve con el nombre del
      // ranking y no con el de la fuente: si el titular dice «Ja'Marr Chase» y
      // la tabla de arriba dice «J.Chase», el lector tiene que poder unirlos.
      affected: (item.player_ids ?? []).map((id) => names.get(id)).filter(Boolean),
    }))
    .filter((item) => item.affected.length > 0);
  if (related.length === 0) return null;
  return (
    <div className="callout">
      <h3>Lo que el modelo no sabe</h3>
      <p className="caption">
        Prensa de los últimos días sobre jugadores de esta lista. No entra en la proyección:
        el ranking sale del historial de partidos, y una noticia de ayer no está en él.
      </p>
      {related.slice(0, 6).map((item, index) => (
        <div className="why" key={`${item.headline}-${index}`}>
          <p>
            <ImpactTag impact={item.impact} /> <strong>{item.affected.join(", ")}</strong> —{" "}
            {item.headline}
          </p>
          <Sources sources={item.sources} />
        </div>
      ))}
      <p className="caption">
        Todas las fichas, con su fecha y su fiabilidad, en <a href="/research">Research</a>.
      </p>
    </div>
  );
}

export default function Semanal() {
  const weekly = model.fantasy_weekly;
  const notes = model.narrative?.player_notes ?? {};
  const research = model.research;
  const newsByPlayer = playersWithNews(research);
  const availability = availabilityByPlayer(model.dossier);

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
    .map((row, index) => ({ ...row, rank: index + 1 }));

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
        <RankTable rows={rankings.slice(0, 60)} columns={COLUMNS}
                   notes={notes} news={newsByPlayer} availability={availability} />
      </section>

      {POSITIONS.map((position) => {
        const group = rankings.filter((row) => row.position === position);
        if (group.length === 0) return null;
        return (
          <section key={position} id={position.toLowerCase()}>
            <h2>
              <PositionChip position={position} /> {position}
            </h2>
            <RankTable rows={numbered(group.slice(0, 40))} columns={POSITION_COLUMNS}
                       notes={notes} news={newsByPlayer} availability={availability} />
            <WhyBlock rows={group.slice(0, 40)} notes={notes} />
            <NewsBlock rows={group} research={research} />
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
