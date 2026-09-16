/**
 * WAIVERS: ADD + DROP, y la plantilla ANTES y DESPUÉS.
 *
 *     UN BUEN AGENTE LIBRE NO ES UN BUEN MOVIMIENTO DE WAIVERS.
 *     LO QUE DECIDE ES LA RESTA: LO QUE ENTRA MENOS LO QUE SALE.
 *
 * ## Por qué no basta con «ADD Player X»
 *
 * Una plantilla llena obliga a cortar a alguien. Si el que hay que cortar vale
 * más que el que entra, el movimiento EMPEORA tu equipo aunque el agente libre
 * sea bueno en abstracto. Por eso aquí no existe una recomendación sin su
 * pareja: cada candidato viene con el corte que menos cuesta y con el efecto
 * neto sobre tu alineación.
 *
 * ## No hay ninguna constante nueva en este fichero
 *
 * Es la misma propiedad que sostiene `rosterFit.js` (regla 6d) y se comprueba
 * igual: el valor de un movimiento es
 *
 *     neto = alineación(plantilla − Y + X) − alineación(plantilla)
 *
 * con `lineupFloor`, que es el MISMO repartidor del board, del Draft Room y del
 * analizador. No hay pesos, no hay multiplicador de necesidad y no hay nota del
 * 1 al 100. Si algún día aparece un `waiverScore: 73`, alguien volvió a
 * disfrazar una convención de medición — exactamente lo que la regla 6e prohíbe.
 *
 * ## Las categorías salen de HECHOS, y las que no se pueden comprobar no se
 * escriben
 *
 * `IMMEDIATE_STARTER` se afirma porque el repartidor mete al jugador en un hueco
 * titular que estaba VACÍO, no porque suene bien. `INJURY_REPLACEMENT` exige que
 * el parte OFICIAL dé OUT a alguien de tu plantilla en esa posición. Y hay
 * categorías del encargo que este fichero NO emite a propósito:
 *
 *   - `HANDCUFF` necesita saber que X es el suplente directo de alguien tuyo.
 *     Eso lo dice el depth chart y hoy no viaja al payload por jugador, así que
 *     afirmarlo sería adivinarlo.
 *   - `SHORT_TERM_STREAM` y `LONGER_TERM_HOLD` necesitan fuerza de calendario
 *     futura, que en este proyecto no está validada para ordenar nada.
 *
 * Una categoría que no se puede sostener con un hecho no se reparte. Es más
 * corto y es cierto.
 */

import { assignSlots } from "./leagueValue.js";
import { lineupFloor, replacementPoints } from "./rosterFit.js";

/** Huecos que NO son de titular: quien cae aquí no suma a la alineación de hoy. */
const BANQUILLO = new Set(["BN", "BE", "IR", "TAXI"]);

/**
 * Cuántos candidatos se evalúan. Igual que en `candidates.js`: la ventana acota
 * cuánto se ORDENA, no si existe alguien elegible. Con la plantilla llena el que
 * de verdad te sirve puede estar en el puesto cuarenta.
 */
export const WAIVER_WINDOW = 60;

/** Los estados de un movimiento. Ninguno es un número. */
export const MOVE = Object.freeze({
  IMMEDIATE_STARTER: "IMMEDIATE_STARTER",
  STARTER_UPGRADE: "STARTER_UPGRADE",
  FLEX_UPGRADE: "FLEX_UPGRADE",
  INJURY_REPLACEMENT: "INJURY_REPLACEMENT",
  BYE_COVER: "BYE_COVER",
  BENCH_DEPTH: "BENCH_DEPTH",
});

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) && x !== null && x !== "" && !Array.isArray(x) ? n : null;
};

const pos = (row) => String(row?.position ?? "").toUpperCase();

/** ¿El parte OFICIAL o la marca de estado dan a este jugador fuera? */
function estaFuera(row) {
  if (String(row?.injury_designation ?? "") === "OUT") return true;
  return row?.status_severity === "OUT" && row?.status_disputed !== true;
}

/**
 * Los huecos titulares que ocupa una plantilla, y cuáles quedan vacíos.
 *
 * Se le pregunta al MISMO repartidor que usa todo lo demás. Derivarlo aquí por
 * mi cuenta sería una segunda definición de «quién es titular».
 */
export function slotPicture({ roster, rosterPositions }) {
  const slots = (rosterPositions ?? [])
    .map((s) => String(s).toUpperCase().trim())
    .filter((s) => !BANQUILLO.has(s));
  if (slots.length === 0) return null;
  const { slots: repartidos } = assignSlots(roster ?? [], slots);
  return {
    slots: repartidos,
    empty: repartidos.filter((e) => !e.player).map((e) => e.slot),
    filled: repartidos.filter((e) => e.player),
  };
}

