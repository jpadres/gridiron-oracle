"""El barrido diario no puede degradar en silencio lo que ya funcionaba.

Contexto real, no hipotético: los días 30 y 31 de agosto de 2026 el trabajo
diario salió VERDE, no barrió nada y publicó las 45 fichas con **cero** enlaces
a jugador, vaciando las marcas del ranking y «Today's Intelligence» en
producción — y encima commiteó «research: barrido del <fecha>».

Dos causas, y aquí hay un test por cada una:

1. `out/` está en `.gitignore`, así que en CI `fantasy_weekly.json` NO EXISTE.
   El índice de enlazado se quedaba vacío y todas las fichas salían sueltas.
2. Publicar con la lista vacía SOBREESCRIBÍA la buena. Un enlazado imposible
   tiene que abortar, no reescribir peor.
"""

from __future__ import annotations

import base64
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from research_build import _publish, _ranking_players  # noqa: E402

RANKING = [
    {"player_id": "00-0000001", "player_name": "J.Allen", "team": "BUF"},
    {"player_id": "00-0000002", "player_name": "P.Nacua", "team": "LAR"},
]
FICHA = {
    "date": "2026-08-29", "headline": "Allen entrena entero", "summary": "s",
    "team": "BUF", "players": ["Josh Allen"], "sources": [], "fantasy_relevance": 3,
}


def _repo(tmp_path: Path, *, payload_ranking=RANKING, weekly=None) -> Path:
    """Un repo mínimo: archivo de research + payload versionado."""
    (tmp_path / "research").mkdir()
    (tmp_path / "research" / "2026-08-29.json").write_text(
        json.dumps({"date": "2026-08-29", "items": [FICHA]}), encoding="utf-8"
    )
    (tmp_path / "out").mkdir()
    if weekly is not None:
        (tmp_path / "out" / "fantasy_weekly.json").write_text(
            json.dumps({"rankings": weekly}), encoding="utf-8"
        )
    web = tmp_path / "web" / "data"
    web.mkdir(parents=True)
    payload = {"fantasy_weekly": {"rankings": payload_ranking}}
    blob = base64.b64encode(
        gzip.compress(json.dumps(payload).encode("utf-8"), mtime=0)
    ).decode("ascii")
    (web / "model.b64.js").write_text(f'export const MODEL_B64 = "{blob}";', encoding="utf-8")
    return tmp_path


def test_el_ranking_sale_del_payload_cuando_no_hay_out(tmp_path):
    """LA CORRECCIÓN: sin `out/fantasy_weekly.json` —o sea, en CI— el índice
    sale del payload versionado, que lleva las tres columnas necesarias."""
    root = _repo(tmp_path)
    assert not (root / "out" / "fantasy_weekly.json").exists()
    players = _ranking_players(root, root / "out")
    assert [p["player_id"] for p in players] == ["00-0000001", "00-0000002"]


def test_out_manda_sobre_el_payload_cuando_existe(tmp_path):
    """Con las dos fuentes, gana `out/`: es la recién generada."""
    fresco = [{"player_id": "00-0000009", "player_name": "N.Uevo", "team": "KC"}]
    root = _repo(tmp_path, weekly=fresco)
    assert _ranking_players(root, root / "out")[0]["player_id"] == "00-0000009"


def test_publish_enlaza_en_condiciones_de_ci(tmp_path):
    """El fallo que se vio en producción, reproducido: sin `out/`, la ficha
    tiene que salir ENLAZADA. Antes salía con `player_ids` vacío."""
    from datetime import date

    root = _repo(tmp_path)
    assert _publish(root, root / "out", date(2026, 8, 29), 10) is True
    payload = json.loads((root / "out" / "research.json").read_text(encoding="utf-8"))
    assert payload["items"][0]["player_ids"] == ["00-0000001"]


def test_sin_ranking_no_se_publica_y_no_se_pisa_lo_bueno(tmp_path):
    """FALLO INYECTADO: payload vacío y sin `out/` — enlazar es imposible.

    Debe abortar (False) y **dejar intacto** el research.json anterior. Si algún
    día esto vuelve a devolver True, el bug de producción está de vuelta.
    """
    from datetime import date

    root = _repo(tmp_path, payload_ranking=[])
    bueno = {"items": [{"headline": "previo", "player_ids": ["00-0000001"]}]}
    (root / "out" / "research.json").write_text(json.dumps(bueno), encoding="utf-8")

    assert _publish(root, root / "out", date(2026, 8, 29), 10) is False
    despues = json.loads((root / "out" / "research.json").read_text(encoding="utf-8"))
    assert despues == bueno
