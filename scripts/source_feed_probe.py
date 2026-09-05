"""Sondeo TÉCNICO de feeds para las organizaciones del catálogo.

Para cada dominio prueba las rutas habituales de RSS/Atom y anota lo que
contestó: código HTTP, tipo de contenido, si el XML parsea, cuántos ítems,
si traen fecha e id estables. Es un hecho de red desde ESTE entorno en ESTA
fecha —no una afirmación de ingestibilidad—, y por eso se guarda con
`checked_from` y `checked_at`, y aparte de la clasificación editorial.

    UN FEED NO PROBADO NO ES «INGESTIBLE». UNO PROBADO HOY NO LO ES MAÑANA.
"""
from __future__ import annotations

import json
import os
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "research/sources.json"
OUT = ROOT / "docs/evidence/feed_probe.json"
PATHS = ("/feed", "/feed/", "/rss", "/rss.xml", "/feeds/rss", "/rss/index.xml", "/?feed=rss2",
         "/arc/outboundfeeds/rss/", "/atom.xml", "/feed.xml", "/index.xml")
TIMEOUT = 10
UA = "GridironOracle-feed-probe/1.0 (+https://gridiron-oracle-five.vercel.app; contact: repo owner)"


def _get(url: str) -> tuple[int | None, str, bytes, str | None]:
    req = request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"})
    try:
        with request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 - sólo https a dominios del catálogo
            body = resp.read(400_000)
            return resp.status, resp.headers.get("Content-Type", ""), body, None
    except error.HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type", "") if exc.headers else "", b"", None
    except (error.URLError, TimeoutError, ConnectionError, OSError, ValueError) as exc:
        return None, "", b"", type(exc).__name__ + ": " + str(exc)[:120]


def _parse_feed(body: bytes) -> dict | None:
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return None
    tag = root.tag.lower()
    items = root.findall(".//item") if "rss" in tag or root.find("channel") is not None else []
    ns = "{http://www.w3.org/2005/Atom}"
    entries = root.findall(f".//{ns}entry")
    kind = "rss" if items else ("atom" if entries else None)
    if not kind:
        return None
    rows = items or entries
    def has(el, *names):
        return any(el.find(n) is not None and (el.find(n).text or "").strip() for n in names)
    dated = sum(1 for e in rows if has(e, "pubDate", "dc:date", f"{ns}published", f"{ns}updated", "{http://purl.org/dc/elements/1.1/}date"))
    ids = sum(1 for e in rows if has(e, "guid", f"{ns}id", "link", f"{ns}link"))
    links = [((e.find("link").text if e.find("link") is not None else None) or (e.find(f"{ns}link").get("href") if e.find(f"{ns}link") is not None else None)) for e in rows[:3]]
    return {"kind": kind, "items": len(rows), "items_with_date": dated, "items_with_id": ids, "sample_links": [x for x in links if x]}


def probe(domain: str) -> dict:
    result = {"domain": domain, "root_status": None, "root_error": None, "feeds": [], "best": None}
    status, ctype, body, err = _get(f"https://{domain}/")
    result["root_status"], result["root_error"] = status, err
    for path in PATHS:
        url = f"https://{domain}{path}"
        status, ctype, body, err = _get(url)
        entry = {"url": url, "status": status, "content_type": ctype[:60], "error": err}
        parsed = _parse_feed(body) if body else None
        if parsed:
            entry.update(parsed)
            result["feeds"].append(entry)
            if result["best"] is None or parsed["items"] > result["best"].get("items", 0):
                result["best"] = entry
            if parsed["items"] >= 5:
                break
        elif status in (401, 402, 403, 429, 451):
            result["feeds"].append(entry)
    return result


def main() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    domains = [e["domain"] for e in catalog["organizations"]]
    if len(sys.argv) > 1:
        domains = [d for d in domains if d in sys.argv[1:]]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(probe, domains))
    out = {
        "checked_from": "development container via egress proxy" if os.environ.get("HTTPS_PROXY") else "development container",
        "checked_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "note": "estado TÉCNICO de red en esta fecha desde este entorno; no es una clasificación editorial ni una promesa de ingestibilidad",
        "domains": len(results),
        "with_feed": sum(1 for r in results if r["best"]),
        "root_unreachable": sum(1 for r in results if r["root_status"] is None),
        "results": results,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out['domains']} dominios · con feed parseable: {out['with_feed']} · raíz inalcanzable: {out['root_unreachable']}")
    for r in results:
        b = r["best"]
        print(f"  {r['domain']:34} raíz={r['root_status']!s:5} {('feed ' + b['kind'] + ' ' + str(b['items']) + ' items, fechas ' + str(b['items_with_date']) + ', ids ' + str(b['items_with_id'])) if b else ('sin feed' + (' · ' + r['root_error'] if r['root_error'] else ''))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
