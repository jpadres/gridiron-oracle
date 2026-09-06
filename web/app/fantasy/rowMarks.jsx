/**
 * LAS MARCAS DE UNA FILA, en un solo sitio.
 *
 *     DOS PANTALLAS QUE PINTAN LO MISMO LEEN EL MISMO FICHERO.
 *
 * Esto vivía dentro de `WeeklyExplorer.jsx`. Cuando el resto de temporada pasó
 * a tener pantalla propia, copiarlo habría sido la sexta vez que dos
 * traductores del mismo formato divergen en este proyecto — y lo que divergiría
 * aquí es si un jugador APARTADO lleva su marca, que ya costó una iteración
 * (Josh Jacobs, puesto 38, exento y sin marca).
 *
 * Ninguna de estas marcas toca un número: son etiquetas al lado de la fila
 * (regla 8). El número del puesto es el mismo con marca y sin ella.
 */

import { availabilityMark } from "../availability.js";
import { rosterMark, teamChangeMark } from "./rosterMark.js";

/**
 * Marcas de contexto de una fila: estado, nota del modelo, prensa, dossier.
 *
 * El ESTADO va primero y va SIEMPRE, igual que en el board: que alguien no
 * pueda jugar es lo primero que hay que ver de una fila, antes que la nota y
 * antes que la prensa. Esta pantalla no lo pintaba —sólo salía la ficha del
 * dossier, que es de agosto—, así que el ranking semanal enseñaba la
 * afirmación vieja y se callaba la de hoy. El fallo de las dos superficies con
 * distinta cobertura, esta vez sobre quién puede jugar.
 */
export function RowMarks({ row, id, notes, news, availability, statusVerifiedAt }) {
  const health = availabilityMark(availability?.[id], statusVerifiedAt, row?.status_label);
  // La situación de PLANTILLA va con el estado y antes que la nota: que alguien
  // no esté en el 53 de su equipo pesa más que por qué el modelo lo sube.
  const roster = rosterMark(row);
  // Y el CAMBIO DE EQUIPO, que no es lo mismo que estar fuera del 53: un
  // jugador puede estar perfectamente activo y en otro sitio. La cabecera del
  // board lo prometía y ninguna fila lo decía.
  const cambio = teamChangeMark(row);
  return (
    <>
      {row?.status_label ? (
        /* UNA AFIRMACIÓN EN DISPUTA NO SE PINTA COMO UN HECHO. Cuando el
           registro de plantillas, posterior y oficial, contradice a la prensa,
           la etiqueta sigue —el desacuerdo es información— pero baja a `risk` y
           el `title` lleva las dos versiones con sus dos fechas. */
        <span className={row.status_disputed ? "mark mark--risk"
          : row.status_severity === "OUT" ? "mark mark--out" : "mark mark--risk"}
              title={(row.status_disputed ? `DISPUTED. ${row.status_dispute} ` : "")
                + `${row.status_detail} `
                + (row.status_freshness === "CURRENT"
                  ? `Verified ${row.status_verified_at}.`
                  : `LAST VERIFIED ${row.status_verified_at}.`)
                + " Changes no number on this row."}>
          {row.status_label}
        </span>
      ) : null}
      {roster ? (
        <span className={roster.className} title={roster.title}>{roster.text}</span>
      ) : null}
      {cambio ? (
        <span className={cambio.className} title={cambio.title}>{cambio.text}</span>
      ) : null}
      {notes?.[id] ? (
        <span className="mark mark--why" title="The model explains this ranking below">?</span>
      ) : null}
      {news?.[id] ? (
        <span className="mark mark--news" title="Recent reporting on this player">!</span>
      ) : null}
      {health ? (
        <span className={health.className} title={health.title}>{health.text}</span>
      ) : null}
    </>
  );
}

/**
 * La marca de propiedad de una fila EN LA LIGA ACTIVA: mío, agente libre o
 * de otro (con su dueño). Sale de la instantánea de la cuenta enlazada, por
 * `sleeper_id`; sin cuenta o sin id no se pinta nada, que es la verdad.
 */
export function OwnMark({ own, owners }) {
  if (!own) return null;
  if (own.status === "MINE") return <span className="own own--mine" title="On your roster in this league">MINE</span>;
  if (own.status === "FREE_AGENT") return <span className="own own--fa" title="Not on any roster in this league">FA</span>;
  const who = owners?.[String(own.rosterId)] ?? `roster ${own.rosterId}`;
  return <span className="own own--taken" title={`On ${who}'s roster`}>{who}</span>;
}

