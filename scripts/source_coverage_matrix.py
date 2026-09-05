"""Matriz de cobertura por equipo: qué clase de fuente ha citado el archivo para cada uno.

Cinco columnas que no se suman: oficial (sitio del equipo o de la liga), local
(prensa de la ciudad o blog de SB Nation), nacional (cabeceras), fantasy
(sitios de fantasy) y lesiones/práctica (fichas de tipo INJURY con fuente de
cualquier clase). Se cuenta sobre las fichas del archivo, cruzadas con la
clasificación del catálogo. Sale la lista de equipos más débiles: ahí es
donde buscar fuentes nuevas, y no por número.
"""
from __future__ import annotations

import glob
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from oracle.data.ingest import normalize_team  # noqa: E402
from oracle.narrative.claims import normalize_type  # noqa: E402

TEAMS = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
         "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",
         "TB", "TEN", "WAS"]
NATIONAL = {"espn.com", "nfl.com", "theathletic.com", "nytimes.com", "sports.yahoo.com", "cbssports.com",
            "nbcsports.com", "si.com", "foxsports.com", "bleacherreport.com", "usatoday.com"}
FANTASY = {"fantasypros.com", "rotowire.com", "rotoballer.com", "pff.com", "footballguys.com", "4for4.com",
           "draftsharks.com", "fantasylife.com", "fantasynerds.com", "fantasyfootballcalculator.com",
           "sharpfootballanalysis.com", "profootballnetwork.com", "thefantasyfootballers.com", "numberfire.com"}


def domain_of(url: str) -> str:
    host = urlparse(url).netloc.lower()
    for p in ("www.", "m.", "amp."):
        if host.startswith(p):
            host = host[len(p):]
    return host


def main() -> int:
    catalog = json.loads((ROOT / "research/sources.json").read_text(encoding="utf-8"))
    cls = {e["domain"]: e for e in catalog["organizations"]}
    matrix = {t: {"official": 0, "local": 0, "national": 0, "fantasy": 0, "injury_practice": 0, "items": 0} for t in TEAMS}
    unknown_team = 0
    for f in sorted(glob.glob(str(ROOT / "research/20*.json"))):
        for item in json.loads(Path(f).read_text(encoding="utf-8")).get("items", []):
            team = normalize_team(item.get("team"))
            if team not in matrix:
                unknown_team += 1
                continue
            row = matrix[team]
            row["items"] += 1
            if normalize_type(item.get("kind")) == "INJURY":
                row["injury_practice"] += 1
            for src in item.get("sources") or []:
                if not isinstance(src, dict) or not src.get("url"):
                    continue
                dom = domain_of(src["url"])
                entry = cls.get(dom) or next((e for d, e in cls.items() if dom.endswith("." + d)), None)
                basis = (entry or {}).get("classification_basis", "")
                if "oficial" in basis:
                    row["official"] += 1
                elif "local" in basis or "SB Nation" in basis:
                    row["local"] += 1
                elif dom in NATIONAL or any(dom.endswith("." + n) for n in NATIONAL):
                    row["national"] += 1
                elif dom in FANTASY:
                    row["fantasy"] += 1
    weakest = sorted(TEAMS, key=lambda t: (matrix[t]["items"], matrix[t]["local"] + matrix[t]["official"]))
    gaps = {
        "no_official_source": [t for t in TEAMS if matrix[t]["official"] == 0],
        "no_local_source": [t for t in TEAMS if matrix[t]["local"] == 0],
        "no_injury_item": [t for t in TEAMS if matrix[t]["injury_practice"] == 0],
        "fewest_items": [(t, matrix[t]["items"]) for t in weakest[:8]],
    }
    out = {"note": "cobertura OBSERVADA en el archivo de research, cruzada con la clasificación del catálogo; no es una promesa de cobertura",
           "archive_items_without_team": unknown_team, "matrix": matrix, "gaps": gaps}
    (ROOT / "docs/evidence/team_coverage.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{'team':5}{'items':>6}{'offic':>6}{'local':>6}{'natl':>6}{'fant':>6}{'inj':>5}")
    for t in TEAMS:
        r = matrix[t]
        print(f"{t:5}{r['items']:>6}{r['official']:>6}{r['local']:>6}{r['national']:>6}{r['fantasy']:>6}{r['injury_practice']:>5}")
    print("\nsin fuente OFICIAL:", len(gaps["no_official_source"]), gaps["no_official_source"])
    print("sin fuente LOCAL:", len(gaps["no_local_source"]), gaps["no_local_source"])
    print("sin ficha de LESIÓN:", gaps["no_injury_item"])
    print("menos fichas:", gaps["fewest_items"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
