import { model, num } from "../../../data/model.js";
import { Callout, NoDataYet, Table } from "../../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — ranking semanal",
  description: "Ranking de fantasy por posición, construido sobre el guion de juego proyectado.",
};

const POSITIONS = ["QB", "RB", "WR", "TE"];

const COLUMNS = [
  { key: "position_rank", label: "#" },
  { key: "player_name", label: "Jugador" },
  { key: "team", label: "Equipo" },
  { key: "opponent", label: "Rival" },
  { key: "projected_points", label: "Proyección", format: (v) => num(v, 1) },
  { key: "baseline_points", label: "Últimos 6", format: (v) => num(v, 1) },
  { key: "matchup_multiplier", label: "Emparejamiento", format: (v) => num(v, 2) },
];

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

  const rankings = weekly.rankings ?? [];

  return (
    <>
      <h1>
        Ranking semanal — {weekly.season}, semana {weekly.week}
      </h1>
      <p className="lede">
        El puente con el modelo de partidos es el guion de juego: el margen y el total
        proyectados determinan cuántas jugadas tendrá cada equipo y de qué tipo. Un receptor con
        un 26% de target share en un partido que se proyecta 17-27 en contra vale más que en uno
        28-17 a favor, porque el equipo que va perdiendo lanza más.
      </p>

      <Callout title="Sólo aparece el titular de cada equipo">
        <p>
          Sin esa restricción, cualquier suplente que arrancó dos partidos hereda el volumen
          completo del equipo y aparece entre los mejores de la jornada — que es exactamente lo
          que hace inútil a un ranking semanal.
        </p>
        <p className="caption">
          No hay parte de lesiones: la titularidad se deduce del volumen reciente.
        </p>
      </Callout>

      <p className="caption">
        La columna <strong>Últimos 6</strong> es el listón contra el que se valida el modelo: la
        media ponderada de los seis últimos partidos del jugador, que cualquiera calcula en dos
        minutos. El <strong>Emparejamiento</strong> es el ajuste por la defensa rival, corregido
        por la calidad de los ataques que ha enfrentado y aplicado amortiguado al 45% — es una
        señal real, pero mucho más pequeña y ruidosa de lo que se cuenta por ahí.
      </p>

      {POSITIONS.map((position) => {
        const group = rankings.filter((row) => row.position === position);
        if (group.length === 0) return null;
        return (
          <section key={position}>
            <h2>{position}</h2>
            <Table columns={COLUMNS} rows={group.slice(0, 40)} />
          </section>
        );
      })}

      <h2>Qué esperar de esto</h2>
      <p>
        El modelo bate al baseline en las cuatro posiciones, y lo hace por dos décimas de punto
        de error. El fantasy semanal es, en su mayor parte, ruido; quien prometa más que esto no
        lo ha medido. La calibración se ajustó con 2022-2023 y se evaluó sin tocarla sobre
        2024-2025.
      </p>
      <p className="caption">
        La corrección más grande del desarrollo fue el quarterback: los intentos de pase de un
        equipo no son los de su quarterback, y sin descontar capturas y escapadas la posición
        salía un 28% alta.
      </p>
    </>
  );
}
