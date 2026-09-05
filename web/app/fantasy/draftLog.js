/**
 * El registro canónico de picks. Una sola fuente de verdad para todo el draft.
 *
 * ## Por qué un registro de eventos y no dos listas de ids
 *
 * Lo que había era `{gone: [], mine: []}`: el concepto era «jugador que ya no
 * está», no «pick». Quién lo cogió, en qué puesto, cuándo y desde dónde no caben
 * en esa forma, y sin ellos no hay reloj, ni corrección, ni procedencia.
 *
 * Y una consecuencia concreta: **deshacer no funcionaba sobre un pick
 * sincronizado**. Se quitaba del conjunto y el siguiente sondeo lo volvía a
 * meter quince segundos después. Aquí deshacer es un EVENTO, así que sobrevive
 * al adaptador.
 *
 * ## La regla de conflicto, entera
 *
 * El estado es un *fold* sobre los eventos ordenados por `(at, seq)`:
 *
 * 1. `TAKE` marca al jugador como tomado, con su pick y su roster.
 * 2. `UNDO` lo libera **desde ese instante**.
 * 3. Un `TAKE` posterior a un `UNDO` vuelve a tomarlo — es el comisionado que
 *    rehace el pick, y tiene que ganar.
 * 4. A igual instante, `MANUAL` gana a cualquier proveedor. Es el único
 *    desempate, y existe para que una corrección a mano no la pise el sondeo.
 * 5. Un `TAKE` de un jugador ya tomado se ignora (idempotente). Es lo que hace
 *    que un adaptador pueda reenviar su lista entera sin duplicar nada. La
 *    única excepción: si el que llega **manda más** que el que está —manual
 *    sobre proveedor— corrige el DUEÑO sin mover el pick de sitio. Sin esa
 *    excepción, decir «este lo he cogido yo» sobre un pick que el sondeo ya
 *    había atribuido al rival no haría nada, porque el TAKE llegaría segundo.
 *
 * Nada se borra: una corrección queda en el registro con su hora y su origen.
 *
 * ## Los eventos del proveedor no se persisten
 *
 * Los picks que llegan del sondeo se convierten a eventos **en memoria** y se
 * funden con los guardados en cada render. No se escriben: un sondeo con un
 * emparejamiento malo dejaría estado duradero equivocado, y
 * `SLEEPER_LIVE_BROWSER` sigue BLOCKED — su salida todavía no es una fuente que
 * se pueda archivar.
 *
 * Su `at` es **el número de pick, no un reloj**. Suena raro y es deliberado: un
 * `Date.now()` del sondeo cambiaría en cada vuelta, así que un UNDO manual de
 * hace diez segundos quedaría por detrás del mismo pick reenviado y el jugador
 * volvería. Con un ordinal pequeño, todo evento manual —que lleva reloj de
 * verdad— es posterior por construcción, y deshacer sobrevive al adaptador.
 *
 * El precio, dicho: si el comisionado **rehace** un pick que tú habías
 * deshecho, el sondeo ya no puede devolverlo. Vuelve a marcarlo a mano. Es el
 * lado correcto en el que equivocarse: un jugador de más en el board se ve y se
 * corrige, uno de menos desaparece sin avisar.
 */

export const SOURCE = { MANUAL: "MANUAL", SLEEPER: "SLEEPER" };
export const ROSTER = { MINE: "MINE", OPPONENT: "OPPONENT", UNKNOWN: "UNKNOWN" };

/**
 * Rango de la fuente. Manda en dos sitios: al desempatar a igual instante, y al
 * decidir si un TAKE que llega puede corregir el dueño de uno que ya está.
 */
const SOURCE_RANK = { [SOURCE.MANUAL]: 2, [SOURCE.SLEEPER]: 1 };

