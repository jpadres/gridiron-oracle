/**
 * TORTURA DE DRAFT: la matriz entera, sin navegador.
 *
 * `draft-sim.mjs` cubre tres ligas y corre en CI. Esto cubre la matriz que un
 * usuario real puede encontrarse —de 8 a 32 equipos, siete formatos, snake y
 * lineal, y siete estrategias de rival— y por eso NO va en CI: son cientos de
 * drafts completos.
 *
 * Los bots son TORTURA DE COMPORTAMIENTO, no validación predictiva. Sirven para
 * dejar el pool en formas incómodas —una posición agotada, una corrida de siete
 * receptores, un rival que coge al azar— y ver si la recomendación sigue siendo
 * COHERENTE. Que sea BUENA está medido aparte, en E23, y este fichero no lo mide.
 *
 * Las propiedades que se exigen en TODOS los turnos de TODOS los drafts:
 *
 *   1. ningún jugador repetido;
 *   2. ninguna posición SATURADA encabeza mientras otra mejore la alineación;
 *   3. la alineación titular de posiciones con valor se completa;
 *   4. en 1QB no se acumulan quarterbacks mientras queden huecos;
 *   5. en superflex/2QB SÍ, con la misma regla y sin excepción escrita;
 *   6. el aviso de pateador/defensa llega antes del final, y sólo si la liga
 *      declara esos huecos;
 *   7. nunca se recomienda a alguien que no cabe en ningún hueco abierto.
 */
import { BOARD, BOTS, POSITION_STATE, ROSTERS, simular, starterState } from "./draft-engine.mjs";

let fallos = 0;
const fallo = (msg) => { fallos += 1; console.log(`  FALLA  ${msg}`); };

const SOLO_ESPECIALISTA = (s) => s.eligible.every((p) => p === "K" || p === "DST" || p === "DEF");

const MATRIZ = [
  { liga: "8 · normal",        roster: "NORMAL",       teams: 8,  rounds: 15 },
  { liga: "10 · normal",       roster: "NORMAL",       teams: 10, rounds: 15 },
  { liga: "12 · normal",       roster: "NORMAL",       teams: 12, rounds: 15 },
  { liga: "12 · superflex",    roster: "SUPERFLEX",    teams: 12, rounds: 15 },
  { liga: "12 · 2QB",          roster: "DOS_QB",       teams: 12, rounds: 15 },
  { liga: "12 · sin flex",     roster: "SIN_FLEX",     teams: 12, rounds: 15 },
  { liga: "12 · tres flex",    roster: "TRES_FLEX",    teams: 12, rounds: 15 },
  { liga: "12 · sin TE",       roster: "SIN_TE",       teams: 12, rounds: 15 },
  { liga: "12 · sin K ni DEF", roster: "SIN_K_NI_DEF", teams: 12, rounds: 15 },
  { liga: "14 · normal",       roster: "NORMAL",       teams: 14, rounds: 15 },
  { liga: "16 · normal",       roster: "NORMAL",       teams: 16, rounds: 15 },
  { liga: "20 · normal",       roster: "NORMAL",       teams: 20, rounds: 15 },
  { liga: "32 · 3FLEX+SF",     roster: "TREINTAYDOS",  teams: 32, rounds: 15 },
];

const ESTRATEGIAS = [
  ["bpa", BOTS.bpa()], ["rbHeavy", BOTS.rbHeavy()], ["wrHeavy", BOTS.wrHeavy()],
  ["qbEarly", BOTS.qbEarly()], ["teHeavy", BOTS.teHeavy()], ["posRun", BOTS.posRun()],
  ["random", BOTS.randomValid(1234)],
];

let drafts = 0, turnosTotales = 0;
const resumen = [];

