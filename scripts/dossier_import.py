#!/usr/bin/env python3
"""Importa el dossier curado desde el libro de Excel a `research/dossier.json`.

    python scripts/dossier_import.py ~/Gridiron_Oracle_PPR.xlsx

El libro no se versiona; el JSON sí, en `research/` junto al archivo diario de
prensa. Es la misma razón: son unos kilobytes de texto atribuido y fechado que
no se pueden reconstruir. El script existe para que el paso de uno a otro esté
en el repo y se pueda repetir cuando llegue un libro nuevo.

Acepta los dos libros que ha ido pasando el dueño y coge de cada uno **sólo las
hojas que no son proyecciones**. Las de proyecciones (`Draft PPR`, `Semanal S1`,
`Pronósticos`) se ignoran a propósito: esos números los produce el modelo de
este repo, y publicar cifras de un fichero externo que no se pueden regenerar ni
verificar rompería lo único que sostiene al proyecto.

El ranking de consenso (`Top 200 Rankings`) **sí** entra, y no es una excepción a
lo anterior: no se publica como proyección sino como **contraste**. Su utilidad
está justamente en el desacuerdo — dónde el modelo se separa del consenso es lo
único que un board propio puede aportar sobre uno comprado, y para verlo hacen
falta los dos.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from oracle.config import paths as resolve_paths
from oracle.data.ingest import normalize_team
from oracle.narrative import dossier

# Fila 5 del libro (base 0) es la de cabeceras; encima van el título y las notas.
HEADER_ROW = 5


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Importa el dossier curado")
    parser.add_argument("workbook", help="Ruta al .xlsx")
    parser.add_argument("--root", default=None)
    parser.add_argument("--generated", default=None, help="Fecha del libro (YYYY-MM-DD)")
    parser.add_argument("--replace", action="store_true",
                        help="Empieza de cero en vez de fusionar con el dossier existente.")
    args = parser.parse_args(argv)

    book = Path(args.workbook).expanduser()
    if not book.exists():
        print(f"No existe {book}")
        return 2

    paths = resolve_paths(args.root)
    out = paths.root / "research" / "dossier.json"

    # Se fusiona con lo que ya haya en vez de sobrescribir: los libros llegan por
    # separado y cada uno trae hojas distintas. Importar el segundo no puede
    # borrar el parte médico del primero.
    payload = {}
    if out.exists() and not args.replace:
        payload = json.loads(out.read_text(encoding="utf-8"))

    present = set(pd.ExcelFile(book).sheet_names)
    imported = []

    for name, sheet, reader in (
        ("medical", "Parte médico", _medical),
        ("medical", "Injuries", _injuries),
        ("camp", "Campamento", _camp),
        ("reporters", "Reporteros", _reporters),
        ("consensus", "Top 200 Rankings", _consensus),
        ("sources", "Sources", _sources),
        ("sleepers", "Sleepers", _sleepers),
        ("teams", "All 32 Teams", _teams),
        ("strategy", "Strategy", _strategy),
    ):
        if sheet not in present:
            continue
        header = 0 if sheet in FLAT_SHEETS else HEADER_ROW
        rows = reader(_sheet(book, sheet, header))
        if not rows:
            continue
        if name == "medical" and payload.get("medical"):
            rows = _merge_medical(payload["medical"], rows)
        payload[name] = rows
        imported.append(f"{sheet} ({len(rows)})")

    if not imported:
        print(f"{book.name} no trae ninguna hoja reconocida.")
        return 2

    payload["generated"] = args.generated or _latest_date(
        payload.get("medical", []) + payload.get("camp", [])
    )
    payload.setdefault("sources_books", [])
    if book.name not in payload["sources_books"]:
        payload["sources_books"].append(book.name)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print("Importado de", book.name + ":", ", ".join(imported))

    counts = dossier.summary(payload)
    print(
        f"Escrito {out.relative_to(paths.root)} — {counts['medical']} situaciones médicas "
        f"({counts['out']} FUERA, {counts['doubt']} DUDA) en {counts['teams']} equipos, "
        f"{counts['camp']} de campamento ({counts['camp_high']} de sustancia alta), "
        f"{counts['reporters']} reporteros."
    )
    return 0


# Hojas cuya cabecera está en la primera fila. El primer libro pone título y
# notas encima de la tabla; el segundo va directo.
FLAT_SHEETS = frozenset({
    "Top 200 Rankings", "Sources", "Sleepers", "All 32 Teams", "Strategy", "Injuries",
})


def _sheet(book: Path, name: str, header: int = HEADER_ROW) -> pd.DataFrame:
    return pd.read_excel(book, name, header=header).dropna(how="all")


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
            "team": normalize_team(_text(row.get("Equipo"))) or "",
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
            "team": normalize_team(_text(row.get("Equipo"))) or "",
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
            "team": normalize_team(_text(row.get("Equipo"))) or "",
            "name": name,
            "outlet": _text(row.get("Medio")),
            "handle": _text(row.get("X")),
        })
    rows.sort(key=lambda r: (r["team"], r["name"]))
    return rows


# Palabras que fijan el nivel de disponibilidad leyendo el estado. Es una regla
# de texto, **no un juicio médico**, igual que en el primer libro. Por eso el
# valor por defecto es DUDA y no SEGUIR: una fila que está en una hoja de
# lesiones es, como poco, una duda.
_OUT_WORDS = ("out for season", "torn acl", "ir;", "season-ending", "pup",
              "at least one month", "out for the season")
_WATCH_WORDS = ("cleared", "full participant", "expected to play", "no restrictions")


def _level_from_status(status: str) -> str:
    text = status.lower()
    if any(word in text for word in _OUT_WORDS):
        return "FUERA"
    if any(word in text for word in _WATCH_WORDS):
        return "SEGUIR"
    return "DUDA"


def _injuries(frame: pd.DataFrame) -> list[dict]:
    """La hoja de lesiones del segundo libro, al formato del parte médico."""
    rows = []
    for _, row in frame.iterrows():
        player = _text(row.get("Player"))
        if not player:
            continue
        status = _text(row.get("Status"))
        rows.append({
            "team": normalize_team(_text(row.get("Team"))) or "",
            "level": _level_from_status(status),
            "player": player,
            "position": _text(row.get("Pos")),
            "situation": status,
            # Lo que hacer y por qué importa, que el primer libro no traía.
            "status": " ".join(filter(None, [
                _text(row.get("Fantasy action")), _text(row.get("Why it matters")),
            ])),
            "source": "Master report (consenso de fuentes)",
            "date": "",
        })
    return rows


def _consensus(frame: pd.DataFrame) -> list[dict]:
    """Ranking de consenso de expertos. **No es una proyección de este modelo.**

    Entra para poder contrastar, no para publicarse como si fuera nuestro. Lo
    valioso de tenerlo al lado es el desacuerdo: dónde el modelo sube o baja a
    alguien respecto al consenso es lo único que un board propio aporta sobre uno
    comprado.
    """
    rows = []
    for _, row in frame.iterrows():
        player = _text(row.get("Player"))
        if not player:
            continue
        rows.append({
            "rank": _int(row.get("Rank")),
            "player": player,
            "position": _text(row.get("Pos")).upper(),
            "team": normalize_team(_text(row.get("Team"))) or "",
            "tier": _text(row.get("Tier")),
            "analysis": _text(row.get("Analysis")),
            "risk": _text(row.get("Risk")),
            "action": _text(row.get("Action")),
        })
    rows.sort(key=lambda r: r["rank"] or 999)
    return rows


def _sources(frame: pd.DataFrame) -> list[dict]:
    """Las fuentes, con su enlace y con la etiqueta de si están verificadas.

    La columna «Used for» del libro marca algunas como `unverified` (los hilos de
    Reddit). Eso se conserva tal cual: mezclar un hilo de foro con el reporte de
    un insider sin decirlo es exactamente lo que hace inútil una bibliografía.
    """
    rows = []
    for _, row in frame.iterrows():
        url = _text(row.get("URL"))
        if not url.startswith(("http://", "https://")):
            continue
        used = _text(row.get("Used for"))
        rows.append({
            "publisher": _text(row.get("Publisher")),
            "article": _text(row.get("Article")),
            "url": url,
            "used_for": used,
            "verified": "unverified" not in used.lower(),
        })
    return rows


def _sleepers(frame: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in frame.iterrows():
        player = _text(row.get("Player"))
        if not player:
            continue
        rows.append({
            "player": player,
            "position": _text(row.get("Pos")).upper(),
            "team": normalize_team(_text(row.get("Team"))) or "",
            "opportunity": _text(row.get("Opportunity")),
            "reason": _text(row.get("Reason to draft")),
        })
    return rows


def _teams(frame: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in frame.iterrows():
        team = normalize_team(_text(row.get("Abbrev")))
        if not team:
            continue
        rows.append({
            "team": team,
            "name": _text(row.get("Team")),
            "grade": _text(row.get("Offseason grade/context")),
            "quarterback": _text(row.get("QB situation")),
            "core": _text(row.get("Fantasy core")),
            "risks": _text(row.get("Key risks")),
            "reading": _text(row.get("Fantasy interpretation")),
        })
    return rows


def _strategy(frame: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in frame.iterrows():
        topic = _text(row.get("Topic"))
        if not topic:
            continue
        rows.append({
            "topic": topic,
            "recommendation": _text(row.get("Recommendation")),
            "reason": _text(row.get("Reason")),
            "action": _text(row.get("Action")),
        })
    return rows


def _merge_medical(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Une los partes médicos de dos libros sin duplicar al mismo jugador.

    Gana el **más grave**, no el más nuevo: si un libro dice FUERA y el otro
    SEGUIR, lo que decide una alineación es el FUERA. Empatados, gana el que
    trae fecha.
    """
    index = {(row["team"], row["player"].lower()): row for row in existing}
    for row in incoming:
        key = (row["team"], row["player"].lower())
        current = index.get(key)
        if current is None:
            index[key] = row
            continue
        if dossier.LEVELS.index(row["level"]) < dossier.LEVELS.index(current["level"]):
            index[key] = row
        elif row["level"] == current["level"] and row.get("date") and not current.get("date"):
            index[key] = row
    merged = list(index.values())
    merged.sort(key=lambda r: (dossier.LEVELS.index(r["level"]), _invert(r.get("date", ""))))
    return merged


def _int(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _invert(date: str) -> str:
    """Clave para ordenar fechas descendente dentro de un `sort` ascendente."""
    return "".join(chr(ord("9") - int(c)) if c.isdigit() else c for c in date)


def _latest_date(rows: list[dict]) -> str:
    dates = [row["date"] for row in rows if row.get("date")]
    return max(dates) if dates else ""


if __name__ == "__main__":
    raise SystemExit(main())
