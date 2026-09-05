"""Cobertura de identidad de las afirmaciones del archivo contra el board publicado.

Mide, no adivina: cuántas afirmaciones se cuelgan de un jugador por el índice
canónico, cuántas quedan sin resolver y cuántas son ambiguas. Sale como JSON
en docs/evidence para que el número publicado tenga fichero.
"""
from __future__ import annotations

import base64
import glob
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from oracle.narrative.claims import (  # noqa: E402
    claims_from_archive,
    coverage,
    link,
    resolve_identities,
)


def payload() -> dict:
    src = (ROOT / "web/data/model.b64.js").read_text(encoding="utf-8")
    m = re.search(r'"([A-Za-z0-9+/=]+)"', src)
    return json.loads(gzip.decompress(base64.b64decode(m.group(1))))


def main() -> int:
    data = payload()
    fantasy = data["fantasy"]
    players = list(fantasy["board"]) + list(fantasy.get("specialists", {}).get("kickers", [])) \
        + list(fantasy.get("specialists", {}).get("defenses", [])) + list(fantasy.get("rookies") or [])
    days = [json.loads(Path(f).read_text(encoding="utf-8")) for f in sorted(glob.glob(str(ROOT / "research/20*.json")))]
    claims = link(resolve_identities(claims_from_archive(days), players))
    cov = coverage(claims)
    out = {
        "claims": cov["claims"], "identity": cov["identity"], "product_linked": cov["product_linked"],
        "with_published_at": cov["with_published_at"], "disputed": cov["disputed"], "superseded": cov["superseded"],
        "board_players": len(players), "archive_files": len(days),
        "ambiguous_examples": sorted({f"{c.subject_raw} ({c.team})" for c in claims if c.identity_status == "AMBIGUOUS"})[:20],
        "unresolved_examples": sorted({f"{c.subject_raw} ({c.team})" for c in claims if c.identity_status == "UNRESOLVED"})[:30],
    }
    (ROOT / "docs/evidence").mkdir(exist_ok=True)
    (ROOT / "docs/evidence/claims_identity.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in out.items() if "examples" not in k}, ensure_ascii=False))
    print("ambiguos:", out["ambiguous_examples"])
    print("sin resolver (muestra):", out["unresolved_examples"][:12])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
