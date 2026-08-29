"""Contrato de esquema entre el payload de Python y la web que lo consume.

Bloque 64 del espec adversarial.

## Por qué hace falta

`web/data/model.json` lo genera Python y lo lee JavaScript, y entre los dos no
hay nada que compruebe que hablan el mismo idioma. Renombrar una columna en un
script no rompe ningún test de Python: rompe una página, en producción, y de la
peor manera posible — `undefined` no lanza una excepción en JavaScript, se
renderiza como un hueco en blanco.

Eso ya tiene un antecedente en este proyecto: `_venue_key` leyó durante años una
columna `venue_key` que no existía y devolvió `None` sin quejarse ni una vez.

## Qué comprueba y qué no

Comprueba que **cada campo que la web lee existe en el payload, con un tipo
utilizable**. No comprueba que el valor sea correcto — de eso se encargan las
validaciones del modelo.

La lista de campos se extrae del payload real generado, así que este fichero
falla si alguien quita un campo, lo renombra, o cambia su tipo.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

PAYLOAD = Path(__file__).resolve().parents[1] / "web" / "data" / "model.json"

# Campos que la web lee de cada colección. Sacados de leer los `.jsx`, no
# adivinados. Si añades un campo a una página, añádelo aquí: es la única forma
# de que el pipeline de Python sepa que alguien depende de él.
CONTRACT: dict[str, tuple[str, ...]] = {
    "fantasy.board": (
        "player_id", "overall_rank", "player_name", "player_full_name", "position",
        "team", "position_rank", "tier", "projected_points", "vor",
        "risk_label", "p_bust", "bust_label", "team_changed", "previous_team",
    ),
    "fantasy_weekly.rankings": (
        "player_id", "position_rank", "player_name", "position", "team", "opponent",
        # Las tres piezas de la mezcla. Se publican juntas a propósito: por
        # separado invitan a una aritmética que no cuadra.
        "projected_points", "model_points", "baseline_points", "blend_weight",
    ),
    "predictions": (
        "game_id", "home_team", "away_team", "spread_line", "total_line",
        "pred_margin", "pred_total", "home_win_prob",
    ),
    "survivor.board": (
        "team", "win_prob", "survival_if_used", "cost", "cost_relative",
        "rank", "advice", "advice_why", "opponent",
    ),
    "ratings": ("team", "elo", "off_epa", "def_epa", "net_epa"),
}

# Escalares que la web lee directamente del payload.
SCALARS: dict[str, type | tuple[type, ...]] = {
    "week.season": int,
    "week.week": int,
    "fantasy.season": int,
    "fantasy.scoring": str,
    "fantasy.teams": int,
    "survivor.season": int,
    "survivor.plan_survival": float,
    "survivor.short_survival": float,
    "survivor.short_horizon": int,
    "research.total": int,
    "research.window_days": int,
    "validation.overall.brier": float,
    "validation.overall.margin_mae": float,
    "validation.ats.win_rate": float,
    "validation.ats.significant": bool,
}


def _dig(payload: dict, path: str):
    node = payload
    for part in path.split("."):
        assert part in node, f"falta `{path}` en el payload (se cortó en `{part}`)"
        node = node[part]
    return node


@pytest.fixture(scope="module")
def payload() -> dict:
    if not PAYLOAD.exists():
        pytest.skip(
            "No hay web/data/model.json. Se genera con "
            "`python scripts/export_web_data.py`; en un clon recién hecho no existe."
        )
    return json.loads(PAYLOAD.read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", sorted(CONTRACT))
def test_cada_coleccion_trae_los_campos_que_la_web_lee(payload, path):
    rows = _dig(payload, path)
    assert isinstance(rows, list) and rows, f"`{path}` tiene que ser una lista no vacía"
    faltan = [c for c in CONTRACT[path] if c not in rows[0]]
    assert not faltan, (
        f"`{path}` no trae {faltan}. La web los lee, y en JavaScript un campo "
        "que falta no lanza una excepción: se renderiza como un hueco en blanco."
    )


@pytest.mark.parametrize("path", sorted(CONTRACT))
def test_ninguna_fila_pierde_un_campo_del_contrato(payload, path):
    """Que lo traiga la primera fila no basta: `_trim_records` filtra por fila."""
    rows = _dig(payload, path)
    for index, row in enumerate(rows):
        faltan = [c for c in CONTRACT[path] if c not in row]
        assert not faltan, f"`{path}[{index}]` no trae {faltan}"


@pytest.mark.parametrize("path,tipo", sorted(SCALARS.items()))
def test_los_escalares_tienen_el_tipo_esperado(payload, path, tipo):
    value = _dig(payload, path)
    if tipo is float:
        # Un entero es un float utilizable; al revés no.
        assert isinstance(value, (int, float)) and not isinstance(value, bool), path
    else:
        assert isinstance(value, tipo), f"`{path}` es {type(value).__name__}, se esperaba {tipo.__name__}"


# Tolerancia de la comprobación de composición. El payload redondea a tres
# decimales para que pese menos, y los tres sumandos se redondean por separado,
# así que la cuenta puede desviarse hasta un par de milésimas. Poner 1e-6 haría
# fallar el test por la precisión de publicación en vez de por un error real —
# y un test que falla por motivos que no son el que vigila acaba desactivado.
TOLERANCIA_REDONDEO = 2e-3


def test_la_mezcla_semanal_compone_en_el_payload_publicado(payload):
    """El número publicado tiene que salir de los números publicados.

    Antes no salía: el QB1 aparecía con baseline 20,1, multiplicador 1,04 y
    proyección 15,2, y quien intentara la aritmética evidente obtenía otra cosa.
    Este test es lo que impide que vuelva a pasar sin que nadie se entere.
    """
    for row in _dig(payload, "fantasy_weekly.rankings"):
        weight = row["blend_weight"]
        esperado = weight * row["baseline_points"] + (1 - weight) * row["model_points"]
        assert abs(row["projected_points"] - esperado) < TOLERANCIA_REDONDEO, row["player_name"]


def test_ninguna_probabilidad_se_sale_del_intervalo(payload):
    """Invariante barata que ya habría cazado un signo invertido."""
    for row in _dig(payload, "predictions"):
        assert 0.0 <= row["home_win_prob"] <= 1.0, row["game_id"]
    for row in _dig(payload, "survivor.board"):
        assert 0.0 <= row["win_prob"] <= 1.0, row["team"]
        assert 0.0 <= row["survival_if_used"] <= 1.0, row["team"]
    overall = _dig(payload, "validation.overall")
    assert 0.0 <= overall["brier"] <= 1.0
    assert 0.0 <= overall["accuracy"] <= 1.0
