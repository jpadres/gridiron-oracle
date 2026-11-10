/**
 * LISTADOS: que quepan, y que la prosa se lea desde la izquierda.
 *
 * El 10 de noviembre de 2026 el dueño lo dijo con una captura: «el listado se
 * ve raro… júntalo más para la izquierda, que quepa». Tenía razón en las dos
 * cosas y ninguna comprobación las miraba:
 *
 *   1. La regla base de tabla es `text-align: right; white-space: nowrap` — la
 *      correcta para columnas de CIFRAS, que es para lo que se escribió. Waivers
 *      y `/salud` metieron FRASES en esas columnas: «Why now», los motivos, el
 *      origen de cada fuente. Una frase alineada a la derecha y sin partir
 *      empuja la tabla a 1.877 px dentro de un hueco de 944, y como el
 *      envoltorio tiene `overflow-x: auto`, la página «no desborda»: `smoke` y
 *      `movil` salían verdes con dos tercios de la tabla fuera de la pantalla.
 *   2. Un chip de posición hijo directo de una rejilla de una columna se estira
 *      de lado a lado: una barra de color donde iba una etiqueta. Y con el
 *      estado del partido DENTRO del chip se leía «RBIN PROGRESS».
 *
 * Aquí se mide GEOMETRÍA y estilo calculado, que es lo único que distingue
 * «está en el DOM» de «se puede leer». Sin navegador propio: recibe la página
 * de quien llama (`smoke`, `movil`), para que el recorrido y el servidor sigan
 * teniendo un solo dueño.
 */

/** Los cuatro defectos de un listado, medidos en la página que se le pasa. */
export async function listados(page) {
  return page.evaluate(() => {
    const texto = (el) => (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
    const visible = (el) => (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0);

    /* 1. UNA TABLA QUE PROMETE CABER, CABE. `rank-table--stack` es la promesa:
          en escritorio parte la prosa y en teléfono se apila. Las tablas de
          cifras anchas (el board, el semanal) desplazan a propósito con sus
          columnas fijas, y por eso NO se miran aquí: exigírselo a todas
          obligaría a relajar la comprobación hasta que no midiera nada. */
    const anchas = [];
    for (const tabla of document.querySelectorAll("table.rank-table--stack")) {
      if (!visible(tabla)) continue;
      const caja = tabla.closest(".table-wrap") ?? tabla.parentElement;
      if (caja.scrollWidth > caja.clientWidth + 1) {
        anchas.push(`tabla de ${caja.scrollWidth} px en ${caja.clientWidth} («${texto(tabla).slice(0, 24)}»)`);
      }
    }

    /* 2. LA PROSA NO SE ALINEA A LA DERECHA. En CUALQUIER tabla: una celda con
          cinco palabras o más es una frase, y una frase pegada al borde derecho
          deja el arranque de cada renglón en un sitio distinto. Las cifras con
          unidad («+12.4 pts», «3 of 28 clubs») no llegan a cinco palabras. */
    const derecha = [];
    for (const celda of document.querySelectorAll("td")) {
      if (!visible(celda)) continue;
      const palabras = texto(celda).split(" ").filter((p) => /[A-Za-z]{2,}/.test(p));
      if (palabras.length < 5) continue;
      const alin = getComputedStyle(celda).textAlign;
      if (alin === "right" || alin === "end") {
        derecha.push(`«${texto(celda).slice(0, 32)}…» alineada a la derecha`);
      }
    }

    /* 3 y 4. UN CHIP ES UNA ETIQUETA: ni una barra ni un contenedor. */
    const chips = [];
    for (const chip of document.querySelectorAll(".ptag")) {
      if (!visible(chip)) continue;
      const r = chip.getBoundingClientRect();
      // 6rem: «FLEX» y «SFLX» miden menos de 3 con el texto agrandado.
      const tope = 6 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (r.width > tope) chips.push(`chip «${texto(chip).slice(0, 12)}» de ${Math.round(r.width)} px`);
      if (chip.children.length > 0) chips.push(`chip «${texto(chip).slice(0, 18)}» lleva otra cosa dentro`);
    }
    return {
      anchas: [...new Set(anchas)],
      derecha: [...new Set(derecha)].slice(0, 6),
      chips: [...new Set(chips)].slice(0, 6),
      // Cuántas cosas se han mirado: una comprobación sobre cero elementos sale
      // verde sin medir nada, y quien llama decide dónde eso es un fallo.
      vistos: {
        tablas: document.querySelectorAll("table.rank-table--stack").length,
        celdas: document.querySelectorAll("td").length,
        chips: document.querySelectorAll(".ptag").length,
      },
    };
  });
}
