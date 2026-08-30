import { model } from "../data/model.js";

/**
 * Piezas de identidad deportiva. Todas de servidor: no llevan estado ni
 * interacción, así que no hay motivo para mandarlas al navegador.
 *
 * El color de equipo entra SIEMPRE por variable CSS (`--team`), nunca como
 * `color` en línea. Es lo que permite que el mismo componente funcione en los
 * dos temas: el token elige `primary` o `mark` según el fondo, y el componente
 * no se entera.
 */

const TEAMS = model.teams ?? {};

export function teamOf(abbr) {
  return TEAMS[abbr] ?? null;
}

/**
 * Los dos colores de un equipo como variables, listos para un `style`.
 *
 * Se emiten los DOS y elige el CSS con una media query. La alternativa evidente
 * era `light-dark(primary, mark)` en una sola variable, que es más corto y más
 * bonito — y depende de soporte que no he comprobado en el navegador objetivo.
 * Si `light-dark()` no resuelve, el color no cae a un valor razonable: cae a
 * nada, y el rail de identidad desaparece sin que falle ningún test.
 */
export function teamVars(abbr) {
  const team = teamOf(abbr);
  if (!team) return undefined;
  return { "--team-light": team.primary, "--team-dark": team.mark };
}

/**
 * Marca de equipo: tres letras y un color. No hay escudo — es marca registrada
 * del club y la CSP sólo permite imágenes propias. La abreviatura en condensada
 * pesada se reconoce igual de rápido a tamaño de fila, que es donde se usa.
 */
export function TeamMark({ abbr, solid = false, title }) {
  const team = teamOf(abbr);
  if (!abbr) return null;
  return (
    <span
      className={solid ? "team-mark team-mark--solid" : "team-mark"}
      style={teamVars(abbr)}
      title={title ?? team?.name ?? abbr}
    >
      {abbr}
    </span>
  );
}

/**
 * Un partido con forma de partido.
 *
 * Visitante a la izquierda, local a la derecha, el mercado en el eje. La barra
 * de abajo es la probabilidad del modelo en un solo trazo: sustituye a leer
 * «61,4%» en una celda y reconstruir mentalmente que el otro lado es 38,6%.
 */
/** Etiquetas inglesas de las features del modelo, para la capa de «why». */
const DRIVER_LABEL = {
  elo_diff: "Elo gap", elo_margin: "Elo margin", market_elo_margin: "Market Elo",
  hfa: "Home field", off_epa_diff: "Offense efficiency", def_epa_diff: "Defense efficiency",
  net_rating_diff: "Net efficiency", pass_epa_diff: "Passing efficiency",
  rush_epa_diff: "Rushing efficiency", form_diff: "Recent form", qb_diff: "QB rating",
  qb_vs_offense: "QB vs offense", rest_diff: "Rest", travel_miles_diff: "Travel",
  tz_shift_away: "Time zones", altitude_delta_away: "Altitude",
  neutral_site: "Neutral site", indoors: "Indoors", experience_min: "QB experience",
};