/**
 * A quién se puede cortar, y a quién NO.
 *
 * No se propone cortar a un titular cuyo partido ya empezó: el cambio no se
 * puede hacer, y proponerlo se lee como que tu alineación está mal puesta — la
 * lección que costó el candado de `lockedSlots`. Tampoco a quien esté en IR, que
 * no ocupa sitio de banquillo.
 */
export function droppable({ roster, rosterPositions, lockedIds = [] }) {
  const bloqueados = new Set(lockedIds.map(String));
  return (roster ?? []).filter((p) => !bloqueados.has(String(p.player_id)));
}

/**
 * El mejor corte para un fichaje, medido y no supuesto.
 *
 * Se prueban todos los cortes posibles y se queda el que deja la alineación más
 * alta. No se elige «el peor del banquillo» por intuición: con flexibles, cortar
 * a un receptor puede costar más que cortar a un corredor mejor, porque el
 * repartidor recoloca.
 */
function mejorCorte({ candidate, roster, rosterPositions, replacement, lockedIds,
                     mustDrop, active }) {
  // `active` es la plantilla SIN los que están OUT: es la alineación que de
  // verdad puedes poner esta jornada. `roster` sigue siendo la lista completa,
  // porque de ahí sale a quién se puede cortar.
  const enCampo = active ?? roster ?? [];
  const base = lineupFloor({ players: enCampo, rosterPositions, replacement });
  if (base === null) return null;

  /* «NO CORTAR A NADIE» NO ES UNA OPCIÓN CUANDO LA PLANTILLA ESTÁ LLENA, Y
     DEJARLA COMPETIR VACIABA LA LISTA ENTERA.

     La primera versión calculaba el fichaje sin corte y lo metía a competir con
     los cortes. Añadir sin cortar SIEMPRE deja la alineación igual o mejor que
     añadir cortando, así que ganaba siempre; después, el guardia de plantilla
     llena descartaba el candidato por no llevar corte y el motor devolvía CERO
     movimientos con un fichaje evidente disponible. Es el fallo de
     `candidates.js` quedándose vacío bajo presión de pool: un motor que no
     encuentra nada se lee como «no hay nada», y había. */
  let mejor = { drop: null, after: null, net: null };
  if (!mustDrop) {
    const sinCortar = lineupFloor({
      players: [...enCampo, candidate], rosterPositions, replacement,
    });
    mejor = { drop: null, after: sinCortar, net: sinCortar === null ? null : sinCortar - base };
  }
  for (const salida of droppable({ roster, rosterPositions, lockedIds })) {
    const quedan = enCampo.filter(
      (p) => String(p.player_id) !== String(salida.player_id)
    );
    const despues = lineupFloor({
      players: [...quedan, candidate], rosterPositions, replacement,
    });
    if (despues === null) continue;
    const neto = despues - base;
    /* DESEMPATE: entre dos cortes que le cuestan lo MISMO a tu alineación —dos
       suplentes que no entran— se corta al de menos puntos proyectados.

       Sin esto ganaba el primero de la lista, que es un artefacto del orden en
       que llegó la plantilla: el motor proponía cortar a un corredor de 4 puntos
       teniendo un receptor de 3 al lado, y las dos respuestas eran igual de
       buenas para la alineación pero no para ti. No es una constante nueva: es
       `projected_points`, que ya está en la fila. */
    const mejora = mejor.net === null || neto > mejor.net;
    const empate = mejor.net !== null && neto === mejor.net
      && (num(salida.projected_points) ?? Infinity)
         < (num(mejor.drop?.projected_points) ?? Infinity);
    if (mejora || empate) {
      mejor = { drop: salida, after: despues, net: neto };
    }
  }
  return { base, ...mejor };
}

/**
 * Por qué ESTE jugador y por qué AHORA, con los hechos que lo sostienen.
 *
 * Cada motivo es comprobable contra la plantilla, el parte oficial o el
 * calendario. Lo que no se puede comprobar no se escribe: «trending up» y «must
 * add» no aparecen en este fichero, y no es un descuido de redacción.
 */
