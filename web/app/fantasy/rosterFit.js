/**
 * LO QUE UN JUGADOR TE AÑADE A TI, con la MISMA definición de VOR.
 *
 *     VOR = puntos − lo que pondrías si no lo tuvieras.
 *     Cambiar «lo que pondrías» de la liga entera a TU alineación no es una
 *     regla nueva: es la misma resta con el otro término bien puesto.
 *
 * ## El problema que resuelve
 *
 * El VOR publicado compara a cada jugador con el primer no-titular de su
 * posición EN LA LIGA. Eso es lo correcto para ordenar un board, y es lo que se
 * validó (E18). Lo que no sabe es que tú ya tienes ala cerrada: el segundo ala
 * cerrada de tu plantilla no entra en tu alineación, así que su valor para ti
 * no es el que dice esa resta. Por eso la lista corta seguía ofreciendo un TE o
 * un QB después de haberlo cogido.
 *
 * ## Lo que NO es
 *
 * **No es el multiplicador de necesidad que se retiró en agosto de 2026.**
 * Aquello era `VOR × 0,35` cuando «la posición estaba llena» según una
 * plantilla estándar que nadie había declarado: un número a ojo sobre una
 * suposición. Aquí no hay ningún número a ojo — no hay una sola constante
 * nueva en este fichero — y los huecos son los que TU liga declara; sin
 * estructura configurada esto no se calcula y la pantalla lo dice.
 *
 * ## La propiedad que lo mantiene honesto
 *
 *     CON LA PLANTILLA VACÍA, EL MARGINAL ES EXACTAMENTE EL VOR.
 *
 * No es una coincidencia agradable: es la comprobación de que no se ha
 * inventado nada. Al primer pick todos tus huecos están en el nivel de
 * reemplazo, así que quien ocupe el suyo sustituye exactamente a ese reemplazo
 * y la resta da el VOR publicado. El orden del primer pick es el del board, y
 * sólo se separa de él a medida que TÚ llenas huecos.
 *
 * Eso también contesta a la regla 6b: ordenar por puntos de alineación a secas
 * habría puesto 52 quarterbacks arriba, porque el QB suma más. Aquí no, porque
 * el hueco del QB vacío ya vale `replacement[QB]` = 233 puntos y sólo se cuenta
 * la diferencia.
 *
 * ## De dónde sale el nivel de reemplazo
 *
 * De las propias filas, por identidad: `proj − vor` es constante dentro de cada
 * posición y ES el reemplazo que usó el compilador. No se recalcula, no se
 * aproxima y no hace falta pasarlo — así que si el board es el de tu superflex,
 * el reemplazo también, sin que este fichero se entere de que existe superflex.
 */

import { SLOT_ELIGIBILITY, assignSlots } from "./leagueValue.js";

const BENCH = new Set(["BN", "BE", "BENCH", "IR", "TAXI"]);

/**
 * Por debajo de esto, un candidato NO añade nada a la alineación.
 *
 * Existe porque hay un tercer estado que no es «se adapta» ni «no hay
 * estructura»: **todos tus titulares están puestos**. Ahí el marginal de todo
 * el mundo es cero y ordenar por él es ordenar por el desempate, o sea por el
 * board. Decirlo es obligatorio; seguir rotulando la lista «lo que más añade a
 * tu alineación» con un +0 en cada fila serían dos frases contradictorias en la
 * misma pantalla, que es un fallo ya cometido en este proyecto.
 *
 * Medio punto y no cero: la resta arrastra coma flotante y un −0,0000001 no es
 * una diferencia, es ruido de suma.
 */
export const FIT_EPSILON = 0.5;

/** ¿Queda algún hueco que alguien pueda mejorar de verdad? */
export function fitIsActive(entries) {
  return (entries ?? []).some((f) => Number(f?.marginal) > FIT_EPSILON);
}
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

/**
 * El nivel de reemplazo por posición, LEÍDO del board y no recalculado.
 *
 * `projected_points − vor` es, por definición del compilador, los puntos del
 * jugador de reemplazo de esa posición. Se toma la mediana por si alguna fila
 * llega incompleta: una sola fila rara no puede mover el suelo de la posición.
 */
export function replacementPoints(rows) {
  const porPos = new Map();
  for (const row of rows ?? []) {
    const proj = num(row?.projected_points);
    const vor = num(row?.vor);
    const pos = String(row?.position ?? "").toUpperCase();
    if (proj === null || vor === null || !pos) continue;
    if (!porPos.has(pos)) porPos.set(pos, []);
    porPos.get(pos).push(proj - vor);
  }
  const out = {};
  for (const [pos, valores] of porPos) {
    valores.sort((a, b) => a - b);
    out[pos] = valores[Math.floor(valores.length / 2)];
  }
  return out;
}

/**
 * Lo que vale un hueco VACÍO: el mejor reemplazo que cabría en él.
 *
 * Un FLEX vacío no vale cero — vale lo que rinde el receptor de reemplazo, que
 * es lo que pondrías ahí. Contarlo cero es lo que hincha el marginal de
 * cualquiera y convierte la lista en un orden por puntos brutos.
 *
 * Un hueco cuya posición no está en el board (pateador, defensa) devuelve
 * `null` y queda FUERA de la cuenta en los dos lados de la resta: sin número
 * suyo, meterlo como cero restaría lo mismo arriba y abajo, pero dejaría un
 * total que no significa nada si alguien lo lee.
 */
