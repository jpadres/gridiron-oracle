/**
 * El análisis de una liga: quién es fuerte, dónde, y contra quién juego.
 *
 *     TODO LO DE AQUÍ ES ARITMÉTICA SOBRE NÚMEROS YA PUBLICADOS.
 *     NINGUNA FILA DICE QUÉ HACER.
 *
 * La diferencia importa y es la misma que retiró «Best available for you» del
 * modo draft: sumar el valor de una plantilla es una cuenta; decir «ofrécele tu
 * corredor por su receptor» es una recomendación que nadie ha validado. Aquí se
 * publica lo primero —con su método escrito— y lo segundo no se publica.
 *
 * ## Sobre qué se suma
 *
 * Sobre el VALOR (VOR) del board repartido por lo que queda de temporada, no
 * sobre los puntos. Es la regla 6b y ya costó una corrección esta misma semana:
 * ordenando por puntos salían 52 quarterbacks entre los sesenta primeros. Un
 * quarterback suma más que cualquier receptor y su reemplazo también, así que
 * los puntos no comparan entre posiciones — y una liga se gana en las
 * comparaciones entre posiciones.
 *
 * ## Qué queda fuera, y se dice
 *
 * Pateadores y defensas NO entran en la fuerza de una plantilla: el board no
 * les calcula valor porque no hay modelo validado para ellos. Un jugador que el
 * mapa de identidad no conoce tampoco entra, y se cuenta aparte como `unknown`
 * en vez de valer cero — «no lo sé» y «no vale nada» son cosas distintas y la
 * segunda hunde a un equipo entero en la tabla sin motivo.
 *
 * ## La mediana, no la media
 *
 * «Débil en una posición» se mide contra la MEDIANA de la liga en esa posición,
 * no contra la media: en una liga de diez equipos un solo receptor descomunal
 * mueve la media lo bastante como para que media liga aparezca «débil». La
 * mediana no se entera de ese jugador, que es lo que se quiere.
 */

import { assignSlots } from "./leagueValue.js";

/** Las cuatro que el board sabe valorar. K y DEF quedan fuera a propósito. */
export const VALUED = ["QB", "RB", "WR", "TE"];

