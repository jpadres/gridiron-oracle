"""Historial del modelo por jugador: MARCA, no calcula.

Los tests son adversarios: lo que vigilan no es que la función agregue —es
corta— sino las formas en que esta capa puede mentir. Publicar un historial de
una temporada sin terminar, tocar un número de la fila, o llamar «sesgo» a un
fallo aislado.
"""

from __future__ import annotations

import pandas as pd
import pytest

from oracle.fantasy.track_record import BAND_FLOOR, attach, build, typical_error


def _board(season: int, filas: list[tuple[str, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        {"player_id": [p for p, _ in filas], "projected_points": [v for _, v in filas]}
    )


def test_una_temporada_sin_realizado_no_se_publica():
    """El fallo que caza: enseñar el «historial» de la temporada en curso."""
    with pytest.raises(ValueError, match="aún no ha terminado"):
        build({2025: _board(2025, [("a", 120.0)])}, {})


def test_el_historial_no_toca_un_solo_numero_de_la_fila():
    rec = build(
        {2024: _board(2024, [("a", 135.2)]), 2025: _board(2025, [("a", 134.3)])},
        {2024: pd.Series({"a": 336.4}), 2025: pd.Series({"a": 279.5})},
    )
    fila = {"player_id": "a", "projected_points": 117.8, "vor": -13.2, "overall_rank": 147}
    assert attach([fila], rec) == 1
    assert fila["projected_points"] == 117.8
    assert fila["vor"] == -13.2 and fila["overall_rank"] == 147
    # Y sólo escribe campos con su prefijo, para poder comprobarlo de un vistazo.
    nuevos = set(fila) - {"player_id", "projected_points", "vor", "overall_rank"}
    assert all(k.startswith("track_") for k in nuevos), nuevos


def test_el_signo_dice_en_que_direccion_falló():
    """`error` positivo = proyectó de MÁS. Confundir el signo invierte el aviso."""
    rec = build(
        {2024: _board(2024, [("h", 135.2)]), 2025: _board(2025, [("h", 134.3)])},
        {2024: pd.Series({"h": 336.4}), 2025: pd.Series({"h": 279.5})},
    )
    fila = {"player_id": "h", "projected_points": 117.8}
    # El listón de su banda, explícito: en producción sale de cientos de casos,
    # y un jugador solo no puede ser «raro» comparado consigo mismo.
    attach([fila], rec, {2: 70.0})
    assert [s["error"] for s in fila["track_seasons"]] == [-201.2, -145.2]
    assert fila["track_bias"] == "UNDER"          # se quedó CORTO las dos veces
    assert fila["track_bias_points"] == 173.2
    assert fila["track_bias_ratio"] > 1.0
    assert fila["track_last_error"] == -145.2


def test_un_fallo_aislado_no_es_un_sesgo():
    """Una temporada mala y otra buena NO se anuncian como tendencia."""
    rec = build(
        {2024: _board(2024, [("x", 200.0)]), 2025: _board(2025, [("x", 200.0)])},
        {2024: pd.Series({"x": 20.0}), 2025: pd.Series({"x": 205.0})},
    )
    fila = {"player_id": "x", "projected_points": 150.0}
    attach([fila], rec)
    assert "track_bias" not in fila
    assert len(fila["track_seasons"]) == 2


def test_dos_fallos_en_direcciones_opuestas_tampoco():
    rec = build(
        {2024: _board(2024, [("y", 200.0)]), 2025: _board(2025, [("y", 100.0)])},
        {2024: pd.Series({"y": 20.0}), 2025: pd.Series({"y": 250.0})},
    )
    fila = {"player_id": "y", "projected_points": 150.0}
    attach([fila], rec)
    assert "track_bias" not in fila, "un +180 y un -150 no son una tendencia"


def test_a_quien_el_modelo_no_proyectaba_no_se_le_inventa_historial():
    """Proyectado 20 y realizado 60 «falla por el 200%» y no significa nada."""
    rec = build(
        {2025: _board(2025, [("z", 20.0)])}, {2025: pd.Series({"z": 60.0})}
    )
    assert "z" not in rec
    fila = {"player_id": "z", "projected_points": 80.0}
    assert attach([fila], rec) == 0
    assert not any(k.startswith("track_") for k in fila)


def test_el_liston_es_el_error_tipico_de_esa_banda_y_no_una_constante():
    """El fallo que caza: un listón global que sólo describe el encogimiento.

    El modelo encoge hacia la media, así que se queda corto con casi todo el
    que acaba siendo élite. Con un listón único, la marca salía en nueve de los
    doce primeros del board y no distinguía a nadie: un fallo de 176 puntos
    sobre una proyección de 230 es lo NORMAL arriba. Lo que sí es un hecho
    sobre el jugador es equivocarse más que de costumbre para SU nivel.
    """
    # Dos jugadores con el MISMO error absoluto y proyecciones muy distintas.
    boards = {
        2024: _board(2024, [("alto", 230.0), ("bajo", 118.0)]),
        2025: _board(2025, [("alto", 230.0), ("bajo", 118.0)]),
    }
    real = {
        2024: pd.Series({"alto": 406.0, "bajo": 294.0}),   # los dos, -176
        2025: pd.Series({"alto": 406.0, "bajo": 294.0}),
    }
    rec = build(boards, real)
    # El listón de la banda alta lo fija el propio jugador alto; el de la baja,
    # el bajo. Con datos así de sintéticos los dos empatan, así que el listón se
    # pasa explícito para probar la MECÁNICA: bandas distintas, listones distintos.
    liston = {4: 200.0, 2: 60.0}     # banda de 200+ y banda de 100-150
    filas = [{"player_id": "alto", "projected_points": 230.0},
             {"player_id": "bajo", "projected_points": 118.0}]
    attach(filas, rec, liston)
    assert "track_bias" not in filas[0], "176 sobre 230 es lo normal arriba: no se marca"
    assert filas[1]["track_bias"] == "UNDER", "176 sobre 118 sí es anormal"
    assert filas[1]["track_bias_ratio"] > 1.0


def test_el_liston_se_mide_de_los_datos_y_nunca_baja_del_suelo():
    rec = build(
        {2024: _board(2024, [("a", 120.0)]), 2025: _board(2025, [("a", 120.0)])},
        {2024: pd.Series({"a": 121.0}), 2025: pd.Series({"a": 119.0})},
    )
    liston = typical_error(rec)
    assert all(v >= BAND_FLOOR for v in liston.values()), (
        "una banda con errores diminutos no puede producir un listón de casi cero: "
        "marcaría a todo el mundo"
    )


def test_no_queda_ninguna_constante_de_error_que_ajustar():
    """El fallo que caza: volver a escribir a mano «qué error es grande».

    Los dos primeros intentos fueron constantes (60, y luego el MAE global) y
    los dos mentían: el primero describía el error normal del modelo, el
    segundo describía su encogimiento. El listón tiene que salir de los datos.
    """
    import oracle.fantasy.track_record as tr

    assert not hasattr(tr, "BIG_MISS"), "vuelve a haber un umbral fijo"
    assert not hasattr(tr, "MODEL_MAE"), "vuelve a haber un MAE escrito a mano"
    assert callable(tr.typical_error), "el listón tiene que medirse, no escribirse"
