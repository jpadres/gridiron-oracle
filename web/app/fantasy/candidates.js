/**
 * La lista corta del asistente: TOP AVAILABLE, no «tu mejor pick».
 *
 * ## La frontera, que es todo el fichero
 *
 * `candidates()` es la lista del BOARD y nada más. `bestForMe()`, al final del
 * fichero, es la que mira tu plantilla — y `BEST_PICK_FOR_ME` sigue BLOCKED en
 * el registro a propósito: está IMPLEMENTADO y no está VALIDADO, que son dos
 * cosas distintas y ahí se escriben separadas.
 *
 * Lo que hace `candidates()` es ORDENAR por
 * el valor por liga ya validado (E18) y quedarse con los primeros elegibles.
 * No pondera por lo que te falta, no inventa una necesidad y no predice si
 * alguien llegará a tu próximo turno. Cada una de esas tres cosas exigiría un
 * experimento que no existe.
 *
 * Lo que sí puede decir, porque son HECHOS derivados de cosas validadas:
 *
 *   - es el disponible con más valor de tu liga        (E18, dentro de su rango)
 *   - comparte tier con estos otros                    (conteo sobre el pool)
 *   - encaja en un hueco titular que tienes abierto    (assignSlots)
 *   - cuántos quedan de su tier                        (conteo)
 *   - cuánto AÑADE a tu alineación de hoy              (rosterFit.js, misma resta)
 *
 * ## El ajuste a la plantilla NO es el multiplicador retirado
 *
 * Desde septiembre de 2026 la lista se ordena por lo que cada jugador añade a
 * TU alineación, cuando la liga declara sus huecos. Eso NO es el `VOR × 0,35`
 * que se retiró en agosto: aquello era un peso a ojo sobre una plantilla
 * estándar que nadie había dicho. Esto es la MISMA definición del VOR con el
 * segundo término bien puesto —lo que pondrías tú si no lo tuvieras, en vez de
 * lo que pondría la liga media— y con la plantilla vacía da exactamente el VOR
 * publicado, que es cómo se comprueba que no hay nada inventado dentro.
 *
 * El board NO cambia. Sigue ordenado por VOR puro, que es la única definición
 * de BEST AVAILABLE que hay en el producto. Lo que se adapta es esta lista de
 * cuatro, que existe para el turno de alguien concreto, y lleva los dos números
 * a la vista para que la diferencia se pueda leer.
 *
 * ## K y DST
 *
 * Son fichables y filtrables, pero NO entran en la lista corta: su orden no
 * está validado (E8b lo rechaza para el pateador) y el modelo de defensa no
 * existe. Mezclarlos en una lista ordenada les prestaría la autoridad de los
 * otros — y esa autoridad es justo lo que no tienen.
 */

import { MIN_WEIGHTED_GAMES, SLOT_ELIGIBILITY, priorShare } from "./leagueValue.js";
import {
  FIT_EPSILON, POSITION_STATE, orderByFit, starterState,
} from "./rosterFit.js";
import { hasNumber, numberOrNull } from "../numbers.js";

/** Posiciones cuyo ORDEN está validado. K y DST quedan fuera a propósito. */
export const RANKED_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Los huecos titulares que siguen abiertos, en códigos de posición. */
export function openSlotPositions(slots) {
  const open = new Set();
  for (const entry of slots ?? []) {
    if (entry.player) continue;
    for (const pos of SLOT_ELIGIBILITY[entry.slot] ?? []) open.add(pos);
  }
  return open;
}

/**
 * Los candidatos: los primeros disponibles por valor, con sus HECHOS al lado.
 *
 * `limit` es corto a propósito. Bajo el reloj, una lista de veinte no es una
 * lista corta: es el board otra vez.
 */