let counter = 0;
/**
 * Identificador monótono dentro de la sesión.
 *
 * `Date.now()` no basta: veinte picks rápidos caen en el mismo milisegundo y el
 * orden se vuelve el del array, que no es un orden. El contador desempata.
 */
function nextSeq() {
  counter += 1;
  return counter;
}

export function takeEvent({ playerId, roster = ROSTER.UNKNOWN, rosterSource = "DECLARED",
                            overall = null, source = SOURCE.MANUAL, providerId = null,
                            at = Date.now() }) {
  return {
    // Un pick tecleado NO tiene número de proveedor, y `null` es la respuesta
    // correcta: se lo asigna `fold` por orden, saltando los ya ocupados.
    kind: "TAKE", playerId, roster, rosterSource, overall, source, providerId, pickNo: null,
    at, seq: nextSeq(),
  };
}

export function undoEvent({ playerId, source = SOURCE.MANUAL, at = Date.now() }) {
  return { kind: "UNDO", playerId, source, at, seq: nextSeq() };
}

function order(a, b) {
  if (a.at !== b.at) return a.at - b.at;
  const rank = (SOURCE_RANK[b.source] ?? 0) - (SOURCE_RANK[a.source] ?? 0);
  if (rank !== 0) return rank;
  return a.seq - b.seq;
}

/**
 * El estado canónico a partir del registro.
 *
 * Devuelve los picks vivos en orden, el índice por jugador y el conjunto de los
 * míos. `overall` se asigna aquí y no al crear el evento: en un draft manual, si
 * se deshace un pick de en medio, los siguientes tienen que renumerarse solos o
 * el recuento se rompe — que es justo el «pick count roto» que hay que evitar.
 *
 * Cuando el pick trae el número del PROVEEDOR, ese número manda y no se
 * renumera nada: el pick 3 sigue siendo el 3 aunque el 2 se caiga. Ver la nota
 * de la numeración más abajo.
 */
export function fold(events) {
  const sorted = [...events].sort(order);
  const live = new Map();
  for (const event of sorted) {
    if (event.kind === "UNDO") {
      live.delete(event.playerId);
      continue;
    }
    const existing = live.get(event.playerId);
    if (existing) {
      // Idempotente: un adaptador puede reenviar su lista entera sin duplicar.
      // Salvo que el que llega mande más, y entonces sólo corrige el dueño: se
      // conservan `at` y `seq` del original para que el pick no se mueva de
      // sitio y `overall` no se renumere por una corrección de atribución.
      if ((SOURCE_RANK[event.source] ?? 0) > (SOURCE_RANK[existing.source] ?? 0)) {
        live.set(event.playerId, {
          ...event, at: existing.at, seq: existing.seq, overall: existing.overall,
        });
      }
      continue;
    }
    live.set(event.playerId, event);
  }

  /* LA NUMERACIÓN.
   *
   * Con número del proveedor se usa ÉSE: es el sitio real del pick en el draft,
   * y respetarlo deja el hueco de lo que no se pudo emparejar vacío en la
   * parrilla — que es la verdad, no un fallo de pintado. Numerar por posición
   * entre los resueltos corría a todos los siguientes una casilla y ponía a los
   * jugadores en la columna de otro equipo.
   *
   * Sin número —el modo manual, que funciona en cualquier plataforma— se
   * numera correlativo como siempre, saltando lo que ya esté ocupado: un pick
   * tecleado no puede caer en el número de uno que existió y no se emparejó.
   * Por eso los correlativos se reparten en una SEGUNDA pasada, cuando ya se
   * sabe qué números se ha quedado el proveedor. */
  const vivos = [...live.values()].sort(order);
  const ocupados = new Set(
    vivos.map((event) => Number(event.pickNo)).filter((n) => Number.isFinite(n) && n > 0)
  );
  let cursor = 0;
  const picks = vivos.map((event) => {
    const suyo = Number(event.pickNo);
    if (Number.isFinite(suyo) && suyo > 0) {
      cursor = Math.max(cursor, suyo);
      return { ...event, overall: suyo };
    }
    do { cursor += 1; } while (ocupados.has(cursor));
    return { ...event, overall: cursor };
  });
  const byPlayer = new Map(picks.map((pick) => [pick.playerId, pick]));
  const mine = new Set(
    picks.filter((pick) => pick.roster === ROSTER.MINE).map((pick) => pick.playerId)
  );
  return { picks, byPlayer, mine, count: picks.length };
}

