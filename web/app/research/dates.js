/**
 * QUÉ FECHA SE ENSEÑA, Y CON QUÉ PALABRA.
 *
 * Una ficha puede saber cuándo se PUBLICÓ (`published_at`) o sólo cuándo la
 * VIMOS (`retrieved_at`, el barrido). 27 de las 40 del 4 de septiembre sólo
 * saben lo segundo, y se pintaban con la misma etiqueta que las que saben lo
 * primero: la fecha de importación como si fuera la del hecho. La palabra va
 * delante para que no se confundan, y sin ninguna de las dos no se inventa.
 */
export function dateLabel(item) {
  if (item?.published_at) return { word: "published", iso: String(item.published_at).slice(0, 10) };
  if (item?.retrieved_at) return { word: "seen", iso: String(item.retrieved_at).slice(0, 10) };
  return null;
}
