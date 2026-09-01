"""Previa de rookie por capital de draft."""

from __future__ import annotations

import pandas as pd
import pytest

from oracle.fantasy.components import COMPONENTS, compile_points
from oracle.fantasy.rookies import (
    UDFA_ROUND,
    draft_round,
    fit,
    predict,
)
from oracle.fantasy.scoring import HALF_PPR, PPR


def _cohorte(season: int) -> list[dict]:
    filas = []
    # Primera ronda: mucho. Séptima: poco. No drafteados: casi nada.
    for pick, points in ((5, 200.0), (12, 180.0), (28, 160.0),
                         (200, 40.0), (220, 30.0), (230, 20.0)):
        for _ in range(6):
            filas.append({"season": season, "position": "RB",
                          "draft_number": pick, "points": points,
                          "draft_round": draft_round(pick)})
    for _ in range(20):
        filas.append({"season": season, "position": "RB", "draft_number": None,
                      "points": 5.0, "draft_round": UDFA_ROUND})
    return filas


@pytest.fixture
def rookies() -> pd.DataFrame:
    filas = []
    for season in range(2018, 2024):
        filas += _cohorte(season)
    return pd.DataFrame(filas)


def test_no_drafteado_no_es_una_ronda_peor_que_la_septima():
    """UDFA es una categoría aparte, no la continuación del final del draft.

    Son 1.942 jugadores de la muestra real y su distribución es distinta.
    """
    assert draft_round(1) == 1
    assert draft_round(32) == 1
    assert draft_round(33) == 2
    assert draft_round(260) == 7          # tope: no hay ronda 9
    assert draft_round(None) == UDFA_ROUND
    assert draft_round(float("nan")) == UDFA_ROUND
    assert draft_round(0) == UDFA_ROUND


def test_la_previa_solo_ve_temporadas_anteriores(rookies):
    """Walk-forward: un rookie de 2020 no puede aprender de 2023."""
    priors = fit(rookies, through_season=2020)
    # La muestra de una celda tiene que ser la de 2018-2019 y nada más.
    celda = priors[("RB", 1)]
    assert celda.sample == 2 * 3 * 6  # dos temporadas x tres picks x seis jugadores

    con_todo = fit(rookies, through_season=2024)
    assert con_todo[("RB", 1)].sample > celda.sample


def test_mejor_capital_predice_mas_puntos(rookies):
    priors = fit(rookies, through_season=2024)
    primera = predict(priors, "RB", 5)
    septima = predict(priors, "RB", 220)
    udfa = predict(priors, "RB", None)
    assert primera.shrunk_mean > septima.shrunk_mean > udfa.shrunk_mean
    assert udfa.is_udfa


def test_sin_previa_devuelve_none_y_no_un_cero(rookies):
    """Un rookie sin previa no entra en el board, y el llamador tiene que verlo.

    Es preferible un board sin rookies —lo que había— a un board con rookies
    inventados. Un 0.0 devuelto en silencio sería justo lo contrario.
    """
    priors = fit(rookies, through_season=2024)
    assert predict(priors, "K", 5) is None       # posición fuera del board
    assert predict(priors, "WR", 5) is None      # sin muestra de esa posición


def test_avisa_cuando_la_distribucion_es_bimodal():
    """Media que dobla a la mediana: o juega o no juega.

    Es el caso real del quarterback de segunda ronda — media 63,4, mediana 15,9.
    Enseñar la media sola ahí sería el peor número posible: no describe a casi
    ninguno de ellos.
    """
    filas = []
    for season in (2020, 2021, 2022):
        # Mitad titulares (200 puntos), mitad suplentes (0). Mediana baja,
        # media alta.
        for points in [200.0] * 5 + [0.0] * 15:
            filas.append({"season": season, "position": "QB", "draft_number": 40,
                          "points": points, "draft_round": 2})
    priors = fit(pd.DataFrame(filas), through_season=2023)
    celda = priors[("QB", 2)]
    assert celda.bimodal_warning is True
    assert celda.p50 < celda.mean


