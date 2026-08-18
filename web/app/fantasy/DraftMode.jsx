"use client";

/**
 * Modo draft: sugiere a quién coger y tú vas tachando lo que se van llevando.
 *
 * ## Por qué esto sí lleva JavaScript
 *
 * El resto del sitio no manda ni una línea de JS propio, y es una decisión, no
 * una casualidad. Aquí se rompe a propósito: un tablero de draft **necesita
 * estado** —quién se ha ido, qué llevas tú— y ese estado cambia sesenta veces
 * en dos horas. Resolverlo sin JS exigiría un backend, que es un precio mucho
 * más alto: cuentas, base de datos y superficie de ataque real a cambio de no
 * mandar quince kilobytes.
 *
 * Lo que **no** cambia: cero peticiones de red. Todo ocurre en tu navegador y el
 * estado vive en `localStorage`, así que puedes recargar en mitad del draft sin
 * perder nada, y nadie más lo ve porque no sale de tu máquina. La CSP sigue sin
 * permitir un solo dominio externo.
 *
 * ## Qué sugiere
 *
 * El mejor disponible por VOR, corregido por lo que ya tienes: cada posición
 * pierde valor para ti a medida que la llenas, porque el quinto receptor de tu
 * banquillo no juega. Sin esa corrección un board te manda coger receptores toda
 * la tarde, que es exactamente el error que un board debería evitarte.
 */

import { useEffect, useMemo, useState } from "react";

// El formateador compartido, no `toFixed`: el sitio está en español y las
// cifras llevan coma. Escribirlo aparte aquí fue exactamente el fallo que el
// barrido de QA anterior había corregido en el resto de la web.
import { num } from "../../data/model.js";

const STORAGE_KEY = "gridiron-draft-v1";

// Plantilla de una liga estándar. Lo que de verdad importa no es el número
// exacto, es que exista un tope: sin él, la sugerencia ignora que ya tienes
// cuatro corredores.
const SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1 };

// Cuánto vale para ti el siguiente jugador de una posición que ya has llenado.
// No es cero —un suplente vale algo, por lesiones y por el hueco flexible— pero
// es poco, y de ahí sale el «ya tienes suficientes corredores».
const BENCH_VALUE = 0.35;

function load() {
  if (typeof window === "undefined") return { gone: [], mine: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const state = raw ? JSON.parse(raw) : null;
    return { gone: state?.gone ?? [], mine: state?.mine ?? [] };
  } catch {
    // Un localStorage corrupto no puede impedirte draftear.
    return { gone: [], mine: [] };
  }
}

export default function DraftMode({ board }) {
  const [state, setState] = useState({ gone: [], mine: [] });
  const [ready, setReady] = useState(false);

  // El estado se lee después del primer render y no durante: el HTML lo genera
  // el servidor, donde no hay localStorage, y pintar cosas distintas en los dos
  // sitios rompe la hidratación de React.
  useEffect(() => {
    setState(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* modo privado o cuota llena: se sigue pudiendo draftear, sin recordar */
    }
  }, [state, ready]);

  const goneSet = useMemo(() => new Set(state.gone), [state.gone]);
  const mineSet = useMemo(() => new Set(state.mine), [state.mine]);

  const counts = useMemo(() => {
    const out = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const row of board) if (mineSet.has(row.player_id)) out[row.position] += 1;
    return out;
  }, [board, mineSet]);

  const available = useMemo(
    () => board.filter((row) => !goneSet.has(row.player_id) && !mineSet.has(row.player_id)),
    [board, goneSet, mineSet]
  );

  // La sugerencia: VOR ajustado por lo que ya tienes en esa posición.
  const suggestions = useMemo(() => {
    const scored = available.map((row) => {
      const filled = counts[row.position] ?? 0;
      const need = filled < (SLOTS[row.position] ?? 1) ? 1 : BENCH_VALUE;
      return { ...row, adjusted: row.vor * need };
    });
    return scored.sort((a, b) => b.adjusted - a.adjusted).slice(0, 8);
  }, [available, counts]);

  const take = (id, mine) =>
    setState((previous) => ({
      gone: mine ? previous.gone : [...previous.gone, id],
      mine: mine ? [...previous.mine, id] : previous.mine,
    }));

  const undo = (id) =>
    setState((previous) => ({
      gone: previous.gone.filter((x) => x !== id),
      mine: previous.mine.filter((x) => x !== id),
    }));

  if (!ready) {
    return <p className="caption">Cargando el modo draft…</p>;
  }

  const picked = board.filter((row) => mineSet.has(row.player_id));
  const total = state.gone.length + state.mine.length;

  return (
    <div className="draft">
      <div className="draft-head">
        <div>
          <strong>{picked.length}</strong> tuyos · <strong>{total}</strong> fuera del tablero
          {total > 0 ? (
            <>
              {" · "}
              <button type="button" className="link" onClick={() => setState({ gone: [], mine: [] })}>
                empezar de cero
              </button>
            </>
          ) : null}
        </div>
        <div className="draft-roster">
          {Object.keys(SLOTS).map((position) => (
            <span
              key={position}
              className={`slot ${counts[position] >= SLOTS[position] ? "slot--full" : ""}`}
            >
              {position} {counts[position]}/{SLOTS[position]}
            </span>
          ))}
        </div>
      </div>

      <p className="caption">
        Pulsa <strong>Yo</strong> cuando lo cojas tú y <strong>Fuera</strong> cuando se lo lleve
        otro. La lista se recalcula sola y se guarda en tu navegador: puedes recargar en mitad
        del draft. No sale de tu máquina.
      </p>

      <ol className="picks">
        {suggestions.map((row, index) => (
          <li key={row.player_id} className={index === 0 ? "pick pick--top" : "pick"}>
            <span className="pick-rank">{index === 0 ? "★" : index + 1}</span>
            <span className="pick-who">
              <span className="nm">{row.player_name}</span>
              <span className="meta">
                {row.position}
                {row.position_rank} · {row.team} · VOR {num(row.vor, 1)}
                {row.risk_label && row.risk_label !== "Normal" ? (
                  <span className={`risk risk--${row.risk_label === "Volátil" ? "high" : "low"}`}>
                    {row.risk_label}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="pick-actions">
              <button type="button" onClick={() => take(row.player_id, true)}>Yo</button>
              <button type="button" className="ghost" onClick={() => take(row.player_id, false)}>
                Fuera
              </button>
            </span>
          </li>
        ))}
      </ol>

      {picked.length > 0 ? (
        <>
          <h3>Tu plantilla</h3>
          <ul className="mine">
            {picked.map((row) => (
              <li key={row.player_id}>
                <span className={`ptag ptag--${row.position.toLowerCase()}`}>{row.position}</span>
                {row.player_name} <span className="outlet">{row.team}</span>
                <button type="button" className="link" onClick={() => undo(row.player_id)}>
                  deshacer
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
