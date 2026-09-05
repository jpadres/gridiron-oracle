/**
 * SIMULACIÓN COMPLETA DE DRAFT, sin navegador.
 *
 * Se draftea un draft entero contra el board REAL siguiendo la recomendación
 * con contexto de plantilla, y se comprueban las propiedades que tienen que
 * cumplirse en TODOS los turnos, no en uno elegido a mano:
 *
 *   · ningún jugador repetido, en mi equipo ni en el de nadie;
 *   · ningún reparto de huecos imposible;
 *   · con el hueco de una posición lleno, esa posición deja de encabezar
 *     mientras quede otra que sí mejore la alineación;
 *   · en superflex el segundo quarterback SIGUE mejorando, con la misma regla;
 *   · los huecos de pateador y defensa se avisan antes de que se acabe;
 *   · la alineación titular se puede completar.
 *
 * Es un guardián, no una demostración de calidad: que la recomendación sea
 * BUENA no está medido, y este fichero no lo mide. Comprueba que es COHERENTE.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));  // .../web
const { model } = await import(path.join(WEB, "data/model.js"));
const { bestForMe, candidates } = await import(path.join(WEB, "app/fantasy/candidates.js"));
const { POSITION_STATE, assignSlotsSafe, replacementPoints, starterState } =
  await import(path.join(WEB, "app/fantasy/rosterFit.js"));

const BOARD = model.fantasy.board;
const REP = replacementPoints(BOARD);
let fallos = 0;
const check = (n, ok, d = "") => {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${n}${d ? ` — ${d}` : ""}`);
};

const NORMAL = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K",
                "BN", "BN", "BN", "BN", "BN", "BN"];
const SUPERFLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF", "K",
                   "BN", "BN", "BN", "BN", "BN"];
// La liga de 32 del repositorio: sin huecos dedicados de RB/WR más allá de uno,
// tres flexibles y un superflex. NO se le aplican supuestos de liga normal.
const TREINTAYDOS = ["RB", "WR", "FLEX", "FLEX", "FLEX", "SUPER_FLEX",
                     "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN", "BN"];

/** Un draft entero. Los rivales cogen el mejor del board; yo, mi recomendación. */
function simular({ nombre, roster, teams, rounds, mySlot }) {
  console.log(`\n=== ${nombre} · ${teams} equipos × ${rounds} rondas, puesto ${mySlot} ===`);
  const tomados = new Set();
  const mio = [];
  const turnos = [];
  const total = teams * rounds;

  for (let overall = 1; overall <= total; overall += 1) {
    const ronda = Math.floor((overall - 1) / teams) + 1;
    const enRonda = ((overall - 1) % teams) + 1;
    const puesto = ronda % 2 === 0 ? teams - enRonda + 1 : enRonda;
    const disponibles = BOARD.filter((r) => !tomados.has(r.player_id));

    if (puesto !== mySlot) {
      // Rival: el mejor del board, que es lo más adverso para mí.
      const suyo = candidates(disponibles, { limit: 1 })[0]?.row ?? disponibles[0];
      if (suyo) tomados.add(suyo.player_id);
      continue;
    }

    const picksRestantes = rounds - ronda + 1;
    const board = candidates(disponibles, { limit: 4 });
    const para = bestForMe(disponibles, {
      roster: mio, rosterPositions: roster, replacement: REP,
      picksLeftForMe: picksRestantes,
    });
    /* Qué cojo. Con recomendación, la recomendación. Sin ella —nadie mejora la
       alineación— lo que el producto ofrece para el banquillo, que es el board
       menos quien no puede llegar a alinearse nunca. Caer al board a secas era
       lo que hacía que esta simulación acabara con CUATRO alas cerradas: el
       fallo estaba en el simulador, pero destapó que al producto le faltaba
       esa lista. */
    const elegido = para?.primary?.row ?? para?.bench?.[0]?.row ?? board[0]?.row ?? disponibles[0];
    const estado = starterState({ roster: mio, rosterPositions: roster });
    turnos.push({
      overall, ronda, picksRestantes,
      antes: mio.map((r) => r.position).join(","),
      abiertos: estado.open.map((s) => s.slot).join(","),
      mejorBoard: board[0] ? `${board[0].row.position} ${board[0].row.player_name}` : "—",
      paraMi: para?.primary
        ? `${para.primary.row.position} ${para.primary.row.player_name} (+${para.primary.fit.marginal.toFixed(0)})`
        : "— banquillo",
      porque: para?.primary?.reasons.map((r) => r.text).join(" · ") ?? "",
      urgeEspecialista: Boolean(para?.mustFillSpecialist),
      // ¿El primero del banquillo puede todavía alinearse? `null` si no hay
      // banquillo que juzgar; `benchTodosLlenos` cuando NINGUNO puede, que es
      // un estado legítimo y no un fallo de orden.
      benchPrimero: para?.bench?.length ? Boolean(para.bench[0].canStart) : null,
      benchTodosLlenos: Boolean(para?.bench?.length) && para.bench.every((b) => !b.canStart),
      elegido: elegido ? `${elegido.position} ${elegido.player_name}` : "—",
      estadoPos: { ...estado.byPosition },
    });
    if (elegido) { tomados.add(elegido.player_id); mio.push(elegido); }
  }
  return { turnos, mio, tomados };
}

