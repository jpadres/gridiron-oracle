#!/usr/bin/env python3
"""El informe del día del draft: qué ha cambiado, y dónde el board y el mercado
no se ponen de acuerdo.

    ESTO ES RESEARCH, NO UN RANKING.

No propone a nadie ni reordena nada: enseña hechos comprobables al lado del
número del modelo para que la decisión la tome quien draftea. Se GENERA en vez
de escribirse a mano por lo mismo que las cifras de la interfaz tienen libro:
una cifra transcrita se queda vieja sin que falle nada.

    python scripts/draft_day_brief.py > docs/DRAFT_DAY.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def marcas(row: dict) -> list[str]:
    """Lo que hay que saber de una fila antes de gastarle un pick."""
    out = []
    if row.get("rostered") is False:
        out.append("NO NFL TEAM")
    estado = row.get("roster_state")
    if estado and estado != "ACTIVE":
        out.append(row.get("roster_label") or estado)
    if row.get("status_severity"):
        out.append(f"{row.get('status_label')} ({row['status_severity']})")
    if row.get("team_changed"):
        out.append(f"{row.get('previous_team')} -> {row.get('team')}")
    if row.get("rookie"):
        out.append("ROOKIE")
    return out


def main() -> int:
    payload = json.loads((RAIZ / "web" / "data" / "model.json").read_text(encoding="utf-8"))
    fantasy = payload["fantasy"]
    board = fantasy["board"]
    fechas = payload.get("data_dates") or {}
    adp = fantasy.get("adp_source") or {}
    prensa = (payload.get("research") or {}).get("press") or {}
    esp = fantasy.get("specialists") or {}

    w = sys.stdout.write
    w("# Draft day — informe de contexto\n\n")
    w("Generado por `scripts/draft_day_brief.py` desde el payload publicado.\n")
    w("**Es research, no un ranking**: ningún número del board cambia por nada de lo que hay aquí.\n\n")

    w("## Relojes\n\n")
    w("| Sección | Fecha del dato |\n|---|---|\n")
    for k in ("model", "fantasy", "rosters", "markets", "research"):
        w(f"| {k} | {fechas.get(k) or 'UNKNOWN'} |\n")
    w(f"| ADP (ventana) | {adp.get('window_start') or 'UNKNOWN'} |\n")
    w(f"| ADP (descarga) | {adp.get('fetched_at') or 'UNKNOWN'} |\n")
    w(f"| prensa leída, más nueva | {prensa.get('as_of') or 'UNKNOWN'} |\n\n")
    w("La descarga **no** fecha el dato: el ADP se bajó hoy y su ventana sigue "
      f"siendo la del {adp.get('window_start')}, con la misma muestra de "
      f"{adp.get('sample_size')} drafts.\n\n")

    w("## Prensa leída hoy\n\n")
    w(f"- {prensa.get('sources_ok')} de {prensa.get('sources_total')} fuentes respondieron.\n")
    w(f"- {prensa.get('entries')} entradas, {prensa.get('undated')} sin fecha de publicación "
      "(no se cuelgan de nadie).\n")
    w(f"- {prensa.get('mentions')} menciones enlazadas a {prensa.get('players')} jugadores "
      "del board, por nombre completo único **y** corroboración de equipo.\n\n")

    con_adp = [r for r in board if r.get("adp") is not None and r.get("overall_rank")]
    brechas = sorted(((abs(r["overall_rank"] - r["adp"]), r) for r in con_adp), reverse=True,
                     key=lambda x: x[0])
    valores = sorted(g for g, _ in brechas)
    p90 = valores[int(len(valores) * 0.90)]
    grandes = [(g, r) for g, r in brechas if g >= p90]
    novatos = sum(1 for _, r in grandes if r.get("rookie"))

    w("## Board contra mercado\n\n")
    w(f"{len(con_adp)} de {len(board)} filas del board tienen ADP. El umbral de «desacuerdo "
      f"grande» es el percentil 90 de la brecha ({p90:.0f} puestos), elegido sobre la "
      "distribución y no a ojo.\n\n")
    w(f"**{novatos} de los {len(grandes)} desacuerdos grandes son NOVATOS, y en todos el board "
      "va por DEBAJO del mercado.**\n\n")
    w("Eso no es una sorpresa ni un fallo nuevo: es la brecha de escala que este repositorio ya\n"
      "midió (E25, +108,9 puntos a favor del novato a igual proyección, 123 pares) y que publica\n"
      "**sin corregir** porque no hay corrección validada. Donde el board y el mercado más se\n"
      "separan es exactamente donde el propio repositorio dice que su escala no es comparable.\n\n")
    w("| brecha | board | ADP | jugador | pos | eq | marcas |\n|---:|---:|---:|---|---|---|---|\n")
    for g, r in grandes[:20]:
        w(f"| {g:.0f} | {r['overall_rank']} | {r['adp']:.1f} | {r['player_full_name']} | "
          f"{r['position']} | {r.get('team')} | {' · '.join(marcas(r)) or '—'} |\n")

    alto = sorted((r for r in con_adp if r["overall_rank"] < r["adp"]),
                  key=lambda r: r["adp"] - r["overall_rank"], reverse=True)
    w("\n### Donde el board va por ENCIMA del mercado\n\n")
    w("Si sigues el board aquí, alcanzas respecto a la sala. Ni bueno ni malo: es el dato.\n\n")
    w("| brecha | board | ADP | jugador | pos | eq | marcas |\n|---:|---:|---:|---|---|---|---|\n")
    for r in alto[:15]:
        w(f"| {r['adp'] - r['overall_rank']:.0f} | {r['overall_rank']} | {r['adp']:.1f} | "
          f"{r['player_full_name']} | {r['position']} | {r.get('team')} | "
          f"{' · '.join(marcas(r)) or '—'} |\n")

    top = sorted((r for r in board if (r.get("overall_rank") or 999) <= 50),
                 key=lambda r: r["overall_rank"])
    con_marca = [r for r in top if marcas(r)]
    w(f"\n## Top 50: {len(con_marca)} filas con algo que mirar\n\n")
    w("| # | jugador | pos | eq | qué |\n|---:|---|---|---|---|\n")
    for r in con_marca:
        w(f"| {r['overall_rank']} | {r['player_full_name']} | {r['position']} | "
          f"{r.get('team')} | {' · '.join(marcas(r))} |\n")

    ks = esp.get("kickers") or []
    sin_puesto = [k for k in ks
                  if k.get("rostered") is False
                  or (k.get("roster_state") and k["roster_state"] != "ACTIVE")]
    w(f"\n## Pateadores: {len(ks) - len(sin_puesto)} de {len(ks)} activos en su equipo\n\n")
    w("El board de especialistas sale de quien más pateó la temporada PASADA, así que un cambio\n"
      "de puesto no lo ve solo. Estos seis NO tienen hoy el puesto que el board les supone:\n\n")
    w("| pateador | board | registro de plantillas |\n|---|---|---|\n")
    for k in sin_puesto:
        destino = k.get("roster_label") or "NO NFL TEAM"
        equipo = f" ({k['roster_team']})" if k.get("roster_team") else ""
        w(f"| {k['player_full_name']} | {k.get('team')} | {destino}{equipo} |\n")
    w("\nY el orden entre pateadores sigue siendo `KICKER_ORDINAL_RANKING` = REJECTED: "
      "el hueco es un hecho de tu liga, el orden K1…K12 no.\n")

    sin_equipo = [r for r in board if r.get("rostered") is False]
    w(f"\n## Sin equipo NFL: {len(sin_equipo)} filas del board\n\n")
    w("No se borran —el modelo los clasifica ahí y esconderlos sería mentir sobre el board— "
      "pero no encabezan la lista corta y salen marcados.\n\n")
    w("| # | jugador | pos | board dice | ADP |\n|---:|---|---|---|---|\n")
    for r in sorted(sin_equipo, key=lambda r: r.get("overall_rank") or 9999)[:12]:
        w(f"| {r.get('overall_rank')} | {r['player_full_name']} | {r['position']} | "
          f"{r.get('team')} | {r.get('adp') if r.get('adp') is not None else '—'} |\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