function motivos({ candidate, roster, picture, week, byes }) {
  const salida = [];
  const p = pos(candidate);

  const vacio = (picture?.empty ?? []).some((s) => s === p);
  if (vacio) salida.push({ code: "OPEN_STARTER_SLOT", text: `your ${p} starting slot is EMPTY` });

  const mismos = (roster ?? []).filter((r) => pos(r) === p);
  const fuera = mismos.filter(estaFuera);
  if (fuera.length > 0) {
    salida.push({
      code: "ROSTERED_OUT",
      text: `${fuera.map((f) => f.player_name ?? f.player_full_name).join(", ")} `
        + `on your roster is OUT on the official report`,
    });
  }

  const enBye = mismos.filter((r) => {
    const b = num(byes?.[String(r.team ?? "").toUpperCase()]);
    return b !== null && num(week) !== null && b === num(week);
  });
  if (enBye.length > 0) {
    salida.push({
      code: "ROSTERED_ON_BYE",
      text: `${enBye.map((f) => f.player_name ?? f.player_full_name).join(", ")} `
        + `is on bye this week`,
    });
  }

  // El uso medido, si la fila lo trae. Es un hecho con muestra, y se dice la
  // muestra: una jornada no es una tendencia.
  const snap = num(candidate.snap_pct);
  const snapAntes = num(candidate.snap_pct_prev);
  if (snap !== null && snapAntes !== null) {
    const d = Math.round((snap - snapAntes) * 1000) / 10;
    if (Math.abs(d) >= 5) {
      salida.push({
        code: "SNAP_CHANGE",
        text: `snap share went from ${Math.round(snapAntes * 100)}% to `
          + `${Math.round(snap * 100)}% (${d > 0 ? "+" : ""}${d} pts, `
          + `${candidate.sample_games ?? "?"} game(s) of sample)`,
      });
    }
  } else if (snap !== null) {
    salida.push({
      code: "SNAP_LEVEL",
      text: `played ${Math.round(snap * 100)}% of his team's offensive snaps `
        + `(${candidate.sample_games ?? 1} game, no previous week to compare against)`,
    });
  }
  return salida;
}

/** La categoría, derivada de DÓNDE cae el jugador y de qué le pasa a tu plantilla. */
function categoria({ candidate, picture, antes, despues, motivosList }) {
  const p = pos(candidate);
  const codigos = new Set(motivosList.map((m) => m.code));
  const entraEnTitular = (despues?.slots ?? []).some(
    (e) => e.player && String(e.player.player_id) === String(candidate.player_id)
      && e.slot === p
  );
  const entraEnFlex = (despues?.slots ?? []).some(
    (e) => e.player && String(e.player.player_id) === String(candidate.player_id)
      && e.slot !== p
  );
  const huecoEstabaVacio = (antes?.empty ?? []).some((s) => s === p);

  if (codigos.has("ROSTERED_OUT") && (entraEnTitular || entraEnFlex)) {
    return MOVE.INJURY_REPLACEMENT;
  }
  if (codigos.has("ROSTERED_ON_BYE") && (entraEnTitular || entraEnFlex)) {
    return MOVE.BYE_COVER;
  }
  if (entraEnTitular && huecoEstabaVacio) return MOVE.IMMEDIATE_STARTER;
  if (entraEnTitular) return MOVE.STARTER_UPGRADE;
  if (entraEnFlex) return MOVE.FLEX_UPGRADE;
  return MOVE.BENCH_DEPTH;
}

/**
 * El tramo de FAAB, declarado como CONVENCIÓN y no como medición.
 *
 * No hay modelo de FAAB validado en este proyecto, así que aquí no se calcula un
 * bid: se reparte en tramos según cuánto MEJORA tu alineación el movimiento —que
 * eso sí está medido— y se dice el porcentaje del presupuesto RESTANTE, no del
 * inicial. Sin presupuesto declarado no se sugiere nada.
 *
 * Los cortes son una convención editable y la interfaz lo dice con esas
 * palabras. Publicar «puja 17%» sería la falsa precisión que este proyecto
 * persigue en todas partes.
 */
export const FAAB_BANDS = Object.freeze([
  { upTo: 0, pct: [0, 0], label: "spend nothing: does not improve your lineup" },
  { upTo: 2, pct: [0, 1], label: "minimum" },
  { upTo: 5, pct: [1, 3], label: "low" },
  { upTo: 10, pct: [3, 8], label: "medium" },
  { upTo: Infinity, pct: [8, 18], label: "high" },
]);