/* ── liga normal de 12 ───────────────────────────────────────────────────── */
{
  const { turnos, mio } = simular({
    nombre: "Normal 1QB", roster: NORMAL, teams: 12, rounds: 15, mySlot: 3,
  });
  for (const t of turnos) {
    console.log(`   R${String(t.ronda).padStart(2)} board:${t.mejorBoard.padEnd(26)} `
      + `para mí:${t.paraMi.padEnd(30)} elijo:${t.elegido.padEnd(22)} ${t.porque.slice(0, 40)}`);
  }
  check("ningún jugador repetido en mi equipo",
        new Set(mio.map((r) => r.player_id)).size === mio.length, `${mio.length} picks`);
  check("todos mis turnos tuvieron recomendación o dijeron banquillo",
        turnos.every((t) => t.paraMi.length > 0), `${turnos.length} turnos`);

  // LA PROPIEDAD DEL FALLO: en cuanto una posición queda SATURADA, no puede
  // encabezar mientras haya otra que sí mejore.
  const malos = turnos.filter((t) => {
    const pos = t.paraMi.split(" ")[0];
    return t.estadoPos[pos] === POSITION_STATE.STARTER_FILLED;
  });
  check("ninguna recomendación encabeza con una posición SATURADA",
        malos.length === 0, malos.map((t) => `R${t.ronda} ${t.paraMi}`).join(" | "));

  /* Lo que se comprueba es lo que el PRODUCTO garantiza, y la frontera está en
     el turno donde la alineación titular se completa. Hasta ahí manda la
     recomendación y no puede acumular una posición que ya no puede alinear.
     A partir de ahí es banquillo, y el banquillo es orden del board con una
     preferencia declarada — que alguien se lleve un tercer ala cerrada de
     reserva es una decisión suya, no un fallo del motor. */
  const hastaCompletar = turnos.filter((t) => t.paraMi !== "— banquillo");
  const posRecomendadas = hastaCompletar.map((t) => t.paraMi.split(" ")[0]);
  const cuenta = (p) => posRecomendadas.filter((x) => x === p).length;
  check("mientras hay huecos, en 1QB no recomienda un segundo quarterback",
        cuenta("QB") <= 1, `${cuenta("QB")} veces`);
  check("ni un segundo ala cerrada", cuenta("TE") <= 1, `${cuenta("TE")} veces`);
  check("y las recomendaciones llenaron huecos hasta completar la alineación",
        hastaCompletar.length >= 6, `${hastaCompletar.length} turnos con recomendación`);
  const estadoFinal = starterState({ roster: mio, rosterPositions: NORMAL });
  const huecosSkill = estadoFinal.open.filter(
    (s) => !s.eligible.every((p) => p === "K" || p === "DST" || p === "DEF")
  );
  check("la alineación titular de posiciones con valor se completa",
        huecosSkill.length === 0, huecosSkill.map((s) => s.slot).join(","));
  check("en el banquillo, quien AÚN puede alinearse va antes que quien no",
        turnos.filter((t) => t.benchPrimero !== null)
          .every((t) => t.benchPrimero === true || t.benchTodosLlenos),
        "");
  const aviso = turnos.filter((t) => t.urgeEspecialista);
  check("el hueco de pateador/defensa se avisa antes del final",
        aviso.length > 0, aviso.length ? `avisa desde la ronda ${aviso[0].ronda}` : "nunca avisó");
}

/* ── superflex ───────────────────────────────────────────────────────────── */
{
  const { turnos, mio } = simular({
    nombre: "Superflex", roster: SUPERFLEX, teams: 12, rounds: 15, mySlot: 3,
  });
  const qb = mio.filter((r) => r.position === "QB").length;
  check("en superflex SÍ acumula dos quarterbacks", qb >= 2, `${qb} QB`);
  const conQb = turnos.filter((t) => t.paraMi.startsWith("QB"));
  check("y el segundo QB llegó a encabezar la recomendación",
        conQb.length >= 2, `${conQb.length} turnos encabezados por QB`);
  const malos = turnos.filter((t) => {
    const pos = t.paraMi.split(" ")[0];
    return t.estadoPos[pos] === POSITION_STATE.STARTER_FILLED;
  });
  check("y sigue sin encabezar con una posición saturada", malos.length === 0);
}

/* ── la liga de 32 ───────────────────────────────────────────────────────── */
{
  const { turnos, mio } = simular({
    nombre: "32 equipos, 3 FLEX + SUPER_FLEX", roster: TREINTAYDOS,
    teams: 32, rounds: 15, mySlot: 17,
  });
  const estado = starterState({ roster: mio, rosterPositions: TREINTAYDOS });
  check("con 32 equipos la estructura sigue siendo la SUYA, no la normal",
        estado.slots.length === 6, `${estado.slots.length} huecos titulares`);
  check("y sus seis huecos titulares se llenan",
        estado.open.length === 0, estado.open.map((s) => s.slot).join(","));
  check("ningún turno se quedó sin decidir",
        turnos.every((t) => t.elegido !== "—"), `${turnos.length} turnos`);
}

console.log(fallos === 0 ? "\nSIN FALLOS" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
