"""UN PARTE A MEDIAS NO ES UN PARTE.

    QUE UN CLUB NO HAYA ENTREGADO NO ES QUE SUS JUGADORES ESTÉN SANOS.

El martes de la jornada 3 de 2026 habían entregado DOS clubes de treinta y dos
—los del partido del jueves, que reportan antes— y el barrido devolvía
`PUBLISHED`, así que la pantalla escribía «week 3 · 0 designations». Es la regla
5 con el signo cambiado: una AUSENCIA presentada como afirmación.

El número de clubes esperados sale del CALENDARIO y nunca de un 32 escrito a
mano — con descansos son menos, y un valor por defecto colado como
configuración real es el fallo que este repositorio lleva anotado desde
`counts[pos] or DEFAULT_STARTERS[pos]`.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd

_RUTA = Path(__file__).resolve().parents[1] / "scripts" / "weekly_research.py"
_spec = importlib.util.spec_from_file_location("weekly_research", _RUTA)
WR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(WR)


def _parte(equipos_con_filas: list[str], season: int = 2026, week: int = 3) -> pd.DataFrame:
    return pd.DataFrame([
        {"season": season, "week": week, "team": t, "gsis_id": f"00-{i:07d}",
         "full_name": f"Player {i}", "position": "WR",
         "report_status": None, "report_primary_injury": None,
         "practice_status": "Full Participation in Practice"}
        for i, t in enumerate(equipos_con_filas)
    ])


def test_parte_incompleto_no_se_publica_como_completo():
    inj = _parte(["ATL", "GB"])
    out = WR.parte_de_lesiones(inj, 2026, 3, {"ATL", "GB", "BUF", "KC"})
    assert out["status"] == "PARTIALLY_FILED"
    assert out["teams"] == 2
    assert out["teams_expected"] == 4
    assert out["teams_pending"] == ["BUF", "KC"]


def test_parte_completo_sigue_siendo_publicado():
    inj = _parte(["ATL", "GB"])
    out = WR.parte_de_lesiones(inj, 2026, 3, {"ATL", "GB"})
    assert out["status"] == "PUBLISHED"
    assert out["teams_pending"] == []


def test_sin_saber_quien_juega_no_se_degrada_el_estado():
    """Sin calendario no se puede decir que falte nadie, y tampoco se inventa.

    `teams_expected` queda en None: UNKNOWN antes que un 32 supuesto.
    """
    inj = _parte(["ATL", "GB"])
    out = WR.parte_de_lesiones(inj, 2026, 3, None)
    assert out["status"] == "PUBLISHED"
    assert out["teams_expected"] is None


def test_los_equipos_esperados_pasan_por_normalize_team():
    """`LA` y `LAR` son el mismo club, y compararlos en crudo fabrica un ausente.

    Es el `AZ`/`ARI` de la tabla de errores, aplicado a esta comparación.
    """
    inj = _parte(["LAR"])
    out = WR.parte_de_lesiones(inj, 2026, 3, {"LA"})
    assert out["teams_pending"] == [], "LA y LAR no pueden contarse como dos clubes"
    assert out["status"] == "PUBLISHED"


def test_una_jornada_vacia_sigue_siendo_no_publicado():
    """Y no se arrastra la anterior: son dos huecos distintos."""
    inj = _parte(["ATL"], week=2)
    out = WR.parte_de_lesiones(inj, 2026, 3, {"ATL", "GB"})
    assert out["status"] == "NOT_PUBLISHED_YET"
    assert out["last_published_week"] == 2
    assert out["rows"] == []


def test_el_reloj_no_fecha_un_parte_parcial_como_la_jornada():
    parcial = {"status": "PARTIALLY_FILED", "week": 3, "teams": 2, "teams_expected": 32}
    assert WR._reloj_del_parte(parcial) != "week 3"
    assert "PARTIAL" in WR._reloj_del_parte(parcial)
    assert WR._reloj_del_parte({"status": "PUBLISHED", "week": 3}) == "week 3"