def _cohorte_con_componentes(season: int) -> list[dict]:
    """La misma cohorte, con los componentes que producen esos puntos en PPR.

    Los puntos NO se escriben a mano: se compilan de los componentes con las
    mismas reglas. Escribirlos aparte dejaría pasar justo el fallo que el test
    existe para cazar — que una de las dos mitades cambie sin la otra.
    """
    filas = []
    for pick, (rec, yardas, tds) in (
        (5, (70.0, 900.0, 8.0)), (12, (60.0, 800.0, 6.0)), (28, (50.0, 700.0, 5.0)),
        (200, (12.0, 150.0, 1.0)), (230, (4.0, 40.0, 0.0)),
    ):
        for _ in range(6):
            filas.append({
                "season": season, "position": "WR", "draft_number": pick,
                "draft_round": draft_round(pick),
                "receptions": rec, "receiving_yards": yardas, "receiving_tds": tds,
                "passing_yards": 0.0, "passing_tds": 0.0, "interceptions": 0.0,
                "rushing_yards": 0.0, "rushing_tds": 0.0, "fumbles_lost": 0.0,
                "two_point_conversions": 0.0,
            })
    for _ in range(20):
        filas.append({
            "season": season, "position": "WR", "draft_number": None,
            "draft_round": UDFA_ROUND,
            "receptions": 0.0, "receiving_yards": 0.0, "receiving_tds": 0.0,
            "passing_yards": 0.0, "passing_tds": 0.0, "interceptions": 0.0,
            "rushing_yards": 0.0, "rushing_tds": 0.0, "fumbles_lost": 0.0,
            "two_point_conversions": 0.0,
        })
    frame = pd.DataFrame(filas)
    frame["points"] = compile_points(frame[list(COMPONENTS)], PPR, frame["position"])
    return frame


def test_compilar_los_componentes_reproduce_los_puntos_de_la_previa():
    """La previa en componentes y la previa en puntos son la MISMA cantidad.

    Es lo que permite que un novato entre en el board por la misma puerta que un
    veterano: sus componentes se compilan con las reglas de TU liga en vez de
    llevar un número de puntos cocinado con las de otra. Si esta igualdad se
    rompe, el board publica un valor de novato que no corresponde a la
    puntuación con la que se está jugando — y no lo dice nadie.

    La tolerancia es de coma flotante (1e-9), no de modelo: son la misma suma
    hecha en distinto orden.
    """
    frame = pd.concat([_cohorte_con_componentes(s) for s in range(2018, 2024)],
                      ignore_index=True)
    priors = fit(frame, 2024)
    assert priors, "sin previas no hay nada que comprobar"
    for prior in priors.values():
        assert len(prior.components) == len(COMPONENTS)
        compilado = float(compile_points(
            pd.DataFrame([dict(zip(COMPONENTS, prior.components, strict=True))]),
            PPR,
            pd.Series([prior.position]),
        ).iloc[0])
        assert compilado == pytest.approx(prior.shrunk_mean, abs=1e-9), (
            f"{prior.position} ronda {prior.draft_round}: "
            f"{compilado} vs {prior.shrunk_mean}"
        )


def test_otra_puntuacion_cambia_el_valor_del_novato():
    """Media recepción tiene que dar MENOS que PPR. Si no, no se compiló nada.

    Un novato con un número de puntos fijo pasaría este test por accidente sólo
    si el número fuera cero. Con componentes, la diferencia es exactamente la
    que dicen las reglas.
    """
    frame = pd.concat([_cohorte_con_componentes(s) for s in range(2018, 2024)],
                      ignore_index=True)
    prior = fit(frame, 2024)[("WR", 1)]
    componentes = pd.DataFrame([dict(zip(COMPONENTS, prior.components, strict=True))])
    ppr = float(compile_points(componentes, PPR, pd.Series(["WR"])).iloc[0])
    media = float(compile_points(componentes, HALF_PPR, pd.Series(["WR"])).iloc[0])
    assert media < ppr
    # La diferencia es media recepción por recepción: comprobable a mano.
    recepciones = prior.components[COMPONENTS.index("receptions")]
    assert ppr - media == pytest.approx(0.5 * recepciones, abs=1e-9)