/** Mediana de una lista de números. Lista vacía -> null, nunca 0. */
export function median(values) {
  const xs = (values ?? []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

const round = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/**
 * La plantilla de un equipo resuelta contra el índice de valor.
 *
 * `index` va por `sleeper_id` y sus filas tienen que traer `value` (el valor
 * de resto de temporada). Lo que no esté se cuenta en `unknown`.
 */
export function rosterOf(team, index) {
  const players = [];
  let unknown = 0;
  for (const id of team?.players ?? []) {
    const row = index?.get(String(id));
    if (!row) { unknown += 1; continue; }
    players.push(row);
  }
  return { players, unknown };
}

/**
 * La fuerza de un equipo: la mejor alineación que puede poner y su valor.
 *
 * Los huecos los reparte `assignSlots`, el MISMO que pinta la plantilla y el
 * mismo espejo de `league.assign_slots` de Python. Tres modelos de flex para la
 * misma liga ya costó una iteración en este proyecto; no hay un cuarto aquí.
 *
 * `byPosition` es el valor de los titulares dedicados de cada posición, que es
 * lo que compara «quién está débil dónde»: un tercer corredor buenísimo no
 * arregla un hueco de receptor.
 */
export function teamStrength({ team, index, rosterPositions }) {
  const { players, unknown } = rosterOf(team, index);
  const { slots, unassigned } = assignSlots(players, rosterPositions ?? []);
  const filled = slots.filter((s) => s.player);
  const lineup = filled.reduce((sum, s) => sum + (Number(s.player.value) || 0), 0);
  const byPosition = {};
  for (const position of VALUED) {
    // Por el HUECO, no por la posición del jugador: un tercer corredor metido
    // en el FLEX suma al total de la alineación y NO al valor del puesto de
    // corredor. Si contara ahí, un equipo con cuatro RB parecería fuerte en
    // todas partes y la comparación por posición —que es para lo que existe
    // esta tabla— dejaría de significar nada.
    const starters = filled.filter((s) => s.slot === position);
    byPosition[position] = {
      value: round(starters.reduce((sum, s) => sum + (Number(s.player.value) || 0), 0)),
      starters: starters.length,
      depth: players.filter((p) => String(p.position).toUpperCase() === position).length,
    };
  }
  return {
    rosterId: team?.rosterId ?? null,
    owner: team?.owner ?? (team?.rosterId != null ? `roster ${team.rosterId}` : "unknown"),
    record: team?.record ?? null,
    lineup: round(lineup),
    slots,
    bench: unassigned,
    byPosition,
    unknown,
    size: (team?.players ?? []).length,
  };
}

/**
 * Los equipos ordenados por el valor de la alineación que pueden poner.
 *
 * NO es un pronóstico de clasificación: no sabe del calendario, ni de quién
 * alinea bien, ni de los waivers que vienen. Es «cuánto valor tienes hoy», que
 * es una cosa distinta y comprobable.
 *
 * Cada equipo trae además `gap` por posición: su valor de titulares menos la
 * MEDIANA de la liga en esa posición. Positivo, sobra; negativo, falta.
 */
export function powerRankings({ snapshot, index, rosterPositions }) {
  const teams = (snapshot?.teams ?? []).map(
    (team) => teamStrength({ team, index, rosterPositions })
  );
  if (teams.length === 0) return [];
  const medians = {};
  for (const position of VALUED) {
    medians[position] = median(teams.map((t) => t.byPosition[position]?.value));
  }
  const ranked = [...teams].sort((a, b) => (b.lineup ?? 0) - (a.lineup ?? 0));
  return ranked.map((team, i) => {
    const gaps = {};
    for (const position of VALUED) {
      const value = team.byPosition[position]?.value;
      gaps[position] = medians[position] == null || value == null
        ? null
        : round(value - medians[position]);
    }
    return {
      ...team,
      rank: i + 1,
      gaps,
      medians,
      mine: snapshot?.rosterId != null && String(team.rosterId) === String(snapshot.rosterId),
      // Dónde sobra y dónde falta MÁS. `null` si no hay medianas (una liga de
      // un equipo, o un índice vacío): no se inventa una posición débil.
      strongest: pick(gaps, (a, b) => b - a),
      weakest: pick(gaps, (a, b) => a - b),
    };
  });
}

function pick(gaps, compare) {
  const entries = Object.entries(gaps).filter(([, v]) => Number.isFinite(v));
  if (entries.length === 0) return null;
  return entries.sort(([, a], [, b]) => compare(a, b))[0][0];
}

/**
 * Posición a posición contra otro equipo.
 *
 * Devuelve una fila por posición valorada con el valor de los titulares
 * DEDICADOS de cada uno y la diferencia. Ojo: esas filas no suman la diferencia
 * total de las alineaciones, porque el FLEX no es de ninguna posición dedicada.
 * Las dos cosas se enseñan por separado y la página lo dice: el total incluye
 * el flexible y las filas no.
 */
export function headToHead(mine, theirs) {
  if (!mine || !theirs) return null;
  const rows = VALUED.map((position) => {
    const a = mine.byPosition[position]?.value;
    const b = theirs.byPosition[position]?.value;
    return {
      position,
      mine: a, theirs: b,
      delta: a == null || b == null ? null : round(a - b),
      mineDepth: mine.byPosition[position]?.depth ?? 0,
      theirsDepth: theirs.byPosition[position]?.depth ?? 0,
    };
  });
  return {
    rows,
    mineTotal: mine.lineup,
    theirsTotal: theirs.lineup,
    delta: round((mine.lineup ?? 0) - (theirs.lineup ?? 0)),
    theirsOwner: theirs.owner,
    theirsRecord: theirs.record,
  };
}

/**
 * Pares de equipos con huecos OPUESTOS: a uno le sobra donde al otro le falta,
 * y al revés.
 *
 * Es lo más cerca del «trade analyzer» que estos datos permiten sin mentir. No
 * dice qué ofrecer, ni que el cambio sea bueno, ni que el otro vaya a aceptar:
 * dice dónde hay una conversación posible, que es un hecho de las dos
 * plantillas. Quien decide sigue siendo quien juega.
 *
 * `minGap` evita el ruido: dos décimas por encima de la mediana no es sobrar.
 */
export function tradeOpenings(rankings, { minGap = 5 } = {}) {
  const out = [];
  for (let i = 0; i < rankings.length; i += 1) {
    for (let j = 0; j < rankings.length; j += 1) {
      if (i === j) continue;
      const a = rankings[i];
      const b = rankings[j];
      for (const give of VALUED) {
        for (const get of VALUED) {
          if (give === get) continue;
          const aSurplus = a.gaps[give];
          const aNeed = a.gaps[get];
          const bSurplus = b.gaps[get];
          const bNeed = b.gaps[give];
          if (![aSurplus, aNeed, bSurplus, bNeed].every(Number.isFinite)) continue;
          if (aSurplus < minGap || bSurplus < minGap) continue;
          if (aNeed > -minGap || bNeed > -minGap) continue;
          out.push({
            a: a.owner, aRosterId: a.rosterId, aMine: a.mine,
            b: b.owner, bRosterId: b.rosterId, bMine: b.mine,
            give, get,
            aSurplus, aNeed, bSurplus, bNeed,
            // Cuánto separa a los dos de la mediana, sumado. Es un tamaño del
            // hueco, no un valor del intercambio: nadie ha medido eso.
            size: round(aSurplus + bSurplus - aNeed - bNeed),
          });
        }
      }
    }
  }
  // Cada par sale UNA vez: (A da RB, B da WR) y (B da WR, A da RB) son el mismo
  // hueco leído desde los dos lados.
  const seen = new Set();
  const unique = [];
  for (const row of out.sort((x, y) => y.size - x.size)) {
    const key = [row.aRosterId, row.bRosterId, row.give, row.get].map(String).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}
