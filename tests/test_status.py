"""Estado de disponibilidad: suspensiones, exentos y listas.

Los tests son adversarios a propósito. Lo que vigilan no es que la función
funcione —es corta— sino las tres formas en que esta capa puede mentir sin
fallar: tratar un estado desconocido como leve, afirmar como actual una
comprobación vieja, y tocar un número que no le corresponde.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from oracle.narrative.status import (
    SEVERITY,
    BadStatusFile,
    PlayerStatus,
    attach,
    load,
)


def _entrada(**cambios) -> dict:
    base = {
        "player_id": "00-0000001",
        "player": "Un Jugador",
        "team": "GB",
        "status": "SUSPENDED",
        "detail": "Suspended three games.",
        "games_out": 3,
        "effective_at": "2026-08-30",
        "verified_at": "2026-09-01",
        "sources": [{"outlet": "ESPN", "url": "https://example.invalid/x"}],
    }
    base.update(cambios)
    return base


def _fichero(tmp_path, entradas):
    path = tmp_path / "player_status.json"
    path.write_text(json.dumps({"season": 2026, "entries": entradas}), encoding="utf-8")
    return path


def test_sin_fichero_no_hay_estados_y_no_falla(tmp_path):
    """Que no haya estados es normal. Que el fichero esté mal, no."""
    assert load(tmp_path / "no-existe.json") == []


def test_un_estado_desconocido_no_pasa_como_leve(tmp_path):
    """El fallo que esto caza: una suspensión colándose en la lista corta.

    Si un estado nuevo se tratara como `RISK` por defecto, quien lo añadiera
    creería estar apartando a un jugador y lo estaría dejando recomendable.
    """
    path = _fichero(tmp_path, [_entrada(status="DESCONOCIDO")])
    with pytest.raises(BadStatusFile, match="desconocido"):
        load(path)


def test_dos_estados_para_el_mismo_jugador_es_un_error(tmp_path):
    path = _fichero(tmp_path, [_entrada(), _entrada(status="IR")])
    with pytest.raises(BadStatusFile, match="dos veces"):
        load(path)


@pytest.mark.parametrize("campo", ["player_id", "status", "detail", "verified_at", "sources"])
def test_una_entrada_incompleta_falla_en_el_build(tmp_path, campo):
    """Sin fuente o sin fecha no se publica. Una marca sin respaldo es un rumor."""
    path = _fichero(tmp_path, [_entrada(**{campo: None})])
    with pytest.raises(BadStatusFile):
        load(path)


def test_una_verificacion_vieja_deja_de_afirmarse_como_actual():
    """El estado dura; la comprobación caduca. Regla 5 aplicada a un estado."""
    viejo = PlayerStatus(
        player_id="x", player="X", status="EXEMPT", detail="",
        effective_at="2026-06-01", verified_at="2026-08-01", sources=(),
    )
    ahora = datetime(2026, 9, 1, tzinfo=UTC)
    assert viejo.freshness(ahora) == "LAST_VERIFIED"
    reciente = PlayerStatus(
        player_id="x", player="X", status="EXEMPT", detail="",
        effective_at="2026-06-01", verified_at="2026-08-30", sources=(),
    )
    assert reciente.freshness(ahora) == "CURRENT"


def test_una_verificacion_en_el_futuro_no_es_fresquisima():
    """Reloj mal puesto o huso mal aplicado: no se puede situar, no se afirma."""
    futuro = PlayerStatus(
        player_id="x", player="X", status="IR", detail="",
        effective_at="2026-06-01", verified_at="2026-12-01", sources=(),
    )
    assert futuro.freshness(datetime(2026, 9, 1, tzinfo=UTC)) == "LAST_VERIFIED"


def test_el_estado_no_toca_ningun_numero(tmp_path):
    """REGLA 8. La prensa marca; no calcula. Se comprueba campo a campo."""
    path = _fichero(tmp_path, [_entrada()])
    fila = {"player_id": "00-0000001", "player_name": "Un Jugador",
            "projected_points": 210.5, "vor": 33.2, "tier": 3, "position_rank": 4}
    antes = dict(fila)
    assert attach([fila], load(path)) == 1
    for campo, valor in antes.items():
        assert fila[campo] == valor, f"{campo} cambió: {antes[campo]} -> {fila[campo]}"
    assert fila["status_severity"] == "OUT"
    assert fila["status_label"] == "SUSPENDED"


def test_no_empareja_por_nombre_cuando_el_id_no_existe(tmp_path):
    """Por id o nada. Emparejar por nombre es cómo se tacha al Robinson que no era."""
    path = _fichero(tmp_path, [_entrada(player_id="00-0009999")])
    fila = {"player_id": "00-0000001", "player_name": "Un Jugador"}
    assert attach([fila], load(path)) == 0
    assert "status_label" not in fila


def test_toda_severidad_es_out_o_risk():
    """Un tercer valor obligaría a decidir qué hace la lista corta con él."""
    assert set(SEVERITY.values()) == {"OUT", "RISK"}


def test_el_fichero_versionado_del_repo_carga_y_esta_completo():
    """El de verdad, no un fixture: es el que se publica.

    Se comprueba aquí porque el fichero se edita a mano y un id mal escrito no
    falla en ningún sitio — simplemente deja al jugador sin marcar.
    """
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "research" / "player_status.json"
    if not path.exists():
        pytest.skip("sin fichero de estados en este checkout")
    entradas = load(path)
    assert entradas, "el fichero existe pero no declara ningún estado"
    for entrada in entradas:
        assert entrada.player_id.startswith("00-0"), entrada.player
        assert entrada.sources, entrada.player
        assert all(s.get("url") for s in entrada.sources), entrada.player
        # Fechas ISO de verdad: un «30/08/2026» se leería como no verificable.
        datetime.fromisoformat(entrada.effective_at)
        datetime.fromisoformat(entrada.verified_at)


def test_una_entrada_recien_verificada_dura_una_semana():
    """La ventana es de siete días: una semana de partidos."""
    entrada = PlayerStatus(
        player_id="x", player="X", status="RESERVE_PUP", detail="",
        effective_at="2026-08-01", verified_at="2026-09-01T00:00:00+00:00", sources=(),
    )
    base = datetime(2026, 9, 1, tzinfo=UTC)
    assert entrada.freshness(base + timedelta(days=6)) == "CURRENT"
    assert entrada.freshness(base + timedelta(days=8)) == "LAST_VERIFIED"