/** El pool recomendable, con las exclusiones de arriba. Una sola definición. */
export function draftablePool(available, { requireSample = true } = {}) {
  return (available ?? []).filter(
    (row) => RANKED_POSITIONS.includes(row.position)
      && row.rostered !== false
      && row.status_severity !== "OUT"
      // La escapatoria es para «no sé su muestra», y con el idioma anterior
      // una muestra nula valía CERO —finito— así que en vez de escapar caía en
      // el `>= MIN` y quedaba EXCLUIDO: justo al revés de lo que dice hacer.
      // Hoy no hay filas así en el payload; el fallo estaba latente.
      && (!requireSample
          || row.rookie || !hasNumber(row.weighted_games ?? row.wg)
          || numberOrNull(row.weighted_games ?? row.wg) >= MIN_WEIGHTED_GAMES)
  );
}

export function candidates(
  available,
  { slots = null, limit = 4, roster = null, rosterPositions = null, replacement = null } = {}
) {
  // Un jugador sin equipo NO se recomienda. Su VOR salió de lo que produjo en
  // un equipo en el que ya no está, así que ofrecerlo como «lo mejor
  // disponible» es afirmar algo que los datos contradicen. Sigue en el board,
  // marcado y buscable — lo que no hace es encabezar la lista.
  //
  // Y tampoco se recomienda a quien NO VA A JUGAR aunque siga en su plantilla:
  // suspendido, en la Lista de Exentos, en IR o en PUP de temporada. Ese hecho
  // no lo tienen los datos de nflverse —Josh Jacobs figura ACT en Green Bay
  // estando apartado sin fecha— y lo trae la capa de prensa con su fuente.
  //
  // Marcar y dejar de recomendar NO es calcular: el número de la fila es el
  // mismo con marca y sin ella, y el jugador sigue en el board y buscable. Lo
  // que no hace es encabezar una lista que dice «lo mejor disponible».
  //
  // `RISK` (PUP activo, holdout, duda) NO sale: sacar a alguien del board por
  // una duda es tomar por quien draftea una decisión que es suya.
  //
  // Y no se recomienda a quien NO TIENE NÚMERO PROPIO. Con menos de tres
  // partidos ponderados de historial NFL, el encogimiento le da más del 75% de
  // su proyección desde la media de su posición: el board enseñaba a Phil
  // Mafah, Kevin Harris, Zach Evans y siete corredores más entre los puestos
  // 150 y 180, todos con ~112 puntos porque 112 ES la media del corredor. Eso
  // no es una lista de valor, es el ancla repetida con nombres distintos.
  //
  // No hace falta validar nada para excluirlos: `prior = 10/(wg+10)` es la
  // propia fórmula del encogimiento leída al revés, no una predicción. Siguen
  // en el board, buscables y fichables — lo que no hacen es encabezar una lista
  // que dice «lo mejor disponible».
  //
  // Un NOVATO no entra en esta regla: su número sale de la previa por capital
  // de draft, que está validada aparte y no es la media de la posición.
  const pool = draftablePool(available);
  if (pool.length === 0) return [];
  const openPositions = slots ? openSlotPositions(slots) : null;

  // El ORDEN. Por defecto es el del board (valor de liga); con la estructura de
  // la plantilla declarada, por lo que cada uno añade a la alineación de hoy.
  // Sin estructura no se reordena nada: suponer una plantilla es justo lo que
  // se retiró, y un orden personalizado sobre una suposición no falla, miente.
  // TERCER ESTADO: la estructura está declarada pero ya no queda hueco titular
  // que nadie pueda mejorar. El orden vuelve a ser el del board por el propio
  // desempate, y la lista tiene que DECIRLO en vez de seguir rotulada como
  // personalizada — con un +0 en las cuatro filas, que es la contradicción.
  const { rows: ordenados, byId: porId, active: fitActive } =
    orderByFit(pool, { roster, rosterPositions, replacement });

  return ordenados.slice(0, limit).map((row, index) => {
    const ajuste = porId?.get(row.player_id) ?? null;
    // Cuántos quedan de SU tier en el pool disponible entero, no en lo pintado.
    // Contarlo sobre la ventana visible fue un bug real de este proyecto.
    const sameTier = Number.isFinite(row.tier)
      ? pool.filter((other) => other.position === row.position && other.tier === row.tier).length
      : null;
    const reasons = [];
    if (index === 0) {
      reasons.push({
        kind: "TOP",
        text: fitActive
          ? "Adds the most to your starting lineup"
          : "Highest league value available",
      });
    }
    if (openPositions && openPositions.has(row.position)) {
      reasons.push({ kind: "SLOT", text: `Fills an open ${row.position} slot` });
    }
    // Cuánto se come tu plantilla del valor publicado, dicho como resta y no
    // como consejo. Sólo se enseña cuando hay algo que decir: repetir «100% of
    // his board value» en las cuatro filas del primer pick sería el aviso que
    // sale siempre y por eso no informa.
    if (fitActive && ajuste && Number.isFinite(ajuste.marginal) && Number.isFinite(ajuste.vor)
        && ajuste.vor > 0 && ajuste.marginal < ajuste.vor - 0.5) {
      reasons.push({
        kind: "FIT",
        text: ajuste.marginal <= 0.5
          ? `You already start a ${row.position} — he adds nothing to this lineup`
          : `Your ${row.position} slot is taken: ${Math.round(ajuste.marginal)} of his `
            + `${Math.round(ajuste.vor)} VOR reaches your lineup`,
      });
    }
    if (sameTier !== null) {
      reasons.push({
        kind: "TIER",
        text: sameTier === 1
          ? `Last ${row.position} in tier ${row.tier}`
          : `${sameTier} ${row.position}s left in tier ${row.tier}`,
      });
    }
    // `fit` lleva el dato; `fitActive` dice si ordenar por él significa algo.
    // Separados a propósito: el número sigue siendo cierto cuando ya no queda
    // hueco, lo que deja de ser cierto es la etiqueta de la lista.
    return { row, reasons, sameTier, fit: ajuste, fitActive };
  });
}

