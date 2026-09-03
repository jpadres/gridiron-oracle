/**
 * Lo que la liga enlazada permite decir SIN inventar un consejo.
 *
 *     COMPARAR DOS PROYECCIONES PUBLICADAS ES ARITMÉTICA.
 *     DECIDIR UN MOVIMIENTO NO LO ES, Y NO ESTÁ VALIDADO.
 *
 * La frontera es la misma que retiró «Best available for you» del modo draft en
 * agosto: aquella pantalla multiplicaba el VOR por una «necesidad» inventada a
 * partir de una plantilla estándar que nadie había declarado, y lo presentaba
 * como si fuera board validado. Aquí no se multiplica nada. Se dice:
 *
 *   - qué proyecta un agente libre de TU liga esta semana,
 *   - qué proyecta el tuyo más flojo de esa misma posición,
 *   - y la resta.
 *
 * Lo que la resta NO sabe, y la interfaz dice al lado: tu banquillo, las
 * jornadas de descanso que vienen, lo que cuesta soltar a alguien, ni si el
 * comisionado te deja hacer el movimiento. Por eso se llama «diferencia de
 * proyección» y no «fichajes recomendados».
 *
 * ## El resto de temporada
 *
 * `restOfSeason` reparte lo que el board proyecta para la temporada entre las
 * jornadas que quedan, descontando el descanso si aún no ha pasado:
 *
 *     factor = jornadas jugables que quedan / 17
 *
 * Diecisiete porque la temporada tiene 18 jornadas y una es el descanso: en la
 * jornada 1 el factor es exactamente 1 y el orden es el del board, que es lo
 * correcto —no se ha jugado nada—. A partir de ahí el descanso cambia el orden
 * de verdad: dos jugadores idénticos no valen lo mismo si a uno le queda el
 * descanso por delante y al otro ya se le pasó.
 *
 * ## Y SE ORDENA POR VALOR, NO POR PUNTOS (regla 6b)
 *
 * La primera versión de esta tabla ordenaba por `ros_points` y salieron
 * CINCUENTA Y DOS quarterbacks entre los sesenta primeros, con el primer
 * receptor en el puesto 13. Es el fallo que este proyecto lleva escrito desde
 * el principio: un quarterback suma más puntos que cualquier receptor y eso no
 * lo hace mejor elección, porque su reemplazo también suma más.
 *
 * Así que se ordena por VOR repartido con el mismo factor. Es consistente:
 * si los puntos del jugador y los de su reemplazo se reparten entre las mismas
 * jornadas, su diferencia se reparte igual. Lo único que separa a dos posiciones
 * es el descanso, que es justo el efecto que se quiere ver.
 *
 * Es un reparto declarado, no un modelo nuevo: no sabe de forma reciente, ni de
 * cambios de rol posteriores al board, ni de lesiones. La marca de estado va
 * al lado y sigue sin tocar el número (regla 8).
 */

/** Jornadas de liga regular. La 18 es la última. */
export const LAST_WEEK = 18;
/** Partidos de una temporada: 18 jornadas menos el descanso. */
export const GAMES_IN_SEASON = LAST_WEEK - 1;

/**
 * Jornadas jugables que le quedan a un equipo desde `week` (incluida).
 *
 * Sin semana o sin descanso conocido se devuelve `null`, no una estimación:
 * un ROS calculado sobre un descanso inventado ordena mal justo a quien lo
 * tiene por delante, que es el único caso donde este cálculo aporta algo.
 */
export function gameWeeksLeft({ team, week, byes }) {
  const from = Number(week);
  if (!Number.isFinite(from) || from < 1 || from > LAST_WEEK) return null;
  const weeks = LAST_WEEK - from + 1;
  const bye = Number(byes?.[team]);
  if (!Number.isFinite(bye)) return null;
  return weeks - (bye >= from ? 1 : 0);
}

/**
 * El board reordenado por lo que queda de temporada.
 *
 * Devuelve las filas con `ros_points` y `ros_rank`. Una fila cuyo descanso no
 * se conoce se queda sin `ros_points` y va al final: UNKNOWN antes que un
 * número plausible.
 */
