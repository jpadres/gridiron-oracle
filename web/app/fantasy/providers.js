/**
 * Mapa de capacidades por proveedor. La idea aprendida en la auditoría de
 * skills: DECLARAR lo que cada fuente sabe hacer, en vez de suponer que todas
 * responden a la misma pregunta.
 *
 *     AQUÍ SÓLO HAY SOPORTE ACTUAL. LO FUTURO NO SE ESCRIBE COMO SOPORTADO.
 *
 * Valores: `true` (funciona hoy), `false` (existe y está bloqueado — con el
 * motivo al lado), `"config"` (lo aporta el usuario al configurar), `null`
 * (no aplica a esa fuente). La interfaz degrada leyendo esto: ningún
 * componente puede asumir que «si la liga es de Sleeper, el sondeo en vivo
 * funciona» — está en false y el porqué es SLEEPER_LIVE_BROWSER BLOCKED.
 *
 * El proveedor es contexto de capacidad, NO un escalafón de calidad: una liga
 * manual es primera clase, con más capacidades hoy que la conectada.
 */

export const PROVIDER_CAPABILITIES = {
  manual: {
    label: "Manual",
    leagueConfig: "config",
    rosterStructure: "config",
    draftState: true,          // el registro canónico de picks, del usuario
    draftHistory: true,        // y con él, el replay
    livePolling: null,         // no hay proveedor al que sondear
    transactions: null,
    lineups: null,
    matchups: null,
  },
  sleeper: {
    label: "Sleeper",
    leagueConfig: true,        // /league/<id>: puntuación y plantilla, leídas
    rosterStructure: true,     // roster_positions, por el compilador único
    draftState: true,          // picks leídos por sondeo en el Draft Board
    draftHistory: true,
    livePolling: false,        // SLEEPER_LIVE_BROWSER está BLOCKED
    transactions: false,       // la API los publica; nadie los ha validado aquí
    lineups: false,
    matchups: false,
  },
  local: {
    label: "Local board",
    leagueConfig: null,        // el tablero local no pertenece a ninguna liga
    rosterStructure: null,
    draftState: true,
    draftHistory: true,
    livePolling: null,
    transactions: null,
    lineups: null,
    matchups: null,
  },
};

export function providerLabel(platform) {
  return PROVIDER_CAPABILITIES[platform]?.label ?? String(platform ?? "Unknown");
}

export function can(platform, capability) {
  return PROVIDER_CAPABILITIES[platform]?.[capability] ?? null;
}
