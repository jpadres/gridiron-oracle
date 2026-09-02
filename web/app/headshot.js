/**
 * La URL de la foto de un jugador, por IDENTIFICADOR, en el CDN de Sleeper.
 *
 * Sin React ni red: se prueba con `node --test`. El componente que la pinta
 * (`headshot.jsx`) sólo añade el fallback a iniciales cuando la imagen falla.
 */

export const SLEEPER_CDN = "https://sleepercdn.com";
const DEFENSE = new Set(["DEF", "DST"]);

export function isDefense(position) {
  return DEFENSE.has(String(position ?? "").toUpperCase());
}

/**
 * Jugador -> miniatura por `sleeper_id`; defensa -> escudo por código de
 * equipo. `null` cuando no se puede construir: nunca se adivina por nombre.
 */
export function headshotUrl({ sid, team, position }) {
  if (isDefense(position)) {
    const code = String(team ?? "").trim().toLowerCase();
    return /^[a-z]{2,3}$/.test(code) ? `${SLEEPER_CDN}/images/team_logos/nfl/${code}.png` : null;
  }
  const id = String(sid ?? "").trim();
  // Sólo ids numéricos: el mapa horneado también lleva las defensas por
  // código de equipo, y ésas van por el escudo, no por la miniatura.
  return /^\d+$/.test(id) ? `${SLEEPER_CDN}/content/nfl/players/thumb/${id}.jpg` : null;
}

/** «P.Nacua» -> «PN», «Ja'Marr Chase» -> «JC», «Cardinals» -> «CA». */
export function initials(name) {
  const parts = String(name ?? "").replace(/[.']/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
