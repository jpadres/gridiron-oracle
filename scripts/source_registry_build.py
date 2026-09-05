"""Registro de fuentes DERIVADO del archivo: lo que se citó, contado por entidad.

    250 SITIOS QUE REPITEN UN INFORME NO SON 250 FUENTES.

Recorre `research/<fecha>.json` y escribe en `research/sources.json` las
secciones `organizations`, `authors` y `rejected` a partir de los enlaces que
las fichas citan. No inventa nada: cada entrada lleva cuántas veces se citó,
desde cuándo, en qué beats y sobre qué tipos de afirmación. Los `providers`
(nflverse, Sleeper) no se tocan: son otra familia y se curan a mano.

Clasificación, con su base escrita en la propia entrada:

    VETTED      medio de referencia declarado en el prompt del barrido o en
                la lista curada de abajo (oficiales, insiders, prensa local)
    DISCOVERED  citado por el barrido y no revisado a mano todavía
    REDUNDANT   agregador que reescribe informes ajenos: cuenta como eco,
                nunca como origen (sources/lineage.py)
    REJECTED    no es prensa deportiva (streaming, entradas, tiendas)

`ingestible` es `null` para todas: no hay ningún feed verificado, y decir
«ingestible» sin haber leído un RSS sería la fecha de descarga disfrazada de
frescura, aplicada a un catálogo. Cuando se verifique uno, irá en `feeds`.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from oracle.narrative.claims import normalize_type  # noqa: E402

ARCHIVE = ROOT / "research"
CATALOG = ARCHIVE / "sources.json"

# Medios de referencia: los que nombra el prompt del barrido y los oficiales.
VETTED = {
    "espn.com": "nombrado en el prompt del barrido",
    "nfl.com": "nombrado en el prompt del barrido; notas oficiales de la liga",
    "theathletic.com": "nombrado en el prompt del barrido",
    "nytimes.com": "The Athletic publica bajo nytimes.com",
    "sports.yahoo.com": "nombrado en el prompt del barrido",
    "cbssports.com": "nombrado en el prompt del barrido",
    "nbcsports.com": "Pro Football Talk, nombrado en el prompt del barrido",
    "profootballtalk.nbcsports.com": "Pro Football Talk, nombrado en el prompt del barrido",
    "si.com": "cabecera nacional con cobertura de beat",
    "foxsports.com": "cabecera nacional",
    "pff.com": "datos de charting propios (origen, no eco)",
    "fantasypros.com": "consenso de expertos: agregación DECLARADA, no reescritura",
    "rotowire.com": "notas de plantilla con fuente citada",
}
# Prensa local y blogs de la red SB Nation que el prompt admite por familia.
LOCAL_PATTERNS = (
    r"\.sbnation\.com$", r"seattletimes\.com$", r"latimes\.com$", r"chicagotribune\.com$",
    r"dallasnews\.com$", r"houstonchronicle\.com$", r"ajc\.com$", r"philly\.com$",
    r"inquirer\.com$", r"star-telegram\.com$", r"nj\.com$", r"nydailynews\.com$",
    r"nypost\.com$", r"masslive\.com$", r"bostonglobe\.com$", r"baltimoresun\.com$",
    r"cleveland\.com$", r"dispatch\.com$", r"freep\.com$", r"jsonline\.com$",
    r"startribune\.com$", r"kansascity\.com$", r"denverpost\.com$", r"azcentral\.com$",
    r"sfchronicle\.com$", r"mercurynews\.com$", r"pressdemocrat\.com$", r"pittsburgh",
    r"post-gazette\.com$", r"tampabay\.com$", r"miamiherald\.com$", r"sun-sentinel\.com$",
    r"jacksonville\.com$", r"tennessean\.com$", r"indystar\.com$", r"courier-journal",
    r"charlotteobserver\.com$", r"newsobserver\.com$", r"nola\.com$", r"buffalonews\.com$",
    r"oregonlive\.com$", r"reviewjournal\.com$", r"nbcsportsbayarea\.com$", r"suntimes\.com$",
    r"nbcsportsboston\.com$", r"nbcsportsphiladelphia\.com$", r"nbcsportschicago\.com$",
    r"^[a-z0-9-]+\.com$",  # placeholder que NUNCA casa solo: se combina abajo
)
_LOCAL = [re.compile(p) for p in LOCAL_PATTERNS[:-1]]
# Sitios oficiales de equipo: los 32 dominios son distintos y no todos son
# `*.com` obvios, así que se lista lo que el archivo ya citó y se amplía a mano.
TEAM_SITES = {
    "seahawks.com", "patriots.com", "chiefs.com", "49ers.com", "eagles.com", "cowboys.com",
    "packers.com", "steelers.com", "ravens.com", "bengals.com", "browns.com", "bills.com",
    "dolphins.com", "jets.com", "texans.com", "colts.com", "jaguars.com", "titansonline.com",
    "broncos.com", "chargers.com", "raiders.com", "giants.com", "commanders.com",
    "bears.com", "lions.com", "vikings.com", "atlantafalcons.com", "panthers.com",
    "neworleanssaints.com", "buccaneers.com", "azcardinals.com", "therams.com",
}
# Agregadores que reescriben: eco, no origen.
REDUNDANT = {
    "yardbarker.com": "agregador: reescribe informes ajenos",
    "clutchpoints.com": "agregador: reescribe informes ajenos",
    "heavy.com": "agregador: reescribe informes ajenos",
    "athlonsports.com": "agregador: reescribe informes ajenos",
    "msn.com": "sindicación: republica artículos de otros medios",
    "profootballrumors.com": "agregador declarado: resume y enlaza informes ajenos",
    "bleacherreport.com": "mayoritariamente reescritura; origen sólo con firma de insider",
    "sportskeeda.com": "agregador: reescribe informes ajenos",
    "essentiallysports.com": "agregador: reescribe informes ajenos",
    "totalprosports.com": "agregador: reescribe informes ajenos",
    "thespun.com": "agregador: reescribe informes ajenos",
    "larrybrownsports.com": "agregador: reescribe informes ajenos",
    "nesn.com": "reescritura salvo cobertura local de NE",
    "marca.com": "reescritura para el mercado hispano",
    "as.com": "reescritura para el mercado hispano",
}
REJECTED = {
    "netflix.com": "streaming: no es prensa",
    "nflshop.com": "tienda",
    "ticketmaster.com": "entradas",
    "stubhub.com": "entradas",
    "wikipedia.org": "enciclopedia: no es fuente primaria de actualidad",
    "youtube.com": "vídeo sin texto verificable ni fecha de hecho fiable",
    "x.com": "red social: el linaje es del autor, no del dominio",
    "twitter.com": "red social: el linaje es del autor, no del dominio",
}


_KNOWN = tuple(sorted(set(VETTED) | set(REDUNDANT) | set(REJECTED), key=len, reverse=True))


def domain_of(url: str) -> str | None:
    """El dominio de la ORGANIZACIÓN: `ca.sports.yahoo.com` es Yahoo Sports.

    Treinta y dos subpáginas de un medio no son treinta y dos organizaciones,
    y una edición regional tampoco. Un subdominio de un dominio conocido se
    pliega al conocido; lo desconocido se deja entero, que es no inventar.
    """
    host = urlparse(url).netloc.lower()
    host = re.sub(r"^(www|m|amp)\.", "", host)
    for known in _KNOWN:
        if host == known or host.endswith("." + known):
            return known
    return host or None


def classify(domain: str) -> tuple[str, str]:
    if domain in REJECTED:
        return "REJECTED", REJECTED[domain]
    if domain in REDUNDANT:
        return "REDUNDANT", REDUNDANT[domain]
    if domain in VETTED:
        return "VETTED", VETTED[domain]
    if domain in TEAM_SITES:
        return "VETTED", "sitio oficial del equipo"
    if any(p.search(domain) for p in _LOCAL):
        return "VETTED", "prensa local o blog de SB Nation, familias que el prompt admite"
    return "DISCOVERED", "citado por el barrido; sin revisión manual"


STATE = {"VETTED": "MANUAL_REFERENCE", "DISCOVERED": "MANUAL_REFERENCE",
         "REDUNDANT": "MANUAL_REFERENCE", "REJECTED": "REJECTED"}


def build() -> dict:
    files = sorted(ARCHIVE.glob("20*.json"))
    orgs: dict[str, dict] = {}
    authors: dict[tuple[str, str], dict] = {}
    for f in files:
        day = json.loads(f.read_text(encoding="utf-8"))
        stamp = day.get("date") or f.stem
        for item in day.get("items", []):
            ctype = normalize_type(item.get("kind"))
            beat = item.get("beat")
            for src in item.get("sources") or []:
                if not isinstance(src, dict) or not src.get("url"):
                    continue
                dom = domain_of(src["url"])
                if not dom:
                    continue
                o = orgs.setdefault(dom, {
                    "citations": 0, "outlets": Counter(), "beats": Counter(),
                    "claim_types": Counter(), "first_cited": stamp, "last_cited": stamp,
                    "authored": 0,
                })
                o["citations"] += 1
                o["outlets"][src.get("outlet") or dom] += 1
                if beat:
                    o["beats"][beat] += 1
                o["claim_types"][ctype] += 1
                o["first_cited"] = min(o["first_cited"], stamp)
                o["last_cited"] = max(o["last_cited"], stamp)
                if src.get("author"):
                    o["authored"] += 1
                    a = authors.setdefault((src["author"].strip(), dom), {
                        "citations": 0, "first_cited": stamp, "last_cited": stamp,
                        "beats": Counter(),
                    })
                    a["citations"] += 1
                    a["first_cited"] = min(a["first_cited"], stamp)
                    a["last_cited"] = max(a["last_cited"], stamp)
                    if beat:
                        a["beats"][beat] += 1

    organizations, rejected = [], []
    for dom, o in sorted(orgs.items(), key=lambda kv: (-kv[1]["citations"], kv[0])):
        cls, basis = classify(dom)
        entry = {
            "source_id": f"org.{dom}",
            "name": o["outlets"].most_common(1)[0][0],
            "kind": "ORGANIZATION",
            "domain": dom,
            "classification": cls,
            "classification_basis": basis,
            "state": STATE[cls],
            "ingestible": None,
            "citations": o["citations"],
            "citations_with_author": o["authored"],
            "first_cited": o["first_cited"],
            "last_cited": o["last_cited"],
            "beats": dict(o["beats"].most_common()),
            "claim_types": dict(o["claim_types"].most_common()),
            "counts_as_origin": cls in {"VETTED", "DISCOVERED"},
        }
        (rejected if cls == "REJECTED" else organizations).append(entry)

    author_entries = [
        {
            "source_id": f"author.{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}@{dom}",
            "name": name, "kind": "AUTHOR", "organization": dom,
            "classification": "DISCOVERED",
            "classification_basis": "firma citada por el barrido; sin revisión manual",
            "state": "MANUAL_REFERENCE",
            "citations": a["citations"], "first_cited": a["first_cited"],
            "last_cited": a["last_cited"], "beats": dict(a["beats"].most_common()),
        }
        for (name, dom), a in sorted(authors.items(), key=lambda kv: (-kv[1]["citations"], kv[0]))
    ]
    return {
        "organizations": organizations, "authors": author_entries, "rejected": rejected,
        "archive_files": [f.name for f in files],
    }


def main() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    derived = build()
    catalog["organizations"] = derived["organizations"]
    catalog["authors"] = derived["authors"]
    catalog["rejected"] = derived["rejected"]
    catalog["derived"] = {
        "at": date.today().isoformat(),
        "from": derived["archive_files"],
        "rule": "organizations/authors/rejected se DERIVAN del archivo con este script; providers y feeds se curan a mano",
    }
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    by = Counter(e["classification"] for e in derived["organizations"] + derived["rejected"])
    print(f"organizations {len(derived['organizations'])} · authors {len(derived['authors'])}"
          f" · rejected {len(derived['rejected'])} · {dict(by)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
