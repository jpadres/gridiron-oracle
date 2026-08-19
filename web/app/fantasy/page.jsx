import { availabilityByPlayer, briefsByPlayer, model, num } from "../../data/model.js";
import { POSITIONS, PositionChip, VorCurve } from "../charts.jsx";
import DraftMode from "./DraftMode.jsx";
import { BustCell, Callout, NoDataYet, RankTable, Table } from "../ui.jsx";

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
  // Las dos columnas de riesgo van a la derecha de la proyección, no a su
  // izquierda: primero cuánto vale el jugador, después qué puede salir mal. Al
  // revés se lee como si el riesgo fuese el criterio de ordenación, y no lo es.
  { key: "p_bust", label: "Bust", format: (_v, row) => <BustCell row={row} /> },
  {
    key: "missed_games",
    label: "Falta",
    format: (v) => (v === null || v === undefined ? "—" : num(v, 1)),
  },
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

/**
 * Una columna de discrepancias con el consenso.
 *
 * Se enseña la posición en los dos boards y la diferencia, no sólo la
 * diferencia: «+106» sin saber de dónde a dónde no dice si es un debate entre
 * la ronda 3 y la 12 o entre la 14 y la 15.
 */
function GapList({ rows }) {
  return (
    <ol className="gap">
      {rows.map((row) => (
        <li key={row.player_id ?? row.player_name}>
          <span className="gap-who">
            <span className={`ptag ptag--${row.position.toLowerCase()}`}>{row.position}</span>
            <strong>{row.player_name}</strong> <span className="outlet">{row.team}</span>
          </span>
          <span className="gap-nums">
            <span className="outlet">
              aquí #{row.model_rank} · consenso #{row.consensus_rank}
            </span>
            <span className={row.gap > 0 ? "gap-up" : "gap-down"}>
              {row.gap > 0 ? `+${row.gap}` : row.gap}
            </span>
          </span>
          {row.analysis ? <span className="gap-note">{row.analysis}</span> : null}
        </li>
      ))}
    </ol>
  );
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
  const briefs = briefsByPlayer(model.dossier, model.research);
  const gap = model.dossier?.gap ?? [];
  const ambiguous = model.dossier?.ambiguous ?? [];

  return (
    <>
      <h1>Board de draft {fantasy.season}</h1>
      <p className="lede">
        Proyección de temporada completa a partir del volumen y la eficiencia de las tres
        últimas temporadas (ponderadas 56/30/14), encogidas hacia la media posicional según
        el tamaño de muestra y corregidas por la curva de edad de cada posición.
      </p>

      <ul className="jump">
        <li><a href="#draft-mode">Modo draft</a></li>
        <li><a href="#consenso">Consenso</a></li>
        <li><a href="#global">Global</a></li>
        {POSITIONS.map((position) => (
          <li key={position}><a href={`#${position.toLowerCase()}`}>{position}</a></li>
        ))}
        <li><a href="#bust">Riesgo</a></li>
        <li><a href="#validacion">Validación</a></li>
      </ul>

      <section id="draft-mode">
        <h2>Modo draft</h2>
        <p className="caption">
          La sugerencia es el mejor disponible por VOR <strong>corregido por lo que ya
          tienes</strong>: cada posición pierde valor para ti a medida que la llenas, porque tu
          quinto receptor no juega. Sin esa corrección un board te manda coger receptores toda
          la tarde, que es justo el error que debería evitarte.
        </p>
        <DraftMode board={board} />
      </section>

      {gap.length > 0 ? (
        <section id="consenso">
          <h2>Dónde este board se separa del consenso</h2>
          <p className="lede">
            Coincidir con el consenso no informa de nada: si los dos dicen lo mismo, daba igual
            cuál mirases. <strong>Toda la información está en el desacuerdo</strong>, y es
            también donde este board puede estar equivocado.
          </p>
          <div className="two-up">
            <div>
              <h3>El modelo los sube</h3>
              <p className="caption">Más alto aquí que en el consenso de expertos.</p>
              <GapList rows={gap.slice(0, 8)} />
            </div>
            <div>
              <h3>El modelo los baja</h3>
              <p className="caption">Más bajo aquí que en el consenso.</p>
              <GapList rows={[...gap].slice(-8).reverse()} />
            </div>
          </div>

          <Callout title="Los desacuerdos caen justo donde el modelo es ciego">
            <p>
              No son errores aleatorios, y por eso valen: <strong>cada bloque de discrepancia
              apunta a una limitación que ya está documentada abajo</strong>.
            </p>
            <ul>
              <li>
                <strong>Lesionados que el modelo sube.</strong> El consenso ya los ha bajado
                porque sabe del parte médico; el modelo proyecta sobre partidos jugados y no
                sabe nada. Aquí manda el consenso — mira su etiqueta de disponibilidad.
              </li>
              <li>
                <strong>Veteranos que el modelo sube.</strong> La curva de edad está
                implementada pero <strong>inactiva</strong>: faltan las fechas de nacimiento.
                Un ala cerrada de 36 años con buen historial sube más de lo que debería.
              </li>
              <li>
                <strong>Jóvenes que el modelo baja.</strong> Sin historial no hay proyección, y
                un segundo año con cambio de papel es justo lo que el modelo no puede ver. Aquí
                el consenso tiene información que estos datos no contienen.
              </li>
            </ul>
          </Callout>

          <p className="caption">
            {gap.length} de los {model.dossier?.consensus_size ?? 0} del consenso se emparejan
            con este board.
            {ambiguous.length > 0 ? (
              <>
                {" "}No se comparan {ambiguous.map((names) => names.join(" y ")).join("; ")}:
                comparten inicial, apellido y equipo, y el formato abreviado de nflverse no los
                distingue. Adivinar cuál es cuál produciría una discrepancia llamativa sobre el
                jugador equivocado.
              </>
            ) : null}
          </p>
        </section>
      ) : null}

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
          <strong>{fantasy.scoring}</strong>, liga de {fantasy.teams} equipos
          {fantasy.league ? (
            <> — sincronizada desde Sleeper: <strong>{fantasy.league}</strong>.</>
          ) : (
            <>. <strong>Supuesta</strong>, no sincronizada: si tu liga puntúa distinto, este
            orden no es el tuyo — la puntuación cambia el ranking, no sólo los puntos.</>
          )}
        </p>
        <RankTable rows={numbered(board)} columns={BOARD_COLUMNS}
                   availability={availability} briefs={briefs} risk tiers />
      </section>

      {POSITIONS.map((position) => {
        const group = board.filter((row) => row.position === position);
        if (group.length === 0) return null;
        return (
          <section key={position} id={position.toLowerCase()}>
            <h2>
              <PositionChip position={position} /> {position}
            </h2>
            <RankTable rows={numbered(group)} columns={BOARD_COLUMNS}
                       availability={availability} briefs={briefs} risk tiers />
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

      <section id="bust">
        <h2>Las dos columnas de riesgo: «Bust» y «Falta»</h2>
        <p>
          <strong>Bust</strong> es la probabilidad de que ese jugador termine la temporada{" "}
          <strong>por debajo del 70% de su proyección</strong>. No es «cuánto puede variar»:
          una proyección puede fallar hacia arriba y eso es una alegría, no un riesgo. Mide
          sólo la cola de abajo, que es la pregunta que se hace de verdad en un draft.
        </p>
        <p>
          El corte del 70% y los umbrales de aceptación se fijaron{" "}
          <strong>antes de medir nada</strong>, y están escritos en{" "}
          <code>docs/PREREGISTRO_riesgo.md</code>. Sobre 1.865 jugador-temporadas de 2016 a
          2025, cada una estimada sólo con las anteriores: el error de calibración es{" "}
          <strong>0,043</strong> y el decil de más riesgo bustea{" "}
          <strong>5,5 veces más</strong> que el de menos —91% frente a 17%—. La tasa base del
          board es del <strong>43%</strong>, que ya es el dato más útil de esta sección:{" "}
          <strong>cuatro de cada diez elecciones de draft se quedan cortas</strong>, y eso
          incluye las buenas.
        </p>
        <p>
          <strong>Falta</strong> son los partidos que se espera que se pierda de 17, a partir
          de su historial de ausencias ponderado 56/30/14 y encogido por tamaño de muestra.
        </p>

        <Callout title="«Falta» no es un parte médico, y la diferencia importa">
          <p>
            Mide en cuántos partidos de su equipo el jugador{" "}
            <strong>no aparece en los datos</strong>. Puede ser una lesión, pero también ser
            suplente, estar inactivo o cumplir una sanción, y estos datos{" "}
            <strong>no los distinguen</strong>. La etiqueta de disponibilidad que sale al lado
            del nombre sí viene de un parte real —del dossier, con su fuente y su fecha— y es
            la que manda si las dos se contradicen.
          </p>
          <p>
            Sobre todos los jugadores con historial la señal parece enorme, Spearman{" "}
            <strong>+0,48</strong>. Casi toda es un espejismo:{" "}
            <strong>mide que los suplentes siguen siendo suplentes</strong>. Restringiendo a
            titulares con 16 o más partidos el año anterior se cae a <strong>+0,09</strong>.
          </p>
          <p>
            El número honesto es el de la población donde se publica —los 250 del board—:{" "}
            <strong>+0,24</strong>, con el tercio de arriba perdiendo el{" "}
            <strong>32,9%</strong> de los partidos frente al <strong>18,1%</strong> del de
            abajo. Eso son unos 5,6 partidos contra 3. Es real, es útil para desempatar, y no
            es una bola de cristal.
          </p>
        </Callout>
      </section>

      <section id="riesgo">
        <h2>La etiqueta de volatilidad, y cuánto vale</h2>
        <p>
          <strong>Estable</strong> y <strong>Volátil</strong> son dos palabras muy fáciles de
          inventarse, así que aquí salen de tres cantidades medidas y{" "}
          <strong>están validadas contra el error realizado</strong>: el tamaño de muestra
          detrás de la proyección, cuánto tuvo que encoger el modelo la tasa bruta del jugador
          —el encogimiento es proporcional a la desconfianza— y qué parte de sus puntos vienen
          de touchdowns, que es la estadística más ruidosa del fantasy.
        </p>
        <p>
          Sobre 1914 jugador-temporadas de 2022 a 2025, proyectando cada una sólo con lo
          anterior: la correlación entre riesgo y error absoluto es{" "}
          <strong>+0,20</strong> y el tercio más volátil se equivoca un{" "}
          <strong>21% más</strong> que el tercio estable. Positivo en las cuatro posiciones, y
          más fuerte en quarterback (+0,45).
        </p>
        <p className="caption">
          Es una señal real y <strong>pequeña</strong>. Ordena a quién mirar con lupa, no
          decide un draft: un «Volátil» con cien puntos más de proyección sigue siendo mejor
          elección que un «Estable» sin ellos. La etiqueta se compara{" "}
          <em>dentro de cada posición</em>, porque las escalas de error de las cuatro se
          diferencian en un factor de tres. La edad no entra: el acantilado del corredor es
          real, pero las fechas de nacimiento no están conectadas y meterla a medias sería peor
          que no meterla.
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