export function restOfSeason({ board, byes, week }) {
  const rows = (Array.isArray(board) ? board : []).map((row) => {
    const left = gameWeeksLeft({ team: row.team, week, byes });
    const factor = left == null ? null : left / GAMES_IN_SEASON;
    const season = Number(row.projected_points);
    const vor = Number(row.vor);
    return {
      ...row,
      ros_games_left: left,
      ros_points: factor != null && Number.isFinite(season) ? season * factor : null,
      ros_vor: factor != null && Number.isFinite(vor) ? vor * factor : null,
    };
  });
  // POR VALOR, no por puntos. Ver la cabecera del módulo: ordenar por puntos
  // llenaba de quarterbacks los sesenta primeros.
  rows.sort((a, b) => {
    if (a.ros_vor == null && b.ros_vor == null) return 0;
    if (a.ros_vor == null) return 1;
    if (b.ros_vor == null) return -1;
    return b.ros_vor - a.ros_vor;
  });
  const byPosition = {};
  return rows.map((row, index) => {
    const rank = row.ros_vor == null ? null : index + 1;
    let positionRank = null;
    if (rank != null) {
      byPosition[row.position] = (byPosition[row.position] ?? 0) + 1;
      positionRank = byPosition[row.position];
    }
    return { ...row, ros_rank: rank, ros_position_rank: positionRank };
  });
}

/** `MINE` / `FREE_AGENT` / `TAKEN` para una fila, o `null` sin liga. */
function statusOf(row, own) {
  const label = own?.(row);
  return label?.status ?? null;
}

/**
 * Por posición: mi titular más flojo contra el mejor agente libre de la liga.
 *
 * Sólo se emite el par cuando el libre proyecta MÁS, porque lo contrario no es
 * información: que tu titular gane a todos los libres es el caso normal.
 *
 * `minDelta` existe para que la lista no se llene de diferencias de dos
 * décimas. Un aviso que sale siempre no informa — la lección de `risk.py`, la
 * misma de siempre.
 */
export function freeAgentUpgrades({
  rows, own, positions = ["QB", "RB", "WR", "TE"], minDelta = 1, limit = 6,
} = {}) {
  const mine = {};
  const free = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const points = Number(row.projected_points);
    if (!Number.isFinite(points)) continue;
    const status = statusOf(row, own);
    if (status === "MINE") (mine[row.position] ??= []).push(row);
    else if (status === "FREE_AGENT") (free[row.position] ??= []).push(row);
  }
  const out = [];
  for (const position of positions) {
    const ours = (mine[position] ?? []).slice()
      .sort((a, b) => a.projected_points - b.projected_points);
    const theirs = (free[position] ?? []).slice()
      .sort((a, b) => b.projected_points - a.projected_points);
    if (ours.length === 0 || theirs.length === 0) continue;
    const weakest = ours[0];
    const best = theirs[0];
    const delta = best.projected_points - weakest.projected_points;
    if (delta < minDelta) continue;
    out.push({ position, free: best, weakest, delta, mineCount: ours.length });
  }
  out.sort((a, b) => b.delta - a.delta);
  return out.slice(0, limit);
}

/**
 * Pateadores y defensas que nadie tiene en la liga.
 *
 * El pateador se ordena por su proyección semanal, que existe. La defensa NO:
 * no hay modelo de DST validado en este proyecto, así que se ordena por el
 * total implícito del rival —de menos a más, que es la señal que sí se midió
 * (r 0,388 contra r 0,060 de sus propios puntos del partido anterior)— y se
 * publica sin columna de proyección. Ordenar por algo que no existe sería
 * inventar el ranking que la página lleva meses diciendo que no tiene.
 */
export function freeSpecialists({ kickers, defenses, own, limit = 5 } = {}) {
  const freeK = (Array.isArray(kickers) ? kickers : [])
    .filter((row) => statusOf(row, own) === "FREE_AGENT")
    .sort((a, b) => (Number(b.projected_points) || 0) - (Number(a.projected_points) || 0))
    .slice(0, limit);
  const freeD = (Array.isArray(defenses) ? defenses : [])
    .filter((row) => statusOf(row, own) === "FREE_AGENT")
    .sort((a, b) => (Number(a.opponent_implied) ?? 0) - (Number(b.opponent_implied) ?? 0))
    .slice(0, limit);
  return { kickers: freeK, defenses: freeD };
}