export function MatchupCard({ game, children, detailed = false }) {
  const away = teamOf(game.away_team);
  const home = teamOf(game.home_team);
  const homeProb = Number(game.home_win_prob ?? 0);
  const awayPct = Math.round((1 - homeProb) * 100);
  const style = {
    ...(away ? { "--away-light": away.primary, "--away-dark": away.mark } : {}),
    ...(home ? { "--home-light": home.primary, "--home-dark": home.mark } : {}),
  };
  const line = Number(game.spread_line);
  // La línea se escribe desde el lado que la lleva, que es como se dice en voz
  // alta: «Seattle da 3 y medio». Publicarla siempre desde el local obliga a
  // interpretar un signo, y un signo mal leído aquí cambia la apuesta.
  const favored = Number.isFinite(line) && line !== 0
    ? (line > 0 ? game.home_team : game.away_team)
    : null;
  const spread = Number.isFinite(line) && line !== 0
    ? `${favored} −${Math.abs(line).toFixed(1)}`
    : "Pick'em";
  const hasScore =
    Number.isFinite(Number(game.pred_home_points)) &&
    Number.isFinite(Number(game.pred_away_points));
  const marketTotal = Number(game.total_line);

  return (
    <article className="matchup" style={style}>
      <div className="side">
        <span className="abbr">{game.away_team}</span>
        <span className="city">{away?.nickname ?? ""}</span>
        {hasScore ? (
          <span className="proj">{Number(game.pred_away_points).toFixed(1)}</span>
        ) : null}
      </div>
      <div className="axis">
        <span className="at">at</span>
        {/* MODELO y MERCADO, cada uno con su nombre. Antes el total del MODELO
            salía rotulado «O/U», que es lenguaje de mercado: la fusión visual
            exacta que esta tarjeta existe para impedir. */}
        {Number.isFinite(Number(game.pred_total)) ? (
          <span className="line line--model">
            <small>Model total</small> {Number(game.pred_total).toFixed(1)}
          </span>
        ) : null}
        <span className="line line--market">
          <small>Market</small> {spread}
          {Number.isFinite(marketTotal) ? ` · O/U ${marketTotal.toFixed(1)}` : ""}
        </span>
      </div>
      <div className="side side--home">
        <span className="abbr">{game.home_team}</span>
        <span className="city">{home?.nickname ?? ""}</span>
        {hasScore ? (
          <span className="proj">{Number(game.pred_home_points).toFixed(1)}</span>
        ) : null}
      </div>
      <div className="odds">
        <span className="pct">{awayPct}%</span>
        <span
          className="track"
          role="img"
          aria-label={`Model win probability: ${game.away_team} ${awayPct}%, ${game.home_team} ${100 - awayPct}%`}
        >
          <span className="fill" style={{ width: `${awayPct}%` }} />
        </span>
        <span className="pct pct--home">{100 - awayPct}%</span>
      </div>
      {/* «Why this number»: atribución REAL — coeficiente × feature del ridge
          residual, en puntos de separación respecto de la línea. Detrás de una
          divulgación: la tarjeta se lee en dos segundos, la explicación cuando
          se pide. Sólo en la vista detallada para no engordar cada tarjeta. */}
      {detailed && Array.isArray(game.drivers) && game.drivers.length > 0 ? (
        <details className="matchup-why">
          <summary>Why this number</summary>
          <p className="caption">
            How far each model input pushes the prediction away from the market line, in
            points (positive favors {game.home_team}). Exact linear attribution of the
            market-anchored member — these four sum to most of the gap.
          </p>
          <ul>
            {game.drivers.map((driver) => (
              <li key={driver.f}>
                <span>{DRIVER_LABEL[driver.f] ?? driver.f}</span>
                <b className={driver.pts >= 0 ? "why-home" : "why-away"}>
                  {driver.pts > 0 ? "+" : ""}{driver.pts.toFixed(2)}
                </b>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {children}
    </article>
  );
}

/**
 * Fila de jugador. `rank`, nombre, equipo y UNA señal de decisión a la derecha.
 *
 * La señal es un solo número a propósito. La versión anterior ponía cuatro datos
 * a 11px («RB1 · ATL · VOR 97.7 · Steady») y ninguno destacaba: cuatro cosas del
 * mismo tamaño son cero cosas.
 */
export function PlayerRow({ rank, name, team, position, signal, signalLabel,
                           tags, onClock = false, children }) {
  return (
    <div
      className={onClock ? "player-row player-row--onclock" : "player-row"}
      style={teamVars(team)}
    >
      <span className={onClock ? "rank-numeral rank-numeral--hero" : "rank-numeral"}>
        {rank}
      </span>
      <span className="who">
        <span className="nm">{name}</span>
        <span className="meta">
          <TeamMark abbr={team} />
          {position ? <span className={`ptag ptag--${position.toLowerCase()}`}>{position}</span> : null}
          {tags}
        </span>
        {children}
      </span>
      {signal !== undefined && signal !== null ? (
        <span className="signal">
          {signal}
          {signalLabel ? <small>{signalLabel}</small> : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Corte de tier. La etiqueta dice cuántos quedan por encima del acantilado,
 * que es la pregunta real del draft: «¿puedo esperar otra ronda?».
 */
export function TierDivider({ tier, remaining, cliff = false }) {
  return (
    <p className="tier-divider">
      <span>Tier {tier}</span>
      {cliff ? <span className="cliff">cliff — {remaining} left</span> : null}
    </p>
  );
}

/** Una cifra protagonista, con su etiqueta encima y su matiz debajo. */
export function StatHero({ label, value, note }) {
  return (
    <div className="stat-hero">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note ? <span className="sub">{note}</span> : null}
    </div>
  );
}
