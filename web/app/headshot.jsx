"use client";

/**
 * La foto del jugador, desde el CDN de Sleeper y por IDENTIFICADOR.
 *
 * ## De dónde sale
 *
 * `sleepercdn.com` publica una miniatura por `sleeper_id`
 * (`/content/nfl/players/thumb/<id>.jpg`) y el escudo de cada equipo
 * (`/images/team_logos/nfl/<equipo>.png`). El id viaja HORNEADO en cada fila
 * (`row.sid`, que `data/model.js` añade en el build desde el mismo mapa que
 * usa el adaptador): ninguna petición extra a la API, y nunca se adivina por
 * nombre — un jugador sin id en el mapa sale con sus iniciales, no con la foto
 * de otro.
 *
 * ## Lo que cuesta
 *
 * Es el SEGUNDO dominio externo del sitio, y sólo en `img-src`: la CSP y CI lo
 * listan como lista blanca de dos destinos, cada uno en su directiva. Cargar la
 * imagen le dice al CDN de Sleeper que alguien está mirando la página; se manda
 * sin referrer y sin credenciales, y es el precio declarado de ver caras en
 * vez de nombres. Si el CDN no responde, la foto se sustituye por las
 * iniciales y no se rompe nada.
 */

import { useState } from "react";

import { headshotUrl, initials, isDefense } from "./headshot.js";

/**
 * `size` en píxeles. Decorativa: el nombre va al lado, así que `alt` es vacío
 * y un lector de pantalla no oye el nombre dos veces.
 */
export function Headshot({ sid, team, position, name, size = 36, className = "" }) {
  const [failed, setFailed] = useState(false);
  const url = headshotUrl({ sid, team, position });
  const style = { width: size, height: size };
  if (!url || failed) {
    return (
      <span className={`hs hs--empty ${className}`.trim()} style={style} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className={`hs ${isDefense(position) ? "hs--team" : ""} ${className}`.trim()}
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
