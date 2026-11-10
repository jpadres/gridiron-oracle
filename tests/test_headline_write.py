"""`check_headline_metrics.py --write`: que publicar no deje CI en rojo.

La muestra del backtest crece cada jornada. Cada publicación semanal movía las
cifras del payload y dejaba la comprobación de portada en rojo hasta que alguien
corregía tres documentos a mano; nadie lo hacía, y ese rojo permanente tapó en
octubre de 2026 tres semanas de exportación parada.

Lo que se guarda aquí:

  1. el modo que escribe deja los documentos como el modo que lee los exige;
  2. sólo toca dígitos — ni una palabra de la prosa;
  3. y se NIEGA cuando el titular dejaría de ser cierto, sin escribir nada.
"""

from __future__ import annotations

import importlib.util
import re
import shutil
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
DOCS = ("README.md", "CLAUDE.md", "docs/ESTADO.md")

# El script se carga por RUTA: `from scripts import …` funciona con
# `python -m pytest` y no con `pytest`, que es el comando que corre CI.
_spec = importlib.util.spec_from_file_location(
    "check_headline_metrics", RAIZ / "scripts" / "check_headline_metrics.py")
chm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(chm)

BASE = {"games": 4012, "brier": 0.21311, "market_brier": 0.21234,
        "margin_mae": 10.071, "market_margin_mae": 9.992,
        "free_brier": 0.21901, "free_margin_mae": 10.312}


@pytest.fixture()
def copia(tmp_path, monkeypatch):
    """Los tres documentos de verdad, copiados: los patrones son los reales."""
    for doc in DOCS:
        destino = tmp_path / doc
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(RAIZ / doc, destino)
    monkeypatch.setattr(chm, "RAIZ", tmp_path)

    def con(overall):
        monkeypatch.setattr(chm, "payload", lambda: {"validation": {"overall": overall}})
        return tmp_path

    return con


def _sin_digitos(texto: str) -> str:
    return re.sub(r"\d", "#", texto)


def test_escribe_y_despues_el_modo_que_lee_pasa(copia):
    raiz = copia(BASE)
    assert chm.main([]) == 1, "el fixture tiene que partir de documentos desfasados"
    assert chm.main(["--write"]) == 0
    assert chm.main([]) == 0
    claude = (raiz / "CLAUDE.md").read_text(encoding="utf-8")
    assert "Brier **0.2131**" in claude and "en 4.012 partidos" in claude
    # La brecha se DERIVA: 0.21311 - 0.21234 y 10.071 - 9.992.
    assert "0,0008 de" in claude and "0,079 de MAE" in claude


def test_solo_toca_digitos(copia):
    raiz = copia(BASE)
    antes = {doc: (raiz / doc).read_text(encoding="utf-8") for doc in DOCS}
    assert chm.main(["--write"]) == 0
    for doc in DOCS:
        despues = (raiz / doc).read_text(encoding="utf-8")
        # Que haya cambiado ALGO: si no, lo de abajo se cumpliría en vacío.
        assert despues != antes[doc], f"{doc}: --write no tocó nada"
        assert _sin_digitos(despues) == _sin_digitos(antes[doc]), (
            f"{doc}: --write cambió algo que no es una cifra")


@pytest.mark.parametrize("cambio", [
    {"brier": 0.2100},                       # el modelo «bate» al mercado en Brier
    {"margin_mae": 9.90},                    # o en MAE
    {"brier": 0.21274},                      # brecha 0,0004: ya no es MAYOR que 0,0005
    {"margin_mae": 10.015},                  # brecha 0,023: ya no es mayor que 0,03
])
def test_se_niega_cuando_el_titular_dejaria_de_ser_cierto(copia, cambio):
    raiz = copia({**BASE, **cambio})
    antes = {doc: (raiz / doc).read_text(encoding="utf-8") for doc in DOCS}
    assert chm.main(["--write"]) == 1
    for doc in DOCS:
        assert (raiz / doc).read_text(encoding="utf-8") == antes[doc], (
            f"{doc} se reescribió con un titular que ya no es cierto")


def test_si_una_frase_ya_no_casa_no_se_escribe_NADA(copia):
    raiz = copia(BASE)
    readme = raiz / "README.md"
    readme.write_text(
        readme.read_text(encoding="utf-8").replace("| MAE del margen |", "| MAE margen |"),
        encoding="utf-8")
    antes = {doc: (raiz / doc).read_text(encoding="utf-8") for doc in DOCS}
    assert chm.main(["--write"]) == 1
    for doc in DOCS:
        assert (raiz / doc).read_text(encoding="utf-8") == antes[doc], (
            f"{doc}: medio documento corregido es peor que ninguno")


def test_el_workflow_semanal_lo_corre_y_publica_los_documentos():
    yml = (RAIZ / ".github/workflows/weekly-predictions.yml").read_text(encoding="utf-8")
    pasos = "\n".join(ln for ln in yml.splitlines() if not ln.lstrip().startswith("#"))
    exporta = pasos.find("python scripts/export_web_data.py")
    escribe = pasos.find("python scripts/check_headline_metrics.py --write")
    publica = pasos.find("scripts/ci_publish.sh")
    assert 0 < exporta < escribe < publica, (
        "las cifras se ponen al día DESPUÉS de exportar y ANTES de publicar")
    orden = pasos[publica:publica + 400]
    for doc in ("web/data/model.b64.js", *DOCS):
        assert doc in orden, f"el commit semanal no lleva {doc}: CI volvería a quedar rojo"