export function faabRange({ net, remaining }) {
  const r = num(remaining);
  if (r === null) {
    return { status: "NO_BUDGET_DECLARED",
      note: "no FAAB budget declared, so no bid is suggested" };
  }
  const n = num(net) ?? 0;
  const banda = FAAB_BANDS.find((b) => n <= b.upTo) ?? FAAB_BANDS[FAAB_BANDS.length - 1];
  return {
    status: "HEURISTIC_RANGE",
    basis: "CONVENTION",
    pct: banda.pct,
    label: banda.label,
    min: Math.round((banda.pct[0] / 100) * r),
    max: Math.round((banda.pct[1] / 100) * r),
    of: r,
    note: "a declared band over your REMAINING budget, not a measured bid: "
      + "this project has no validated FAAB model",
  };
}

/**
 * LOS MOVIMIENTOS DE WAIVERS DE TU LIGA.
 *
 * Devuelve `null` cuando no hay estructura de plantilla declarada: sin huecos no
 * hay alineación que valorar, y suponer «12 equipos PPR» es exactamente lo que
 * se retiró (regla 6).
 */
export function waiverMoves({
  available, roster, rosterPositions, week = null, byes = null,
  lockedIds = [], faabRemaining = null, rosterLimit = null,
  window = WAIVER_WINDOW, limit = 12,
} = {}) {
  if (!Array.isArray(rosterPositions) || rosterPositions.length === 0) return null;
  const replacement = replacementPoints(available ?? []);

  /* UN JUGADOR QUE LA LIGA DA OUT NO LLENA SU HUECO ESTA JORNADA.
     ES LA MITAD DEL MOTOR, NO UN DETALLE.

     La primera versión pasaba la plantilla entera al repartidor, así que un
     corredor titular con OUT en el parte seguía «ocupando» su hueco con sus 16
     puntos: el motor contestaba que no necesitabas un reemplazo JUSTO cuando lo
     necesitabas, y etiquetaba el fichaje como BENCH_DEPTH con un +0. Lo cazó el
     test de INJURY_REPLACEMENT.

     El filtro es de ESTA jornada y por eso vive aquí y no en `rosterFit.js`, que
     valora un draft entero y donde una designación semanal no tiene sentido. La
     plantilla completa se conserva para el tamaño y para decidir a quién se
     puede cortar: el lesionado sigue ocupando sitio, y a veces ES el corte. */
  const disponibles = (roster ?? []).filter((x) => !estaFuera(x));
  const antes = slotPicture({ roster: disponibles, rosterPositions });
  if (antes === null) return null;

  const plantillaLlena = num(rosterLimit) !== null
    ? (roster ?? []).length >= num(rosterLimit)
    : null;

  const candidatos = (available ?? []).slice(0, window);
  const salida = [];
  for (const candidate of candidatos) {
    const corte = mejorCorte({
      candidate, roster, rosterPositions, replacement, lockedIds,
      mustDrop: plantillaLlena === true, active: disponibles,
    });
    // `net === null` sólo pasa si no hay ningún corte posible —todos bloqueados—
    // y la plantilla está llena. Eso no es «no mejora»: es que el movimiento no
    // se puede hacer, y se salta sin inventarle un cero.
    if (corte === null || corte.net === null) continue;

    const quedan = corte.drop
      ? disponibles.filter((p) => String(p.player_id) !== String(corte.drop.player_id))
      : disponibles;
    const despues = slotPicture({ roster: [...quedan, candidate], rosterPositions });
    const motivosList = motivos({ candidate, roster, picture: antes, week, byes });

    salida.push({
      add: candidate,
      drop: corte.drop,
      net: Math.round(corte.net * 10) / 10,
      lineupBefore: Math.round(corte.base * 10) / 10,
      lineupAfter: Math.round(corte.after * 10) / 10,
      category: categoria({ candidate, picture: antes, antes, despues, motivosList }),
      reasons: motivosList,
      // Un movimiento que no mejora no se esconde: se enseña con su cero y la
      // pantalla decide. Draftear o fichar un seguro es una decisión tuya.
      improves: corte.net > 0,
      faab: faabRange({ net: corte.net, remaining: faabRemaining }),
      rosterAfter: {
        empty: despues?.empty ?? [],
        size: quedan.length + 1,
      },
    });
  }
  // Por lo que AÑADEN, que es la única definición de valor de este fichero.
  salida.sort((a, b) => b.net - a.net);
  return {
    moves: salida.slice(0, limit),
    evaluated: candidatos.length,
    poolSize: (available ?? []).length,
    emptyStarterSlots: antes.empty,
    rosterFull: plantillaLlena,
    // Si NADIE mejora tu alineación se dice, en vez de enseñar los cuatro menos
    // malos con un +0 debajo de un rótulo que promete mejora.
    anyImproves: salida.some((m) => m.improves),
  };
}
