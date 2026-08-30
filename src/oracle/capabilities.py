"""Registro de capacidades: qué puede y qué no puede afirmar este producto.

Bloques D y E del Decision Lab V2.

## El problema que resuelve

Un modelo puede producir un número perfectamente utilizable y **aun así no tener
autoridad para respaldar una recomendación**. Las dos cosas a la vez.

El caso que motivó esto: el modelo de quarterback proyecta puntos razonables
—T.Lawrence 22,6— y la capacidad de recomendar Start/Sit de QB **no está
validada**: pierde contra la media ponderada de sus seis últimos partidos por
tres vías independientes (Spearman 0,213 vs 0,248; acierto por pares 54,2% vs
54,4%; y el MAE sólo gana tras mezclar). La interfaz puede enseñar ese 22,6.
No puede decir «alinea a Lawrence».

Sin un sitio donde esté escrito, esa distinción vive en la cabeza de quien
programa la pantalla, y dura hasta la siguiente pantalla.

## Cómo funciona

    SALIDA DEL MODELO -> ESTADO DE VALIDACIÓN -> AUTORIDAD -> PRESENTACIÓN

La autoridad se **deriva** del estado, el estado sale de un experimento con su
número, y el registro entero viaja al payload. La interfaz no puede presentar
una capacidad con más autoridad de la que este fichero permite, y eso lo
comprueba un test en vez de la disciplina de quien escriba el JSX.

## Regla de mantenimiento

Cambiar un `status` **exige** cambiar `experiment_id`, `metric` y
`last_validated`. Un estado sin experimento detrás es una opinión con formato de
dato, que es justo lo que este fichero existe para impedir.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum


class Status(str, Enum):
    """Qué sabemos de esta capacidad."""

    VALIDATED = "VALIDATED"
    """Medida fuera de muestra, bate a su baseline, umbral preregistrado."""

    NOT_READY = "NOT_READY"
    """Produce números utilizables pero no ha demostrado batir a su baseline."""

    REJECTED = "REJECTED"
    """Medida y **rechazada**. No es que falte trabajo: es que no funciona."""

    BLOCKED = "BLOCKED"
    """Faltan datos o infraestructura. No se ha podido medir todavía."""

    DESIGN_ONLY = "DESIGN_ONLY"
    """Diseñada, sin implementar. No hay nada que enseñar."""


class Authority(str, Enum):
    """Cuánto puede decir la interfaz."""

    RECOMMEND = "RECOMMEND"
    """«Alinea a X», con la evidencia al lado."""

    INFORM = "INFORM"
    """Enseñar el número y dejar comparar. **No** recomendar."""

    DATA_ONLY = "DATA_ONLY"
    """El dato crudo, sin orden ni juicio. Ni rankings ni etiquetas."""

    HIDE = "HIDE"
    """No se enseña."""


# El mapeo es total y no tiene excepciones a propósito. En cuanto una capacidad
# pudiera saltarse su estado «porque este caso es distinto», el registro deja de
# valer para nada.
_AUTHORITY: dict[Status, Authority] = {
    Status.VALIDATED: Authority.RECOMMEND,
    Status.NOT_READY: Authority.INFORM,
    Status.REJECTED: Authority.DATA_ONLY,
    Status.BLOCKED: Authority.HIDE,
    Status.DESIGN_ONLY: Authority.HIDE,
}


@dataclass(frozen=True)
class Capability:
    """Una cosa que el producto podría querer afirmar."""

    id: str
    status: Status
    evidence: str
    experiment_id: str | None = None
    metric: str | None = None
    sample_size: int | None = None
    limitations: tuple[str, ...] = ()
    last_validated: str | None = None
    model_version: str | None = None

    @property
    def authority(self) -> Authority:
        """Se deriva del estado. No es un campo, para que no se pueda subir."""
        return _AUTHORITY[self.status]

    def as_payload(self) -> dict:
        data = asdict(self)
        data["status"] = self.status.value
        data["authority"] = self.authority.value
        data["limitations"] = list(self.limitations)
        return data


# --- el registro ------------------------------------------------------------
#
# Cada entrada apunta a un experimento del registro (`docs/experimentos/`) y
# lleva su número. Una entrada sin experimento sólo puede estar BLOCKED o
# DESIGN_ONLY: sin medición no hay nada que validar ni que rechazar.

MODEL_VERSION = "2026.08.29"

REGISTRY: tuple[Capability, ...] = (
    Capability(
        id="START_SIT_RB",
        status=Status.VALIDATED,
        evidence="53,9% de acierto en pares apretados frente al 51,8% de su forma reciente",
        experiment_id="E11",
        metric="acierto por pares = 0.539",
        sample_size=8294,
        limitations=(
            "Sólo pares con los dos jugadores proyectados por encima de 8 puntos.",
            "Por debajo de 1 punto de diferencia proyectada el acierto cae al 50,6%: "
            "ver SEPARATION_SCALE.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="START_SIT_WR",
        status=Status.VALIDATED,
        evidence="52,4% frente al 48,6% de su forma reciente — la mayor ventaja medida",
        experiment_id="E11",
        metric="acierto por pares = 0.524",
        sample_size=24834,
        limitations=("Misma zona de decisión que RB.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="START_SIT_TE",
        status=Status.VALIDATED,
        evidence="51,7% frente al 49,7% de su forma reciente",
        experiment_id="E11",
        metric="acierto por pares = 0.517",
        sample_size=3267,
        limitations=("Ventaja de 2 puntos porcentuales: la más pequeña de las tres validadas.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="START_SIT_QB",
        status=Status.NOT_READY,
        evidence=(
            "PIERDE contra la media ponderada de sus seis últimos partidos por tres "
            "vías independientes: Spearman 0,213 frente a 0,248, acierto por pares "
            "54,2% frente a 54,4%, y el MAE sólo gana después de mezclar"
        ),
        experiment_id="E6, E7, E11",
        metric="acierto por pares = 0.542 frente a baseline 0.544",
        sample_size=5959,
        limitations=(
            "El modelo produce proyecciones utilizables — la interfaz puede enseñarlas.",
            "Lo que no está validado es RECOMENDAR entre dos quarterbacks.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WEEKLY_PROJECTION",
        status=Status.VALIDATED,
        evidence="la mezcla con la forma reciente bate al baseline en MAE en las cuatro posiciones",
        experiment_id="E7",
        metric="MAE 5,13–6,57 según posición, siempre por debajo del baseline",
        sample_size=6299,
        limitations=(
            "Es una MEZCLA: el modelo solo no bate al baseline en ninguna posición.",
            "Calibrada en nivel, no en dispersión: la proyección sigue comprimida "
            "frente a la realidad (sd 3,3 frente a 8,4 en QB).",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="SEPARATION_SCALE",
        status=Status.VALIDATED,
        evidence=(
            "moneda al aire por debajo de 1 punto (50,6%), leve entre 1 y 3 (53–56%), "
            "claro entre 3 y 5 (59,8%), muy claro por encima de 5 (66,7%)"
        ),
        experiment_id="E12",
        metric="acierto por tramo de separación",
        sample_size=89114,
        limitations=(
            "Son frecuencias históricas del sistema, NO probabilidades por par.",
            "Decir «A tiene un 60% de superar a B» exigiría calibración por par, "
            "que es otro experimento.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="ROOKIE_PRIOR",
        status=Status.VALIDATED,
        evidence="Spearman 0,604 walk-forward frente a 0,093 de la media de posición",
        experiment_id="E9",
        metric="Spearman = 0.604",
        sample_size=2250,
        limitations=(
            "Gana en ORDEN, no en puntos: el MAE apenas bate a predecir cero, porque "
            "el rookie modal realmente hace cero puntos.",
            "La distribución es bimodal en varias celdas — el QB de 2ª ronda promedia "
            "63,4 con mediana 15,9. Hay que publicar intervalo, nunca un punto.",
            "El modelo de bust de veteranos NO aplica a quien no tiene historial NFL.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="KICKER_ORDINAL_RANKING",
        status=Status.REJECTED,
        evidence=(
            "la separación entre K1–K6 y K7–K12 es de 0,26 puntos por partido con "
            "IC95% [−0,36, +0,87]: no distinguible de cero"
        ),
        experiment_id="E8b",
        metric="diferencia K1-K6 menos K7-K12 = +0.26 pts/partido",
        sample_size=2108,
        limitations=(
            "El modelo SÍ bate a sus baselines en MAE — lo rechazado es el ORDEN "
            "dentro del top 12, no el modelo.",
            "Lo que distingue es «titular en buen ataque» frente a «suplente en ataque "
            "malo», y para eso nadie necesita un modelo.",
            "Presentación permitida: grupo de streaming. Nunca K1…K12.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="KICKER_SKILL_ESTIMATE",
        status=Status.REJECTED,
        evidence=(
            "el porcentaje de acierto no predice el del año siguiente (r 0,024) y su "
            "dispersión (0,071) apenas supera la del azar binomial (0,066)"
        ),
        experiment_id="E8",
        metric="r año N -> N+1 = 0.024",
        sample_size=359,
        limitations=("Alrededor del 13% de la varianza es habilidad. El resto es azar.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="BETTING_EDGE",
        status=Status.REJECTED,
        evidence=(
            "49,81% contra el spread, IC95% [48,2%, 51,4%], frente a un equilibrio de "
            "52,4%; y el acierto NO crece con la discrepancia (49,3% / 50,9% / 48,8%)"
        ),
        experiment_id="E4",
        metric="acierto ATS = 0.4981",
        sample_size=3736,
        limitations=("Regla permanente del proyecto: docs/REGLA_edge.md.",),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WEATHER_PREDICTION",
        status=Status.BLOCKED,
        evidence=(
            "el efecto del viento es real (−3,47 puntos por encima de 15 mph) pero "
            "nflverse sólo publica clima OBSERVADO: cero de los 272 partidos de 2026 "
            "lo traen"
        ),
        experiment_id="E10, E10b",
        metric="efecto medido = -3.47 pts, pero sin dato en tiempo de pronóstico",
        sample_size=5008,
        limitations=(
            "Se desbloquea con datos en tiempo de PRONÓSTICO y validación prospectiva.",
            "Los −2,22 puntos contra el total de cierre NO son una ventaja: son fuga.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="WEATHER_HISTORICAL",
        status=Status.VALIDATED,
        evidence="por encima de 15 mph los partidos anotan 3,47 puntos menos, IC95% [−4,78, −2,16]",
        experiment_id="E10",
        metric="diferencia = -3.47 pts",
        sample_size=5008,
        limitations=(
            "DESCRIPTIVO Y RETROSPECTIVO. Nunca como entrada de una predicción.",
            "Medido con viento observado; un pronóstico tiene su propio error, "
            "nunca medido aquí.",
        ),
        last_validated="2026-08-29",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="DST_STREAMING",
        status=Status.DESIGN_ONLY,
        evidence=(
            "el total implícito del rival predice los puntos permitidos a r 0,388, "
            "frente a r 0,060 del último partido de la propia defensa"
        ),
        experiment_id=None,
        metric="r = 0.388 (exploratorio, sin modelo construido)",
        sample_size=7658,
        limitations=(
            "Medido, no construido. No hay modelo ni validación walk-forward.",
            "Las pérdidas forzadas NO son una cualidad estable: balones sueltos "
            "año contra año r 0,044.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="MATCHUP_WIN_PROBABILITY",
        status=Status.BLOCKED,
        evidence="hacen falta distribuciones por jugador validadas, y no existen",
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Necesita: distribuciones de resultado por jugador, correlaciones dentro "
            "de una alineación y cobertura validada de los cuantiles.",
            "Sin eso, un «tienes un 61% de ganar» es un número inventado con dos cifras.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="MULTI_LEAGUE_SCORING",
        status=Status.BLOCKED,
        evidence="el payload publica puntos ya cocinados, no componentes proyectados",
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Se desbloquea con el bloque A de V2: componentes canónicos en el payload.",
            "El compilador de puntuación (ScoringRules) ya existe y funciona.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="MULTI_LEAGUE_DRAFT_STATE",
        status=Status.VALIDATED,
        evidence=(
            "el estado de draft se guarda bajo una clave compuesta "
            "(temporada + liga + draft) y 19 tests demuestran que no hay fuga entre "
            "ligas: A->B->A devuelve cada estado intacto y el blob global v1 no se "
            "atribuye a ninguna liga"
        ),
        experiment_id="E14",
        metric="19/19 escenarios de aislamiento, cero fugas",
        sample_size=19,
        limitations=(
            "Es ESTADO de liga, no VALOR por liga: el board sigue siendo uno solo.",
            "Sin las tres partes de la identidad no se persiste — falla seguro.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="LEAGUE_SPECIFIC_VALUE",
        status=Status.BLOCKED,
        evidence=(
            "el board publicado usa 12 equipos y PPR con QB1/RB2/WR3/TE1. El VOR "
            "depende del nivel de reemplazo, y el nivel de reemplazo depende del "
            "tamaño de la liga y de los huecos de titular: en una superflex, calcular "
            "con un solo quarterback no está «un poco mal», cambia el orden entero"
        ),
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "Depende de MULTI_LEAGUE_SCORING (bloque A de V2), también BLOCKED.",
            "Hasta entonces la interfaz enseña el estado real de tu liga y un board "
            "que NO está personalizado a ella. Las dos cosas a la vez, dichas.",
        ),
        last_validated=None,
        model_version=None,
    ),
    Capability(
        id="SLEEPER_SYNC_PERIODIC",
        status=Status.VALIDATED,
        evidence=(
            "comprobado desde GitHub Actions el 2026-08-30: `state/nfl` y "
            "`user/<nombre>` responden 200 con datos reales; `league/<id>/rosters` y "
            "`draft/<id>/picks` responden 404 sobre ids inventados, que es llegar al "
            "servicio. Contraste con api.github.com en 200"
        ),
        experiment_id="E13",
        metric="4 de 4 endpoints alcanzables (2x200, 2x404 esperado)",
        sample_size=4,
        limitations=(
            "Prueba alcance desde un runner, NO desde el navegador ni desde Vercel.",
            "Habilita la sincronización PERIÓDICA: waivers, traspasos y multi-liga, "
            "que no necesitan tiempo real.",
            "No habilita Game Day: eso necesita el camino del navegador, sin comprobar.",
        ),
        last_validated="2026-08-30",
        model_version=MODEL_VERSION,
    ),
    Capability(
        id="SLEEPER_LIVE_BROWSER",
        status=Status.BLOCKED,
        evidence=(
            "sin comprobar. El alcance desde servidor está demostrado (E13), pero el "
            "camino que usan el modo draft y Game Day es el del navegador del usuario, "
            "y eso sólo lo contesta un draft de verdad"
        ),
        experiment_id=None,
        metric=None,
        sample_size=None,
        limitations=(
            "La CSP ya permite connect-src a api.sleeper.app: el camino está abierto "
            "por diseño, sólo falta ejecutarlo una vez.",
            "El 403 de desarrollo NO era de Sleeper — era el proxy del contenedor, que "
            "bloquea también Google y el propio sitio de producción de este proyecto.",
        ),
        last_validated=None,
        model_version=None,
    ),
)

BY_ID: dict[str, Capability] = {c.id: c for c in REGISTRY}


def get(capability_id: str) -> Capability:
    """La capacidad, o revienta.

    No devuelve un valor por defecto permisivo a propósito: una capacidad que no
    está en el registro es una que nadie ha evaluado, y el comportamiento seguro
    ante lo no evaluado no es «adelante».
    """
    if capability_id not in BY_ID:
        raise KeyError(
            f"Capacidad desconocida: {capability_id!r}. Añádela al registro con su "
            f"experimento antes de usarla. Conocidas: {sorted(BY_ID)}"
        )
    return BY_ID[capability_id]


def may_recommend(capability_id: str) -> bool:
    """¿Puede la interfaz emitir una recomendación respaldada por esto?"""
    return get(capability_id).authority is Authority.RECOMMEND


def as_payload() -> dict:
    """El registro entero, para que viaje a la web."""
    return {
        "model_version": MODEL_VERSION,
        "capabilities": [c.as_payload() for c in REGISTRY],
    }