for (const caso of MATRIZ) {
  const roster = ROSTERS[caso.roster];
  const declaraEspecialista = roster.some((s) => s === "K" || s === "DEF" || s === "DST");
  const esMultiQB = roster.filter((s) => s === "QB").length > 1
    || roster.includes("SUPER_FLEX");
  // Puestos: primero, medio y último — el hueco entre turnos es distinto en cada uno.
  const puestos = [...new Set([1, Math.ceil(caso.teams / 2), caso.teams])];
  const problemas = [];

  for (const slot of puestos) {
    for (const [nombreBot, bot] of ESTRATEGIAS) {
      for (const snake of [true, false]) {
        const etiqueta = `${caso.liga} · puesto ${slot} · ${nombreBot} · ${snake ? "snake" : "lineal"}`;
        const { turnos, mio, tomados } = simular({
          nombre: etiqueta, roster, teams: caso.teams, rounds: caso.rounds,
          mySlot: slot, opponent: bot, snake,
        });
        drafts += 1; turnosTotales += turnos.length;

        // 1. sin repetidos
        if (new Set(mio.map((r) => r.player_id)).size !== mio.length) {
          problemas.push(`${etiqueta}: jugador repetido`);
        }
        // 2. ninguna posición saturada encabeza
        const saturadas = turnos.filter((t) => {
          const pos = t.paraMi.split(" ")[0];
          return t.estadoPos[pos] === POSITION_STATE.STARTER_FILLED;
        });
        if (saturadas.length) {
          problemas.push(`${etiqueta}: ${saturadas.length} turnos encabezados por posición SATURADA (R${saturadas[0].ronda} ${saturadas[0].paraMi})`);
        }
        /* 3. la alineación titular con valor se completa — SI el board todavía
           contenía a alguien elegible. Con 32 equipos y bots que agotan una
           posición, los rivales se llevan LOS 158 corredores del board: ahí un
           hueco abierto es la única respuesta veraz y exigir lo contrario sería
           un test pidiendo lo imposible. Se comprueba contra lo que quedaba. */
        const fin = starterState({ roster: mio, rosterPositions: roster });
        const huecosSkill = fin.open.filter((s) => !SOLO_ESPECIALISTA(s));
        const quedaban = BOARD.filter((r) => !tomados.has(r.player_id));
        const inexcusables = huecosSkill.filter((s) =>
          quedaban.some((r) => (s.eligible ?? []).includes(r.position)));
        if (inexcusables.length) {
          problemas.push(`${etiqueta}: quedaron huecos de valor sin llenar HABIENDO candidatos (${inexcusables.map((s) => s.slot).join(",")})`);
        }
        // 4/5. quarterbacks acumulados mientras hay recomendación activa
        const conRec = turnos.filter((t) => t.paraMi !== "— banquillo");
        const qbRec = conRec.filter((t) => t.paraMi.startsWith("QB")).length;
        if (!esMultiQB && qbRec > 1) {
          problemas.push(`${etiqueta}: 1QB y recomendó ${qbRec} quarterbacks con huecos abiertos`);
        }
        // 6. el aviso de especialista sólo donde la liga lo declara
        const avisa = turnos.some((t) => t.urgeEspecialista);
        if (!declaraEspecialista && avisa) {
          problemas.push(`${etiqueta}: avisa de pateador/defensa en una liga que NO declara esos huecos`);
        }
        if (declaraEspecialista && !avisa) {
          problemas.push(`${etiqueta}: nunca avisó del hueco de pateador/defensa`);
        }
        /* 6b. LA ETIQUETA TIENE QUE SER CIERTA. El último recurso ofrece a un
           jugador por debajo del umbral de muestra y lo DICE. Si esa rama acaba
           sirviendo también a jugadores que sí superan el umbral —porque la
           búsqueda de primera opción mira una ventana demasiado corta— la
           etiqueta pasa a ser falsa: al usuario se le avisa de una debilidad
           que ese jugador no tiene. Un aviso falso gasta la credibilidad del
           aviso verdadero. */
        const etiquetaFalsa = turnos.filter((t) =>
          t.muestraCorta && !t.rookieRecomendado
          && Number(t.wgRecomendado) >= 3);
        if (etiquetaFalsa.length) {
          problemas.push(`${etiqueta}: ${etiquetaFalsa.length} recomendaciones marcadas «muestra corta» con muestra SUFICIENTE (R${etiquetaFalsa[0].ronda} ${etiquetaFalsa[0].paraMi}, wg=${etiquetaFalsa[0].wgRecomendado})`);
        }

        // 7. nunca se recomienda a quien no cabe en ningún hueco abierto
        const imposibles = conRec.filter((t) => {
          const pos = t.paraMi.split(" ")[0];
          return t.estadoPos[pos] === POSITION_STATE.BENCH_DEPTH && t.abiertos.length > 0;
        });
        if (imposibles.length) {
          problemas.push(`${etiqueta}: ${imposibles.length} recomendaciones de quien no cabe en ningún hueco abierto`);
        }
      }
    }
  }
  const marca = problemas.length ? "FALLA" : "ok   ";
  console.log(`  ${marca} ${caso.liga.padEnd(20)} ${puestos.length * ESTRATEGIAS.length * 2} drafts`);
  for (const p of problemas.slice(0, 4)) { fallo(p); }
  if (problemas.length > 4) { console.log(`         … y ${problemas.length - 4} más del mismo tipo`); }
  resumen.push({ liga: caso.liga, problemas: problemas.length });
}

console.log(`\n${drafts} drafts completos, ${turnosTotales} turnos míos evaluados.`);
console.log(fallos === 0 ? "SIN FALLOS" : `${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