/* ════════════════════════════════════════════════════════════════════════════
 * DOS LISTAS, Y NINGUNA CORROMPE A LA OTRA
 *
 *     BEST AVAILABLE  = el board. Valor de tu liga, sin mirarte a ti.
 *     BEST PICK FOR ME = quién MEJORA TU ALINEACIÓN de hoy, y por qué.
 *
 * Se enseñan las dos porque las dos son ciertas y responden a preguntas
 * distintas. Si el número uno del board es un quarterback y tú ya tienes a
 * Josh Allen en una liga de un QB, quieres VERLO ahí arriba sin que el
 * asistente te diga que es tu mejor pick.
 * ══════════════════════════════════════════════════════════════════════════ */

/** La regla explícita de cuándo un candidato puede encabezar «para ti». */
const MEJORA = (ajuste) => Number(ajuste?.marginal) > FIT_EPSILON;

/**
 * La recomendación con contexto de plantilla, y sus motivos.
 *
 * El orden entre los que MEJORAN tu alineación es el marginal —la misma resta
 * del VOR con tu alineación como segundo término (regla 6d)— y el desempate, el
 * valor del board. No hay puntuación compuesta, ni pesos, ni una nota del 1 al
 * 100: cada motivo que se enseña es un hecho que se puede comprobar mirando la
 * plantilla y el pool.
 *
 * LA REGLA DE SATURACIÓN, escrita entera: un candidato cuya posición ya no
 * mejora tu alineación (marginal ≈ 0) **no puede ser el principal mientras
 * exista otro que sí la mejore**. No se le esconde, no se le baja el VOR y no
 * se te impide cogerlo — sale en BEST AVAILABLE con su número intacto. En una
 * superflex el segundo quarterback SÍ mejora la alineación, así que ahí puede
 * encabezar sin ninguna excepción escrita para él: la regla es la misma y el
 * resultado cambia porque la liga es otra.
 *
 * `null` cuando no se puede sostener: sin estructura declarada, sin valor, o
 * sin nada que mejore. Entonces la pantalla enseña BEST AVAILABLE y lo dice.
 */
