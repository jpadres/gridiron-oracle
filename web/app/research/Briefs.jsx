"use client";

/**
 * EL ARCHIVO DE PRENSA, ACOTABLE.
 *
 *     SESENTA FICHAS APILADAS NO SON UN ARCHIVO, SON UN MURO.
 *
 * La página de Research medía 24.061 píxeles: todo lo barrido, por día, sin una
 * sola forma de decir «enséñame lo de mi equipo». Cuando lo único que se puede
 * hacer con una lista es bajarla, la lista no se usa — la misma razón por la
 * que el resto de temporada no se encontraba dentro del semanal.
 *
 * Aquí no se quita ni una ficha: se filtra. Por equipo, por relevancia y por
 * texto, con los mismos chips que ya usan el board y el semanal, y el conteo
 * siempre dice cuántas hay de cuántas.
 *
 * ## Lo que este componente NO hace
 *
 * No reordena por importancia ni puntúa nada: la relevancia y el impacto los
 * trae la ficha del barrido, con su fuente. Filtrar es elegir qué mirar; jerarquizar
 * sería una opinión nueva, y la prensa de este proyecto no calcula (regla 8).
 */

import { useMemo, useState } from "react";

import { ImpactTag, Sources } from "../ui.jsx";

/** Fichas por tramo. Veinte es una sesión de lectura; sesenta es un muro. */
const TRAMO = 20;

const KIND = {
  lesion: "Injury", transaccion: "Transaction", depth_chart: "Depth chart",
  campamento: "Camp", contrato: "Contract", disciplina: "Discipline",
  esquema: "Scheme", otro: "Other",
};
const CONFIDENCE = {
  confirmado: { label: "Confirmed", hint: "Official team or league announcement." },
  informado: { label: "Reported", hint: "A named insider is reporting it." },
  rumor: { label: "Rumor", hint: "Speculation, or unnamed sources." },
};
const EVIDENCE = {
  HECHO: { label: "Fact", hint: "Official announcement from the team, the league or an injury report." },
  REPORTADO: { label: "Reported", hint: "A named writer is reporting it as their own information." },
  OBSERVADO: { label: "Observed", hint: "A reporter describing what they saw: reps, who practiced." },
  OPINION: { label: "Opinion", hint: "A named analyst expects something. That is their read, not a fact." },
  MODELO: { label: "Model", hint: "This is us, from our own numbers." },
};

const NO_DATE = "no date";
const norm = (s) => String(s ?? "").toLowerCase();

function formatDate(iso, options) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC", ...options,
  });
}
const longDate = (iso) => formatDate(iso, { weekday: "long", month: "long", day: "numeric" });

/** La ficha. Misma anatomía que la del servidor: una sola forma para una cosa. */
function Brief({ item, showDate = false }) {
  const confidence = CONFIDENCE[item.confidence] ?? CONFIDENCE.rumor;
  return (
    <article className={`note note--${item.impact}`}>
      <h3>{item.headline}</h3>
      <p className="note-meta">
        {showDate && item.date ? (
          <span className="tag">{formatDate(item.date, { month: "short", day: "numeric" })}</span>
        ) : null}
        <span className="chip">{item.team}</span>
        <span className="tag">{KIND[item.kind] ?? KIND.otro}</span>
        <ImpactTag impact={item.impact} />
        <span className={`tag tag--${item.confidence}`} title={confidence.hint}>
          {confidence.label}
        </span>
        {EVIDENCE[item.evidence_type] ? (
          <span className="prov" title={EVIDENCE[item.evidence_type].hint}>
            {EVIDENCE[item.evidence_type].label}
          </span>
        ) : null}
        {item.players?.length ? <span className="note-players">{item.players.join(", ")}</span> : null}
      </p>
      <p>{item.summary}</p>
      <Sources sources={item.sources} />
    </article>
  );
}

export default function Briefs({ items = [] }) {
  const [team, setTeam] = useState("ALL");
  const [onlyLineup, setOnlyLineup] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(TRAMO);

  /* Cualquier filtro vuelve al primer tramo. Quedarse en «60 fichas» al filtrar
     por un equipo con cuatro enseñaría las cuatro con un botón de «ver más» que
     ya no puede hacer nada — el mismo cuidado que en el board. */
  const filtrar = (accion) => { setShown(TRAMO); accion(); };

  // Los equipos salen de las fichas que HAY, no de los 32: un chip que no
  // devuelve nada es un callejón sin salida con aspecto de filtro.
  const teams = useMemo(
    () => [...new Set(items.map((i) => i.team).filter(Boolean))].sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const q = norm(query).trim();
    return items.filter((item) => {
      if (team !== "ALL" && item.team !== team) return false;
      // «Mueve una alineación» es la relevancia 4-5 que ya declara el barrido,
      // no un umbral nuevo inventado aquí.
      if (onlyLineup && Number(item.relevance) < 4) return false;
      if (q && !norm(item.headline).includes(q) && !norm(item.summary).includes(q)
          && !norm((item.players ?? []).join(" ")).includes(q)) return false;
      return true;
    });
  }, [items, team, onlyLineup, query]);

  const visibles = filtered.slice(0, shown);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const item of visibles) {
      const key = item.date || NO_DATE;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === NO_DATE) return 1;
      if (b[0] === NO_DATE) return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [visibles]);

  return (
    <>
      <div className="ros-filters">
        <div className="pos-filter" role="group" aria-label="Team">
          <button type="button" className="pos-option" aria-pressed={team === "ALL"}
                  onClick={() => filtrar(() => setTeam("ALL"))}>All teams</button>
          {teams.map((t) => (
            <button key={t} type="button" className="pos-option" aria-pressed={team === t}
                    onClick={() => filtrar(() => setTeam(t))}>{t}</button>
          ))}
        </div>
        <button type="button" className="wk-detail" aria-pressed={onlyLineup}
                onClick={() => filtrar(() => setOnlyLineup((v) => !v))}>
          {onlyLineup ? "Show everything" : "Only what moves a lineup"}
        </button>
        <label className="ros-search">
          <span className="sr-only">Search the sweep</span>
          <input type="search" value={query} placeholder="Search player, team or headline"
                 onChange={(e) => filtrar(() => setQuery(e.target.value))} />
        </label>
      </div>

      <p className="caption ros-count">
        {filtered.length === 0
          ? "Nothing in the sweep matches these filters."
          : <><strong>{filtered.length}</strong> of {items.length} briefs
              {team !== "ALL" ? <> · {team}</> : null}
              {onlyLineup ? " · relevance 4 and 5" : ""}.</>}
      </p>

      {byDay.map(([day, dayItems]) => (
        <section key={day} id={day}>
          <h3 className="day">{day === NO_DATE ? day : longDate(day)}</h3>
          {dayItems.map((item, index) => (
            <Brief key={`${day}-${index}`} item={item} />
          ))}
        </section>
      ))}

      {filtered.length > shown ? (
        <p className="board-more">
          <button type="button" className="wk-detail"
                  onClick={() => setShown((n) => n + TRAMO)}>
            Show {Math.min(TRAMO, filtered.length - shown)} more
          </button>
          <span className="caption">
            {shown} of {filtered.length} shown. Nothing is dropped — the rest is one tap away,
            or filter it down.
          </span>
        </p>
      ) : null}
    </>
  );
}
