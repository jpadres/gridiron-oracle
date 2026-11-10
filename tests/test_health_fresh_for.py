"""HASTA CUÁNDO SE PUEDE AFIRMAR ACTUAL: el dato que deja al navegador degradar.

La etiqueta de `/salud` se calcula al exportar y la página se lee días después.
El 10 de noviembre de 2026 enseñaba «10 de 12 FRESH» sobre un payload del 14 de
octubre: la exportación semanal llevaba tres semanas parada y la página que
existe para avisar de eso era la única que no podía verlo.

El remedio parte la pregunta como `gameClock.js`: Python fija DE CUÁNDO es el
dato y publica cuánto dura (`fresh_for_hours`), y el reloj del navegador decide
si ya pasó. Lo que estos tests guardan es que ese número salga de
`freshness.WINDOWS` —el mismo corte que usó `classify`— y no de una segunda
tabla: dos umbrales para la misma decisión es `noBet.js` otra vez.
"""

from __future__ import annotations

import datetime as dt

import pytest

from oracle import health
from oracle.freshness import USABLE_AS_CURRENT, WINDOWS, Domain, Provenance, classify

AHORA = dt.datetime(2026, 10, 14, 12, 0, tzinfo=dt.timezone.utc)


def _assess(domain, *, edad=dt.timedelta(minutes=1), timeless=False):
    return health.assess(
        name="x", feeds="y", domain=domain, origin="o",
        published_at=AHORA - edad, now=AHORA, timeless=timeless,
    )


@pytest.mark.parametrize("domain", [Domain.ODDS, Domain.INJURY_REPORT, Domain.ROSTER,
                                    Domain.NEWS, Domain.DEPTH_CHART])
def test_el_corte_es_el_mismo_que_uso_classify(domain):
    """Justo antes del corte publicado `classify` dice ACTUAL; justo después, no."""
    r = _assess(domain)
    assert r.fresh_for_hours is not None
    corte = dt.timedelta(hours=r.fresh_for_hours)
    assert corte == WINDOWS[domain][1], "el número no sale de la terna de freshness"
    for delta, esperado in ((-dt.timedelta(seconds=30), True), (dt.timedelta(seconds=30), False)):
        estado = classify(
            Provenance(domain=domain, published_at=AHORA - (corte + delta), source="o"),
            now=AHORA,
        )
        assert (estado in USABLE_AS_CURRENT) is esperado, (
            f"{domain.value}: a {corte + delta} classify dice {estado.value}")


def test_lo_que_no_caduca_no_lleva_corte():
    # Una estadística de carrera, o el board que por diseño no lee su temporada:
    # `None` es «no se degrada nunca», y el navegador lo respeta.
    assert _assess(Domain.ODDS, timeless=True).fresh_for_hours is None


def test_el_corte_viaja_al_payload():
    d = _assess(Domain.ROSTER).as_dict()
    assert d["fresh_for_hours"] == 24.0


def test_un_minuto_y_un_cuarto_de_hora_no_se_redondean_a_cero():
    # 15 minutos son 0,25 h. Redondeado a un decimal daría 0,2 —doce minutos— y
    # a entero CERO: toda cuota nacería caducada.
    assert _assess(Domain.ODDS).fresh_for_hours == 0.25