export function bestForMe(available, {
  roster = null, rosterPositions = null, replacement = null,
  picksLeftForMe = null, limit = 4,
} = {}) {
  const state = starterState({ roster, rosterPositions });
  if (!state) return null;

  const pool = draftablePool(available);
  if (pool.length === 0) return null;

  const { rows, byId } = orderByFit(pool, { roster, rosterPositions, replacement });
  if (!byId) return null;

  /* CUÁNTOS DE ESTA POSICIÓN PUEDEN LLEGAR A ALINEARSE.
     Es un HECHO de la liga —cuántos huecos la admiten— y no un tope a ojo. Con
     un hueco de TE y un FLEX que lo acepta, como mucho DOS alas cerradas
     pueden entrar en tu alineación: un tercero no puede jugar nunca, ni
     lesionándose los otros dos. Recomendarlo sería recomendar un jugador que
     esta liga no te deja poner. Se le excluye de la recomendación; sigue en el
     board, con su valor intacto y fichable. */
  const cupo = {};
  const yaTengo = {};
  for (const slot of state.slots) {
    for (const pos of SLOT_ELIGIBILITY[slot.slot] ?? []) cupo[pos] = (cupo[pos] ?? 0) + 1;
  }
  for (const row of roster ?? []) yaTengo[row.position] = (yaTengo[row.position] ?? 0) + 1;
  const puedeJugar = (row) => (yaTengo[row.position] ?? 0) < (cupo[row.position] ?? 0);

  const mejoran = rows.filter((row) => MEJORA(byId.get(row.player_id)) && puedeJugar(row));

  /* UN HUECO TITULAR VACÍO SON CERO PUNTOS, NO EL NIVEL DE REEMPLAZO.
     ─────────────────────────────────────────────────────────────────────────
     El marginal compara con lo que pondrías si no lo tuvieras, y `slotFloor`
     valora un hueco ABIERTO al nivel de reemplazo — correcto mientras exista en
     el pool alguien de ese nivel, porque es literalmente lo que acabarías
     poniendo. Cuando el pool cae por debajo, la resta da ~0 para TODOS y el
     motor concluía «nadie mejora tu alineación», se iba al banquillo y dejaba
     el hueco VACÍO para siempre. Un hueco vacío no rinde el reemplazo: rinde
     CERO.

     Pasa de verdad: con once rivales drafteando corredores, en la ronda 6
     quedaban ~90 RB disponibles, los dos huecos de RB abiertos, y el motor
     recomendaba banquillo. El draft terminaba con CERO running backs.

     Y es el error exacto que E23 midió EN EL BASELINE —«un drafter por VOR puro
     a veces termina sin ala cerrada; un hueco vacío son cero puntos»—, que era
     el 47% de la ventaja atribuida a este motor. Cometerlo aquí no sólo es un
     fallo: invalidaría la razón por la que este motor existe.

     El arreglo NO toca `rosterFit` —así la identidad «plantilla vacía → VOR
     publicado» sigue exacta y E23 sigue valiendo— ni el board, ni añade una
     constante. Sólo cambia a quién se ofrece cuando nadie supera el reemplazo:
     si queda un hueco titular abierto y alguien del pool puede ocuparlo, ESE es
     el pick, ordenado por los puntos que aporta frente al cero que habría. */
  if (mejoran.length === 0) {
    const posDeHuecosAbiertos = new Set();
    for (const hueco of state.open ?? []) {
      for (const pos of hueco.eligible ?? SLOT_ELIGIBILITY[hueco.slot] ?? []) {
        posDeHuecosAbiertos.add(pos);
      }
    }
    /* Se busca en el POOL ENTERO y no en `rows`, que es la ventana de 50 de
       `orderByFit`. Bajo presión de pool los que quedan para tu hueco están en
       el puesto 200 del board: con la ventana, la lista salía vacía y el hueco
       se quedaba sin llenar. Es el artefacto del «los cuatro primeros no te
       caben, el que sí te sirve está en el 15», otra vez — la ventana acota
       cuánto se ORDENA, no si existe alguien que pueda ocupar un hueco
       obligatorio. */
    const porPuntos = (a, b) =>
      (numberOrNull(b.projected_points) ?? 0) - (numberOrNull(a.projected_points) ?? 0);
    let llenanHueco = pool.filter((row) => posDeHuecosAbiertos.has(row.position)).sort(porPuntos);

    /* ÚLTIMO RECURSO: ni un jugador de muestra suficiente cabe en el hueco.
       Pasa de verdad en ligas profundas —20 equipos con la posición agotada
       dejaba 44 corredores en el board y CERO drafteables, porque todos caen
       bajo el umbral de partidos ponderados—. Ese umbral existe para no
       RECOMENDAR a alguien de muestra corta como si fuera fiable, no para
       impedirte llenar un hueco obligatorio: entre un jugador dudoso y un cero
       garantizado, el cero es peor y encima no es una elección tuya. Se ofrece,
       se dice que es de muestra corta, y sólo en esta rama. */
    let muestraCorta = false;
    if (llenanHueco.length === 0) {
      const ancho = draftablePool(available, { requireSample: false });
      llenanHueco = ancho.filter((row) => posDeHuecosAbiertos.has(row.position)).sort(porPuntos);
      muestraCorta = llenanHueco.length > 0;
    }

    if (llenanHueco.length > 0) {
      const conMotivo = llenanHueco.slice(0, limit + 1).map((row) => ({
        row,
        fit: byId.get(row.player_id) ?? null,
        reasons: [
          { key: "EMPTY_SLOT", text: `Fills an open ${row.position} slot that would otherwise score 0` },
          muestraCorta
            ? { key: "SHORT_SAMPLE", text: "Below the sample threshold — offered only because the slot would stay empty" }
            : { key: "BELOW_REPLACEMENT", text: "No one left beats replacement level at your open slots" },
        ],
      }));
      return {
        state,
        primary: conMotivo[0] ?? null,
        alternates: conMotivo.slice(1, limit + 1),
        startersComplete: state.startersComplete,
        mustFillSpecialist: urgeEspecialista(state, picksLeftForMe),
        benchOnly: false,
        // Se marca para que la pantalla pueda decir POR QUÉ este orden no es el
        // de «lo que más añade»: aquí nadie añade nada sobre el reemplazo.
        fillingEmptySlot: true,
        shortSampleOnly: muestraCorta,
        bench: [],
      };
    }
  }

  if (mejoran.length === 0) {
    return {
      state,
      primary: null,
      alternates: [],
      // `startersComplete` dice la VERDAD del estado, no «no encontré a nadie».
      // Antes devolvía siempre `true` aquí, así que con los huecos de defensa y
      // pateador abiertos la pantalla afirmaba que la alineación estaba hecha.
      startersComplete: state.startersComplete,
      // Y el aviso del pateador y la defensa VIVE en las dos salidas. Estaba
      // sólo en la de abajo, así que desaparecía justo cuando empieza a
      // importar: al final del draft, que es cuando ya nadie mejora nada.
      mustFillSpecialist: urgeEspecialista(state, picksLeftForMe),
      // Lo que queda es banquillo: se dice, y se dice por qué no hay principal.
      benchOnly: true,
      /* LA LISTA DE BANQUILLO: orden del board, con UNA preferencia declarada.
         Delante van los que todavía podrían llegar a alinearse en esta liga y
         detrás los que ya no. Es un hecho, no un gusto: con un hueco de TE y un
         FLEX que lo admite, como mucho DOS alas cerradas pueden entrar en tu
         alineación, así que un tercero sólo vale como seguro. No se le esconde
         —sigue en la lista, detrás— porque draftear un seguro es una decisión
         legítima que te toca a ti.

         La primera versión FILTRABA a los que no podían alinearse, y a partir
         de la ronda 11 todas las posiciones estaban en su cupo: la lista se
         quedaba VACÍA y el simulador caía al board a secas, que es como acabó
         con cinco alas cerradas. Un banquillo existe precisamente para tener
         gente por encima del cupo de titulares. */
      bench: [...rows]
        .sort((a, b) => (Number(puedeJugar(b)) - Number(puedeJugar(a)))
          || (Number(b.vor) || 0) - (Number(a.vor) || 0))
        .slice(0, limit)
        .map((row) => ({ row, fit: byId.get(row.player_id) ?? null, canStart: puedeJugar(row) })),
    };
  }

  const conMotivos = mejoran.slice(0, limit + 1).map((row) => ({
    row,
    fit: byId.get(row.player_id),
    reasons: reasonsFor(row, { state, fit: byId.get(row.player_id), pool }),
  }));
  return {
    state,
    primary: conMotivos[0] ?? null,
    alternates: conMotivos.slice(1, limit + 1),
    startersComplete: false,
    mustFillSpecialist: urgeEspecialista(state, picksLeftForMe),
    benchOnly: false,
    bench: [],
  };
}

