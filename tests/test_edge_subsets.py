"""Las ocho definiciones de E27, probadas a mano.

Un fallo en `_cruza_clave` no da error: define OTRO experimento y publica su
resultado bajo el nombre del preregistrado. Los casos se eligen a mano para que
la respuesta correcta y la incorrecta caigan en lados distintos — la lección del
test del turno, donde «8 picks en una liga de 4» daba lo mismo con el fallo y sin
él.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd
import pytest

# El script se carga por RUTA: `from scripts import ...` funciona con
# `python -m pytest` y NO con el ejecutable `pytest`, y CI corre el segundo.
_RUTA = Path(__file__).resolve().parents[1] / "scripts" / "edge_subsets_experiment.py"
_spec = importlib.util.spec_from_file_location("edge_subsets_experiment", _RUTA)
E27 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(E27)


@pytest.mark.parametrize(
    ("linea", "pred", "espera"),
    [
        (2.5, 4.0, True),    # cruza el 3
        (-2.5, -4.0, True),  # cruza el -3: el mismo hecho desde el visitante
        (6.5, 7.5, True),    # cruza el 7
        (1.0, 8.0, True),    # cruza los dos
        (2.5, 2.9, False),   # se mueve y no cruza nada
        (3.0, 4.0, False),   # la línea YA está en 3: estrictamente entre, no
        (4.0, 3.0, False),   # ídem al revés: el orden no importa
        (-1.0, 1.0, False),  # cruza el cero, que NO es un número clave
        (7.0, 7.0, False),   # sin desacuerdo no hay cruce
    ],
)
def test_cruza_clave(linea, pred, espera):
    assert E27._cruza_clave(linea, pred) is espera


def test_cruza_clave_3_ignora_el_siete():
    """`KEY_CROSS_3` es un subconjunto más estrecho, no el mismo con otro nombre."""
    assert E27._cruza_clave(6.5, 7.5, (3.0,)) is False
    assert E27._cruza_clave(2.5, 3.5, (3.0,)) is True


def _fila(linea, pred):
    return {"spread_line": linea, "pred_margin": pred, "margin": 0.0, "season": 2012}


def test_el_no_favorito_es_el_lado_que_RECIBE_puntos():
    """Cuatro filas construidas para que cada máscara acierte sólo una.

    `spread_line` es el margen del LOCAL: positivo = local favorito. Apostar al
    local con línea negativa es apostar a un no favorito en casa; apostar al
    visitante con línea positiva es apostar al no favorito de fuera.
    """
    frame = pd.DataFrame([
        _fila(-4.0, -1.0),   # 0: local recibe 4 y el modelo lo prefiere -> HOME_DOG
        _fila(4.0, 1.0),     # 1: local favorito y el modelo va al visitante -> AWAY_DOG
        _fila(-4.0, -7.0),   # 2: local recibe 4 y el modelo va al visitante (favorito)
        _fila(4.0, 7.0),     # 3: local favorito y el modelo lo prefiere
    ])
    m = E27.subsets(frame)
    assert list(m["HOME_DOG"]) == [True, False, False, False]
    assert list(m["AWAY_DOG"]) == [False, True, False, False]


def test_el_octavo_subconjunto_cruza_las_dos_condiciones():
    """`KEY_CROSS_AND_DOG` es el ÚNICO que consume `dog`, así que es el único que
    puede probarlo.

    La primera versión de este fichero comprobaba `HOME_DOG` y `AWAY_DOG`, que se
    construyen directos desde `pick_home & (linea < 0)` sin pasar por `dog`: al
    invertir el signo de `dog` los trece tests siguieron VERDES. La hipótesis
    estaba mal, no el guardián — y la propiedad que faltaba es ésta.
    """
    frame = pd.DataFrame([
        # cruza el -3 (entre -3,5 y -1) y la apuesta va al local, que RECIBE 3,5
        _fila(-3.5, -1.0),
        # cruza el 3 (entre 2,5 y 5) y la apuesta va al local, que es FAVORITO
        _fila(2.5, 5.0),
    ])
    m = E27.subsets(frame)
    assert list(m["KEY_CROSS"]) == [True, True], "las dos cruzan: lo que las separa es el lado"
    assert list(m["KEY_CROSS_AND_DOG"]) == [True, False]


def test_la_lista_es_cerrada_y_son_ocho():
    """El preregistro fija OCHO, y la corrección de Bonferroni depende de ese número.

    Si alguien añade un subconjunto sin tocar `N_TESTS`, la corrección se queda
    corta y el experimento publica un intervalo que no corresponde a lo que hizo.
    """
    frame = pd.DataFrame([_fila(-3.5, 1.0)])
    assert len(E27.subsets(frame)) == E27.N_TESTS == 8


def test_el_equilibrio_y_la_z_son_los_del_preregistro():
    """Las constantes se comprueban contra el DOCUMENTO, no contra sí mismas.

    Es el guardián de las cifras de portada aplicado a un experimento: si alguien
    relaja el umbral en el código, el preregistro deja de describir lo que se
    corrió y nada más falla.
    """
    doc = (Path(__file__).resolve().parents[1]
           / "docs" / "PREREGISTRO_edge_subconjuntos.md").read_text(encoding="utf-8")
    assert "52,381%" in doc and E27.BREAKEVEN == 0.52381
    assert "2.734" in doc and abs(E27.Z_CORRECTED - 2.7344) < 1e-9
    assert "n >= 200" in doc and E27.MIN_BETS == 200
    assert "2012-2019" in doc and list(E27.DISCOVERY) == list(range(2012, 2020))
    assert "2020-2025" in doc and list(E27.CONFIRM) == list(range(2020, 2026))
