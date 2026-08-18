#!/usr/bin/env python3
"""Importa el dossier curado desde el libro de Excel a `research/dossier.json`.

    python scripts/dossier_import.py ~/Gridiron_Oracle_PPR.xlsx

El libro no se versiona; el JSON sí, en `research/` junto al archivo diario de
prensa. Es la misma razón: son unos kilobytes de texto atribuido y fechado que
no se pueden reconstruir. El script existe para que el paso de uno a otro esté
en el repo y se pueda repetir cuando llegue un libro nuevo.

Tres hojas y nada más. Las de proyecciones (`Draft PPR`, `Semanal S1`,
`Pronósticos`) se ignoran a propósito: esos números los produce el modelo de
este repo, y aceptar los de un fichero externo sería publicar cifras que no se
pueden regenerar ni verificar.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.narrative import dossier

# Fila 5 del libro (base 0) es la de cabeceras; encima van el título y las notas.
HEADER_ROW = 5


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importa el dossier curado")
    parser.add_argument("workbook", help="Ruta al .xlsx")
    parser.add_argument("--root", default=None)
    parser.add_argument("--generated", default=None, help="Fecha del libro (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    book = Path(args.workbook).expanduser()
    if not book.exists():
        print(f"No existe {book}")
        return 2

    paths = resolve_paths(args.root)
    medical = _medical(_sheet(book, "Parte médico"))
    camp = _camp(_sheet(book, "Campamento"))
    reporters = _reporters(_sheet(book, "Reporteros"))

    payload = {
        "generated": args.generated or _latest_date(medical + camp),
        "source": book.name,
        "medical": medical,
        "camp": camp,
        "reporters": reporters,
    }
    out = paths.root / "research" / "dossier.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = dossier.summary(payload)
    print(
        f"Escrito {out.relative_to(paths.root)} — {counts['medical']} situaciones médicas "
        f"({counts['out']} FUERA, {counts['doubt']} DUDA) en {counts['teams']} equipos, "
        f"{counts['camp']} de campamento ({counts['camp_high']} de sustancia alta), "
        f"{counts['reporters']} reporteros."
    )
    return 0


def _sheet(book: Path, name: str) -> pd.DataFrame:
    return pd.read_excel(book, name, header=HEADER_ROW).dropna(how="all")


def _text(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip()


def _date(value: object) -> str:
    """Fechas a YYYY-MM-DD. El libro las trae como texto o como timestamp."""
    if pd.isna(value):
        return ""
    if isinstance(value, str):
        return value.strip()[:10]
    return pd.Timestamp(value).date().isoformat()


def _medical(frame: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in frame.iterrows():
        player = _text(row.get("Jugador"))
        if not player:
            continue
        rows.append({
            "team": _text(row.get("Equipo")).upper(),
            "level": dossier.normalise_level(row.get("Nivel")),
            "player": player,
            "position": _text(row.get("Pos")),
            "situation": _text(row.get("Situación")),
            "status": _text(row.get("Estado")),
            "source": _text(row.get("Fuente")),
            "date": _date(row.get("Fecha")),
        })
    # FUERA primero y, dentro de cada nivel, lo más reciente arriba.
    rows.sort(key=lambda r: (dossier.LEVELS.index(r["level"]), _invert(r["date"])))
    return rows


def _camp(frame: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in frame.iterrows():
        player = _text(row.get("Jugador"))
        if not player:
            continue
        rows.append({
            "team": _text(row.get("Equipo")).upper(),
            "substance": dossier.normalise_substance(row.get("Sustancia")),
            "player": player,
            "position": _text(row.get("Pos")),
            "report": _text(row.get("Qué reportan")),
            "source": _text(row.get("Fuente")),
            "date": _date(row.get("Fecha")),
        })
    rows.sort(key=lambda r: (dossier.SUBSTANCE.index(r["substance"]), _invert(r["date"])))
    return rows


def _reporters(frame: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in frame.iterrows():
        name = _text(row.get("Reportero"))
        if not name:
            continue
        rows.append({
            "team": _text(row.get("Equipo")).upper(),
            "name": name,
            "outlet": _text(row.get("Medio")),
            "handle": _text(row.get("X")),
        })
    rows.sort(key=lambda r: (r["team"], r["name"]))
    return rows


def _invert(date: str) -> str:
    """Clave para ordenar fechas descendente dentro de un `sort` ascendente."""
    return "".join(chr(ord("9") - int(c)) if c.isdigit() else c for c in date)


def _latest_date(rows: list[dict]) -> str:
    dates = [row["date"] for row in rows if row.get("date")]
    return max(dates) if dates else ""


if __name__ == "__main__":
    raise SystemExit(main())