/**
 * ¿Urge ya llenar los huecos que sólo pateador o defensa pueden llenar?
 *
 * No es una ronda fija: es que te queden tantos picks como huecos titulares
 * abiertos, que es cuando dejar de llenarlos te deja sin alineación legal.
 *
 * `picksLeftForMe == null` explícito y NO `Number.isFinite(Number(x))`:
 * `Number(null)` es CERO, que es finito, así que «no sé cuántos picks te
 * quedan» se convertía en «te queda cero» y la urgencia salía SIEMPRE. Es la
 * misma trampa que ya costó una iteración en el libro de apuestas.
 */
function urgeEspecialista(state, picksLeftForMe) {
  if (picksLeftForMe === null || picksLeftForMe === undefined) return false;
  const quedan = Number(picksLeftForMe);
  if (!Number.isFinite(quedan)) return false;
  return state.openSpecialist.length > 0 && quedan <= state.open.length;
}

/** Los motivos. Cada uno es un HECHO comprobable, no una valoración. */
function reasonsFor(row, { state, fit, pool }) {
  const out = [];
  const estado = state.byPosition[row.position];
  if (estado === POSITION_STATE.OPEN_STARTER) {
    out.push({ kind: "OPEN_STARTER", text: `${row.position} starter open` });
  } else if (estado === POSITION_STATE.FLEX_ELIGIBLE) {
    const hueco = state.open.find((s) => !s.dedicated && s.eligible.includes(row.position));
    out.push({ kind: "FLEX", text: `Fits your open ${hueco?.slot ?? "FLEX"}` });
  }
  // Cuántos quedan de su tier EN EL POOL, no en lo que se pinta. Contarlo sobre
  // la lista visible es un fallo ya cometido dos veces en este proyecto.
  if (Number.isFinite(row.tier)) {
    const quedan = pool.filter((o) => o.position === row.position && o.tier === row.tier).length;
    out.push({
      kind: "TIER",
      text: quedan === 1
        ? `Last ${row.position} in tier ${row.tier}`
        : `Tier ${row.tier} · ${quedan - 1} more after him`,
    });
  }
  // Qué posiciones han dejado de mejorar tu alineación. Es el hecho que explica
  // por qué el número uno del board no encabeza esta lista.
  const llenas = Object.entries(state.byPosition)
    .filter(([, v]) => v === POSITION_STATE.STARTER_FILLED)
    .map(([k]) => k);
  if (llenas.length > 0) {
    out.push({ kind: "FILLED", text: `${llenas.join(" + ")} starter${llenas.length > 1 ? "s" : ""} already filled` });
  }
  if (Number.isFinite(fit?.marginal) && Number.isFinite(fit?.vor) && fit.marginal < fit.vor - 0.5) {
    out.push({
      kind: "PARTIAL",
      text: `${Math.round(fit.marginal)} of his ${Math.round(fit.vor)} VOR reaches your lineup`,
    });
  }
  return out.slice(0, 4);
}