/**
 * El puesto que elige en un pick global dado.
 *
 * `snake` invierte en las rondas pares; `linear` no. El tipo se LEE, no se
 * supone: dar snake por hecho en un draft lineal produce un calendario
 * equivocado a partir de la ronda 2, y equivocado de forma plausible.
 */
export function slotForOverall(overall, teams, type) {
  if (!overall || !teams || teams < 2) return null;
  if (type !== "snake" && type !== "linear") return null;
  const round = Math.floor((overall - 1) / teams) + 1;
  const inRound = ((overall - 1) % teams) + 1;
  const slot = type === "snake" && round % 2 === 0 ? teams - inRound + 1 : inRound;
  return { round, slot, inRound };
}

/**
 * ¿El pick que viene ahora es mío?
 *
 * Devuelve `true`, `false` o **`null`**, y el `null` es la parte importante: si
 * no se conoce el puesto o el tipo de draft, no se adivina. Un pick asignado a
 * la plantilla equivocada corrompe todas las decisiones siguientes.
 */
export function isMyTurn({ overall, teams, type, mySlot }) {
  if (!mySlot || !teams || !type) return null;
  const position = slotForOverall(overall, teams, type);
  return position ? position.slot === mySlot : null;
}

/** Los picks que faltan para mi próximo turno. `null` si no se puede saber. */
export function untilMyTurn({ count, teams, type, mySlot, rounds = null }) {
  if (!mySlot || !teams || !type) return null;
  const limit = rounds ? teams * rounds : teams * 20;
  for (let overall = count + 1; overall <= limit; overall += 1) {
    const position = slotForOverall(overall, teams, type);
    if (position && position.slot === mySlot) {
      return { overall, ...position, away: overall - count - 1 };
    }
  }
  return null;
}

/**
 * Los picks de un adaptador, convertidos a eventos **efímeros**.
 *
 * `at` es el número de pick y no un reloj — el porqué está en la cabecera del
 * fichero. Los picks sin ordinal caen al final conservando el orden en que
 * llegaron, que es lo único que se sabe de ellos.
 *
 * No se guarda nada: quien llame funde estos eventos con el registro persistido
 * en cada render y tira el resultado.
 */
