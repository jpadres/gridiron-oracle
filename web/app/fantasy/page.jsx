import { model, num } from "../../data/model.js";
import { Callout, NoDataYet, Table } from "../ui.jsx";

export const metadata = {
  title: "Gridiron Oracle — board de draft",
  description: "Proyecciones de temporada ordenadas por valor sobre reemplazo, con tiers.",
};

const BOARD_COLUMNS = [
  { key: "overall_rank", label: "#" },
  { key: "player_name", label: "Jugador" },
  { key: "position", label: "Pos" },
  { key: "position_rank", label: "Pos #" },
  { key: "tier", label: "Tier" },
  { key: "projected_points", label: "Proyección", format: (v) => num(v, 1) },
  { key: "vor", label: "VOR", format: (v) => num(v, 1) },
];

const VALIDATION_COLUMNS = [
  { key: "position", label: "Posición" },
  { key: "pearson", label: "Correlación", format: (v) => num(v, 2) },
  { key: "spearman", label: "Spearman", format: (v) => num(v, 2) },
  { key: "mae", label: "MAE (pts)", format: (v) => num(v, 0) },
];

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

  return (
    <>
      <h1>Board de draft {fantasy.season}</h1>
      <p className="lede">
        Proyección de temporada completa a partir del volumen y la eficiencia de las tres
        últimas temporadas (ponderadas 56/30/14), encogidas hacia la media posicional según el
        tamaño de muestra y corregidas por la curva de edad de cada posición.
      </p>

      <Callout title="El orden es por VOR, no por puntos totales">
        <p>
          Comparar un quarterback con un running back por puntos totales no significa nada: el
          QB siempre gana y aun así se elige en la ronda 8. Lo que importa no es cuántos puntos
          hace un jugador, sino <strong>cuántos más que el que puedes conseguir gratis en su
          posición</strong>. Eso es el valor sobre reemplazo.
        </p>
        <p>
          Los tiers salen de los huecos reales en VOR, no de cortar la lista en trozos de doce.
          Un hueco grande dice «si no coges a uno de estos ahora, ya no hay»; una zona plana
          dice que puedes esperar una ronda entera.
        </p>
      </Callout>

      <p className="caption">
        Puntuación: {fantasy.scoring}. Liga de {fantasy.teams} equipos. Los touchdowns se
        encogen más que nada: son la estadística más ruidosa del fantasy y la que más engaña al
        mirar el año anterior.
      </p>

      <Table columns={BOARD_COLUMNS} rows={fantasy.board ?? []} />

      <h2>Validación</h2>
      <p className="caption">
        Proyección de pretemporada frente al resultado real, cada temporada proyectada usando
        sólo lo anterior.
      </p>
      <Table columns={VALIDATION_COLUMNS} rows={fantasy.validation ?? []} />
      <p>
        Un Spearman de ~0.55 está en línea con lo mejor que se publica — y aun así significa que
        <strong> una de cada tres parejas de jugadores termina en el orden contrario</strong>.
        Los rankings sirven para no cometer errores grandes, no para adivinar la temporada.
      </p>

      <h2>Limitaciones</h2>
      <ul>
        <li>Los rookies no aparecen: sin partidos NFL no hay historial que proyectar.</li>
        <li>No hay parte de lesiones; el titular se deduce del volumen reciente.</li>
        <li>El reparto interno de un backfield nuevo se hereda del año anterior.</li>
        <li>Se proyectan 15,5 partidos para todos: el riesgo de lesión individual no está
          diferenciado.</li>
      </ul>
    </>
  );
}