export function slotFloor(slot, replacement) {
  const elegibles = SLOT_ELIGIBILITY[String(slot).toUpperCase()] ?? [];
  let mejor = null;
  for (const pos of elegibles) {
    const r = num(replacement?.[pos]);
    if (r !== null && (mejor === null || r > mejor)) mejor = r;
  }
  return mejor;
}

/**
 * Los puntos de tu alineación con los huecos vacíos puestos a nivel de
 * reemplazo. No es una predicción de tu temporada: es el término que se resta.
 */
export function lineupFloor({ players, rosterPositions, replacement }) {
  const slots = (rosterPositions ?? [])
    .map((raw) => String(raw).toUpperCase().trim())
    .filter((slot) => !BENCH.has(slot));
  if (slots.length === 0) return null;

  const { slots: repartidos } = assignSlots(players ?? [], slots);
  let total = 0;
  for (const entry of repartidos) {
    if (entry.player) {
      const proj = num(entry.player.projected_points);
      // Un titular sin proyección ocupa su hueco y no suma, igual que en
      // `lineup.js`. Lo que NO puede hacer es cobrar el suelo del hueco: eso
      // le regalaría los puntos del reemplazo por estar ahí.
      if (proj !== null) total += proj;
      continue;
    }
    const floor = slotFloor(entry.slot, replacement);
    if (floor !== null) total += floor;
  }
  return total;
}

/**
 * Lo que cada candidato AÑADE a tu alineación, con el VOR publicado al lado.
 *
 * `marginal` es la resta de dos alineaciones repartidas por `assignSlots` — el
 * mismo repartidor del board, del Draft Room y del analizador, que es el único
 * que hay a propósito. Si el candidato desplaza a alguien a un flex, el
 * repartidor lo recoloca y la resta lo recoge sola; no hay que preverlo aquí.
 *
 * Devuelve `null` si no hay estructura de plantilla: sin huecos declarados no
 * hay alineación que valorar, y suponer una es exactamente lo que se retiró.
 */
export function rosterFit({ candidates, roster, rosterPositions, replacement }) {
  if (!Array.isArray(rosterPositions) || rosterPositions.length === 0) return null;
  const base = lineupFloor({ players: roster, rosterPositions, replacement });
  if (base === null) return null;

  return (candidates ?? []).map((row) => {
    const conEl = lineupFloor({
      players: [...(roster ?? []), row], rosterPositions, replacement,
    });
    const marginal = conEl === null ? null : conEl - base;
    return {
      player_id: row.player_id,
      marginal,
      vor: num(row.vor),
      // Cuánto se ha comido tu plantilla del valor publicado. 1 = intacto (el
      // hueco estaba libre), 0 = no entra en tu alineación. Es un COCIENTE de
      // dos cosas medidas, no un peso: nadie lo elige.
      kept: marginal === null || !num(row.vor) ? null : marginal / num(row.vor),
    };
  });
}


/**
 * Cuántos candidatos se miran antes de ordenar. Reordenar sólo los que se
 * pintan no serviría: si los primeros del board ya no te caben, el que sí te
 * sirve está en el puesto quince y nunca entraría en la lista.
 */
export const FIT_WINDOW = 50;

/**
 * EL ORDEN POR AJUSTE A LA PLANTILLA. Una sola implementación, dos pantallas.
 *
 * El Draft Room y el board de `/fantasy` enseñan la misma decisión con distinta
 * caja, y cada uno con su propio orden sería la sexta vez que dos traductores
 * del mismo formato divergen en este proyecto. Aquí se ordena; cada pantalla
 * decide cómo lo pinta.
 *
 * Devuelve `active: false` cuando no hay estructura declarada o cuando ya no
 * queda hueco titular que nadie pueda mejorar — en los dos casos el orden es el
 * del board, y la pantalla tiene que decir cuál de los dos es.
 */
export function orderByFit(rows, { roster, rosterPositions, replacement, window = FIT_WINDOW } = {}) {
  const lista = Array.isArray(rows) ? rows : [];
  const ventana = lista.slice(0, window);
  const fit = rosterFit({ candidates: ventana, roster, rosterPositions, replacement });
  if (!fit) return { rows: lista, byId: null, active: false };

  const byId = new Map(fit.map((f) => [f.player_id, f]));
  const ordered = [...ventana].sort((a, b) => {
    const ma = byId.get(a.player_id)?.marginal ?? -Infinity;
    const mb = byId.get(b.player_id)?.marginal ?? -Infinity;
    // Empate a marginal —dos que no entran en tu alineación, o dos que la
    // mejoran igual— se rompe por el valor del board. Sin el desempate, con
    // todos los huecos llenos el orden quedaría al azar del `sort`.
    return mb - ma || (Number(b.vor) || 0) - (Number(a.vor) || 0);
  });
  return { rows: ordered, byId, active: fitIsActive(fit) };
}