export function providerEvents(picks, { source = SOURCE.SLEEPER, mySlot = null } = {}) {
  /* DE QUIÉN ES EL PICK CUANDO SLEEPER NO LO DICE.
   *
   * Siguiendo un DRAFT POR ID —un mock, o mirar un draft sin haber tecleado tu
   * usuario— no hay `userId` ni `rosterId` que cruzar, así que el adaptador
   * marca TODOS los picks UNKNOWN. Y eso es correcto por su parte: él no sabe
   * quién eres. El efecto era que tu plantilla se quedaba vacía y todo lo que
   * depende de ella —la lista corta que se adapta, los huecos abiertos, el
   * conteo por posición— no tenía nada que mirar, en silencio.
   *
   * El pick SÍ trae su `draft_slot`, y tú SÍ has declarado tu puesto. Cruzar
   * los dos no es adivinar: es la MISMA derivación por puesto que usa el modo
   * manual, sobre un dato que has declarado tú. Sin puesto declarado, o sin
   * casilla en el pick, se queda UNKNOWN — «no sé de quién es» nunca se
   * convierte en «es de otro».
   *
   * Y lo que el adaptador YA resolvió no se toca: `picked_by`/`roster_id` es
   * evidencia más fuerte que la casilla. */
  const casilla = Number(mySlot);
  const porCasilla = (pick) => {
    if (pick.roster && pick.roster !== ROSTER.UNKNOWN) return pick.roster;
    const suya = Number(pick.draftSlot);
    if (!Number.isFinite(casilla) || casilla <= 0 || !Number.isFinite(suya) || suya <= 0) {
      return ROSTER.UNKNOWN;
    }
    return suya === casilla ? ROSTER.MINE : ROSTER.OPPONENT;
  };

  return (Array.isArray(picks) ? picks : []).map((pick, index) => ({
    kind: "TAKE",
    playerId: pick.playerId,
    roster: porCasilla(pick),
    rosterSource: pick.roster && pick.roster !== ROSTER.UNKNOWN ? "PROVIDER" : "DERIVED",
    overall: null,
    source,
    providerId: pick.providerId ?? null,
    // EL NÚMERO DE PICK DEL PROVEEDOR, y no sólo como clave de orden.
    //
    // Antes viajaba únicamente en `at`, que es la clave de ordenación, y `fold`
    // lo tiraba para renumerar por posición entre los RESUELTOS. Un solo pick
    // que no se pueda emparejar —un novato de 2026 que no está en el board
    // publicado, un pateador— y todo lo siguiente se corre una casilla. En una
    // parrilla de snake una casilla es la columna de OTRO equipo. Se vio en un
    // draft real: nadie lo había adivinado porque el número venía en la
    // respuesta desde el principio.
    pickNo: Number.isFinite(pick.pickNo) ? pick.pickNo : null,
    at: Number.isFinite(pick.pickNo) ? pick.pickNo : index + 1,
    seq: index + 1,
  }));
}

/**
 * El estado del draft DESPUÉS del pick efectivo N. Es el modelo del replay.
 *
 * ## La decisión de semántica, tomada y cerrada
 *
 * El cursor recorre los **picks efectivos finales**, no los eventos crudos.
 * «Después del pick N» significa: los N primeros picks de la historia YA
 * CORREGIDA — la que queda cuando deshacer y las correcciones de dueño han
 * hecho su trabajo. Un pick deshecho y rehecho aparece una vez, donde quedó; un
 * dueño corregido aparece corregido desde el principio.
 *
 * La alternativa —reproducir el tiempo crudo, con jugadores que aparecen y
 * desaparecen— enseña el ruido de la sala, no el draft. Para revisar un draft
 * lo que importa es la historia como quedó, y ésa es una sola.
 *
 * ## Por qué esto es una función y no otro modelo de datos
 *
 * `fold` ya produce los picks efectivos ordenados y renumerados. El estado tras
 * el pick N es literalmente sus N primeros: mismo objeto, mismo orden, mismos
 * dueños. No hay un segundo modelo que pueda discrepar del primero — y hay un
 * test que exige que rebanar aquí y replegar los N primeros picks como eventos
 * den EXACTAMENTE lo mismo.
 *
 * N va de 0 (antes del draft) a `state.count` (el estado actual). Fuera de ese
 * rango se acota, que para un cursor es lo correcto.
 */
export function replayState(state, n) {
  const upto = Math.max(0, Math.min(Number(n) || 0, state.picks.length));
  const picks = state.picks.slice(0, upto);
  const byPlayer = new Map(picks.map((pick) => [pick.playerId, pick]));
  const mine = new Set(
    picks.filter((pick) => pick.roster === ROSTER.MINE).map((pick) => pick.playerId)
  );
  return { picks, byPlayer, mine, count: picks.length };
}

/** Etiqueta de pick al estilo del deporte: `4.08`. */
export function pickLabel(overall, teams, type) {
  const position = slotForOverall(overall, teams, type);
  if (!position) return `#${overall}`;
  return `${position.round}.${String(position.inRound).padStart(2, "0")}`;
}
