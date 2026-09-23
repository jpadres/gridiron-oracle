/**
 * QUÉ SE PUEDE AFIRMAR DEL PARTE OFICIAL, Y QUÉ NO.
 *
 *     QUE UN CLUB NO HAYA ENTREGADO NO ES QUE SUS JUGADORES ESTÉN SANOS.
 *
 * El martes de la jornada 3 de 2026 habían entregado DOS clubes de treinta y
 * dos —los del partido del jueves, que reportan antes— y la pantalla escribía
 * «week 3 · 0 designations». Cierta palabra por palabra, y se lee como «el
 * parte está y no hay nadie tocado». Es la regla 5 con el signo cambiado: una
 * AUSENCIA presentada como afirmación, en la pantalla con la que se alinea.
 *
 * Vive aparte de las dos pantallas a propósito. `/fantasy/waivers` lo enseña
 * como reloj y `/fantasy/lineups` como aviso sobre la alineación, pero el HECHO
 * es uno solo — y este proyecto lleva catorce veces arreglando una superficie y
 * dejando la otra con la cobertura vieja.
 *
 * No calcula nada: traduce el estado que ya trae el barrido
 * (`scripts/weekly_research.py`), que es la única autoridad de lo que barrió.
 */

/** ¿Cubre el parte a todos los clubes que juegan esta jornada? */
export function reportCoverage(report) {
  if (!report || !report.status) return { known: false, partial: false };
  const status = report.status;
  const filed = Number.isInteger(report.teams) ? report.teams : null;
  const expected = Number.isInteger(report.teams_expected) ? report.teams_expected : null;
  const pending = Array.isArray(report.teams_pending) ? report.teams_pending : [];
  return {
    known: true,
    status,
    filed,
    expected,
    pending,
    // Quién SÍ ha entregado. Viaja aparte y no se calcula restando: la lista de
    // pendientes ya viene del barrido, que es la autoridad de lo que barrió.
    filedTeams: Array.isArray(report.teams_filed) && report.teams_filed.length
      ? report.teams_filed.join(", ")
      : null,
    // Parcial y «todavía no hay nada» son dos huecos distintos, y sólo el
    // primero se puede describir por club.
    partial: status === "PARTIALLY_FILED",
    missing: status === "NOT_PUBLISHED_YET" || status === "SOURCE_UNAVAILABLE",
    week: Number.isInteger(report.week) ? report.week : null,
    lastPublishedWeek: Number.isInteger(report.last_published_week)
      ? report.last_published_week
      : null,
    designations: Number.isInteger(report.with_designation) ? report.with_designation : null,
  };
}

/** El reloj de una línea. No dice «week 3» a secas sobre un parte a medias. */
export function injuryClockLabel(report) {
  const c = reportCoverage(report);
  if (!c.known) return "UNKNOWN";
  if (c.status === "PUBLISHED") {
    return `week ${c.week} · all ${c.expected ?? "?"} clubs filed · ${c.designations ?? 0} designations`;
  }
  if (c.partial) {
    return `week ${c.week} PARTIAL · ${c.filed} of ${c.expected} clubs filed · ${c.designations ?? 0} designations`;
  }
  if (c.status === "NOT_PUBLISHED_YET") {
    return `week ${c.week} not filed yet (last: week ${c.lastPublishedWeek ?? "?"})`;
  }
  return c.status;
}

/**
 * La frase que impide leer un hueco como una afirmación.
 *
 * Devuelve `null` cuando el parte SÍ cubre a todos: un aviso que sale siempre
 * no informa, que es el fallo de «muestra corta» en los 250 jugadores.
 */
export function coverageWarning(report) {
  const c = reportCoverage(report);
  if (!c.known) {
    return "No injury report was read for this week. An absent designation here means "
      + "NOT REPORTED, not healthy.";
  }
  if (c.partial) {
    // El martes faltan TREINTA de treinta y dos, y escupir esa lista en un
    // teléfono es un muro de códigos que nadie lee — cuando lo corto es decir
    // los DOS que sí han entregado. Misma información, leída de un vistazo.
    // Se nombra la lista más corta de las dos, y se dice cuál se está nombrando:
    // «filed» y «still to file» no se pueden confundir.
    const filed = c.filed ?? 0;
    const lista = c.pending.length && c.expected
      ? (filed <= c.pending.length
        ? ` So far only ${c.filedTeams ?? "the Thursday clubs"} have.`
        : ` Still to file: ${c.pending.join(", ")}.`)
      : "";
    return `Only ${filed} of ${c.expected} clubs have filed the week ${c.week} report — `
      + `clubs playing Thursday report first, the rest from Wednesday on.${lista} `
      + "For a player on a club that has not filed, no designation means NOT REPORTED, not healthy.";
  }
  if (c.status === "NOT_PUBLISHED_YET") {
    return `No club has filed the week ${c.week} report yet. Last week with a report: `
      + `week ${c.lastPublishedWeek ?? "?"} — and it is NOT carried forward. `
      + "An absent designation means NOT REPORTED, not healthy.";
  }
  if (c.status === "SOURCE_UNAVAILABLE") {
    return "The injury report could not be read. An absent designation means NOT REPORTED, not healthy.";
  }
  return null;
}
